// Run with Electron. IPC fixtures exercise the real setup page without writing CLI settings.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { buildFiles } = require('../harness-config.cjs');
const output = path.resolve(__dirname, '../test-results/copilot-audit');
fs.mkdirSync(output, { recursive: true });
fs.mkdirSync(path.join(output, 'profile'), { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
const available = [
  { id: 'claude-sonnet-5-1', owned_by: 'Anthropic', clients: ['claude'] },
  { id: 'gpt-5.1', owned_by: 'OpenAI', clients: ['codex'] },
  { id: 'gemini-3', owned_by: 'Google', clients: [] },
];
let applied;
const timer = setTimeout(() => { console.error('CLI setup smoke timed out'); app.exit(1); }, 30000);
app.whenReady().then(async () => {
  ipcMain.handle('harness:theme', () => ({ value: { name: 'dark', tokens: {} } }));
  ipcMain.handle('harness:load', () => ({ value: {
    defaults: { codex: path.join(output, 'config.toml'), claude: path.join(output, 'settings.json') },
    saved: { claude: { enabled: true, all: false, models: ['claude-sonnet-5.1', 'gpt-5.1'], defaultModel: 'claude-sonnet-5.1' } },
    models: available,
  } }));
  ipcMain.handle('harness:inspect', (_event, _name, file) => ({ value: { path: file, exists: false } }));
  ipcMain.handle('harness:apply', (_event, selection) => {
    applied = buildFiles(selection, available, available.map((model) => ({ slug: model.id })), { origin: 'http://127.0.0.1:8317', apiKey: 'test-only-key' });
    return { value: { paths: Object.values(applied.normalized).map((item) => item.path), backups: [] } };
  });
  const window = new BrowserWindow({ show: false, width: 1100, height: 850,
    webPreferences: { preload: path.resolve(__dirname, '../harness-preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  const run = (code) => window.webContents.executeJavaScript(code);
  await window.loadFile(path.resolve(__dirname, '../harness.html'));
  await run(`new Promise(resolve => {
    const ready = () => document.getElementById('claude-default') && !document.getElementById('refresh').disabled;
    if (ready()) { resolve(); return; }
    const observer = new MutationObserver(() => { if (ready()) { observer.disconnect(); resolve(); } });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
  })`);
  const state = await run(`({
    codex: [...document.getElementById('codex-default').options].map(option => option.value),
    claude: [...document.getElementById('claude-default').options].map(option => option.value),
    rows: [...document.querySelectorAll('#model-rows tr')].map(row => [...row.querySelectorAll('input')].map(input => ({ disabled: input.disabled, checked: input.checked }))),
    applyEnabled: !document.getElementById('apply').disabled
  })`);
  assert.deepEqual(state.codex, ['gpt-5.1']);
  assert.deepEqual(state.claude, ['claude-sonnet-5-1']);
  assert.deepEqual(state.rows, [
    [{ disabled: true, checked: false }, { disabled: false, checked: true }],
    [{ disabled: false, checked: true }, { disabled: true, checked: false }],
    [{ disabled: true, checked: false }, { disabled: true, checked: false }],
  ]);
  assert.equal(state.applyEnabled, true);
  await run(`document.getElementById('setup').requestSubmit()`);
  await run(`new Promise(resolve => {
    const status = document.getElementById('status');
    if (status.className === 'success') { resolve(); return; }
    const observer = new MutationObserver(() => { if (status.className === 'success') { observer.disconnect(); resolve(); } });
    observer.observe(status, { childList: true, attributes: true });
  })`);
  const claudeConfig = JSON.parse(applied.files.find(([file]) => file.endsWith('settings.json'))[1]);
  assert.deepEqual(claudeConfig.availableModels, ['claude-sonnet-5-1']);
  assert.equal(claudeConfig.model, 'claude-sonnet-5-1');
  const catalog = JSON.parse(applied.files.find(([file]) => file.endsWith('cliproxy-models.json'))[1]);
  assert.deepEqual(catalog.models.map((model) => model.slug), ['gpt-5.1']);
  await run(`for (const id of ['codex-enabled', 'claude-all']) {
    const input = document.getElementById(id); input.checked = false; input.dispatchEvent(new Event('change'));
  }`);
  assert.equal(await run(`document.getElementById('apply').disabled`), true);
  console.log('CLI setup smoke passed: model families, canonical saved IDs, isolated apply, and empty-selection validation.');
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ passed: true, checks: ['model families', 'canonical saved IDs', 'isolated apply', 'empty selection'] }, null, 2));
  clearTimeout(timer);
  window.destroy();
  app.quit();
}).catch((error) => { clearTimeout(timer); fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ passed: false, error: String(error) })); console.error(error); app.exit(1); });
