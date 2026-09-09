import { ipcMain, dialog } from 'electron';
import path = require('node:path');
import fs = require('node:fs');
import { randomBytes } from 'node:crypto';
import { createHarnessService } from './harness-config.cjs';

function setupHarnessWindow(parent: Electron.BrowserWindow, runtime: Parameters<typeof createHarnessService>[0], userData: string) {
  const service = createHarnessService(runtime, userData);

  let applying = false;
  const readTheme = () => parent.webContents.executeJavaScript(`(() => {
    const style = getComputedStyle(document.documentElement);
    const keys = ['bg-primary', 'bg-secondary', 'bg-tertiary', 'bg-hover', 'text-primary', 'text-secondary', 'border-color', 'border-primary', 'primary-color', 'primary-hover', 'primary-active', 'success-badge-text', 'failure-badge-text'];
    return { name: document.documentElement.dataset.theme || 'light', tokens: Object.fromEntries(keys.map(key => ['--' + key, style.getPropertyValue('--' + key).trim()])) };
  })()`);
  const trusted = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => event.sender === parent.webContents && event.senderFrame === parent.webContents.mainFrame && new URL(event.senderFrame.url).origin === runtime.origin && new URL(event.senderFrame.url).pathname === '/management.html';
  const handle = (name: string, action: (...args: any[]) => unknown) => ipcMain.handle(name, async (event, ...args) => {
    if (!trusted(event)) throw new Error('Untrusted configuration request.');
    try { return { value: await action(...args) }; }
    catch (error) { return { error: error.message }; }
  });
  handle('harness:page', () => {
    const nonce = randomBytes(18).toString('base64');
    const read = (name: string) => fs.readFileSync(path.join(__dirname, name), 'utf8');
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
export { setupHarnessWindow };
