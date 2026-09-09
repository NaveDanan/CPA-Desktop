const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const TOML = require('smol-toml');
const { defaultPaths, configPath, buildFiles, buildRestoreFiles, writeFiles, createHarnessService } = require('../harness-config.cjs');
const models = [{ id: 'claude-sonnet', display_name: 'Claude Sonnet' }, { id: 'gpt-copilot' }];
const catalog = models.map((model) => ({ slug: model.id, display_name: model.id, context_window: 128000 }));
const connection = { origin: 'http://127.0.0.1:8317', apiKey: 'test-only-key' };
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cliproxy-harness-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, codex: { enabled: true, path: path.join(root, 'config.toml'), models: ['gpt-copilot'] }, claude: { enabled: true, path: path.join(root, 'settings.json'), models: ['claude-sonnet'] } };
}
test('default paths honor CLI environment overrides', () => {
  assert.deepEqual(defaultPaths({ CODEX_HOME: '/custom/codex', CLAUDE_CONFIG_DIR: '/custom/claude' }, '/home/test'), { codex: path.join('/custom/codex', 'config.toml'), claude: path.join('/custom/claude', 'settings.json') });
});
test('separate catalogs and model pickers preserve unrelated settings and back up originals', (t) => {
  const selection = fixture(t);
  const original = 'model = "old"\n[projects."D:/work"]\ntrust_level = "trusted"\n[mcp_servers.example]\ncommand = "example"\n';
  fs.writeFileSync(selection.codex.path, original);
  fs.writeFileSync(selection.claude.path, JSON.stringify({ permissions: { deny: ['Bash(rm *)'] }, env: { CUSTOM: 'kept' } }));
  const { files } = buildFiles(selection, models, catalog, connection);
  const backups = writeFiles(files);
  assert.equal(backups.length, 2);
  assert.equal(fs.readFileSync(backups.find((file) => file.includes('config.toml.')), 'utf8'), original);
  const codex = TOML.parse(fs.readFileSync(selection.codex.path, 'utf8'));
  assert.equal(codex.projects['D:/work'].trust_level, 'trusted');
  assert.equal(codex.mcp_servers.example.command, 'example');
  assert.equal(codex.model_providers.cliproxy_copilot.experimental_bearer_token, connection.apiKey);
  assert.deepEqual(JSON.parse(fs.readFileSync(codex.model_catalog_json)).models.map((model) => model.slug), ['gpt-copilot']);
  const claude = JSON.parse(fs.readFileSync(selection.claude.path));
  assert.deepEqual(claude.availableModels, ['claude-sonnet']);
  assert.deepEqual(claude.modelPicker.options.map((model) => model.model), ['claude-sonnet']);
  assert.equal(claude.modelPicker.replaceBuiltInOptions, true);
  assert.equal(claude.env.CUSTOM, 'kept');
  assert.equal(claude.env.ANTHROPIC_BASE_URL, connection.origin);
  assert.deepEqual(claude.permissions.deny, ['Bash(rm *)']);
});
test('all models includes refreshed models and repeated apply replaces old selections', (t) => {
  const selection = fixture(t); selection.codex.all = true; selection.claude.enabled = false;
  writeFiles(buildFiles(selection, models, catalog, connection).files);
  selection.codex.all = false;
  writeFiles(buildFiles(selection, models, catalog, connection).files);
  const config = TOML.parse(fs.readFileSync(selection.codex.path, 'utf8'));
  assert.equal(JSON.parse(fs.readFileSync(config.model_catalog_json)).models.length, 1);
  assert.equal(fs.existsSync(selection.claude.path), false);
});

test('Claude configuration allows model switching and uses one API-key authentication source', (t) => {
  const selection = fixture(t);
  fs.writeFileSync(selection.claude.path, JSON.stringify({ env: { ANTHROPIC_MODEL: 'old', ANTHROPIC_AUTH_TOKEN: 'old-token' } }));
  const { files } = buildFiles(selection, models, catalog, connection);
  const claude = JSON.parse(files.find(([file]) => file === selection.claude.path)[1]);
  assert.equal(claude.model, 'claude-sonnet');
  assert.equal(claude.env.ANTHROPIC_MODEL, undefined);
  assert.equal(claude.env.ANTHROPIC_AUTH_TOKEN, '');
  assert.equal(claude.env.ANTHROPIC_API_KEY, connection.apiKey);
});

test('restore resets selected CLI settings and preserves unrelated preferences', (t) => {
  const selection = fixture(t);
  fs.writeFileSync(selection.codex.path, '[mcp_servers.example]\ncommand = "example"\n[model_providers.other]\nname = "Other"\n');
  fs.writeFileSync(selection.claude.path, JSON.stringify({ env: { CUSTOM: 'kept' }, permissions: { deny: ['Bash(rm *)'] } }));
  writeFiles(buildFiles(selection, models, catalog, connection).files);
  const claudeBefore = fs.readFileSync(selection.claude.path, 'utf8');
  selection.claude.enabled = false;
  writeFiles(buildRestoreFiles(selection).files);
  const codex = TOML.parse(fs.readFileSync(selection.codex.path, 'utf8'));
  assert.equal(codex.model, undefined);
  assert.equal(codex.model_provider, undefined);
  assert.equal(codex.model_catalog_json, undefined);
  assert.equal(codex.model_providers.cliproxy_copilot, undefined);
  assert.equal(codex.model_providers.other.name, 'Other');
  assert.equal(codex.mcp_servers.example.command, 'example');
  assert.equal(fs.readFileSync(selection.claude.path, 'utf8'), claudeBefore);
  selection.codex.enabled = false;
  selection.claude.enabled = true;
  const backups = writeFiles(buildRestoreFiles(selection).files);
  assert.equal(fs.readFileSync(backups[0], 'utf8'), claudeBefore);
  assert.deepEqual(JSON.parse(fs.readFileSync(selection.claude.path, 'utf8')), { env: { CUSTOM: 'kept' }, permissions: { deny: ['Bash(rm *)'] } });
});

