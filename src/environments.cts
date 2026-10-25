import fs = require('node:fs');
import path = require('node:path');
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const TOTAL_KEYS = ['requests', 'total_tokens', 'input_tokens', 'cache_read_tokens', 'cache_write_tokens', 'output_tokens', 'cost_usd', 'input_cost_usd', 'cache_read_cost_usd', 'cache_write_cost_usd', 'output_cost_usd', 'other_cost_usd', 'cache_savings_usd', 'unpriced_requests', 'estimated_requests'] as const;
function emptyTotals(): UsageTotals { return Object.fromEntries(TOTAL_KEYS.map(key => [key, 0])) as unknown as UsageTotals; }
function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) throw new Error('Invalid usage totals received.');
  return value;
}
function addTotals(target: UsageTotals, source: UsageTotals) {
  for (const key of TOTAL_KEYS) target[key] = number(target[key] + number(source[key] ?? 0));
}
function label(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\x00-\x1f]/.test(value); }
function validateBoundaries(value: unknown): asserts value is number[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 401 ||
    !value.every((item, index) => Number.isSafeInteger(item) && item >= 0 && item <= 8640000000000000 && (index === 0 || item > value[index - 1]))) throw new Error('Choose a valid usage period.');
}
function validateRate(rate: UsageRate, nested = false) {
  if (!rate || typeof rate !== 'object') throw new Error('Invalid model pricing.');
  for (const key of ['input', 'cached', 'write', 'output'] as const) number(rate[key]);
  if (rate.threshold !== undefined) number(rate.threshold);
  if (rate.long_context) { if (nested) throw new Error('Invalid model pricing.'); validateRate(rate.long_context, true); }
}
function mergeDashboards(values: UsageDashboard[], boundaries: number[]): UsageDashboard {
  validateBoundaries(boundaries);
  const providers = new Map<string, ProviderUsage>();
  const rates: Record<string, ModelPricing> = Object.create(null);
  let pricing: UsageDashboard['pricing'];
  for (const value of values) {
    if (!value || Date.parse(value.start) !== boundaries[0] || Date.parse(value.end) !== boundaries.at(-1) || !Array.isArray(value.providers) || value.providers.length > 200) throw new Error('Invalid usage response.');
    if (value.pricing) {
      const p = value.pricing;
      if (typeof p.updated_at !== 'string' || !Number.isFinite(Date.parse(p.updated_at)) || !Number.isSafeInteger(p.models) || p.models < 0) throw new Error('Invalid pricing timestamp.');
      if (!pricing || Date.parse(p.updated_at) < Date.parse(pricing.updated_at)) pricing = { updated_at: p.updated_at, models: p.models, ...(p.error ? { error: 'Pricing refresh unavailable.' } : {}) };
    }
    if (value.rates) for (const [key, rate] of Object.entries(value.rates)) {
      if (!label(key)) throw new Error('Invalid model pricing.');
      validateRate(rate);
      rates[key] = { input: rate.input, cached: rate.cached, write: rate.write, output: rate.output,
        ...(label(rate.name) ? { name: rate.name } : {}), ...(rate.threshold === undefined ? {} : { threshold: rate.threshold }),
        ...(label(rate.category) ? { category: rate.category } : {}),
        ...(rate.prompt_tokens === undefined ? {} : { prompt_tokens: number(rate.prompt_tokens) }),
        ...(rate.long_context ? { long_context: { input: rate.long_context.input, cached: rate.long_context.cached, write: rate.long_context.write, output: rate.long_context.output } } : {}) };
    }
    for (const source of value.providers) {
      if (!label(source.provider) || !Array.isArray(source.series) || source.series.length > 5000 || !Array.isArray(source.buckets) || source.buckets.length !== boundaries.length - 1) throw new Error('Invalid usage series received.');
      let target = providers.get(source.provider);
      if (!target) { target = { ...emptyTotals(), provider: source.provider, series: [], buckets: Array.from({ length: boundaries.length - 1 }, (): UsageBucketPoint[] => []) }; providers.set(source.provider, target); }
      addTotals(target, source);
      const indexes = source.series.map(series => {
        if (!label(series.model) || !label(series.harness)) throw new Error('Invalid model or CLI in usage.');
        let index = target.series.findIndex(item => item.model === series.model && item.harness === series.harness);
        if (index < 0) { index = target.series.length; target.series.push({ ...emptyTotals(), model: series.model, harness: series.harness }); }
        addTotals(target.series[index], series); return index;
      });
      source.buckets.forEach((bucket, i) => {
        if (bucket === null) return;
        if (!Array.isArray(bucket) || bucket.length > source.series.length) throw new Error('Invalid usage buckets received.');
        const seen = new Set<number>();
        for (const point of bucket) {
          if (!Number.isInteger(point.series) || indexes[point.series] === undefined || seen.has(point.series)) throw new Error('Invalid usage bucket index.');
          seen.add(point.series);
          const index = indexes[point.series];
          let combined = target.buckets[i].find(item => item.series === index);
          if (!combined) { combined = { series: index, requests: 0, total_tokens: 0, cost_usd: 0 }; target.buckets[i].push(combined); }
          for (const key of ['requests', 'total_tokens', 'cost_usd'] as const) combined[key] = number(combined[key] + number(point[key]));
        }
      });
    }
  }
  return { start: new Date(boundaries[0]).toISOString(), end: new Date(boundaries.at(-1)).toISOString(), providers: [...providers.values()], pricing, rates };
}
function environmentURL(value: unknown) {
  if (typeof value !== 'string') throw new Error('Enter an environment address.');
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error('Enter a full http:// or https:// address.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Use an HTTP(S) origin without credentials, a path, or query parameters.');
  return url.origin;
}
function validateToken(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[\x21-\x7e]{32,512}$/.test(value)) throw new Error('Enter a connection token of at least 32 characters.');
}
function portableSelection(value: unknown): PortableSelections {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Choose CLI models first.');
  const result: PortableSelections = {};
  for (const [key, selection] of Object.entries(value)) {
    if (!['codex', 'claude'].includes(key)) throw new Error('Unknown CLI.');
    const item = selection as CliSelection;
    if (!item || typeof item.enabled !== 'boolean' || typeof item.all !== 'boolean' || !Array.isArray(item.models) || item.models.length > 1000 || !item.models.every(label) || (item.defaultModel !== undefined && item.defaultModel !== '' && !label(item.defaultModel))) throw new Error('Invalid model selection.');
    result[key] = { enabled: item.enabled, all: item.all, models: [...new Set(item.models)], ...(item.defaultModel ? { defaultModel: item.defaultModel } : {}) };
  }
  if (!Object.values(result).some(item => item.enabled)) throw new Error('Enable at least one CLI in CLI and Environments and apply its models first.');
  return result;
}
type Codec = { encrypt(value: string): string; decrypt(value: string): string };
type SavedEnvironment = { id: string; name: string; address: string; identity: string; secret: string };
function atomicJSON(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
    for (let attempt = 0; ; attempt++) {
      try { fs.renameSync(temporary, file); break; }
      catch (error) {
        // Windows file watchers and scanners can briefly hold a replaced file open.
        if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 20) throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    }
  }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
