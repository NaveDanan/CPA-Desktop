const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

for (const fail of [false, true]) test('supervisor ' + (fail ? 'rolls back a release that fails to boot' : 'commits a release only after readiness'), async t => {
  const root = path.resolve(__dirname, '../test-results/launcher', randomUUID());
  const data = path.join(root, 'data'); fs.mkdirSync(data, { recursive: true });
  const release = path.join(root, 'releases/1.2.11'); fs.mkdirSync(release, { recursive: true });
  const log = path.join(root, 'boots');
  const marker = path.join(root, 'activated');
  const fixture = (name, activate) => `const fs=require('node:fs'); fs.appendFileSync(${JSON.stringify(log)}, ${JSON.stringify(name + '\n')}); process.on('message',()=>{}); process.send({type:'ready',version:${JSON.stringify(name)}}); ${activate ? `if(!fs.existsSync(${JSON.stringify(marker)})){fs.writeFileSync(${JSON.stringify(marker)},'1'); setImmediate(()=>process.send({type:'activate',release:'1.2.11',version:'1.2.11'}));}` : ''}`;
  fs.writeFileSync(path.join(root, 'headless.cjs'), fixture('bootstrap', true));
  for (const name of ['runtime.cjs', 'harness-config.cjs', 'environments.cjs', 'headless-update.cjs', 'resources/cli-proxy-api', 'resources/management.html', 'node_modules/yaml/package.json', 'node_modules/smol-toml/package.json']) {
    const file = path.join(release, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, '');
  }
  fs.writeFileSync(path.join(release, 'package.json'), '{"version":"1.2.11"}');
  fs.writeFileSync(path.join(release, 'headless.cjs'), fail ? 'process.exit(1)' : fixture('1.2.11', false));
  const script = `require(${JSON.stringify(path.resolve(__dirname, '../launcher.cjs'))}).supervise(${JSON.stringify(root)},['serve','--data-dir',${JSON.stringify(data)}],2000).catch(e=>{console.error(e);process.exitCode=1})`;
  const parent = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let stderr = ''; parent.stderr.on('data', chunk => { stderr += chunk; });
  t.after(async () => { if (parent.exitCode === null) { parent.kill('SIGTERM'); await once(parent, 'exit'); } });
  await new Promise((resolve, reject) => {
    const check = () => {
      if (!fs.existsSync(path.join(root, 'current.json'))) return;
      const state = JSON.parse(fs.readFileSync(path.join(root, 'current.json')));
      if (fail ? fs.existsSync(path.join(data, 'update-error.json')) && fs.readFileSync(log, 'utf8').split('bootstrap').length === 3 : state.current === '1.2.11' && !state.pending) { clearTimeout(timer); watcher.close(); resolve(); }
    };
    const watcher = fs.watch(root, { recursive: true }, check);
    const timer = setTimeout(() => { watcher.close(); reject(new Error('supervisor timed out ' + stderr)); }, 7000);
    check();
  });
  const state = JSON.parse(fs.readFileSync(path.join(root, 'current.json')));
  assert.equal(state.pending, undefined); assert.equal(state.current, fail ? undefined : '1.2.11');
});
