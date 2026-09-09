const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setupTaskbar } = require('../taskbar.cjs');

test('taskbar uses a persistent icon and updates only this app shortcuts without changing their targets', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cpa-taskbar-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const desktop = path.join(root, 'Desktop');
  fs.mkdirSync(desktop);
  for (const name of ['app.lnk', 'other.lnk']) fs.writeFileSync(path.join(desktop, name), 'fixture');
  const iconPath = path.join(root, 'source.ico');
  fs.writeFileSync(iconPath, 'first icon');
  let details;
  const updates = [];
  const options = {
    window: { setAppDetails: (value) => { details = value; } },
    app: { isPackaged: true, getAppPath: () => root, getPath: (key) => key === 'desktop' ? desktop : root },
    shell: {
      readShortcutLink: (file) => ({ target: path.join(root, file.endsWith('app.lnk') ? 'CLIProxyAPI Desktop.exe' : 'Other.exe'), icon: 'old.ico', iconIndex: 0 }),
      writeShortcutLink: (...args) => { updates.push(args); return true; },
    },
    iconPath, userData: path.join(root, 'profile'), executable: 'C:\\App Folder\\app.exe',
  };
  const first = setupTaskbar(options);
  assert.equal(details.appId, 'io.cliproxy.desktop');
  assert.equal(details.appIconPath, first);
  assert.equal(details.relaunchCommand, '"C:\\App Folder\\app.exe"');
  assert.equal(fs.readFileSync(first, 'utf8'), 'first icon');
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0], [path.join(desktop, 'app.lnk'), 'update', { target: path.join(root, 'CLIProxyAPI Desktop.exe'), icon: first, iconIndex: 0 }]);
  assert.equal(setupTaskbar(options), first, 'unchanged icons retain their path');
  fs.writeFileSync(iconPath, 'new icon');
  assert.notEqual(setupTaskbar(options), first, 'new icon content gets a new cache identity');
});