test('restore validates all paths before writing and does not require a running proxy', async (t) => {
  const selection = fixture(t);
  const service = createHarnessService({}, selection.root, async () => { throw new Error('Offline'); });
  const loaded = await service.load();
  assert.equal(loaded.modelError, 'Offline');
  assert.ok(loaded.defaults.claude);
  assert.throws(() => service.restore({}), /Select at least one/);
  fs.writeFileSync(selection.codex.path, 'model_provider = "cliproxy_copilot"\n');
  fs.writeFileSync(selection.claude.path, 'bad json');
  assert.throws(() => service.restore(selection), /syntax/);
  assert.match(fs.readFileSync(selection.codex.path, 'utf8'), /cliproxy_copilot/);
  fs.unlinkSync(selection.claude.path);
  const result = service.restore(selection);
  assert.equal(result.paths.length, 2);
  assert.equal(result.restored.claude.enabled, false);
  assert.equal(fs.existsSync(selection.claude.path), false);
  assert.equal((await service.load()).saved.codex.enabled, false);
});
test('invalid config, paths, missing metadata, and stale selections do not overwrite files', (t) => {
  const selection = fixture(t);
  fs.writeFileSync(selection.claude.path, 'invalid JSON');
  assert.throws(() => buildFiles(selection, models, catalog, connection), /syntax/);
  assert.equal(fs.existsSync(selection.codex.path), false);
  assert.throws(() => configPath('relative.toml', 'codex'), /absolute/);
  selection.claude.enabled = false;
  assert.throws(() => buildFiles(selection, models, [], connection), /metadata/);
  selection.codex.models = ['removed'];
  assert.throws(() => buildFiles(selection, models, catalog, connection), /no longer available/);
});
test('staging failure leaves original files unchanged', (t) => {
  const selection = fixture(t);
  fs.writeFileSync(selection.codex.path, 'original');
  const directory = path.join(selection.root, 'directory'); fs.mkdirSync(directory);
  assert.throws(() => writeFiles([[selection.codex.path, 'changed'], [directory, 'invalid']]));
  assert.equal(fs.readFileSync(selection.codex.path, 'utf8'), 'original');
  assert.ok(!fs.readdirSync(selection.root).some((file) => file.endsWith('.tmp')));
});
test('a failed replacement rolls back files already replaced', (t) => {
  const selection = fixture(t);
  fs.writeFileSync(selection.codex.path, 'original codex');
  fs.writeFileSync(selection.claude.path, 'original claude');
  const rename = fs.renameSync;
  t.mock.method(fs, 'renameSync', (source, destination) => {
    if (destination === selection.claude.path) throw new Error('Simulated file lock');
    return rename(source, destination);
  });
  assert.throws(() => writeFiles([[selection.codex.path, 'new codex'], [selection.claude.path, 'new claude']]), /Simulated file lock/);
  assert.equal(fs.readFileSync(selection.codex.path, 'utf8'), 'original codex');
  assert.equal(fs.readFileSync(selection.claude.path, 'utf8'), 'original claude');
  assert.ok(!fs.readdirSync(selection.root).some((file) => file.endsWith('.tmp')));
});
test('live discovery filters disabled and non-Copilot accounts, deduplicates models, and uses current API key', async (t) => {
  const selection = fixture(t); const configPath = path.join(selection.root, 'proxy.yaml');
  fs.writeFileSync(configPath, 'api-keys: [current-key]');
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url, authorization: options.headers.Authorization });
    let data;
    if (url.endsWith('/auth-files')) data = { files: [{ name: 'a.json', provider: 'github-copilot' }, { name: 'b.json', type: 'github-copilot' }, { name: 'disabled', provider: 'github-copilot', disabled: true }, { name: 'other', provider: 'codex' }] };
    else if (url.includes('/auth-files/models')) data = { models };
    else data = { models: catalog };
    return { ok: true, json: async () => data };
  };
  const service = createHarnessService({ origin: connection.origin, configPath, managementKey: 'management-only' }, selection.root, request);
  assert.equal((await service.load()).models.length, 2);
  await service.apply(selection);
  assert.ok(calls.find((call) => call.url.includes('client_version') && call.authorization === 'Bearer current-key'));
  assert.ok(!calls.some((call) => call.url.includes('name=disabled') || call.url.includes('name=other')));
  assert.equal((await service.load()).saved.codex.path, selection.codex.path);
  assert.ok(!fs.readFileSync(path.join(selection.root, 'harness-settings.json'), 'utf8').includes('current-key'));
});
