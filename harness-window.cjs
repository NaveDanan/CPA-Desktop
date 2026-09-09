const { ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { randomBytes } = require('node:crypto');
const { createHarnessService } = require('./harness-config.cjs');

function setupHarnessWindow(parent, runtime, userData) {
  const service = createHarnessService(runtime, userData);

  let applying = false;
  const readTheme = () => parent.webContents.executeJavaScript(`(() => {
    const style = getComputedStyle(document.documentElement);
    const keys = ['bg-primary', 'bg-secondary', 'bg-tertiary', 'bg-hover', 'text-primary', 'text-secondary', 'border-color', 'border-primary', 'primary-color', 'primary-hover', 'primary-active', 'success-badge-text', 'failure-badge-text'];
    return { name: document.documentElement.dataset.theme || 'light', tokens: Object.fromEntries(keys.map(key => ['--' + key, style.getPropertyValue('--' + key).trim()])) };
  })()`);
  const trusted = (event) => event.sender === parent.webContents && event.senderFrame === parent.webContents.mainFrame && new URL(event.senderFrame.url).origin === runtime.origin && new URL(event.senderFrame.url).pathname === '/management.html';
  const handle = (name, action) => ipcMain.handle(name, async (event, ...args) => {
    if (!trusted(event)) throw new Error('Untrusted configuration request.');
    try { return { value: await action(...args) }; }
    catch (error) { return { error: error.message }; }
  });
  handle('harness:page', () => {
    const nonce = randomBytes(18).toString('base64');
    const read = (name) => fs.readFileSync(path.join(__dirname, name), 'utf8');
    return read('harness.html')
      .replace("script-src 'self'; style-src 'self'", `script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'`)
      .replace('<link rel="stylesheet" href="harness.css">', `<style nonce="${nonce}">${read('harness.css')}</style>`)
      .replace('<script src="harness-renderer.js" defer></script>', `<script nonce="${nonce}">${read('harness-bridge.js')}</script>`)
      .replace('</body>', `<script nonce="${nonce}">${read('harness-renderer.js')}</script></body>`);
  });
  handle('harness:load', () => service.load());
  handle('harness:theme', readTheme);
  handle('harness:inspect', (harness, value) => service.inspect(harness, value));
  handle('harness:browse', async (harness, value) => {
    if (!['codex', 'claude'].includes(harness)) throw new Error('Unknown CLI.');
    const result = await dialog.showSaveDialog(parent, {
      title: `Locate ${harness === 'codex' ? 'Codex' : 'Claude Code'} configuration`,
      defaultPath: value, buttonLabel: 'Use this path',
      filters: [{ name: 'Configuration', extensions: [harness === 'codex' ? 'toml' : 'json'] }],
      properties: ['showHiddenFiles'],
    });
    return result.canceled ? null : service.inspect(harness, result.filePath);
  });
  handle('harness:apply', async (selection) => {
    if (applying) throw new Error('Configuration is already being saved.');
    applying = true;
    try { return await service.apply(selection); } finally { applying = false; }
  });
  handle('harness:restore', async (selection) => {
    if (applying) throw new Error('Configuration is already being saved.');
    applying = true;
    try { return await service.restore(selection); } finally { applying = false; }
  });
  ipcMain.on('harness:theme-updated', async (event) => {
    if (!trusted(event)) return;
    try {
      const theme = await readTheme();
      if (!parent.isDestroyed()) parent.webContents.send('harness:theme-changed', theme);
    } catch { /* The parent may be closing or navigating. */ }
  });
}
module.exports = { setupHarnessWindow };
