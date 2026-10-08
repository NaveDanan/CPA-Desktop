import fs = require('node:fs');
import path = require('node:path');
import os = require('node:os');
import { randomUUID } from 'node:crypto';
import * as TOML from 'smol-toml';
import YAML = require('yaml');

function defaultPaths(env = process.env, home = os.homedir()) {
  return {
    codex: path.join(env.CODEX_HOME || path.join(home, '.codex'), 'config.toml'),
    claude: path.join(env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), 'settings.json'),
  };
}

function configPath(value: unknown, harness: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Choose a configuration file.');
  const expanded = value.trim().replace(/^~(?=[\\/])/, os.homedir());
  if (!path.isAbsolute(expanded)) throw new Error('Use an absolute configuration path.');
  const resolved = path.resolve(expanded);
  const extension = harness === 'codex' ? '.toml' : '.json';
  if (path.extname(resolved).toLowerCase() !== extension) throw new Error(`Choose a ${extension} configuration file.`);
  if (fs.existsSync(resolved) && !fs.lstatSync(resolved).isFile()) throw new Error('Choose a regular configuration file, not a directory or link.');
  return resolved;
}

function readConfig(file: string, harness: string) {
  if (!fs.existsSync(file)) return {};
  try {
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    const result = harness === 'codex' ? TOML.parse(text) : JSON.parse(text);
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
    return result;
  } catch {
    throw new Error(`Cannot read ${file}. Fix its ${harness === 'codex' ? 'TOML' : 'JSON'} syntax before applying.`);
  }
}

// Stage every file first, preserve originals, and roll back a partially completed write.
function writeFiles(files: [string, string][]) {
  const id = randomUUID();
  const staged = [];
  const committed = [];
  try {
    for (const [file, text] of files) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (fs.existsSync(file) && !fs.lstatSync(file).isFile()) throw new Error(`Not a regular file: ${file}`);
      const backup = fs.existsSync(file) ? `${file}.cliproxy-${id}.bak` : null;
      if (backup) fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL);
      const temporary = `${file}.${id}.tmp`;
      staged.push({ file, temporary, backup });
      fs.writeFileSync(temporary, text, { mode: 0o600, flag: 'wx' });
    }
    for (const entry of staged) {
      fs.renameSync(entry.temporary, entry.file);
      committed.push(entry);
    }
    return staged.filter((entry) => entry.backup).map((entry) => entry.backup);
  } catch (error) {
    for (const entry of committed.reverse()) {
      if (entry.backup) fs.copyFileSync(entry.backup, entry.file);
      else fs.unlinkSync(entry.file);
    }
    throw error;
  } finally {
    for (const entry of staged) if (fs.existsSync(entry.temporary)) fs.unlinkSync(entry.temporary);
  }
}

function modelsForCli(models: CopilotModel[], harness: string) {
  return models.filter((model) => {
    const vendor = (model.owned_by || '').toLowerCase();
    const id = model.id.split('/').pop().toLowerCase();
    return harness === 'claude' ? vendor === 'anthropic' || id.startsWith('claude-')
      : vendor === 'openai' || /^(gpt-|o\d(?:[.-]|$)|codex(?:[.-]|$))/.test(id);
  });
}

