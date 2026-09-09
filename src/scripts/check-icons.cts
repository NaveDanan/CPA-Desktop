// Verify that the packaged executables and Windows shortcuts carry the application icon.
import fs = require('node:fs');
import path = require('node:path');
import assert = require('node:assert/strict');
import { createHash } from 'node:crypto';

function sections(buffer: Buffer) {
  const peOffset = buffer.readUInt32LE(0x3c);
  const count = buffer.readUInt16LE(peOffset + 6);
  const optionalSize = buffer.readUInt16LE(peOffset + 20);
  const table = peOffset + 24 + optionalSize;
  const list = [];
  for (let index = 0; index < count; index++) {
    const offset = table + index * 40;
    list.push({
      name: buffer.toString('latin1', offset, offset + 8).replace(/\0/g, ''),
      virtualAddress: buffer.readUInt32LE(offset + 12),
      rawAddress: buffer.readUInt32LE(offset + 20),
    });
  }
  return list;
}

function directoryEntries(buffer: Buffer, base: number, offset: number) {
  const named = buffer.readUInt16LE(base + offset + 12);
  const ids = buffer.readUInt16LE(base + offset + 14);
  const list = [];
  for (let index = 0; index < named + ids; index++) {
    const entry = base + offset + 16 + index * 8;
    list.push({ id: buffer.readUInt32LE(entry), offset: buffer.readUInt32LE(entry + 4) });
  }
  return list;
}

// Read every resource of one type (3 = RT_ICON, 14 = RT_GROUP_ICON, 16 = RT_VERSION).
function resources(file: string, type: number) {
  const buffer = fs.readFileSync(file);
  const rsrc = sections(buffer).find((section) => section.name === '.rsrc');
  if (!rsrc) return [];
  const base = rsrc.rawAddress;
  const root = directoryEntries(buffer, base, 0).find((entry) => (entry.id & 0x7fffffff) === type);
  if (!root) return [];
  return directoryEntries(buffer, base, root.offset & 0x7fffffff).map((name) => {
    const language = directoryEntries(buffer, base, name.offset & 0x7fffffff)[0];
    const data = base + (language.offset & 0x7fffffff);
    const address = buffer.readUInt32LE(data);
    const size = buffer.readUInt32LE(data + 4);
    const start = base + address - rsrc.virtualAddress;
    return { id: name.id & 0x7fffffff, data: buffer.subarray(start, start + size) };
  });
}

const digest = (data: Buffer) => createHash('sha256').update(data).digest('hex');

function checkExecutable(label: string, file: string, expected: { image: string }) {
  assert.ok(fs.existsSync(file), `${label} exists: ${file}`);
  const icons = resources(file, 3);
  assert.equal(icons.length, 1, `${label} embeds exactly one icon image`);
  assert.equal(digest(icons[0].data), expected.image, `${label} embeds the application icon, not Electron's default`);
  const groups = resources(file, 14);
  assert.equal(groups.length, 1, `${label} declares one icon group`);
  const group = groups[0].data;
  assert.equal(group.readUInt16LE(4), 1, `${label} icon group lists one image`);
  assert.equal(group[6] || 256, 256, `${label} icon is 256 pixels wide`);
  assert.equal(group[7] || 256, 256, `${label} icon is 256 pixels tall`);
  return icons[0].data;
}

function checkVersion(label: string, file: string, version: string) {
  const [info] = resources(file, 16);
  assert.ok(info, `${label} carries version information`);
  const text = info.data.toString('utf16le');
  assert.ok(text.includes(version), `${label} reports version ${version}`);
}

function run() {
  const root = path.resolve(__dirname, '..');
  const source = fs.readFileSync(path.join(root, 'assets', 'icon.ico'));
  assert.equal(source.readUInt16LE(4), 1, 'assets/icon.ico holds a single image');
  const expected = { image: digest(source.subarray(22)) };
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const packageOnly = process.argv.includes('--package-only');

  const targets = [
    ['Packaged application', path.join(root, 'dist', 'win-unpacked', 'CLIProxyAPI Desktop.exe')],
    ['Installer', path.join(root, 'dist', `CLIProxyAPI-Desktop-Setup-${version}.exe`)],
  ];
  const installed = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'cliproxy-desktop', 'CLIProxyAPI Desktop.exe');
  if (!packageOnly && fs.existsSync(installed)) targets.push(['Installed application', installed]);
  const uninstaller = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'cliproxy-desktop', 'Uninstall CLIProxyAPI Desktop.exe');
  if (!packageOnly && fs.existsSync(uninstaller)) targets.push(['Uninstaller', uninstaller]);

  for (const [label, file] of targets) checkExecutable(label, file, expected);
  checkVersion('Packaged application', targets[0][1], version);
  if (targets[2]) checkVersion('Installed application', targets[2][1], version);

  // Shortcuts drive the desktop, Start menu, and taskbar icons.
  const shortcuts = [
    ['Desktop shortcut', path.join(process.env.USERPROFILE || '', 'Desktop', 'CLIProxyAPI Desktop.lnk')],
    ['Start menu shortcut', path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'CLIProxyAPI Desktop.lnk')],
  ].filter(([, file]) => !packageOnly && fs.existsSync(file));
  for (const [label, file] of shortcuts) {
    const text = fs.readFileSync(file).toString('utf16le');
    assert.ok(text.includes('CLIProxyAPI Desktop.exe'), `${label} points at the installed application`);
  }

  console.log(JSON.stringify({
    version,
    icon: { bytes: source.length, sha256: expected.image },
    executables: targets.map(([label, file]) => ({ label, file })),
    shortcuts: shortcuts.map(([label, file]) => ({ label, file })),
  }, null, 2));
}

run();
