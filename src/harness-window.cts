import { ipcMain, dialog, safeStorage, app } from 'electron';
import path = require('node:path');
import fs = require('node:fs');
import { randomBytes } from 'node:crypto';
import { createHarnessService } from './harness-config.cjs';
import { createEnvironmentManager, validateBoundaries } from './environments.cjs';

function setupHarnessWindow(parent: Electron.BrowserWindow, runtime: Parameters<typeof createHarnessService>[0], userData: string) {
  const service = createHarnessService(runtime, userData);
  const environments = createEnvironmentManager({
    userData, version: app.getVersion(), localLoad: service.load,
    localApply: selection => {
      if (applying) throw new Error('Configuration is already being saved.');
      applying = true;
      return service.apply(selection).finally(() => { applying = false; });
    },
    codec: {
      encrypt(value) {
        if (!safeStorage.isEncryptionAvailable() || (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) throw new Error('Unlock your desktop keyring, then connect again.');
        return safeStorage.encryptString(value).toString('base64');
      },
      decrypt: value => safeStorage.decryptString(Buffer.from(value, 'base64')),
    },
    localDashboard: async (boundaries, refreshPricing) => {
      const query = new URLSearchParams({ boundaries: boundaries.join(',') });
      if (refreshPricing) query.set('refresh_pricing', 'true');
      const response = await fetch(`${runtime.origin}/v8/management/observability/usage/dashboard?${query}`, { headers: { Authorization: `Bearer ${runtime.managementKey}` } });
      if (!response.ok) throw new Error('Local usage is unavailable.');
      return response.json();
    },
  });

  let applying = false;
  const readTheme = () => parent.webContents.executeJavaScript(`(() => {
    const style = getComputedStyle(document.documentElement);
    const keys = ['bg-primary', 'bg-secondary', 'bg-tertiary', 'bg-hover', 'text-primary', 'text-secondary', 'text-tertiary', 'border-color', 'border-primary', 'primary-color', 'primary-hover', 'primary-active', 'success-badge-text', 'failure-badge-text'];
    return { name: document.documentElement.dataset.theme || 'light', tokens: Object.fromEntries(keys.map(key => ['--' + key, style.getPropertyValue('--' + key).trim()])) };
  })()`);
  const trusted = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => event.sender === parent.webContents && event.senderFrame === parent.webContents.mainFrame && new URL(event.senderFrame.url).origin === runtime.origin && new URL(event.senderFrame.url).pathname === '/management.html';
  const handle = (name: string, action: (...args: any[]) => unknown) => ipcMain.handle(name, async (event, ...args) => {
    if (!trusted(event)) throw new Error('Untrusted configuration request.');
    try { return { value: await action(...args) }; }
    catch (error) { return { error: error.message }; }
  });
  // Embedded pages run in sandboxed frames, so their styles and scripts are inlined under a fresh nonce.
  // Replacer callbacks keep "$" sequences in the inlined code from being read as replacement patterns.
  const framePage = (page: string, renderer: string) => {
    const nonce = randomBytes(18).toString('base64');
    const read = (name: string) => fs.readFileSync(path.join(__dirname, name), 'utf8');
    return read(`${page}.html`)
      .replace("script-src 'self'; style-src 'self'", () => `script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'`)
      .replace(`<link rel="stylesheet" href="${page}.css">`, () => `<style nonce="${nonce}">${read(`${page}.css`)}</style>`)
      .replace(`<script src="${renderer}" defer></script>`, () => `<script nonce="${nonce}">${read('harness-bridge.js')}</script>`)
      .replace('</body>', () => `<script nonce="${nonce}">${read(renderer)}</script></body>`);
  };
  handle('harness:page', () => framePage('harness', 'harness-renderer.js'));
  handle('harness:usage-page', () => framePage('usage', 'usage-renderer.js'));
  handle('harness:dashboard-page', () => framePage('dashboard', 'dashboard-renderer.js'));
  handle('harness:usage', async (period: string, start?: string, end?: string, refreshPricing = false) => {
    if (!['today', 'this_week', 'this_month', 'custom'].includes(period)) throw new Error('Choose a valid period.');
    if (period === 'custom' && (!/^\d{4}-\d{2}-\d{2}$/.test(start || '') || !/^\d{4}-\d{2}-\d{2}$/.test(end || ''))) throw new Error('Choose valid start and end dates.');
    const query = new URLSearchParams({ period });
    if (refreshPricing === true) query.set('refresh_pricing', 'true');
    if (period === 'custom') { query.set('start', start); query.set('end', end); }
    const response = await fetch(`${runtime.origin}/v8/management/observability/usage/copilot?${query}`, {
      headers: { Authorization: `Bearer ${runtime.managementKey}` },
    });
    if (!response.ok) throw new Error(`Could not load Copilot usage (${response.status}). Check that the proxy is running.`);
    return response.json();
  });
  handle('harness:dashboard', (boundaries: unknown, refreshPricing = false, scope = 'all') => {
    validateBoundaries(boundaries);
    return environments.dashboard(boundaries, refreshPricing === true, scope);
  });
  handle('harness:environments', environments.list);
  handle('harness:connectEnvironment', environments.connect);
  handle('harness:removeEnvironment', environments.remove);
  handle('harness:refreshEnvironments', environments.refresh);
  handle('harness:bulkEnvironments', environments.bulk);
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
