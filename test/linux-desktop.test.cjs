const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { setupLinuxDesktop, DESKTOP_FILE, APP_ID } = require('../linux-desktop.cjs');

function fixture() {
  const root = process.platform === 'linux' ? fs.mkdtempSync(path.join(os.tmpdir(), 'cpa-linux-desktop-')) : path.resolve(__dirname, '../test-results/linux-desktop', randomUUID());
  fs.mkdirSync(root, { recursive: true });
  const appImage = path.join(root, 'CPA Desktop.AppImage'); fs.writeFileSync(appImage, 'fixture');
  const userData = path.join(root, 'state'); fs.mkdirSync(userData);
  const state = path.join(userData, 'environments.json'); fs.writeFileSync(state, '{"saved":"connection"}');
  const options = { appImage, userData, iconPath: path.resolve(__dirname, '../assets/icon.png'), home: root,
    env: { XDG_CONFIG_HOME: path.join(root, 'config'), XDG_DATA_HOME: path.join(root, 'data') } };
  return { root, state, options };
}

test('AppImage startup and application entries preserve the executable, profile, and persistent icon', () => {
  const { options, state } = fixture();
  const result = setupLinuxDesktop(options);
  const startup = fs.readFileSync(result.autostartFile, 'utf8');
  const launcher = fs.readFileSync(result.launcherFile, 'utf8');
  assert.equal(path.basename(result.autostartFile), DESKTOP_FILE);
  assert.ok(startup.includes(options.appImage.replace(/\\/g, '\\\\\\\\')));
  assert.match(startup, / --background\n/);
  assert.ok(!launcher.includes('--background'));
  assert.match(startup, /--user-data-dir/);
  assert.ok(!startup.includes('/tmp/.mount_'));
  assert.match(launcher, new RegExp('StartupWMClass=' + APP_ID.replace(/\./g, '\\.')));
  assert.deepEqual(fs.readFileSync(result.iconFile), fs.readFileSync(options.iconPath));
  assert.equal(fs.readFileSync(state, 'utf8'), '{"saved":"connection"}');
  const modified = fs.statSync(result.autostartFile).mtimeMs;
  setupLinuxDesktop(options);
  assert.equal(fs.statSync(result.autostartFile).mtimeMs, modified, 'unchanged registration does not rewrite startup settings');
});

test('a new AppImage refreshes paths while retaining disabled startup, custom fields, and action groups', () => {
  const { root, options } = fixture();
  const result = setupLinuxDesktop(options);
  fs.appendFileSync(result.autostartFile, 'Hidden=true\nX-GNOME-Autostart-enabled=false\nOnlyShowIn=GNOME;\n# User preference\n[Desktop Action Custom]\nExec=custom-command\n');
  const next = path.join(root, 'CPA-1.3.2.AppImage'); fs.writeFileSync(next, 'next');
  setupLinuxDesktop({ ...options, appImage: next });
  const startup = fs.readFileSync(result.autostartFile, 'utf8');
  assert.ok(startup.includes('CPA-1.3.2.AppImage'));
  assert.ok(!startup.includes('CPA Desktop.AppImage'));
  assert.match(startup, /Hidden=true\n/);
  assert.match(startup, /X-GNOME-Autostart-enabled=false\n/);
  assert.match(startup, /OnlyShowIn=GNOME;\n/);
  assert.match(startup, /# User preference\n\[Desktop Action Custom\]\nExec=custom-command\n/);
});

test('relative XDG paths use standard home locations and invalid executable paths leave settings alone', () => {
  const { root, options } = fixture();
  const result = setupLinuxDesktop({ ...options, env: { XDG_CONFIG_HOME: 'relative', XDG_DATA_HOME: 'relative' } });
  assert.equal(result.autostartFile, path.join(root, '.config/autostart', DESKTOP_FILE));
  assert.equal(result.launcherFile, path.join(root, '.local/share/applications', DESKTOP_FILE));
  const before = fs.readFileSync(result.autostartFile, 'utf8');
  assert.throws(() => setupLinuxDesktop({ ...options, appImage: 'relative.AppImage' }), /persistent AppImage/);
  assert.equal(fs.readFileSync(result.autostartFile, 'utf8'), before);
});

test('Linux desktop launcher executes special-character paths literally and login adds only background mode', { skip: process.platform !== 'linux' }, async () => {
  const { root, options } = fixture();
  const appImage = path.join(root, 'CPA space "quotes" $dollar `tick` %u \\slash.AppImage');
  fs.writeFileSync(appImage, '#!/usr/bin/env node\nrequire("node:fs").writeFileSync(process.env.CPA_TEST_ARGV,JSON.stringify(process.argv.slice(2)));\n', { mode: 0o755 });
  const result = setupLinuxDesktop({ ...options, appImage });
  for (const [file, background] of [[result.launcherFile, false], [result.autostartFile, true]]) {
    const output = path.join(root, randomUUID() + '.json');
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { watcher.close(); reject(new Error('Desktop launch did not execute the AppImage path')); }, 8000);
      const watcher = fs.watch(root, () => { if (fs.existsSync(output)) { clearTimeout(timer); watcher.close(); resolve(); } });
      try { execFileSync('gio', ['launch', file], { env: { ...process.env, CPA_TEST_ARGV: output }, timeout: 8000 }); }
      catch (error) { clearTimeout(timer); watcher.close(); reject(error); }
    });
    assert.deepEqual(JSON.parse(fs.readFileSync(output, 'utf8')), ['--user-data-dir', options.userData, ...(background ? ['--background'] : [])]);
  }
});