async function remoteJSON(address: string, token: string, route: string, body?: unknown, request = fetch) {
  let response: Response;
  try {
    response = await request(address + '/api/environment/v1' + route, { method: body === undefined ? 'GET' : 'POST', redirect: 'error',
      headers: { Authorization: 'Bearer ' + token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(body === undefined ? 15000 : 180000) });
  } catch { throw new Error('Could not reach the environment. Check its address and connection.'); }
  if (!response.ok) { await response.body?.cancel(); throw new Error(response.status === 401 ? 'Connection token rejected. Reconnect this environment.' : response.status === 404 && (route === '/details' || route.startsWith('/providers/')) ? 'Update this environment to v1.4.0 or later using Update selected versions, then try again.' : 'Environment request failed (' + response.status + ').'); }
  if (!response.body) throw new Error('Empty environment response.');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > 16 * 1024 * 1024) throw new Error(); chunks.push(next.value); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { throw new Error('Invalid or oversized environment response.'); }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
function validateInfo(value: unknown): asserts value is EnvironmentInfo {
  const info = value as EnvironmentInfo;
  if (!info || info.protocol !== 1 || !UUID.test(info.id) || !label(info.name) || !VERSION.test(info.version) || !label(info.platform) || !label(info.arch)) throw new Error('This address is not a compatible CPA environment.');
}
// Only this service handles credential contents. Renderer responses contain account metadata only.
function createProviderService(runtime: { origin: string; managementKey: string }, request = fetch) {
  const filename = (name: unknown): name is string => typeof name === 'string' && /^[^\\/:*?"<>|\x00-\x1f]{1,200}\.json$/.test(name) && !/^(?:\.|CON\.|PRN\.|AUX\.|NUL\.|COM[1-9]\.|LPT[1-9]\.)/i.test(name);
  async function api(route: string, method = 'GET', input?: unknown) {
    const response = await request(runtime.origin + '/v8/management' + route, { method, redirect: 'error',
      headers: { Authorization: 'Bearer ' + runtime.managementKey, ...(input === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: input === undefined ? undefined : JSON.stringify(input) });
    if (!response.ok) { await response.body?.cancel(); throw new Error('Provider request failed (' + response.status + ').'); }
    if (!response.body) throw new Error('Empty provider response.');
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > 4 * 1024 * 1024) throw new Error('Provider response is too large.'); chunks.push(next.value); }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  const list = async (): Promise<ProviderAccount[]> => {
    const data = await api('/credentials');
    if (!Array.isArray(data.files) || data.files.length > 500) throw new Error('Invalid provider list.');
    return data.files.filter((item: AuthAccount) => filename(item.name)).map((item: AuthAccount & {status?: string}) => ({
      name: item.name, provider: item.provider || item.type || 'unknown', disabled: item.disabled === true,
      ...(label(item.status) ? { status: item.status } : {}),
    }));
  };
  return {
    list,
    async export(): Promise<ProviderBundle> {
      const files: ProviderBundle['files'] = [];
      for (const account of await list()) files.push({ name: account.name, content: { ...await api('/credentials/download?name=' + encodeURIComponent(account.name)), disabled: account.disabled } });
      const bundle = { files };
      if (Buffer.byteLength(JSON.stringify(bundle)) > 240 * 1024) throw new Error('Provider credentials exceed the sync limit.');
      return bundle;
    },
    async import(bundle: ProviderBundle) {
      if (!bundle || !Array.isArray(bundle.files) || bundle.files.length > 500 || Buffer.byteLength(JSON.stringify(bundle)) > 240 * 1024 ||
        bundle.files.some(file => !filename(file.name) || !file.content || typeof file.content !== 'object' || Array.isArray(file.content)) || new Set(bundle.files.map(file => file.name)).size !== bundle.files.length) throw new Error('Invalid provider credentials.');
      // Keep unrelated accounts. Matching names are updated through the backend's persistence hook.
      for (const file of bundle.files) await api('/credentials?name=' + encodeURIComponent(file.name), 'POST', file.content);
      return { imported: bundle.files.length };
    },
    async action(input: ProviderAction): Promise<ProviderResult> {
      if (!input || typeof input !== 'object') throw new Error('Choose a provider action.');
      const providers = ['github-copilot', 'codex', 'claude', 'antigravity', 'kimi', 'kimi-ai', 'xai', 'devin', 'meta'];
      if (input.action === 'toggle') {
        if (!filename(input.name) || typeof input.disabled !== 'boolean') throw new Error('Invalid account.');
        await api('/credentials/status', 'PATCH', { name: input.name, disabled: input.disabled }); return { status: 'ok' };
      }
      if (input.action === 'start') {
        if (!providers.includes(input.provider)) throw new Error('Choose a supported provider.');
        const data = await api('/oauth/auth-url?provider=' + encodeURIComponent(input.provider));
        const url = new URL(data.url);
        if (url.protocol !== 'https:' || url.username || url.password || !label(data.state)) throw new Error('Invalid sign-in response.');
        return { url: url.href, state: data.state, ...(label(data.flow) ? { flow: data.flow } : {}), ...(label(data.user_code) ? { user_code: data.user_code } : {}) };
      }
      if (!label(input.state)) throw new Error('Invalid sign-in session.');
      if (input.action === 'callback') {
        if (!providers.includes(input.provider) || typeof input.redirect !== 'string' || input.redirect.length > 8192) throw new Error('Invalid sign-in callback.');
        const url = new URL(input.redirect);
        if (!['http:', 'https:'].includes(url.protocol) || url.searchParams.get('state') !== input.state) throw new Error('Callback does not match this sign-in.');
        await api('/oauth/callback', 'POST', { provider: input.provider, redirect_url: input.redirect }); return { status: 'wait' };
      }
      if (!['status', 'cancel'].includes(input.action)) throw new Error('Unknown provider action.');
      const data = await api('/oauth/' + (input.action === 'cancel' ? 'session' : 'status') + '?state=' + encodeURIComponent(input.state), input.action === 'cancel' ? 'DELETE' : 'GET');
      return { status: ['ok', 'wait', 'error'].includes(data.status) ? data.status : 'error' };
    },
  };
}
function environmentDetails(loaded: HarnessLoad, providers: ProviderAccount[]): EnvironmentDetails {
  const selection: PortableSelections = {};
  for (const [key, item] of Object.entries(loaded.saved)) if (['codex', 'claude'].includes(key)) selection[key] = { enabled: item.enabled, all: item.all, models: item.models || [], ...(item.defaultModel ? { defaultModel: item.defaultModel } : {}) };
  return { models: loaded.models.map(model => ({ id: model.id, display_name: model.display_name, clients: model.clients })), selection, providers, ...(loaded.modelError ? { modelError: 'Model discovery is unavailable. Check provider connections.' } : {}) };
}
function publicDetails(value: EnvironmentDetails): EnvironmentDetails {
  if (!value || !Array.isArray(value.models) || value.models.length > 10000 || !Array.isArray(value.providers) || value.providers.length > 500 ||
    value.models.some(model => !model || !label(model.id) || (model.display_name !== undefined && !label(model.display_name)) || (model.clients !== undefined && (!Array.isArray(model.clients) || model.clients.some(key => !['codex', 'claude'].includes(key))))) ||
    value.providers.some(item => !item || !label(item.name) || !label(item.provider) || typeof item.disabled !== 'boolean') || !value.selection || typeof value.selection !== 'object' || Array.isArray(value.selection)) throw new Error('Invalid environment details. Update the remote CPA version.');
  const selection = value.selection;
  // Validate inactive configurations too without requiring an enabled CLI for inspection.
  for (const [key, item] of Object.entries(selection)) portableSelection({ [key]: { ...item, enabled: true } });
  return environmentDetails({ defaults: {}, saved: selection as CliSelections, models: value.models, modelError: value.modelError }, value.providers.map(item => ({ name: item.name, provider: item.provider, disabled: item.disabled, ...(label(item.status) ? { status: item.status } : {}) })));
}
function createEnvironmentManager(options: {
  userData: string; codec: Codec; version: string;
  localDashboard(boundaries: number[], refresh: boolean): Promise<UsageDashboard>;
  localLoad(): Promise<HarnessLoad>; localApply(selection: CliSelections): Promise<HarnessSave>;
  request?: typeof fetch;
  localProviders?: ReturnType<typeof createProviderService>;
}) {
  const file = path.join(options.userData, 'environments.json'); const request = options.request || fetch;
  const read = (): SavedEnvironment[] => {
    try {
      if (!fs.existsSync(file)) return [];
      if (fs.statSync(file).size > 128 * 1024) throw new Error();
      const items = JSON.parse(fs.readFileSync(file, 'utf8')) as SavedEnvironment[];
      if (!Array.isArray(items) || items.length > 50 || items.some(item => !item || !UUID.test(item.id) || !UUID.test(item.identity) || !label(item.name) || item.address !== environmentURL(item.address) || typeof item.secret !== 'string' || item.secret.length > 4096) || new Set(items.map(item => item.id)).size !== items.length) throw new Error();
      return items;
    } catch { throw new Error('Saved environments could not be read. Restore environments.json from a backup.'); }
  };
  let mutating = false;
  const lock = () => { if (mutating) throw new Error('An environment operation is already running.'); mutating = true; };
  const statuses = new Map<string, { info?: EnvironmentInfo; error?: string; checkedAt: string }>();
  const call = (item: SavedEnvironment, route: string, body?: unknown) => {
    let token: string;
    try { token = options.codec.decrypt(item.secret); validateToken(token); } catch { throw new Error('The saved token cannot be decrypted. Reconnect this environment.'); }
    return remoteJSON(item.address, token, route, body, request);
  };
  async function check(item: SavedEnvironment) {
    try {
      const info = await call(item, '/info'); validateInfo(info);
      if (info.id !== item.identity) throw new Error('Environment identity changed. Remove and reconnect it.');
      if (info.updateError) info.updateError = 'The last update failed. The previous version was restored.';
      statuses.set(item.id, { info, checkedAt: new Date().toISOString() }); return info;
    } catch (error) { statuses.set(item.id, { error: error.message, checkedAt: new Date().toISOString() }); throw error; }
  }
  const list = (): EnvironmentView[] => [
    { id: 'local', name: 'This computer', address: 'Local proxy', version: options.version, status: 'connected' },
    ...read().map(item => { const status = statuses.get(item.id); return { id: item.id, name: item.name, address: item.address, version: status?.info?.version, status: status?.error ? 'offline' as const : status?.info ? 'connected' as const : 'unchecked' as const, error: status?.error, checkedAt: status?.checkedAt, updateError: status?.info?.updateError }; }),
  ];
  return {
    list,
    async refresh() { await Promise.allSettled(read().map(check)); return list(); },
    async connect(value: { name: string; address: string; token: string }) {
      lock();
      try {
        const address = environmentURL(value?.address); validateToken(value?.token);
        if (!label(value.name) || !value.name.trim() || value.name.length > 80) throw new Error('Enter a name of up to 80 characters.');
        const info = await remoteJSON(address, value.token, '/info', undefined, request); validateInfo(info);
        const items = read();
        if (items.length >= 50) throw new Error('A maximum of 50 environments can be connected.');
        if (items.some(item => item.identity === info.id || item.address === address)) throw new Error('This environment is already connected.');
        const item = { id: randomUUID(), name: value.name.trim(), address, identity: info.id, secret: options.codec.encrypt(value.token) };
        atomicJSON(file, [...items, item]); statuses.set(item.id, { info, checkedAt: new Date().toISOString() }); return list();
      } finally { mutating = false; }
    },
    async edit(id: string, value: { name: string; address: string; token?: string }) {
      lock();
      try {
        const items = read(); const item = items.find(item => item.id === id);
        if (!item) throw new Error('Unknown environment.');
        if (!label(value?.name) || !value.name.trim() || value.name.length > 80) throw new Error('Enter a name of up to 80 characters.');
        const address = environmentURL(value.address);
        if (items.some(other => other.id !== id && other.address === address)) throw new Error('This address is already connected.');
        const candidate = { ...item, name: value.name.trim(), address };
        if (value.token) { validateToken(value.token); candidate.secret = options.codec.encrypt(value.token); }
        const info = await call(candidate, '/info'); validateInfo(info);
        if (info.id !== item.identity) throw new Error('Environment identity changed. Remove and reconnect it.');
        atomicJSON(file, items.map(other => other.id === id ? candidate : other));
        statuses.set(id, { info, checkedAt: new Date().toISOString() }); return list();
      } finally { mutating = false; }
    },
    async details(id: string): Promise<EnvironmentDetails> {
      if (id === 'local') return environmentDetails(await options.localLoad(), await options.localProviders.list());
      const item = read().find(item => item.id === id); if (!item) throw new Error('Unknown environment.');
      await check(item); return publicDetails(await call(item, '/details'));
    },
    async providerAction(id: string, input: ProviderAction): Promise<ProviderResult> {
      lock();
      try {
        if (id === 'local') return await options.localProviders.action(input);
        const item = read().find(item => item.id === id); if (!item) throw new Error('Unknown environment.');
        await check(item); return await call(item, '/providers/action', input);
      } finally { mutating = false; }
    },
    remove(id: string) {
      lock();
      try { const items = read(); if (!items.some(item => item.id === id)) throw new Error('Unknown environment.'); atomicJSON(file, items.filter(item => item.id !== id)); statuses.delete(id); return list(); }
      finally { mutating = false; }
    },
    async dashboard(boundaries: number[], refresh = false, scope = 'all'): Promise<UsageDashboard> {
      validateBoundaries(boundaries); const items = read();
      if (scope !== 'all' && scope !== 'local' && !items.some(item => item.id === scope)) throw new Error('Unknown environment.');
      const targets = [{ id: 'local', name: 'This computer' }, ...items].filter(item => scope === 'all' || item.id === scope);
      const results = await Promise.all(targets.map(async target => {
        try {
          let value: UsageDashboard;
          if (target.id === 'local') value = await options.localDashboard(boundaries, refresh);
          else { const item = items.find(item => item.id === target.id); await check(item); value = await call(item, '/dashboard', { boundaries, refreshPricing: refresh }); }
          mergeDashboards([value], boundaries);
          return { value, environment: { id: target.id, name: target.name, available: true, checkedAt: new Date().toISOString() } };
        } catch (error) { return { environment: { id: target.id, name: target.name, available: false, error: target.id === 'local' ? 'Local usage is unavailable.' : error.message, checkedAt: new Date().toISOString() } }; }
      }));
      const healthy = results.filter(item => item.value).map(item => item.value);
      return { ...mergeDashboards(healthy, boundaries), environments: results.map(item => item.environment), partial: healthy.length !== results.length };
    },
    async bulk(action: 'models' | 'version' | 'providers', ids: unknown, source = 'local'): Promise<EnvironmentOutcome[]> {
      lock();
      try {
        if (!Array.isArray(ids) || !ids.length || ids.length > 51 || !ids.every(id => typeof id === 'string') || new Set(ids).size !== ids.length) throw new Error('Select environments first.');
        const items = read();
        if (ids.some(id => id !== 'local' && !items.some(item => item.id === id))) throw new Error('Unknown environment.');
        if (!['models', 'version', 'providers'].includes(action)) throw new Error('Unknown operation.');
        const origin = items.find(item => item.id === source);
        if (source !== 'local' && !origin) throw new Error('Unknown source environment.');
        if (origin && action !== 'version') await check(origin);
        const loaded = action === 'models' && source === 'local' ? await options.localLoad() : undefined;
        const selection = action === 'models' ? portableSelection(loaded ? loaded.saved : publicDetails(await call(origin, '/details')).selection) : undefined;
        const providers = action === 'providers' ? (origin ? await call(origin, '/providers/export', {}) : await options.localProviders.export()) : undefined;
        const outcomes: EnvironmentOutcome[] = [];
        for (let offset = 0; offset < ids.length; offset += 4) outcomes.push(...await Promise.all(ids.slice(offset, offset + 4).map(async id => {
          try {
            if (id === source && action !== 'version') return { id, ok: true, message: 'Source environment is unchanged' };
            if (id === 'local') {
              if (action === 'version') return { id, ok: true, message: 'Already at desktop version ' + options.version };
              if (action === 'providers') { const result = await options.localProviders.import(providers); return { id, ok: true, message: result.imported + ' provider connections synced' }; }
              const localSettings = loaded || await options.localLoad();
              const local = Object.fromEntries(Object.entries(selection).map(([key, value]) => [key, { ...value, path: localSettings.saved[key]?.path || localSettings.defaults[key] }]));
              await options.localApply(local); return { id, ok: true, message: 'Models applied' };
            }
            const item = items.find(item => item.id === id); const before = await check(item);
            if (action === 'providers') { const result = await call(item, '/providers/import', providers); return { id, ok: true, message: result.imported + ' provider connections synced' }; }
            if (action === 'version' && before.version === options.version) return { id, ok: true, message: 'Already at ' + options.version };
            await call(item, action === 'models' ? '/models/apply' : '/version/sync', action === 'models' ? { selection } : { version: options.version });
            if (action === 'models') return { id, ok: true, message: 'Models applied' };
            // Acknowledgement is not completion. Require the pinned VM to report the running target version.
            for (let attempt = 0; attempt < 60; attempt++) {
              await delay(2000);
              try { const info = await check(item); if (info.version === options.version) return { id, ok: true, message: 'Running ' + info.version }; if (info.updateError) throw new Error('Update failed; the previous version was restored.'); }
              catch (error) { if (/identity changed|Update failed|token rejected/.test(error.message)) throw error; }
            }
            throw new Error('Restart could not be verified. Refresh environments to check the running version.');
          } catch (error) { return { id, ok: false, message: error.message }; }
        })));
        return outcomes;
      } finally { mutating = false; }
    },
  };
}
export { atomicJSON, environmentURL, validateToken, validateBoundaries, validateInfo, portableSelection, mergeDashboards, remoteJSON, createEnvironmentManager, createProviderService, environmentDetails };
