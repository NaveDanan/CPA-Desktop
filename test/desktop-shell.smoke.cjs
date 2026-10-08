// Run with Electron from the desktop directory. Uses an isolated page and mocked releases.
const { app, BrowserWindow, ipcMain, Tray, Menu } = require('electron');
const { createServer } = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { setupTray } = require('../tray.cjs');
app.setPath('userData', path.resolve(__dirname, '../test-results/desktop-shell/profile'));
let server;
let tray;
let exiting = false;
app.on('before-quit', () => { exiting = true; tray?.destroy(); server?.close(); });
app.whenReady().then(async () => {
  server = createServer((_req, res) => res.end('<!doctype html><html><head></head><body style="margin:0;background:#141311;color:white"><main style="padding:70px 240px;font-family:Segoe UI">Desktop shell test</main></body></html>'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let state = { currentVersion: '1.1.0', status: 'available', canInstall: true, progress: null, release: { version: '1.2.0', installer: { size: 104857600 }, notes: '## What\'s new\n\n- Automatic GitHub release checks\n- Download and install updates in the app\n\n<script>window.injected = true</script>' }, error: null };
  let resolveDownload;
  let downloads = 0;
  let installs = 0;
  let failDownload = false;
  ipcMain.handle('desktop-update-state', () => state);
  ipcMain.handle('desktop-get-maximize-state', () => false);
  ipcMain.handle('desktop-branding', () => ({ name: 'CPA for Desktop', logo: '' }));
  ipcMain.handle('desktop-open-release', () => false);
  ipcMain.handle('desktop-check-updates', () => state);
  ipcMain.handle('desktop-download-update', () => {
    if (failDownload) throw new Error('Mocked download failure');
    downloads++;
    state = { ...state, status: 'downloading', progress: { received: 52428800, total: 104857600 } };
    window.webContents.send('desktop-update-state', state);
    return new Promise((resolve) => { resolveDownload = resolve; });
  });
  ipcMain.handle('desktop-cancel-update', () => {
    state = { ...state, status: 'available', progress: null };
    window.webContents.send('desktop-update-state', state);
    resolveDownload(state);
    return state;
  });
  ipcMain.handle('desktop-install-update', () => {
    installs++;
    state = { ...state, status: 'installing' };
    window.webContents.send('desktop-update-state', state);
    return state;
  });
  const window = new BrowserWindow({ width: 1100, height: 750, show: false, frame: false,
    webPreferences: { preload: path.resolve(__dirname, '../preload.cjs'), backgroundThrottling: false, sandbox: true, contextIsolation: true, nodeIntegration: false, additionalArguments: [`--desktop-origin=${origin}`] } });
  tray = setupTray({ Tray, Menu, app, window, icon: path.resolve(__dirname, '../assets/icon.ico'), isExiting: () => exiting, checkForUpdates: async () => state });
  await window.loadURL(`${origin}/management.html`);
  window.show();
  window.focus();
  const run = (code) => window.webContents.executeJavaScript(code);
  const capture = async () => {
    await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))');
    return window.webContents.capturePage();
  };
  const waitFor = (condition) => run(`new Promise((resolve, reject) => {
    const timer = setTimeout(() => { observer.disconnect(); reject(new Error('Update panel did not reach expected state')); }, 5000);
    const inspect = () => { if (${condition}) { clearTimeout(timer); observer.disconnect(); resolve(); } };
    const observer = new MutationObserver(inspect);
    observer.observe(document.getElementById('desktop-updates'), { subtree: true, childList: true, attributes: true });
    inspect();
  })`);
  await run("document.getElementById('desktop-update-button').focus()");
  const result = await run(`({ label: document.getElementById('desktop-update-button').textContent, visible: !document.getElementById('desktop-update-panel').hidden, notes: document.getElementById('desktop-update-notes').textContent, injected: window.injected === true, releaseVisible: !document.getElementById('desktop-view-release').hidden })`);
  assert.match(result.label, /1.2.0/);
  assert.equal(result.visible, true);
  assert.equal(result.releaseVisible, true);
  assert.equal(result.injected, false);
  assert.match(result.notes, /<script>/);
  assert.equal(await run("document.getElementById('desktop-download-update').hidden"), false);
  const screenshot = await capture();
  fs.mkdirSync(path.resolve(__dirname, '../test-results/desktop-shell'), { recursive: true });
  fs.writeFileSync(path.resolve(__dirname, '../test-results/desktop-shell/update-panel.png'), screenshot.toPNG());
  failDownload = true;
  await run("document.getElementById('desktop-download-update').focus(); document.getElementById('desktop-download-update').click()");
  await waitFor("document.getElementById('desktop-update-message').textContent === 'Unable to download the update. Try again.'");
  assert.equal(await run("document.activeElement.id"), 'desktop-download-update');
  failDownload = false;
  await run("document.getElementById('desktop-download-update').focus(); document.getElementById('desktop-download-update').click()");
  await waitFor("!document.getElementById('desktop-cancel-update').hidden");
  assert.equal(downloads, 1);
  assert.equal(await run("document.getElementById('desktop-update-progress').value"), 50);
  assert.equal(await run("document.activeElement.id"), 'desktop-cancel-update');
  fs.writeFileSync(path.resolve(__dirname, '../test-results/desktop-shell/downloading.png'), (await capture()).toPNG());
  await run("document.getElementById('desktop-cancel-update').click()");
  await waitFor("!document.getElementById('desktop-download-update').disabled");
  assert.equal(await run("document.getElementById('desktop-update-progress').hidden"), true);
  await run("document.getElementById('desktop-download-update').click()");
  await waitFor("!document.getElementById('desktop-cancel-update').hidden");
  state = { ...state, status: 'downloaded' };
  window.webContents.send('desktop-update-state', state);
  resolveDownload(state);
  await waitFor("!document.getElementById('desktop-install-update').hidden");
  assert.equal(downloads, 2);
  assert.equal(await run("document.activeElement.id"), 'desktop-install-update');
  assert.match(await run("document.getElementById('desktop-update-message').textContent"), /interrupt active requests/);
  fs.writeFileSync(path.resolve(__dirname, '../test-results/desktop-shell/ready-to-install.png'), (await capture()).toPNG());
  window.setSize(850, 600);
  await run("document.documentElement.style.cssText = '--bg-secondary:#fff;--bg-tertiary:#eee;--text-primary:#171717;--text-secondary:#555;--border-color:#bbb'");
  assert.equal(await run("document.getElementById('desktop-update-panel').scrollWidth <= document.getElementById('desktop-update-panel').clientWidth"), true);
  fs.writeFileSync(path.resolve(__dirname, '../test-results/desktop-shell/ready-to-install-light.png'), (await capture()).toPNG());
  await run("document.getElementById('desktop-install-update').click()");
  await waitFor("document.getElementById('desktop-update-button').textContent === 'Installing update…'");
  assert.equal(installs, 1);
  assert.equal(await run("document.getElementById('desktop-install-update').disabled"), true);
  await run("document.getElementById('desktop-updates').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  assert.equal(await run("document.getElementById('desktop-update-panel').hidden"), true);
  await run("document.getElementById('desktop-updates').dispatchEvent(new Event('pointerenter'))");
  assert.equal(await run("document.getElementById('desktop-update-panel').hidden"), false);
  state = { currentVersion: '1.1.0', status: 'current', release: null, error: null };
  const rendered = run(`new Promise(resolve => {
    const button = document.getElementById('desktop-update-button');
    if (button.textContent === 'Up to date') { resolve(); return; }
    const observer = new MutationObserver(() => {
      if (button.textContent === 'Up to date') { observer.disconnect(); resolve(); }
    });
    observer.observe(button, { childList: true });
  })`);
  window.webContents.send('desktop-update-state', state);
  await rendered;
  assert.equal(await run("document.getElementById('desktop-view-release').hidden"), true);
  window.show();
  window.close();
  assert.equal(window.isDestroyed(), false);
  assert.equal(window.isVisible(), false);
  tray.emit('click');
  assert.equal(window.isVisible(), true);
  console.log('Desktop shell smoke passed: download progress, cancellation, retry, install action, keyboard focus, light/dark layouts, safe notes, current state, and tray close/reopen.');
  app.quit();
}).catch((error) => {
  console.error(error);
  exiting = true;
  tray?.destroy();
  server?.close();
  app.exit(1);
});
