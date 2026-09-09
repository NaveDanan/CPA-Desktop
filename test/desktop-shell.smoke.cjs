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
  let state = { currentVersion: '1.1.0', status: 'available', release: { version: '1.2.0', notes: '## What\'s new\n\n- Automatic GitHub release checks\n- Keep the proxy running in the tray\n\n<script>window.injected = true</script>' }, error: null };
  ipcMain.handle('desktop-update-state', () => state);
  ipcMain.handle('desktop-get-maximize-state', () => false);
  ipcMain.handle('desktop-open-release', () => false);
  ipcMain.handle('desktop-check-updates', () => state);
  const window = new BrowserWindow({ width: 1100, height: 750, show: false, frame: false,
    webPreferences: { preload: path.resolve(__dirname, '../preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, additionalArguments: [`--desktop-origin=${origin}`] } });
  tray = setupTray({ Tray, Menu, app, window, icon: path.resolve(__dirname, '../assets/icon.ico'), isExiting: () => exiting, checkForUpdates: async () => state });
  await window.loadURL(`${origin}/management.html`);
  window.show();
  window.focus();
  const run = (code) => window.webContents.executeJavaScript(code);
  await run("document.getElementById('desktop-update-button').focus()");
  const result = await run(`({ label: document.getElementById('desktop-update-button').textContent, visible: !document.getElementById('desktop-update-panel').hidden, notes: document.getElementById('desktop-update-notes').textContent, injected: window.injected === true, releaseVisible: !document.getElementById('desktop-view-release').hidden })`);
  assert.match(result.label, /1.2.0/);
  assert.equal(result.visible, true);
  assert.equal(result.releaseVisible, true);
  assert.equal(result.injected, false);
  assert.match(result.notes, /<script>/);
  const screenshot = await window.webContents.capturePage();
  fs.mkdirSync(path.resolve(__dirname, '../test-results/desktop-shell'), { recursive: true });
  fs.writeFileSync(path.resolve(__dirname, '../test-results/desktop-shell/update-panel.png'), screenshot.toPNG());
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
  console.log('Desktop shell smoke passed: release indicator, safe notes, focus/hover/Escape, current state, native tray close and reopen.');
  app.quit();
}).catch((error) => {
  console.error(error);
  exiting = true;
  tray?.destroy();
  server?.close();
  app.exit(1);
});
