import fs = require('node:fs');
import path = require('node:path');
import os = require('node:os');
import http = require('node:http');
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { option, prepareConfig, assertPortFree } from './runtime.cjs';
import { createHarnessService } from './harness-config.cjs';
import { atomicJSON, portableSelection, validateBoundaries } from './environments.cjs';
import { stageRelease } from './headless-update.cjs';

const API = '/api/environment/v1';
function identity(userData: string, rotate = false) {
  const file = path.join(userData, 'environment-auth.json');
  const saved = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { id: randomUUID(), token: '' };
  if (rotate || !saved.token) { saved.token = randomBytes(32).toString('hex'); atomicJSON(file, saved); }
  return saved as { id: string; token: string };
}
function authorized(value: string | undefined, token: string) {
  const actual = Buffer.from(value || '');
  const expected = Buffer.from('Bearer ' + token);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
async function body(req: http.IncomingMessage) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw new Error('Expected JSON.');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 256 * 1024) throw new Error('Request is too large.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('Invalid JSON.'); }
}
function vmSelection(selection: unknown, loaded: HarnessLoad): CliSelections {
  return Object.fromEntries(Object.entries(portableSelection(selection)).map(([key, value]) =>
    [key, { ...value, path: loaded.saved[key]?.path || loaded.defaults[key] }]));
}
function createEnvironmentServer(options: {
  userData: string; version: string; name: string;
  dashboard(boundaries: number[], refresh: boolean): Promise<UsageDashboard>;
  load(): Promise<HarnessLoad>; apply(selection: CliSelections): Promise<HarnessSave>;
  sync?(version: string): Promise<() => void>;
}) {
  identity(options.userData);
  let writing = false;
  return http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (status: number, value: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    // Browser origins are never part of this machine-to-machine protocol.
    if (req.headers.origin || !authorized(req.headers.authorization, identity(options.userData).token)) { send(401, { error: 'Unauthorized' }); req.resume(); return; }
    const route = req.url;
    try {
      if (req.method === 'GET' && route === API + '/info') {
        const errorFile = path.join(options.userData, 'update-error.json');
        const updateError = fs.existsSync(errorFile) ? JSON.parse(fs.readFileSync(errorFile, 'utf8')).error : undefined;
        send(200, { protocol: 1, id: identity(options.userData).id, name: options.name, version: options.version, platform: process.platform, arch: process.arch, updateError });
        return;
      }
      if (req.method === 'POST' && route === API + '/dashboard') {
        const input = await body(req);
        validateBoundaries(input.boundaries);
        send(200, await options.dashboard(input.boundaries, input.refreshPricing === true)); return;
      }
      if (req.method !== 'POST' || ![API + '/models/apply', API + '/version/sync'].includes(route)) { send(404, { error: 'Not found' }); req.resume(); return; }
      if (writing) { send(409, { error: 'An operation is already running' }); req.resume(); return; }
      writing = true;
      try {
        const input = await body(req);
        if (route === API + '/models/apply') {
          const selection = vmSelection(input.selection, await options.load());
          const saved = await options.apply(selection);
          send(200, { applied: true, files: saved.paths.length }); return;
        }
        if (input.version === options.version) { send(200, { version: options.version, restarting: false }); return; }
        if (!options.sync) { send(409, { error: 'Start through the cpa launcher to enable updates' }); return; }
        const activate = await options.sync(input.version);
        res.once('finish', () => setImmediate(activate));
        send(202, { version: input.version, restarting: true });
      } finally { writing = false; }
    } catch {
      // Never return filesystem paths, request bodies, upstream errors, or credentials.
      send(400, { error: 'Operation failed. Check the VM configuration and release availability.' });
    }
  });
}
async function localDashboard(runtime: ReturnType<typeof prepareConfig>, boundaries: number[], refresh: boolean) {
  const query = new URLSearchParams({ boundaries: boundaries.join(',') });
  if (refresh) query.set('refresh_pricing', 'true');
  const response = await fetch(runtime.origin + '/v8/management/observability/usage/dashboard?' + query, { headers: { Authorization: 'Bearer ' + runtime.managementKey } });
  if (!response.ok) throw new Error('Usage is unavailable.');
  return await response.json() as UsageDashboard;
}
async function main(args = process.argv.slice(2)) {
  const command = args[0] || 'help';
  if (command === 'help' || args.includes('--help')) {
    console.log('CPA headless\n\n  cpa serve [--host 127.0.0.1] [--port 8318] [--name NAME]\n            [--data-dir PATH] [--import-config PATH]\n  cpa token [rotate] [--data-dir PATH]\n  cpa models --file selection.json [--data-dir PATH]\n\nThe proxy runs on loopback. Connect the desktop to the management address\nwith the token from cpa token. Node.js 22 or later is required.');
    return;
  }
  const userData = path.resolve(option(args, '--data-dir') || path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local/state'), 'cpa'));
  if (command === 'token') { console.log(identity(userData, args[1] === 'rotate').token); return; }
  const runtime = prepareConfig(userData, option(args, '--import-config'));
  const service = createHarnessService(runtime, userData);
  if (command === 'models') {
    const file = option(args, '--file');
    if (!file) throw new Error('Pass --file selection.json. The proxy must be running.');
    const saved = await service.apply(vmSelection(JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')), await service.load()));
    console.log('Models applied to ' + saved.paths.length + ' configuration files.'); return;
  }
  if (command !== 'serve') throw new Error('Unknown command. Run cpa help.');
  const host = option(args, '--host') || '127.0.0.1';
  const port = Number(option(args, '--port') || 8318);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || port === runtime.port) throw new Error('Choose a distinct management port.');
  await assertPortFree(runtime.port);
  const resources = path.join(__dirname, 'resources');
  const binary = path.join(resources, process.platform === 'win32' ? 'cli-proxy-api.exe' : 'cli-proxy-api');
  if (!fs.existsSync(binary)) throw new Error('Bundled proxy is missing.');
  const log = fs.createWriteStream(path.join(userData, 'proxy.log'), { flags: 'a', mode: 0o600 });
  const env: NodeJS.ProcessEnv = { ...process.env, MANAGEMENT_STATIC_PATH: resources };
  for (const key of Object.keys(env)) if (/^(PGSTORE_|GITSTORE_|OBJECTSTORE_)/.test(key) || key === 'MANAGEMENT_PASSWORD') delete env[key];
  const backend = spawn(binary, ['--config', runtime.configPath], { cwd: userData, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  backend.stdout.pipe(log, { end: false }); backend.stderr.pipe(log, { end: false });
  let backendError = false;
  backend.on('error', () => { backendError = true; });
  let server: http.Server;
  let stopping = false;
  const stop = async (code: number) => {
    if (stopping) return;
    stopping = true;
    server?.closeAllConnections(); server?.close();
    if (backend.exitCode === null && !backendError) {
      const exited = new Promise<void>(resolve => backend.once('exit', () => resolve()));
      backend.kill('SIGTERM');
      await Promise.race([exited, delay(5000)]);
      if (backend.exitCode === null) { backend.kill('SIGKILL'); await exited; }
    }
    log.end(); process.exit(code);
  };
  process.on('SIGTERM', () => void stop(0)); process.on('SIGINT', () => void stop(0));
  process.on('disconnect', () => void stop(0));
  backend.on('exit', () => { if (!stopping) void stop(1); });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      if (backendError || backend.exitCode !== null) throw new Error('Proxy failed to start.');
      try {
        const response = await fetch(runtime.origin + '/v8/management/config', { headers: { Authorization: 'Bearer ' + runtime.managementKey }, signal: AbortSignal.timeout(1000) });
        await response.arrayBuffer();
        if (response.ok) { ready = true; break; }
      } catch { /* Startup probe. */ }
      await delay(250);
    }
    if (!ready) throw new Error('Proxy did not become ready.');
    const version: string = require('./package.json').version;
    server = createEnvironmentServer({
      userData, version, name: option(args, '--name') || os.hostname(),
      dashboard: (boundaries, refresh) => localDashboard(runtime, boundaries, refresh),
      load: service.load, apply: service.apply,
      ...(process.send && process.env.CPA_INSTALL_ROOT ? { sync: async (target: string) => {
        const release = await stageRelease(process.env.CPA_INSTALL_ROOT, target);
        return () => process.send?.({ type: 'activate', release, version: target });
      } } : {}),
    });
    server.headersTimeout = 10000; server.requestTimeout = 180000;
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
    process.send?.({ type: 'ready', version });
    console.log('CPA ' + version + ' management listening on ' + host + ':' + port);
    console.log('Proxy: ' + runtime.origin + '. Run cpa token to read the connection token.');
  } catch (error) { console.error(error.message); await stop(1); }
}
if (require.main === module) void main().catch(error => { console.error(error.message); process.exitCode = 1; });
export { identity, authorized, vmSelection, createEnvironmentServer, main };
