const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const YAML = require('yaml');
const { setTimeout: delay } = require('node:timers/promises');

async function check() {
  const data = path.join(process.env.APPDATA, 'CLIProxyAPI Desktop');
  const config = YAML.parse(fs.readFileSync(path.join(data, 'config.yaml'), 'utf8'));
  const origin = `http://127.0.0.1:${config.port}`;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${config['api-keys'][0]}` };
  let ready = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    try {
      const response = await fetch(origin + '/v1/models', { headers });
      const body = await response.json();
      if (body.data?.some((model) => model.id === 'gpt-4.1')) { ready = true; break; }
    } catch { /* Wait for startup and provider discovery. */ }
    await delay(1000);
  }
  assert.ok(ready, 'The desktop proxy discovers the test model');
  const cases = [
    { name: 'OpenAI chat completions', route: '/v1/chat/completions', body: { model: 'gpt-4.1', messages: [{ role: 'user', content: 'Reply with exactly: desktop works' }], max_tokens: 32, stream: false } },
    { name: 'Codex Responses protocol', route: '/v1/responses', body: { model: 'gpt-4.1', input: 'Reply with exactly: desktop works', max_output_tokens: 32, stream: false } },
    { name: 'Claude Messages protocol', route: '/v1/messages', body: { model: 'gpt-4.1', messages: [{ role: 'user', content: 'Reply with exactly: desktop works' }], max_tokens: 32, stream: false } },
  ];
  const results = [];
  for (const item of cases) {
    const response = await fetch(origin + item.route, { method: 'POST', headers: { ...headers, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(item.body) });
    const body = await response.json();
    const answer = body.choices?.[0]?.message?.content || body.output?.flatMap((entry) => entry.content || []).map((entry) => entry.text || '').join('') || body.content?.map((entry) => entry.text || '').join('');
    const result = { name: item.name, status: response.status, answer: answer || '', error: body.error?.message || null };
    results.push(result);
    console.log(JSON.stringify(result));
  }
  const output = path.join(__dirname, '../test-results');
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'inference.json'), JSON.stringify(results, null, 2));
  assert.ok(results.every((result) => result.status === 200 && /desktop works/i.test(result.answer)), 'All three protocol requests succeed through Copilot');
}
check().catch((error) => { console.error(error.message); process.exitCode = 1; });