function buildFiles(selection: CliSelections, models: CopilotModel[], catalog: CatalogModel[], connection: { origin: string; apiKey: string }) {
  const files: [string, string][] = [];
  const normalized: CliSelections = {};
  for (const harness of ['codex', 'claude']) {
    const item = selection[harness];
    if (!item?.enabled) continue;
    const file = configPath(item.path, harness);
    const available = modelsForCli(models, harness);
    const ids = item.all ? available.map((model) => model.id) : [...new Set(item.models || [])];
    if (!ids.length) throw new Error(`Select at least one model for ${harness === 'codex' ? 'Codex' : 'Claude Code'}.`);
    if (ids.some((id) => !models.some((model) => model.id === id))) throw new Error('A selected model is no longer available. Refresh the model list.');
    if (ids.some((id) => !available.some((model) => model.id === id))) throw new Error('A selected model is unavailable for this CLI. Use Anthropic models for Claude Code and OpenAI models for Codex.');
    const initial = ids.includes(item.defaultModel) ? item.defaultModel : ids[0];
    const config = readConfig(file, harness);
    if (harness === 'codex') {
      const entries = ids.map((id) => catalog.find((model) => model.slug === id));
      if (entries.some((entry) => !entry)) throw new Error('The proxy did not return Codex metadata for every selected model. Refresh and try again.');
      const catalogPath = `${file}.cliproxy-models.json`;
      config.model = initial;
      config.model_provider = 'cliproxy_copilot';
      config.model_catalog_json = catalogPath;
      if (config.model_reasoning_effort && !entries.find((entry) => entry.slug === initial).supported_reasoning_levels?.some((level) => level.effort === config.model_reasoning_effort)) {
        delete config.model_reasoning_effort;
      }
      config.model_providers ||= {};
      config.model_providers.cliproxy_copilot = {
        name: 'GitHub Copilot via CLIProxyAPI', base_url: `${connection.origin}/v1`,
        wire_api: 'responses', experimental_bearer_token: connection.apiKey,
      };
      files.push([catalogPath, JSON.stringify({ models: entries.map((entry, priority) => ({ ...entry, visibility: 'list', supported_in_api: true, priority })) }, null, 2) + '\n']);
      files.push([file, TOML.stringify(config)]);
    } else {
      config.env = {
        ...config.env, ANTHROPIC_BASE_URL: connection.origin, ANTHROPIC_AUTH_TOKEN: '',
        ANTHROPIC_API_KEY: connection.apiKey,
        CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: '0',
      };
      for (const family of ['opus', 'sonnet', 'haiku', 'fable']) {
        const familyModels = ids.filter((id) => id.split('/').pop().startsWith(`claude-${family}`));
        familyModels.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
        config.env[`ANTHROPIC_DEFAULT_${family.toUpperCase()}_MODEL`] = familyModels.includes(initial) ? initial : familyModels[0] || initial;
      }
      // Let /model persist the next session's choice without an environment override.
      delete config.env.ANTHROPIC_MODEL;
      delete config.env.ANTHROPIC_DEFAULT_MODEL;
      delete config.env.CLAUDE_CODE_SUBAGENT_MODEL;
      config.model = initial;
      config.availableModels = ids;
      config.modelPicker = {
        replaceBuiltInOptions: true,
        options: ids.map((id) => ({ model: id, label: models.find((model) => model.id === id).display_name || id, description: 'GitHub Copilot via CLIProxyAPI' })),
      };
      files.push([file, JSON.stringify(config, null, 2) + '\n']);
    }
    normalized[harness] = { ...item, path: file, models: ids, defaultModel: initial };
  }
  if (!files.length) throw new Error('Enable at least one CLI.');
  return { files, normalized };
}

// Remove the settings owned by this integration, preserving other CLI preferences.
function buildRestoreFiles(selection: Record<string, Pick<CliSelection, "path" | "enabled">>) {
  const files: [string, string][] = [];
  const restored: CliSelections = {};
  for (const harness of ['codex', 'claude']) {
    const item = selection[harness];
    if (!item?.enabled) continue;
    const file = configPath(item.path, harness);
    const config = readConfig(file, harness);
    if (harness === 'codex') {
      if (config.model_provider === 'cliproxy_copilot') {
        for (const key of ['model', 'model_provider', 'model_reasoning_effort']) delete config[key];
      }
      if (config.model_catalog_json === `${file}.cliproxy-models.json`) delete config.model_catalog_json;
      if (config.model_providers) delete config.model_providers.cliproxy_copilot;
    } else {
      for (const key of ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_DEFAULT_FABLE_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL', 'CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY']) {
        if (config.env) delete config.env[key];
      }
      for (const key of ['model', 'availableModels', 'modelPicker']) delete config[key];
    }
    if (fs.existsSync(file)) files.push([file, harness === 'codex' ? TOML.stringify(config) : JSON.stringify(config, null, 2) + '\n']);
    restored[harness] = { enabled: false, path: file, all: true, models: [], defaultModel: '' };
  }
  if (!Object.keys(restored).length) throw new Error('Select at least one CLI to restore.');
  return { files, restored };
}

