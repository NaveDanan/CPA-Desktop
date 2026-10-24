import fs = require('node:fs');
import path = require('node:path');
import { packHeadless } from './pack-headless.cjs';

async function main() {
  const args = process.argv.slice(2);
  const linux = args.includes('--linux') || args.includes('--headless') || process.platform === 'linux';
  const platform = linux ? 'linux' : 'win32';
  const arch = args.includes('--arm64') ? 'arm64' : 'x64';
  const root = path.resolve(__dirname, '..');
  const target = JSON.parse(fs.readFileSync(path.join(root, 'resources/target.json'), 'utf8'));
  if (target.platform !== platform || target.arch !== arch) throw new Error(`Run prepare:resources -- --platform ${platform} --arch ${arch} first.`);
  if (args.includes('--headless')) { packHeadless(root, arch); return; }
  if (linux && process.platform !== 'linux') throw new Error('Build AppImage on Linux or WSL. Headless archives can be built on either platform.');
  const { build, Platform, Arch }: typeof import('electron-builder') = require('electron-builder');
  delete process.env.ELECTRON_MIRROR; delete process.env.ELECTRON_RUN_AS_NODE;
  await build({
    targets: (linux ? Platform.LINUX : Platform.WINDOWS).createTarget(linux ? ['AppImage'] : ['nsis'], arch === 'arm64' ? Arch.arm64 : Arch.x64),
    config: {
      ...(linux ? {} : { electronDist: 'node_modules/electron/dist' }),
    },
  });
}
void main().catch(error => { console.error(error.message); process.exitCode = 1; });
