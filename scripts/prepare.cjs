const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const resources = path.resolve(__dirname, '../resources');
const index = process.argv.indexOf('--ui');
const ui = index < 0 ? path.join(root, 'static/management.html') : path.resolve(process.argv[index + 1]);
if (!fs.existsSync(ui)) throw new Error('Pass --ui with the exact existing management.html to bundle.');
fs.mkdirSync(resources, { recursive: true });
execFileSync('go', ['build', '-trimpath', '-o', path.join(resources, 'cli-proxy-api.exe'), './cmd/server'], { cwd: root, stdio: 'inherit' });
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
