const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createEnvironmentManager, mergeDashboards, environmentURL, portableSelection } = require('../environments.cjs');
const { createEnvironmentServer, identity } = require('../headless.cjs');
const boundaries = [0, 1000, 2000];
const totals = { requests: 1, total_tokens: 20, input_tokens: 10, output_tokens: 10, cost_usd: 0.1 };
const sample = () => ({ start: new Date(0).toISOString(), end: new Date(2000).toISOString(), providers: [{ ...totals, provider: 'github-copilot', series: [{ ...totals, model: 'gpt-test', harness: 'codex' }], buckets: [[{ series: 0, requests: 1, total_tokens: 20, cost_usd: 0.1 }], []] }] });
const directory = () => { const dir = path.resolve(__dirname, '../test-results/environments', randomUUID()); fs.mkdirSync(dir, { recursive: true }); return dir; };

test('aggregation aligns series and buckets without losing pricing context', () => {
  const one = sample(); one.rates = { 'gpt-test': { input: 1, cached: 0.1, write: 0, output: 3, category: 'standard', prompt_tokens: 200000 } };
  const result = mergeDashboards([one, sample()], boundaries);
  assert.equal(result.providers[0].requests, 2);
  assert.equal(result.providers[0].series.length, 1);
  assert.equal(result.providers[0].series[0].total_tokens, 40);
  assert.equal(result.providers[0].buckets[0][0].cost_usd, 0.2);
  assert.equal(result.rates['gpt-test'].category, 'standard');
  assert.equal(result.rates['gpt-test'].prompt_tokens, 200000);
  const bad = sample(); bad.providers[0].buckets[0][0].series = 9;
  assert.throws(() => mergeDashboards([bad], boundaries), /index/);
  bad.providers[0].buckets[0][0].series = 0; bad.providers[0].requests = -1;
  assert.throws(() => mergeDashboards([bad], boundaries), /totals/);
});

test('connection inputs reject embedded credentials and portable models omit local paths', () => {
  assert.equal(environmentURL('http://localhost:8318/'), 'http://localhost:8318');
  for (const address of ['file:///tmp', 'http://user:password@host', 'http://host/path', 'http://host/?token=secret']) assert.throws(() => environmentURL(address));
  assert.deepEqual(portableSelection({ codex: { enabled: true, all: false, models: ['gpt-test'], path: 'C:/private', apiKey: 'secret' } }), { codex: { enabled: true, all: false, models: ['gpt-test'] } });
  assert.deepEqual(portableSelection({ codex: { enabled: true, all: true, models: [], defaultModel: '' } }), { codex: { enabled: true, all: true, models: [] } });
});

test('real HTTP service authenticates, pins identity, applies VM paths, and reports partial usage', async t => {
  const vmDir = directory(); let applied; let available = true;
  const loaded = { defaults: { codex: '/home/vm/.codex/config.toml' }, saved: {}, models: [] };
  const server = createEnvironmentServer({ userData: vmDir, version: '1.2.10', name: 'VM', dashboard: async () => { if (!available) throw new Error('private details'); return sample(); }, load: async () => loaded, apply: async selection => { applied = selection; return { paths: ['config'], backups: [] }; } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = 'http://127.0.0.1:' + server.address().port;
  const token = identity(vmDir).token;
  assert.equal((await fetch(address + '/api/environment/v1/info')).status, 401);
  assert.equal((await fetch(address + '/api/environment/v1/info', { headers: { Authorization: 'Bearer ' + token, Origin: 'http://attacker.test' } })).status, 401);
  const desktopDir = directory();
  const manager = createEnvironmentManager({ userData: desktopDir, version: '1.2.10', codec: { encrypt: value => Buffer.from(value).toString('base64'), decrypt: value => Buffer.from(value, 'base64').toString() }, localDashboard: async () => sample(), localLoad: async () => ({ defaults: {}, saved: { codex: { enabled: true, all: false, models: ['gpt-test'], path: 'C:/desktop/config.toml' } }, models: [] }), localApply: async () => ({ paths: [], backups: [] }) });
  const views = await manager.connect({ name: 'My VM', address, token });
  assert.equal(views.length, 2); assert.ok(!JSON.stringify(views).includes(token));
  assert.ok(!fs.readFileSync(path.join(desktopDir, 'environments.json'), 'utf8').includes(token));
  await assert.rejects(manager.connect({ name: 'Duplicate', address, token }), /already/);
  assert.equal((await manager.dashboard(boundaries)).providers[0].requests, 2);
  assert.equal((await manager.dashboard(boundaries, false, views[1].id)).providers[0].requests, 1);
  assert.equal((await manager.bulk('models', [views[1].id]))[0].ok, true);
  assert.equal(applied.codex.path, '/home/vm/.codex/config.toml');
  assert.equal((await manager.bulk('version', [views[1].id]))[0].message, 'Already at 1.2.10');
  available = false;
  const partial = await manager.dashboard(boundaries);
  assert.equal(partial.partial, true); assert.equal(partial.providers[0].requests, 1);
  assert.ok(!JSON.stringify(partial).includes('private details'));
  const auth = identity(vmDir); auth.id = randomUUID(); fs.writeFileSync(path.join(vmDir, 'environment-auth.json'), JSON.stringify(auth));
  const changed = await manager.refresh(); assert.match(changed[1].error, /identity changed/);
  manager.remove(views[1].id); assert.equal(manager.list().length, 1);
});

test('version sync waits for the remote running version after acknowledgement', async () => {
  let acknowledged = false; let probes = 0;
  const info = { protocol: 1, id: randomUUID(), name: 'VM', platform: 'linux', arch: 'x64', version: '1.2.10' };
  const manager = createEnvironmentManager({ userData: directory(), version: '1.3.0', codec: { encrypt: value => value, decrypt: value => value }, localDashboard: async () => sample(), localLoad: async () => ({ defaults: {}, saved: {}, models: [] }), localApply: async () => ({ paths: [], backups: [] }), request: async (url, options) => {
    if (url.endsWith('/version/sync')) { assert.equal(JSON.parse(options.body).version, '1.3.0'); acknowledged = true; return Response.json({ restarting: true }, { status: 202 }); }
    if (acknowledged) probes++;
    return Response.json({ ...info, version: acknowledged && probes >= 2 ? '1.3.0' : '1.2.10' });
  } });
  const items = await manager.connect({ name: 'VM', address: 'http://vm.test:8318', token: 'test-00000000000000000000000000000000' });
  const result = await manager.bulk('version', [items[1].id]);
  assert.equal(probes, 2); assert.deepEqual(result, [{ id: items[1].id, ok: true, message: 'Running 1.3.0' }]);
});
