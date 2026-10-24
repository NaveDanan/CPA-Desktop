import fs = require('node:fs');
import path = require('node:path');
import { gzipSync } from 'node:zlib';

function tarFile(name: string, bytes: Buffer, executable = false) {
  const header = Buffer.alloc(512);
  let file = name; let prefix = '';
  if (Buffer.byteLength(name) > 100) {
    const slash = name.lastIndexOf('/'); prefix = name.slice(0, slash); file = name.slice(slash + 1);
    if (Buffer.byteLength(prefix) > 155 || Buffer.byteLength(file) > 100) throw new Error('Archive path too long.');
  }
  const write = (value: string, offset: number, size: number) => header.write(value, offset, size, 'utf8');
  const octal = (value: number, offset: number, size: number) => write(value.toString(8).padStart(size - 1, '0') + '\0', offset, size);
  write(file, 0, 100); octal(executable ? 0o755 : 0o644, 100, 8); octal(0, 108, 8); octal(0, 116, 8);
  octal(bytes.length, 124, 12); octal(0, 136, 12); header.fill(32, 148, 156); write('0', 156, 1);
  write('ustar\0', 257, 6); write('00', 263, 2); write(prefix, 345, 155);
  write(header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148, 8);
  return Buffer.concat([header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512)]);
}
function packHeadless(root: string, arch: string) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const entries: Buffer[] = [];
  const add = (name: string, file = path.join(root, name)) => {
    if (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) throw new Error('Expected a regular distribution file.');
    entries.push(tarFile(name, fs.readFileSync(file), name === 'resources/cli-proxy-api'));
  };
  for (const file of ['launcher.cjs', 'headless.cjs', 'headless-update.cjs', 'environments.cjs', 'runtime.cjs', 'harness-config.cjs', 'resources/cli-proxy-api', 'resources/management.html', 'resources/ui-provenance.json']) add(file);
  const walk = (directory: string) => {
    for (const item of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const name = directory + '/' + item.name;
      if (item.isDirectory()) walk(name); else if (item.isFile()) add(name); else throw new Error('Links are not supported in the release.');
    }
  };
  for (const dependency of Object.keys(pkg.dependencies)) walk('node_modules/' + dependency);
  entries.push(tarFile('package.json', Buffer.from(JSON.stringify({ name: 'cpa-headless', version: pkg.version, private: true, engines: { node: '>=22' } }) + '\n')));
  entries.push(tarFile('cpa', Buffer.from('#!/bin/sh\nset -eu\nCPA_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec node "$CPA_ROOT/launcher.cjs" "$@"\n'), true));
  const output = path.resolve(root, '../dist/desktop'); fs.mkdirSync(output, { recursive: true });
  const file = path.join(output, `CPA-Headless-${pkg.version}-linux-${arch}.tar.gz`);
  fs.writeFileSync(file, gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)])));
  console.log(file); return file;
}
export { tarFile, packHeadless };
