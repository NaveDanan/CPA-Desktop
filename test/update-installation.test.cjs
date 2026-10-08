const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { createUpdateChecker, newerRelease } = require('../updates.cjs');
const { cleanupUpdateCache, takeInstallError, removeUpdateDirectory, launchUpdateInstaller } = require('../update-installer.cjs');

const bytes = Buffer.from('An installer fixture, never executed.');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const asset = { name: 'CLIProxyAPI-Desktop-Setup-1.3.0.exe', size: bytes.length, state: 'uploaded', digest: `sha256:${sha256}` };
const release = (changes = {}) => ({ tag_name: 'v1.3.0', assets: [asset], ...changes });
const response = (value) => ({ ok: true, json: async () => [value] });

async function fixture(t, overrides = {}) {
  const root = path.resolve(__dirname, '../test-results/update-installation');
  await fs.mkdir(root, { recursive: true });
  const cacheDir = await fs.mkdtemp(path.join(root, 'case-'));
  let installed;
  const checker = createUpdateChecker({
    currentVersion: '1.2.6', cacheDir,
    fetchRelease: async () => response(release()),
    fetchInstaller: async () => new Response(bytes),
    installUpdate: async (update) => { installed = update; },
    ...overrides,
  });
  t.after(async () => {
    await checker.stop();
    await fs.rm(cacheDir, { recursive: true, force: true });
  });
  await checker.check();
  return { checker, cacheDir, installed: () => installed };
}

test('installer metadata requires a matching uploaded asset with size and digest', () => {
  const valid = newerRelease(release(), '1.2.6').installer;
  assert.equal(valid.sha256, sha256);
  assert.equal(valid.url, 'https://github.com/NaveDanan/CPA-Desktop/releases/download/v1.3.0/CLIProxyAPI-Desktop-Setup-1.3.0.exe');
  for (const changes of [{ name: 'other.exe' }, { state: 'new' }, { digest: null }, { digest: {} }, { digest: 'sha256:invalid' }, { size: 0 }, { size: -1 }, { size: 1.5 }]) {
    assert.equal(newerRelease(release({ assets: [{ ...asset, ...changes }] }), '1.2.6').installer, null);
  }
});

test('Windows helper survives the app process exiting and reports installer failure', { skip: process.platform !== 'win32', timeout: 20000 }, async (t) => {
  const { checker, cacheDir } = await fixture(t);
  await checker.download();
  const [name] = await fs.readdir(cacheDir);
  const directory = path.join(cacheDir, name);
  const update = {
    version: '1.3.0', directory, file: path.join(directory, 'installer.exe'), sha256, size: bytes.length,
    cacheDir, appPath: path.join(cacheDir, 'never-launch.exe'), userData: path.join(cacheDir, 'данные שלום'),
  };
  const launcher = `require(${JSON.stringify(path.resolve(__dirname, '../update-installer.cjs'))}).launchUpdateInstaller(${JSON.stringify(update)}).catch(error => { console.error(error); process.exitCode = 1; });`;
  const child = spawn(process.execPath, ['-e', launcher], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stderr.on('data', (chunk) => { output += chunk; });
  assert.equal(await new Promise((resolve) => child.once('exit', resolve)), 0, output);
  let result;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { result = JSON.parse(await fs.readFile(path.join(cacheDir, 'last-install.json'), 'utf8')); break; }
    catch { await delay(100); }
  }
  // The fixture is not an executable. Windows rejects it; no app installation occurs.
  assert.equal(result?.success, false);
  assert.ok(result.error);
  assert.match(await takeInstallError(cacheDir), /could not be installed/);
});

