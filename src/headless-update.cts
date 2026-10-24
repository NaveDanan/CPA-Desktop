import fs = require('node:fs');
import path = require('node:path');
import { createHash, randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const MAX_ARCHIVE = 192 * 1024 * 1024;
const MAX_CONTENT = 512 * 1024 * 1024;
async function boundedBytes(response: Response, limit: number): Promise<Buffer> {
  if (!response.ok || !response.body) throw new Error('Download failed.');
  if (Number(response.headers.get('content-length')) > limit) throw new Error('Download is too large.');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > limit) throw new Error('Download is too large.'); chunks.push(next.value); } }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return Buffer.concat(chunks);
}
function extractRelease(archive: Buffer, destination: string) {
  const tar = gunzipSync(archive, { maxOutputLength: MAX_CONTENT });
  let offset = 0; let entries = 0; let ended = false; const names = new Set<string>();
  const field = (header: Buffer, start: number, size: number) => header.subarray(start, start + size).toString('utf8').replace(/\0.*$/s, '');
  const octal = (text: string) => { if (!/^[0-7]+$/.test(text.trim())) throw new Error('Invalid archive number.'); return parseInt(text.trim(), 8); };
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512); offset += 512;
    if (header.every(byte => byte === 0)) { ended = true; if (tar.subarray(offset).some(byte => byte !== 0)) throw new Error('Invalid archive trailer.'); break; }
    if (++entries > 20000 || field(header, 257, 6) !== 'ustar') throw new Error('Unsupported release archive.');
    const checksum = octal(field(header, 148, 8));
    const sum = header.reduce((total, byte, index) => total + (index >= 148 && index < 156 ? 32 : byte), 0);
    if (sum !== checksum) throw new Error('Invalid archive checksum.');
    const prefix = field(header, 345, 155); const name = (prefix ? prefix + '/' : '') + field(header, 0, 100);
    const relative = name.replace(/\/$/, ''); const kind = field(header, 156, 1);
    if (!relative || !/^[a-zA-Z0-9@_./+ -]+$/.test(relative) || relative.startsWith('/') || relative.split('/').some(part => !part || part === '.' || part === '..') || names.has(relative) || !['', '0', '5'].includes(kind)) throw new Error('Unsafe archive entry.');
    names.add(relative); const size = octal(field(header, 124, 12)); const mode = octal(field(header, 100, 8));
    if (size > MAX_CONTENT || offset + size > tar.length || (kind === '5' && size !== 0)) throw new Error('Invalid archive size.');
    const target = path.join(destination, ...relative.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    if (kind === '5') fs.mkdirSync(target, { mode: 0o700 });
    else fs.writeFileSync(target, tar.subarray(offset, offset + size), { flag: 'wx', mode: mode & 0o111 ? 0o700 : 0o600 });
    offset += Math.ceil(size / 512) * 512;
  }
  if (!ended) throw new Error('Incomplete release archive.');
}
function validateRelease(directory: string, version: string) {
  if (!VERSION.test(version) || JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')).version !== version) throw new Error('Release version does not match.');
  for (const name of ['headless.cjs', 'runtime.cjs', 'harness-config.cjs', 'environments.cjs', 'headless-update.cjs', 'resources/cli-proxy-api', 'resources/management.html', 'node_modules/yaml/package.json', 'node_modules/smol-toml/package.json']) {
    const stat = fs.lstatSync(path.join(directory, name)); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Release is incomplete.');
  }
}
async function stageRelease(installRoot: string, targetVersion: string, request = fetch) {
  if (!VERSION.test(targetVersion) || process.platform !== 'linux' || !['x64', 'arm64'].includes(process.arch)) throw new Error('This release target is unsupported.');
  const releases = path.join(path.resolve(installRoot), 'releases'); fs.mkdirSync(releases, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(releases).isSymbolicLink()) throw new Error('Invalid release directory.');
  const final = path.join(releases, targetVersion);
  if (fs.existsSync(final)) { validateRelease(final, targetVersion); return targetVersion; }
  const response = await request('https://api.github.com/repos/NaveDanan/CPA-Desktop/releases/tags/v' + targetVersion, { headers: { Accept: 'application/vnd.github+json' }, redirect: 'error', signal: AbortSignal.timeout(30000) });
  const release = JSON.parse((await boundedBytes(response, 1024 * 1024)).toString('utf8'));
  const name = 'CPA-Headless-' + targetVersion + '-linux-' + process.arch + '.tar.gz';
  const asset = release.assets?.find((item: {name: string}) => item.name === name);
  const expectedURL = 'https://github.com/NaveDanan/CPA-Desktop/releases/download/v' + targetVersion + '/' + name;
  if (release.tag_name !== 'v' + targetVersion || release.draft || release.prerelease || !asset || !/^sha256:[a-f0-9]{64}$/.test(asset.digest || '') || asset.browser_download_url !== expectedURL) throw new Error('A verified headless release is not available for this version.');
  const bytes = await boundedBytes(await request(expectedURL, { signal: AbortSignal.timeout(180000) }), MAX_ARCHIVE);
  if ('sha256:' + createHash('sha256').update(bytes).digest('hex') !== asset.digest) throw new Error('Release digest mismatch.');
  const staging = path.join(releases, '.stage-' + randomUUID()); fs.mkdirSync(staging, { mode: 0o700 });
  try { extractRelease(bytes, staging); validateRelease(staging, targetVersion); fs.renameSync(staging, final); return targetVersion; }
  finally {
    // Only this call's unactivated staging directory is disposable.
    if (fs.existsSync(staging) && path.dirname(staging) === releases && !fs.lstatSync(staging).isSymbolicLink()) fs.rmSync(staging, { recursive: true });
  }
}
export { VERSION, boundedBytes, extractRelease, validateRelease, stageRelease };