function createHarnessService(runtime: { configPath: string; origin: string; managementKey: string }, userData: string, request = fetch) {
  const preferencesPath = path.join(userData, 'harness-settings.json');
  const preferences = () => fs.existsSync(preferencesPath) ? JSON.parse(fs.readFileSync(preferencesPath, 'utf8')) : {};
  const connection = () => {
    const config = YAML.parse(fs.readFileSync(runtime.configPath, 'utf8'));
    const apiKey = (config.access?.['api-keys'] ?? config['api-keys'])?.[0];
    if (typeof apiKey !== 'string' || !apiKey) throw new Error('Add a proxy API key in the management UI first.');
    return { origin: runtime.origin, apiKey };
  };
  async function get(route: string, key: string): Promise<DiscoveryResponse> {
    const response = await request(runtime.origin + route, { headers: { Authorization: `Bearer ${key}` } });
    if (!response.ok) throw new Error(`Cannot load models from the proxy (${response.status}). Check that the proxy is running.`);
    return response.json();
  }
  async function discover() {
    const auth = await get('/v0/management/auth-files', runtime.managementKey);
    const accounts = (auth.files || []).filter((account) => (account.provider === 'github-copilot' || account.type === 'github-copilot') && !account.disabled);
    const byID = new Map<string, CopilotModel>();
    for (const account of accounts) {
      const result = await get(`/v0/management/auth-files/models?name=${encodeURIComponent(account.name)}`, runtime.managementKey);
      for (const model of result.models || []) byID.set(model.id, model);
    }
    return [...byID.values()].filter((model) => {
      const name = model.id.split('/').pop();
      return !name.startsWith('claude-') || !name.includes('.') || !byID.has(model.id.replaceAll('.', '-'));
    }).map((model) => ({ ...model, clients: ['codex', 'claude'].filter((key) => modelsForCli([model], key).length > 0) }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }
  return {
    async load() {
      const result: HarnessLoad = { defaults: defaultPaths(), saved: preferences(), models: [] };
      try { result.models = await discover(); } catch (error) { result.modelError = error.message; }
      return result;
    },
    inspect(harness: string, value: string) {
      if (!['codex', 'claude'].includes(harness)) throw new Error('Unknown CLI.');
      const file = configPath(value, harness);
      readConfig(file, harness);
      return { path: file, exists: fs.existsSync(file) };
    },
    async apply(selection: CliSelections) {
      const models = await discover();
      const conn = connection();
      const catalog = selection.codex?.enabled ? (await get('/v1/models?client_version', conn.apiKey)).models || [] : [];
      const { files, normalized } = buildFiles(selection, models, catalog, conn);
      files.push([preferencesPath, JSON.stringify({ ...preferences(), ...selection, ...normalized }, null, 2) + '\n']);
      const backups = writeFiles(files);
      return { backups, paths: Object.values(normalized).map((item) => item.path) };
    },
    restore(selection: Record<string, Pick<CliSelection, "path" | "enabled">>) {
      const { files, restored } = buildRestoreFiles(selection);
      files.push([preferencesPath, JSON.stringify({ ...preferences(), ...restored }, null, 2) + '\n']);
      const backups = writeFiles(files);
      return { backups, restored, paths: Object.values(restored).map((item) => item.path) };
    },
  };
}

export { defaultPaths, configPath, readConfig, buildFiles, buildRestoreFiles, writeFiles, createHarnessService, modelsForCli };
