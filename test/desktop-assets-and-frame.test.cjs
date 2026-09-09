const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('desktop app icon assets exist and are non-empty', () => {
  const icoPath = path.resolve(__dirname, '../assets/icon.ico');
  const pngPath = path.resolve(__dirname, '../assets/icon.png');
  assert.ok(fs.existsSync(icoPath), 'icon.ico exists in assets');
  assert.ok(fs.existsSync(pngPath), 'icon.png exists in assets');
  assert.ok(fs.statSync(icoPath).size > 1000, 'icon.ico is valid size');
  assert.ok(fs.statSync(pngPath).size > 1000, 'icon.png is valid size');
});

test('desktop package.json configures the icon and includes assets', () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
  assert.equal(pkg.build?.icon, 'assets/icon.ico', 'build.icon is configured');
  assert.equal(pkg.build?.win?.icon, 'assets/icon.ico', 'build.win.icon is configured');
  assert.ok(pkg.build?.files?.includes('assets/icon.ico'), 'Windows icon is included in build.files');
  assert.ok(pkg.build?.files?.includes('assets/icon.png'), 'PNG icon is included in build.files');
});

test('desktop main.cjs uses frameless window and sets the app icon', () => {
  const main = fs.readFileSync(path.resolve(__dirname, '../main.cjs'), 'utf8');
  assert.ok(main.includes('frame: false'), 'main.cjs configures frameless window (frame: false)');
  assert.ok(main.includes('icon: appIcon'), 'main.cjs passes appIcon to BrowserWindow');
  assert.ok(main.includes('window.setIcon(appIcon)'), 'main.cjs sets window icon explicitly');
  assert.ok(main.includes('desktop-minimize'), 'main.cjs handles desktop-minimize IPC');
  assert.ok(main.includes('desktop-toggle-maximize'), 'main.cjs handles desktop-toggle-maximize IPC');
  assert.ok(main.includes('desktop-close'), 'main.cjs handles desktop-close IPC');
});

test('desktop preload.cjs injects custom titlebar and controls matching app theme', () => {
  const preload = fs.readFileSync(path.resolve(__dirname, '../preload.cjs'), 'utf8');
  assert.ok(preload.includes('setupDesktopTitlebar'), 'preload.cjs defines setupDesktopTitlebar');
  assert.ok(preload.includes('desktop-titlebar'), 'preload.cjs injects desktop-titlebar');
  assert.ok(preload.includes('desktop-btn-minimize'), 'preload.cjs has minimize button');
  assert.ok(preload.includes('desktop-btn-maximize'), 'preload.cjs has maximize/restore button');
  assert.ok(preload.includes('desktop-btn-close'), 'preload.cjs has close button');
  assert.ok(preload.includes('var(--bg-secondary'), 'preload.cjs styles align with app theme variables');
});

test('desktop titlebar drops the brand block and starts beside a full-height sidebar', () => {
  const preload = fs.readFileSync(path.resolve(__dirname, '../preload.cjs'), 'utf8');
  assert.ok(!preload.includes('desktop-titlebar-badge'), 'the DESKTOP badge is removed');
  assert.ok(!preload.includes('desktop-titlebar-icon'), 'the titlebar brand icon is removed');
  assert.ok(!preload.includes('desktop-titlebar-title'), 'the titlebar brand title is removed');
  assert.ok(preload.includes('--desktop-titlebar-left'), 'titlebar offset variable is defined');
  assert.ok(preload.includes('left: var(--desktop-titlebar-left)'), 'titlebar starts where the sidebar ends');
  assert.ok(/\.sidebar\s*\{\s*height: 100vh !important;/.test(preload), 'sidebar takes the full window height');

  const main = fs.readFileSync(path.resolve(__dirname, '../main.cjs'), 'utf8');
  assert.ok(!main.includes('desktop-get-icon'), 'main.cjs drops the unused titlebar icon channel');
});

test('the embedded CLI setup iframe is allowed to submit its form and open its dialog', () => {
  const preload = fs.readFileSync(path.resolve(__dirname, '../preload.cjs'), 'utf8');
  const sandbox = preload.match(/setAttribute\('sandbox', '([^']*)'\)/)?.[1] ?? '';
  assert.ok(sandbox.includes('allow-scripts'), 'iframe keeps scripting');
  assert.ok(sandbox.includes('allow-forms'), 'Apply to CLIs submits its form');
  assert.ok(sandbox.includes('allow-modals'), 'Restore Defaults opens its modal dialog');
  assert.ok(!sandbox.includes('allow-same-origin'), 'iframe stays in an opaque origin');
});
