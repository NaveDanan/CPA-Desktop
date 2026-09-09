// Verify a generated catalog using the installed Codex CLI without making an inference request.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const configDir = path.resolve(process.argv[2]);
const launcher = path.join(process.env.APPDATA, 'npm/node_modules/@openai/codex/bin/codex.js');
const config = require('smol-toml').parse(fs.readFileSync(path.join(configDir, 'config.toml'), 'utf8'));
const expected = JSON.parse(fs.readFileSync(config.model_catalog_json, 'utf8')).models.map((model) => model.slug).sort();
const child = spawn(process.execPath, [launcher, 'app-server', '--stdio'], { cwd: configDir, env: { ...process.env, CODEX_HOME: configDir }, windowsHide: true });
let buffer = '';
let completed = false;
const timer = setTimeout(() => { console.error('Codex catalog verification did not complete.'); child.kill(); process.exitCode = 1; }, 30000);
const send = (message) => child.stdin.write(JSON.stringify(message) + '\n');
child.stderr.on('data', () => {});
child.stdout.on('data', (data) => {
  buffer += data;
  let newline;
  while ((newline = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
    let message;
    try { message = JSON.parse(line); } catch { continue; }
    if (message.id === 1) {
      send({ method: 'initialized', params: {} });
      send({ id: 2, method: 'model/list', params: { includeHidden: false } });
    }
    if (message.id === 2) {
      try {
        assert.ok(!message.error, JSON.stringify(message.error));
        const actual = message.result.data.map((model) => model.model).sort();
        assert.deepEqual(actual, expected);
        console.log(`Installed Codex CLI lists exactly ${actual.length} selected models.`);
        completed = true;
      } catch (error) { console.error(error.message); process.exitCode = 1; }
      clearTimeout(timer); child.kill();
    }
  }
});
child.on('exit', () => { clearTimeout(timer); if (!completed) { console.error('Codex exited before catalog verification passed.'); process.exitCode = 1; } });
send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'cliproxy_catalog_test', version: '1.0.0' }, capabilities: { experimentalApi: true } } });
