const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { gzipSync } = require('node:zlib');
const { tarFile } = require('../scripts/pack-headless.cjs');
const { extractRelease, boundedBytes, stageRelease } = require('../headless-update.cjs');
const directory = () => { const dir = path.resolve(__dirname, '../test-results/updates', randomUUID()); fs.mkdirSync(dir, { recursive: true }); return dir; };

test('release archive roundtrip preserves executable mode and rejects traversal and links', () => {
  const dir = directory();
  extractRelease(gzipSync(Buffer.concat([tarFile('resources/cli-proxy-api', Buffer.from('binary'), true), tarFile('package.json', Buffer.from('{}')), Buffer.alloc(1024)])), dir);
  assert.equal(fs.readFileSync(path.join(dir, 'resources/cli-proxy-api'), 'utf8'), 'binary');
  for (const name of ['../escape', '/absolute', 'a/../../escape', 'a\\escape']) {
    assert.throws(() => extractRelease(gzipSync(Buffer.concat([tarFile(name, Buffer.from('bad')), Buffer.alloc(1024)])), directory()), /Unsafe/);
  }
  const link = tarFile('link', Buffer.alloc(0)); link[156] = 50; link.fill(32, 148, 156);
  link.write(link.subarray(0, 512).reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148, 8);
  assert.throws(() => extractRelease(gzipSync(Buffer.concat([link, Buffer.alloc(1024)])), directory()), /Unsafe/);
});

test('download limits cover streamed bodies as well as declared lengths', async () => {
  await assert.rejects(boundedBytes(new Response('too long'), 2), /too large/);
  await assert.rejects(boundedBytes(new Response('x', { headers: { 'content-length': '999' } }), 2), /too large/);
});

test('Linux release staging requires the repository URL and verifies asset digest before activation', { skip: process.platform !== 'linux' }, async () => {
  const { createHash } = require('node:crypto');
  const version = '1.3.1';
  const entries = ['headless.cjs', 'runtime.cjs', 'harness-config.cjs', 'environments.cjs', 'headless-update.cjs', 'resources/cli-proxy-api', 'resources/management.html', 'node_modules/yaml/package.json', 'node_modules/smol-toml/package.json'].map(name => tarFile(name, Buffer.from('fixture')));
  const archive = gzipSync(Buffer.concat([...entries, tarFile('package.json', Buffer.from(JSON.stringify({ version }))), Buffer.alloc(1024)]));
  const name = `CPA-Headless-${version}-linux-${process.arch}.tar.gz`;
  const url = `https://github.com/NaveDanan/CPA-Desktop/releases/download/v${version}/${name}`;
  let digest = 'sha256:' + '0'.repeat(64); let assetURL = url;
  const request = async target => target.includes('api.github.com') ? Response.json({ tag_name: 'v' + version, assets: [{ name, digest, browser_download_url: assetURL }] }) : new Response(archive);
  const root = directory();
  await assert.rejects(stageRelease(root, version, request), /digest mismatch/);
  assert.equal(fs.existsSync(path.join(root, 'releases', version)), false);
  digest = 'sha256:' + createHash('sha256').update(archive).digest('hex'); assetURL = 'https://other.test/release';
  await assert.rejects(stageRelease(root, version, request), /verified headless release/);
  assetURL = url; assert.equal(await stageRelease(root, version, request), version);
  assert.equal(fs.existsSync(path.join(root, 'releases', version, 'headless.cjs')), true);
});