test('downloads verified bytes once, then hands off installation once without deleting its job', async (t) => {
  let downloads = 0;
  const { checker, installed } = await fixture(t, {
    fetchInstaller: async (url, options) => {
      downloads++;
      assert.equal(options.headers.Authorization, undefined);
      assert.match(url, /^https:\/\/github.com\/NaveDanan\/CPA-Desktop\/releases\/download\//);
      return new Response(bytes);
    },
  });
  const pending = checker.download();
  assert.equal(checker.download(), pending);
  const state = await pending;
  assert.equal(state.status, 'downloaded');
  assert.deepEqual(state.progress, { received: bytes.length, total: bytes.length });
  assert.equal((await checker.check()).status, 'downloaded');
  const first = checker.install();
  assert.equal(checker.install(), first);
  assert.equal((await first).status, 'installing');
  const update = installed();
  assert.deepEqual(await fs.readFile(update.file), bytes);
  await checker.stop();
  assert.deepEqual(await fs.readFile(update.file), bytes);
  assert.equal(downloads, 1);
});

test('wrong checksums, truncated bytes, and oversized downloads cannot be installed and leave no partial files', async (t) => {
  for (const body of [Buffer.alloc(bytes.length), bytes.subarray(1), Buffer.concat([bytes, bytes])]) {
    const { checker, cacheDir, installed } = await fixture(t, { fetchInstaller: async () => new Response(body) });
    const state = await checker.download();
    assert.equal(state.status, 'available');
    assert.match(state.error, /verified|size/);
    await checker.install();
    assert.equal(installed(), undefined);
    assert.deepEqual(await fs.readdir(cacheDir), []);
  }
});

test('cancelling an in-progress download removes its job and permits a retry', async (t) => {
  let started;
  const fetching = new Promise((resolve) => { started = resolve; });
  let attempts = 0;
  const { checker, cacheDir } = await fixture(t, { fetchInstaller: async (_url, { signal }) => {
    if (++attempts > 1) return new Response(bytes);
    started();
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
    });
  } });
  const pending = checker.download();
  await fetching;
  assert.equal((await checker.cancelDownload()).status, 'available');
  assert.equal((await pending).error, null);
  assert.deepEqual(await fs.readdir(cacheDir), []);
  assert.equal((await checker.download()).status, 'downloaded');
  await checker.stop();
  assert.deepEqual(await fs.readdir(cacheDir), []);
});

test('changed downloaded files and failed installation handoffs keep the app available to retry', async (t) => {
  const { checker, cacheDir, installed } = await fixture(t);
  await checker.download();
  const [directory] = await fs.readdir(cacheDir);
  const downloadedFile = path.join(cacheDir, directory, 'installer.exe');
  await fs.writeFile(downloadedFile, Buffer.alloc(bytes.length));
  assert.equal((await checker.install()).status, 'available');
  assert.equal(installed(), undefined);
  assert.deepEqual(await fs.readdir(cacheDir), []);

  const failed = await fixture(t, { installUpdate: async () => { throw new Error('helper blocked'); } });
  await failed.checker.download();
  const state = await failed.checker.install();
  assert.equal(state.status, 'available');
  assert.match(state.error, /Unable to start/);
  assert.deepEqual(await fs.readdir(failed.cacheDir), []);
  assert.equal((await failed.checker.download()).status, 'downloaded');
});

test('cache cleanup preserves active helper jobs and unrelated files, and rejects deletion outside the cache', async (t) => {
  const { checker, cacheDir } = await fixture(t);
  const active = path.join(cacheDir, 'update-active');
  const interrupted = path.join(cacheDir, 'update-interrupted');
  await fs.mkdir(active);
  await fs.mkdir(interrupted);
  await fs.writeFile(path.join(active, 'ready.json'), JSON.stringify({ pid: process.pid }));
  await fs.writeFile(path.join(cacheDir, 'keep.txt'), 'keep');
  await cleanupUpdateCache(cacheDir);
  assert.deepEqual((await fs.readdir(cacheDir)).sort(), ['keep.txt', 'update-active']);
  await assert.rejects(removeUpdateDirectory(cacheDir, path.dirname(cacheDir)), /Invalid temporary/);
  await fs.writeFile(path.join(cacheDir, 'last-install.json'), JSON.stringify({ success: false }));
  const message = await takeInstallError(cacheDir);
  assert.match(message, /could not be installed/);
  assert.equal(await takeInstallError(cacheDir), null);
  await checker.stop();
});

test('Windows helper acknowledges a UTF-8 job before waiting for the app to quit', { skip: process.platform !== 'win32', timeout: 15000 }, async (t) => {
  let helperPid;
  t.after(() => { if (helperPid) process.kill(helperPid); });
  const { checker, cacheDir } = await fixture(t);
  await checker.download();
  const [name] = await fs.readdir(cacheDir);
  const directory = path.join(cacheDir, name);
  await launchUpdateInstaller({
    version: '1.3.0', directory, file: path.join(directory, 'installer.exe'), sha256, size: bytes.length,
    cacheDir, appPath: path.join(cacheDir, 'never-launch.exe'), userData: path.join(cacheDir, 'данные שלום'),
  }).catch(async (error) => {
    const result = await fs.readFile(path.join(cacheDir, 'last-install.json'), 'utf8').catch(() => '');
    throw new Error(`${error.message}\n${result}`);
  });
  const ready = JSON.parse(await fs.readFile(path.join(directory, 'ready.json'), 'utf8'));
  // The helper is waiting for this test process. Stop it before any installer runs.
  helperPid = ready.pid;
  assert.ok(ready.pid > 0);
  process.kill(ready.pid, 0);
  const job = JSON.parse(await fs.readFile(path.join(directory, 'job.json'), 'utf8'));
  assert.equal(job.restartArgs[1], path.join(cacheDir, 'данные שלום'));
});
