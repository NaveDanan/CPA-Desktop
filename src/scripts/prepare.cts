import fs = require('node:fs');
import path = require('node:path');
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const args = process.argv.slice(2);
const value = (name: string, fallback: string) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const platform = value('--platform', process.platform);
const arch = value('--arch', process.arch);
if (!['win32', 'linux'].includes(platform) || !['x64', 'arm64'].includes(arch)) throw new Error('Use --platform win32|linux and --arch x64|arm64.');
const root = process.env.CPA_BACKEND_ROOT ? path.resolve(process.env.CPA_BACKEND_ROOT) : path.resolve(__dirname, '../..');
const resources = path.resolve(__dirname, '../resources');
const index = process.argv.indexOf('--ui');
const ui = index < 0 ? path.join(root, 'static/management.html') : path.resolve(process.argv[index + 1]);
if (!fs.existsSync(ui)) throw new Error('Pass --ui with the exact existing management.html to bundle.');
fs.mkdirSync(resources, { recursive: true });
execFileSync(process.env.CPA_GO || 'go', ['build', '-trimpath', '-o', path.join(resources, platform === 'win32' ? 'cli-proxy-api.exe' : 'cli-proxy-api'), './cmd/server'], {
  cwd: root, stdio: 'inherit', env: { ...process.env, GOOS: platform === 'win32' ? 'windows' : 'linux', GOARCH: arch === 'x64' ? 'amd64' : 'arm64', CGO_ENABLED: '0' },
});
if (platform === 'linux') fs.chmodSync(path.join(resources, 'cli-proxy-api'), 0o755);
fs.writeFileSync(path.join(resources, 'target.json'), JSON.stringify({ platform, arch }));
const html = fs.readFileSync(ui);
fs.writeFileSync(path.join(resources, 'management.html'), html);
const sha256 = createHash('sha256').update(html).digest('hex');
fs.writeFileSync(path.join(resources, 'ui-provenance.json'), JSON.stringify({ sha256, bytes: html.length, note: 'Unmodified existing management center HTML.' }, null, 2));
const assets = path.resolve(__dirname, '../assets');
if (fs.existsSync(path.join(assets, 'icon.ico'))) {
  fs.copyFileSync(path.join(assets, 'icon.ico'), path.join(resources, 'icon.ico'));
}
if (fs.existsSync(path.join(assets, 'icon.png'))) {
  fs.copyFileSync(path.join(assets, 'icon.png'), path.join(resources, 'icon.png'));
}
console.log(`Bundled original management page: ${html.length} bytes, SHA-256 ${sha256}`);
