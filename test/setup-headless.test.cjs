const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { gzipSync } = require('node:zlib');
const { spawnSync } = require('node:child_process');
const { tarFile } = require('../scripts/pack-headless.cjs');

test('headless setup wizard helpers preserve unrelated files and credentials', { skip: process.platform !== 'linux' }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cpa-wizard-test-'));
  const wizardPath = path.resolve(__dirname, '../scripts/setup-headless.sh');
  const wizard = fs.readFileSync(wizardPath, 'utf8');
  const python = wizard.split("<<'CPA_ARCHIVE_PY'\n")[1].split('\nCPA_ARCHIVE_PY')[0];
  const helper = path.join(root, 'archive-helper.py'); fs.writeFileSync(helper, python);
  const elf = Buffer.alloc(64); elf.write('\x7fELF'); elf[4] = 2; elf[5] = 1; elf.writeUInt16LE(process.arch === 'arm64' ? 183 : 62, 18);
  const files = {
    cpa: Buffer.from('#!/bin/sh\nexit 0\n'), 'launcher.cjs': Buffer.from('launcher'),
    'headless.cjs': Buffer.from('headless'), 'headless-update.cjs': Buffer.from('updater'),
    'environments.cjs': Buffer.from('environments'), 'runtime.cjs': Buffer.from('runtime'),
    'harness-config.cjs': Buffer.from('harness'), 'package.json': Buffer.from('{"name":"cpa-headless","version":"1.3.1"}'),
    'resources/cli-proxy-api': elf, 'resources/management.html': Buffer.from('<html>CPA</html>'),
    'resources/ui-provenance.json': Buffer.from('{}'), 'node_modules/yaml/package.json': Buffer.from('{"name":"yaml"}'),
    'node_modules/smol-toml/package.json': Buffer.from('{"name":"smol-toml"}'),
  };
  const archive = path.join(root, 'CPA-Headless-1.3.1-linux-' + process.arch + '.tar.gz');
  const entries = Object.entries(files).map(([name, bytes]) => tarFile(name, bytes, name === 'cpa' || name === 'resources/cli-proxy-api'));
  fs.writeFileSync(archive, gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)])));
  const run = (...args) => spawnSync('python3', [helper, ...args], { encoding: 'utf8', env: { ...process.env, CPA_API_PORT: '8318' } });
  const ok = (...args) => { const result = run(...args); assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout); };

  await t.test('syntax, template library, and noninteractive help', () => {
    assert.equal(spawnSync('bash', ['-n', wizardPath]).status, 0);
    const prefix = wizard.slice(0, wizard.indexOf('\n', wizard.indexOf('# STAGES:')) + 1);
    assert.equal(createHash('sha256').update(prefix).digest('hex'), '80d6d730ab523ad2d405ba775fe48cb7d7362e10d6b5b197ba4fda9fb0dd4afa');
    const result = spawnSync('bash', [wizardPath, '--help'], { encoding: 'utf8' });
    assert.equal(result.status, 0); assert.match(result.stdout, /Usage:/);
    assert.equal((wizard.match(/^stage '/gm) || []).length, 9);
  });

  const install = path.join(root, 'installed');
  await t.test('PATH setup preserves profiles, supports spaces, and is repeatable', () => {
    const directory = path.join(root, 'command path $literal'); fs.mkdirSync(directory);
    const command = path.join(directory, 'cpa'); fs.writeFileSync(command, '#!/bin/sh\nprintf "CPA path works\\n"\n', { mode: 0o755 });
    const profile = path.join(root, 'bashrc'); fs.writeFileSync(profile, '# Keep existing settings\nexport CPA_EXISTING_SETTING=retained\n');
    const call = spawnSync('bash', ['-c', 'source "$1"; cpa_add_to_path "$2" "$3"; cpa_add_to_path "$2" "$3"; cpa', 'test', wizardPath, directory, profile], { encoding: 'utf8' });
    assert.equal(call.status, 0, call.stderr); assert.match(call.stdout, /CPA path works/);
    const content = fs.readFileSync(profile, 'utf8'); assert.match(content, /CPA_EXISTING_SETTING=retained/);
    assert.equal((content.match(/# CPA headless PATH/g) || []).length, 1);
    const fresh = spawnSync('bash', ['--noprofile', '--norc', '-c', 'source "$1"; source "$1"; command -v cpa; cpa; printf "%s" "$CPA_EXISTING_SETTING"', 'test', profile], { encoding: 'utf8', env: { ...process.env, PATH: '/usr/bin:/bin' } });
    assert.equal(fresh.status, 0, fresh.stderr); assert.ok(fresh.stdout.includes(command)); assert.match(fresh.stdout, /CPA path works/); assert.match(fresh.stdout, /retained$/);
  });
  const data = path.join(root, 'saved-data'); fs.mkdirSync(data);
  const state = path.join(data, 'environment-auth.json'); fs.writeFileSync(state, '{"token":"fixture-private-token"}');
  await t.test('installs inside the chosen directory and safely reuses matching files', () => {
    assert.equal(ok('install', archive, install).version, '1.3.1');
    assert.equal(fs.readFileSync(path.join(install, 'cpa'), 'utf8'), files.cpa.toString());
    assert.ok(fs.statSync(path.join(install, 'cpa')).mode & 0o111);
    assert.equal(fs.existsSync(path.join(root, 'cpa')), false);
    ok('install', archive, install);
    assert.equal(ok('installed', install).version, '1.3.1');
    assert.equal(fs.readFileSync(state, 'utf8'), '{"token":"fixture-private-token"}');
    const foreign = path.join(root, 'unrelated-project'); fs.mkdirSync(foreign);
    fs.writeFileSync(path.join(foreign, 'package.json'), '{"name":"other-project"}');
    assert.notEqual(run('install', archive, foreign).status, 0);
    assert.equal(fs.existsSync(path.join(foreign, 'cpa')), false);
    assert.equal(fs.readFileSync(path.join(foreign, 'package.json'), 'utf8'), '{"name":"other-project"}');
  });

  await t.test('rejects unsafe archives and symlinked destinations', () => {
    for (const name of ['../escape', '/tmp/escape', 'resources/../../escape']) {
      const bad = path.join(root, 'bad.tar.gz'); fs.writeFileSync(bad, gzipSync(Buffer.concat([tarFile(name, Buffer.from('bad')), Buffer.alloc(1024)])));
      assert.notEqual(run('inspect', bad).status, 0);
    }
    const link = path.join(root, 'linked-install'); fs.symlinkSync(install, link);
    assert.notEqual(run('install', archive, link).status, 0);
    assert.equal(fs.readFileSync(path.join(install, 'cpa'), 'utf8'), files.cpa.toString());
  });

  await t.test('upgrading an older installation chooses a separate folder and retains saved data', () => {
    const previous = path.join(root, 'upgrade', 'cpa'); ok('install', archive, previous);
    const upgraded = { ...files, 'headless.cjs': Buffer.from('new headless implementation'), 'package.json': Buffer.from('{"name":"cpa-headless","version":"1.4.0"}') };
    const nextArchive = path.join(root, 'next.tar.gz');
    fs.writeFileSync(nextArchive, gzipSync(Buffer.concat([...Object.entries(upgraded).map(([name, bytes]) => tarFile(name, bytes, name === 'cpa' || name === 'resources/cli-proxy-api')), Buffer.alloc(1024)])));
    assert.notEqual(run('install', nextArchive, previous).status, 0, 'never overlay the old runtime');
    const destination = ok('destination', nextArchive, previous, data);
    assert.equal(destination.directory, previous + '-1.4.0');
    assert.equal(destination.previous, previous);
    ok('install', nextArchive, destination.directory);
    assert.equal(ok('installed', destination.directory).version, '1.4.0');
    assert.equal(fs.readFileSync(path.join(previous, 'headless.cjs'), 'utf8'), 'headless');
    assert.equal(fs.readFileSync(state, 'utf8'), '{"token":"fixture-private-token"}');
    assert.equal(ok('destination', nextArchive, destination.directory, data).directory, destination.directory);
    assert.notEqual(run('destination', archive, destination.directory, data).status, 0, 'do not downgrade an existing runtime');
    assert.notEqual(run('destination', nextArchive, previous, destination.directory).status, 0, 'runtime and state cannot overlap');
  });

  await t.test('same-version mixed files and occupied upgrade folders use a fresh runtime folder', () => {
    const mixed = path.join(root, 'mixed-install', 'cpa'); ok('install', archive, mixed);
    fs.writeFileSync(path.join(mixed, 'headless.cjs'), 'older or locally modified code');
    const occupied = mixed + '-1.3.1'; ok('install', archive, occupied);
    fs.writeFileSync(path.join(occupied, 'headless.cjs'), 'another modified runtime');
    const selected = ok('destination', archive, mixed, data);
    assert.notEqual(selected.directory, mixed);
    assert.notEqual(selected.directory, occupied);
    ok('install', archive, selected.directory);
    assert.equal(fs.readFileSync(path.join(selected.directory, 'headless.cjs'), 'utf8'), 'headless');
    assert.equal(fs.readFileSync(path.join(mixed, 'headless.cjs'), 'utf8'), 'older or locally modified code');
    assert.equal(fs.readFileSync(path.join(occupied, 'headless.cjs'), 'utf8'), 'another modified runtime');
    assert.equal(fs.readFileSync(state, 'utf8'), '{"token":"fixture-private-token"}');
    assert.equal(ok('destination', archive, mixed, data).directory, selected.directory, 'repeat setup reuses the matching runtime');
  });

  await t.test('cleanup removes only identical archive files and leaves changed and unrelated files', () => {
    const loose = path.join(root, 'earlier-extraction'); ok('install', archive, loose);
    fs.writeFileSync(path.join(loose, 'notes.txt'), 'my notes');
    fs.writeFileSync(path.join(loose, 'config.yaml'), 'my config');
    fs.mkdirSync(path.join(loose, 'auths')); fs.writeFileSync(path.join(loose, 'auths/account.json'), 'my credential');
    fs.writeFileSync(path.join(loose, 'resources/keep.png'), 'my picture');
    fs.writeFileSync(path.join(loose, 'node_modules/yaml/package.json'), 'modified by me');
    const plan = ok('plan', archive, loose, install, data);
    assert.equal(fs.existsSync(path.join(loose, 'cpa')), true, 'planning does not delete');
    assert.ok(plan.files.some(item => item.path.endsWith('/cpa')));
    assert.ok(plan.kept.includes('node_modules/yaml/package.json'));
    const result = ok('clean', archive, loose, install, data);
    assert.equal(result.removed, true);
    assert.equal(fs.existsSync(path.join(loose, 'cpa')), false);
    assert.equal(fs.readFileSync(path.join(loose, 'notes.txt'), 'utf8'), 'my notes');
    assert.equal(fs.readFileSync(path.join(loose, 'config.yaml'), 'utf8'), 'my config');
    assert.equal(fs.readFileSync(path.join(loose, 'auths/account.json'), 'utf8'), 'my credential');
    assert.equal(fs.readFileSync(path.join(loose, 'resources/keep.png'), 'utf8'), 'my picture');
    assert.equal(fs.readFileSync(path.join(loose, 'node_modules/yaml/package.json'), 'utf8'), 'modified by me');
    assert.equal(fs.readFileSync(state, 'utf8'), '{"token":"fixture-private-token"}');
    assert.equal(fs.readFileSync(path.join(install, 'cpa'), 'utf8'), files.cpa.toString());
    assert.equal(fs.existsSync(archive), true, 'loose-file cleanup retains the archive');
  });

  await t.test('cleanup cannot follow a symlink or target live installation/state', () => {
    const loose = path.join(root, 'symlink-extraction'); ok('install', archive, loose);
    const outside = path.join(root, 'outside'); fs.mkdirSync(outside);
    const protectedFile = path.join(outside, 'page.html'); fs.writeFileSync(protectedFile, files['resources/management.html']);
    const link = path.join(loose, 'resources/management.html'); fs.unlinkSync(link); fs.symlinkSync(protectedFile, link);
    assert.notEqual(run('clean', archive, install, install, data).status, 0);
    assert.notEqual(run('clean', archive, data, install, data).status, 0);
    ok('clean', archive, loose, install, data);
    assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
    assert.equal(fs.readFileSync(protectedFile, 'utf8'), files['resources/management.html'].toString());
    const unknown = path.join(root, 'unrelated-folder'); fs.mkdirSync(unknown); fs.writeFileSync(path.join(unknown, 'cpa'), files.cpa);
    assert.notEqual(run('clean', archive, unknown, install, data).status, 0);
    assert.equal(fs.existsSync(path.join(unknown, 'cpa')), true);
  });

  await t.test('published release digest and metadata must match the archive', () => {
    const meta = ok('inspect', archive);
    const name = path.basename(archive);
    const release = { tag_name: 'v1.3.1', assets: [{ name, digest: 'sha256:' + meta.sha256, browser_download_url: 'https://github.com/NaveDanan/CPA-Desktop/releases/download/v1.3.1/' + name }] };
    const file = path.join(root, 'release.json'); fs.writeFileSync(file, JSON.stringify(release));
    assert.equal(ok('verify-release', archive, file).version, '1.3.1');
    release.assets[0].digest = 'sha256:' + '0'.repeat(64); fs.writeFileSync(file, JSON.stringify(release));
    assert.notEqual(run('verify-release', archive, file).status, 0);
  });

  await t.test('service uses the launcher and public inputs cannot become extra commands', () => {
    const result = run('unit', install, data, process.execPath, 'VM "$HOME" %n', os.userInfo().username, '');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /launcher\.cjs/);
    assert.match(result.stdout, /WantedBy=multi-user.target/);
    assert.match(result.stdout, /KillMode=mixed/);
    assert.ok(result.stdout.includes('$$HOME')); assert.ok(result.stdout.includes('%%n'));
    const unit = path.join(root, 'cpa.service'); fs.writeFileSync(unit, result.stdout);
    const verified = spawnSync('systemd-analyze', ['verify', unit], { encoding: 'utf8' });
    assert.equal(verified.status, 0, verified.stderr);
    assert.notEqual(run('unit', install, data, '/usr/bin/node', 'VM\nExecStart=bad', os.userInfo().username, '').status, 0);
    assert.ok(result.stdout.includes('"--host" "0.0.0.0"'), 'service accepts direct VM connections');
    assert.ok(!wizard.includes('ssh -N'), 'setup does not require a PC tunnel');
    const predicate = wizard.split('\n').find(line => line.startsWith("python3 -c 'import ipaddress,sys;" )).split(' || ')[0];
    for (const target of ['192.168.1.50', '2001:db8::1']) assert.equal(spawnSync('bash', ['-c', 'CPA_VM_ADDRESS="$1"; ' + predicate, 'test', target]).status, 0);
    for (const target of ['-oProxyCommand=bad', '192.168.1.50;touch bad', '$(bad)']) assert.notEqual(spawnSync('bash', ['-c', 'CPA_VM_ADDRESS="$1"; ' + predicate, 'test', target]).status, 0);
  });
});
