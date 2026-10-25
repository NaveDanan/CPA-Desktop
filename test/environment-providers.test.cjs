const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createProviderService, createEnvironmentManager } = require('../environments.cjs');
const { createEnvironmentServer, identity } = require('../headless.cjs');

const directory = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cpa-provider-test-'));
function providerFixture(files = {}) {
  const calls = [];
  const service = createProviderService({ origin: 'http://proxy.test', managementKey: 'management-secret' }, async (address, options) => {
    assert.equal(options.headers.Authorization, 'Bearer management-secret');
    const url = new URL(address); calls.push({ route: url.pathname, method: options.method });
    const name = url.searchParams.get('name');
    if (url.pathname.endsWith('/credentials/download')) return Response.json(files[name]);
    if (url.pathname.endsWith('/credentials/status')) { const input = JSON.parse(options.body); files[input.name].disabled = input.disabled; return Response.json({ status: 'ok' }); }
    if (url.pathname.endsWith('/credentials') && options.method === 'POST') { files[name] = JSON.parse(options.body); return Response.json({ status: 'ok' }); }
    if (url.pathname.endsWith('/credentials')) return Response.json({ files: Object.entries(files).map(([name, item]) => ({ name, type: item.type, disabled: item.disabled, access_token: item.access_token })) });
    if (url.pathname.endsWith('/auth-url')) return Response.json({ url: 'https://github.com/login/device', state: 'github-copilot-session', flow: 'device', user_code: 'ABCD-EFGH', access_token: 'never-render-this' });
    return Response.json({ status: 'ok', access_token: 'never-render-this' });
  });
  return { files, calls, service };
}

test('provider operations sanitize metadata, validate imports, and constrain OAuth callbacks', async () => {
  const fixture = providerFixture({ 'copilot.json': { type: 'github-copilot', access_token: 'upstream-secret' } });
  assert.ok(!JSON.stringify(await fixture.service.list()).includes('upstream-secret'));
  const login = await fixture.service.action({ action: 'start', provider: 'github-copilot' });
  assert.equal(login.user_code, 'ABCD-EFGH'); assert.ok(!JSON.stringify(login).includes('never-render-this'));
  await assert.rejects(fixture.service.action({ action: 'start', provider: '../../credentials' }));
  await assert.rejects(fixture.service.action({ action: 'callback', provider: 'codex', state: login.state, redirect: 'http://localhost/callback?state=wrong&code=private' }), /match/);
  await fixture.service.action({ action: 'toggle', name: 'copilot.json', disabled: true });
  assert.equal((await fixture.service.export()).files[0].content.disabled, true);
  for (const name of ['../escape.json', 'C:escape.json', 'CON.json']) await assert.rejects(fixture.service.import({ files: [{ name, content: {} }] }));
  await fixture.service.import({ files: [{ name: 'new.json', content: { type: 'codex', access_token: 'new-secret' } }] });
  assert.equal(fixture.files['new.json'].access_token, 'new-secret'); assert.ok(fixture.files['copilot.json']);
  await assert.rejects(fixture.service.import({ files: [{ name: 'new.json', content: {} }, { name: 'new.json', content: {} }] }));
});

test('real environment HTTP sync transfers providers, preserves VM paths, edits tokens, and reports failures', async t => {
  const source = providerFixture({ 'copilot.json': { type: 'github-copilot', access_token: 'source-secret' } });
  const target = providerFixture({ 'other.json': { type: 'codex', access_token: 'keep-this-account' } });
  const vmData = directory(); let applied;
  const selection = { codex: { enabled: true, all: false, models: ['gpt-test'], path: 'C:/source/config.toml' } };
  const loaded = { defaults: { codex: '/home/agent/.codex/config.toml' }, saved: {}, models: [{ id: 'gpt-test', clients: ['codex'] }] };
  const server = createEnvironmentServer({ userData: vmData, version: '1.4.0', name: 'VM', providers: target.service,
    dashboard: async () => { throw new Error(); }, load: async () => loaded, apply: async input => { applied = input; loaded.saved = input; return { paths: ['config'], backups: [] }; } });
  await new Promise(resolve => server.listen(0, '0.0.0.0', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = 'http://127.0.0.1:' + server.address().port;
  const token = identity(vmData).token;
  const manager = createEnvironmentManager({ userData: directory(), version: '1.4.0', codec: { encrypt: value => Buffer.from(value).toString('base64'), decrypt: value => Buffer.from(value, 'base64').toString() },
    localProviders: source.service, localLoad: async () => ({ defaults: {}, saved: selection, models: loaded.models }), localApply: async () => ({ paths: [], backups: [] }), localDashboard: async () => { throw new Error(); } });
  const id = (await manager.connect({ name: 'VM', address, token }))[1].id;
  const details = await manager.details(id);
  assert.equal(details.models[0].id, 'gpt-test'); assert.equal(details.providers[0].name, 'other.json');
  assert.ok(!JSON.stringify(details).includes('keep-this-account'));
  assert.equal((await manager.bulk('providers', [id]))[0].ok, true);
  assert.equal(target.files['copilot.json'].access_token, 'source-secret'); assert.equal(target.files['other.json'].access_token, 'keep-this-account');
  assert.equal((await manager.bulk('models', [id]))[0].ok, true); assert.equal(applied.codex.path, '/home/agent/.codex/config.toml');
  assert.equal((await manager.details(id)).selection.codex.models[0], 'gpt-test');
  assert.ok(!JSON.stringify(await manager.details(id)).includes('/home/agent'));
  const edited = await manager.edit(id, { name: 'Renamed VM', address }); assert.equal(edited[1].name, 'Renamed VM');
  const rotated = identity(vmData, true).token;
  await assert.rejects(manager.edit(id, { name: 'Bad update', address }), /token rejected/);
  assert.equal(manager.list()[1].name, 'Renamed VM');
  await manager.edit(id, { name: 'Renamed VM', address, token: rotated });
  await manager.providerAction(id, { action: 'toggle', name: 'copilot.json', disabled: true });
  assert.equal(target.files['copilot.json'].disabled, true);
  assert.equal((await manager.bulk('providers', ['local'], id))[0].ok, true, 'remote environment can be the sync source');
  assert.equal(source.files['copilot.json'].disabled, true);
  const bundle = { files: [{ name: 'should-not-write.json', content: { type: 'codex', access_token: 'private' } }] };
  for (const headers of [{}, { Authorization: 'Bearer ' + rotated, Origin: 'http://browser.test' }]) {
    const response = await fetch(address + '/api/environment/v1/providers/import', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(bundle) }); assert.equal(response.status, 401);
  }
  assert.ok(!target.files['should-not-write.json']);
  const authFile = path.join(vmData, 'environment-auth.json'); const auth = JSON.parse(fs.readFileSync(authFile)); auth.id = randomUUID(); fs.writeFileSync(authFile, JSON.stringify(auth));
  const result = await manager.bulk('providers', [id]); assert.equal(result[0].ok, false); assert.match(result[0].message, /identity changed/);
});
