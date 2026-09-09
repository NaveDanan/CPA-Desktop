// Optional fallback when a machine's npm download mirror is unavailable.
// Accept only the official archive matching the installed Electron package.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
async function install() {
  const electronDir = path.dirname(require.resolve('electron/package.json'));
  const version = require('electron/package.json').version;
  const archiveName = `electron-v${version}-win32-x64.zip`;
  const archive = path.resolve(process.argv[2] || path.join(__dirname, '../resources', archiveName));
  const expected = require(path.join(electronDir, 'checksums.json'))[archiveName];
  const actual = createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  if (!expected || actual !== expected) throw new Error('Electron archive checksum verification failed.');
  const { default: extract } = await import('@electron-internal/extract-zip');
  await extract(archive, { dir: path.join(electronDir, 'dist') });
  fs.writeFileSync(path.join(electronDir, 'path.txt'), 'electron.exe');
  console.log('Official Electron runtime installed and checksum verified.');
}
install().catch((error) => { console.error(error.message); process.exitCode = 1; });
