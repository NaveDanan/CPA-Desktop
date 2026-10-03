const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const YAML = require('yaml');
const { prepareConfig, assertPortFree } = require('../runtime.cjs');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cliproxy-desktop-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('first run creates private configuration with real API and management keys', (t) => {
  const root = fixture(t);
  const runtime = prepareConfig(root);
  assert.equal(runtime.origin, 'http://127.0.0.1:8317');
  assert.equal(runtime.config.host, '127.0.0.1');
  assert.equal(runtime.config['remote-management']['allow-remote'], false);
  assert.equal(runtime.config['remote-management']['disable-auto-update-panel'], true);
  assert.equal(runtime.managementKey.length, 64);
  assert.equal(runtime.config['api-keys'][0].length, 64);
});

test('migration copies accounts, preserves API keys and port, leaves originals intact', (t) => {
  const root = fixture(t);
  const old = path.join(root, 'source');
  const target = path.join(root, 'desktop');
  fs.mkdirSync(path.join(old, 'auths'), { recursive: true });
  const account = JSON.stringify({ type: 'github-copilot', access_token: 'test-only-token' });
  fs.writeFileSync(path.join(old, 'auths/account.json'), account);
  fs.writeFileSync(path.join(old, 'auths/ignored.log'), 'not an account');
  const original = YAML.stringify({ port: 8337, 'auth-dir': 'auths', 'api-keys': ['test-api-key'], 'remote-management': { 'secret-key': 'old-key' } });
  const configPath = path.join(old, 'config.yaml');
  fs.writeFileSync(configPath, original);
  const result = prepareConfig(target, configPath);
  assert.equal(result.config.port, 8337);
  assert.deepEqual(result.config['api-keys'], ['test-api-key']);
  assert.notEqual(result.managementKey, 'old-key');
  assert.equal(fs.readFileSync(configPath, 'utf8'), original);
  assert.equal(fs.readFileSync(path.join(target, 'auths/account.json'), 'utf8'), account);
  assert.equal(fs.existsSync(path.join(target, 'auths/ignored.log')), false);
  assert.equal(fs.readFileSync(path.join(old, 'auths/account.json'), 'utf8'), account);
});

test('v8 import keeps nested settings and applies desktop security settings', (t) => {
  const root = fixture(t);
  const source = path.join(root, 'source');
  const target = path.join(root, 'desktop');
  fs.mkdirSync(path.join(source, 'auths'), { recursive: true });
  fs.writeFileSync(path.join(source, 'auths/account.json'), JSON.stringify({ type: 'github-copilot' }));
  const configPath = path.join(source, 'config.yaml');
  fs.writeFileSync(configPath, YAML.stringify({
    'config-version': 8,
    server: { host: '0.0.0.0', port: 8338 },
    management: { 'secret-key': 'old-key', 'allow-remote': true },
    access: { 'api-keys': ['test-v8-key'] },
    oauth: { 'auth-dir': 'auths' },
  }));

  const result = prepareConfig(target, configPath);
  assert.equal(result.origin, 'http://127.0.0.1:8338');
  assert.equal(result.config.server.host, '127.0.0.1');
  assert.equal(result.config.server.port, 8338);
  assert.equal(result.config.management['allow-remote'], false);
  assert.equal(result.config.management['secret-key'], result.managementKey);
  assert.deepEqual(result.config.access['api-keys'], ['test-v8-key']);
  assert.equal(result.config.observability.usage['usage-statistics-enabled'], true);
  assert.equal(result.config.oauth['auth-dir'], path.join(target, 'auths').replaceAll('\\', '/'));
  assert.ok(fs.existsSync(path.join(target, 'auths/account.json')));
  const relaunched = prepareConfig(target);
  assert.equal(relaunched.origin, result.origin);
  assert.equal(relaunched.managementKey, result.managementKey);
  assert.deepEqual(relaunched.config.access['api-keys'], ['test-v8-key']);
});

test('v8 import keeps legacy-only API keys while migrating mixed settings', (t) => {
  const root = fixture(t);
  const original = path.join(root, 'original.yaml');
  fs.writeFileSync(original, YAML.stringify({
    'config-version': 8,
    server: { port: 8339 },
    access: {},
    'api-keys': ['existing-key'],
  }));
  const result = prepareConfig(path.join(root, 'desktop'), original);
  assert.deepEqual(result.config.access['api-keys'], ['existing-key']);
  assert.equal(result.port, 8339);
});

test('relaunch preserves keys and user settings without importing again', (t) => {
  const root = fixture(t);
  const first = prepareConfig(root);
  const changed = first.config;
  changed.port = 8456;
  changed.debug = true;
  fs.writeFileSync(first.configPath, YAML.stringify(changed));
  const second = prepareConfig(root, 'missing-original-config.yaml');
  assert.equal(second.managementKey, first.managementKey);
  assert.equal(second.config.port, 8456);
  assert.equal(second.config.debug, true);
  assert.deepEqual(second.config['api-keys'], first.config['api-keys']);
});

test('occupied port is rejected without touching its listener', async () => {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    await assert.rejects(assertPortFree(port), /already in use/);
    assert.ok(server.listening);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  await assertPortFree(port);
});
