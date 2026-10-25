// Run with: node test/codex-tool-discovery.smoke.cjs /absolute/path/to/codex
// Uses an isolated Codex home, a mock inference server, and a large fixture MCP.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const TOML = require('smol-toml');

async function main() {
  const binary = process.argv[2] || process.env.CPA_CODEX_BIN;
  assert(binary, 'Pass the Codex executable path or set CPA_CODEX_BIN.');
  const temporary = path.resolve(__dirname, '../../temp');
  fs.mkdirSync(temporary, { recursive: true });
  const root = fs.mkdtempSync(path.join(temporary, 'codex-discovery-'));
  const template = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../internal/registry/models/codex_client_models.json')))
    .models.find((model) => model.slug === 'gpt-6.1-sol');
  const mcpFile = path.join(root, 'mcp.cjs');
  fs.writeFileSync(mcpFile, `
    const readline = require('node:readline');
    const tools = Array.from({ length: 80 }, (_, i) => ({
      name: 'fixture_tool_' + i,
      description: 'Shipping integration fixture documentation. '.repeat(100),
      inputSchema: { type: 'object', properties: Object.fromEntries(Array.from({ length: 20 }, (_, j) => [
        'parameter_' + j, { type: 'string', description: 'A parameter for testing deferred discovery. '.repeat(3) },
      ])) },
    }));
    readline.createInterface({ input: process.stdin }).on('line', (line) => {
      const request = JSON.parse(line);
      if (request.id == null) return;
      let result = {};
      if (request.method === 'initialize') result = {
        protocolVersion: request.params.protocolVersion, capabilities: { tools: {} },
        serverInfo: { name: 'large-fixture', version: '1' },
      };
      if (request.method === 'tools/list') result = { tools };
      if (request.method === 'tools/call') result = { content: [{ type: 'text', text: 'fixture-executed' }] };
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\\n');
    });
  `);

  let captured = [];
  let executed = false;
  const server = http.createServer(async (request, response) => {
    const parts = [];
    for await (const part of request) parts.push(part);
    let raw = Buffer.concat(parts);
    if (request.headers['content-encoding'] === 'zstd') raw = require('node:zlib').zstdDecompressSync(raw);
    captured.push(JSON.parse(raw.toString()));
    if (captured.length > 1) executed ||= raw.toString().includes('fixture-executed');
    const item = captured.length === 1 ? {
      id: 'ctc_fixture', type: 'custom_tool_call', name: 'exec', namespace: 'functions', call_id: 'call_fixture',
      input: 'const tool = ALL_TOOLS.find(t => t.name.endsWith("__fixture_tool_79")); if (!tool) throw Error("Deferred fixture tool missing"); text(await tools[tool.name]({}));',
    } : { id: 'msg_fixture', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'OK', annotations: [] }] };
    const result = { id: 'resp_fixture', object: 'response', status: 'completed', model: template.slug, output: [item], usage: { input_tokens: 100, output_tokens: 1, total_tokens: 101 } };
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const event of [
      { type: 'response.created', response: { ...result, status: 'in_progress', output: [] } },
      { type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', content: [] } },
      { type: 'response.output_item.done', output_index: 0, item },
      { type: 'response.completed', response: result },
    ]) response.write('data: ' + JSON.stringify(event) + '\n\n');
    response.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const results = [];
    for (const enabled of [false, true]) {
      const home = path.join(root, String(enabled));
      fs.mkdirSync(home);
      const catalog = path.join(home, 'models.json');
      fs.writeFileSync(catalog, JSON.stringify({ models: [{ ...template, supports_search_tool: enabled }] }));
      fs.writeFileSync(path.join(home, 'config.toml'), TOML.stringify({
        model: template.slug, model_provider: 'fixture', model_catalog_json: catalog,
        features: { apps: false, enable_request_compression: false },
        model_providers: { fixture: { name: 'Fixture', base_url: `http://127.0.0.1:${server.address().port}`, wire_api: 'responses', requires_openai_auth: false } },
        mcp_servers: { large_fixture: { command: process.execPath, args: [mcpFile], startup_timeout_sec: 15 } },
      }));
      captured = [];
      executed = false;
      let output = '';
      const child = spawn(binary, ['exec', '--ephemeral', '--json', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', 'Run the fixture tool, then reply OK.'], {
        cwd: root, env: { ...process.env, CODEX_HOME: home }, windowsHide: true,
      });
      child.stdin.end();
      child.stdout.on('data', (part) => { output += part; });
      child.stderr.on('data', (part) => { output += part; });
      const timer = setTimeout(() => child.kill(), 45_000);
      let code;
      try {
        code = await new Promise((resolve, reject) => { child.on('exit', resolve); child.on('error', reject); });
      } finally { clearTimeout(timer); }
      assert(code === 0 && captured.length > 0, `Codex fixture failed: ${output.slice(-2000)}`);
      assert(executed, `Codex must discover and execute the MCP tool: ${output.slice(-2000)}`);
      const body = JSON.stringify(captured[0]);
      const stats = { enabled, bytes: Buffer.byteLength(body), executed, hasEagerFixture: body.includes('fixture_tool_79') };
      results.push(stats);
      console.log(JSON.stringify(stats));
    }
    assert(results[0].hasEagerFixture, 'Baseline must load the complete fixture catalog.');
    assert(!results[1].hasEagerFixture, 'Tool discovery must defer the fixture catalog.');
    assert(results[1].bytes < results[0].bytes / 2, 'Deferred loading must substantially reduce request size.');
    console.log('PASS: the actual Codex client defers the large MCP catalog.');
  } finally {
    server.close();
    assert(path.resolve(root).startsWith(temporary + path.sep) && !fs.lstatSync(root).isSymbolicLink());
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
