import fs = require('node:fs');
import path = require('node:path');
import os = require('node:os');
import { randomUUID } from 'node:crypto';

const APP_ID = 'io.cliproxy.desktop';
const DESKTOP_FILE = APP_ID + '.desktop';

function desktopValue(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
}
function execArgument(value: string) {
  if (/[\x00-\x1f\x7f]/.test(value)) throw new Error('Desktop launch paths cannot contain control characters.');
  // Exec is parsed by the desktop, not a shell. Its quoting precedes desktop-string escaping.
  return '"' + value.replace(/%/g, '%%').replace(/[\\"`$]/g, character => '\\' + character) + '"';
}
function writeChanged(file: string, value: string | Buffer) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  if (fs.existsSync(file) && fs.readFileSync(file).equals(bytes)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o644 });
    fs.renameSync(temporary, file);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
function updateEntry(file: string, values: Record<string, string>) {
  const previous = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '[Desktop Entry]\n';
  const lines = previous.replace(/\r\n/g, '\n').trimEnd().split('\n');
  const start = lines.indexOf('[Desktop Entry]');
  if (start < 0) throw new Error('Existing CPA desktop entry has no Desktop Entry group.');
  let end = lines.findIndex((line, index) => index > start && /^\[.*\]$/.test(line));
  if (end < 0) end = lines.length;
  const remaining = new Map(Object.entries(values));
  const group: string[] = [];
  for (const line of lines.slice(start + 1, end)) {
    const key = /^([A-Za-z0-9-]+)\s*=/.exec(line)?.[1];
    if (key && Object.hasOwn(values, key)) {
      if (remaining.has(key)) group.push(key + '=' + desktopValue(remaining.get(key)));
      remaining.delete(key);
    } else group.push(line);
  }
  for (const [key, value] of remaining) group.push(key + '=' + desktopValue(value));
  // Retain Hidden, GNOME's enable flag, desktop restrictions, comments, and action groups.
  writeChanged(file, [...lines.slice(0, start + 1), ...group, ...lines.slice(end)].join('\n') + '\n');
}
function setupLinuxDesktop(options: { appImage: string; userData: string; iconPath: string; env?: NodeJS.ProcessEnv; home?: string }) {
  const { appImage, userData, iconPath, env = process.env, home = os.homedir() } = options;
  if (!appImage || !path.isAbsolute(appImage) || appImage.includes('=') || !fs.statSync(appImage).isFile()) throw new Error('A persistent AppImage executable is required.');
  if (!path.isAbsolute(userData)) throw new Error('The app data directory must be absolute.');
  const xdgHome = (value: string | undefined, fallback: string) => value && path.isAbsolute(value) ? value : fallback;
  const configHome = xdgHome(env.XDG_CONFIG_HOME, path.join(home, '.config'));
  const dataHome = xdgHome(env.XDG_DATA_HOME, path.join(home, '.local/share'));
  const autostartFile = path.join(configHome, 'autostart', DESKTOP_FILE);
  const launcherFile = path.join(dataHome, 'applications', DESKTOP_FILE);
  const iconFile = path.join(dataHome, 'icons/hicolor/256x256/apps', APP_ID + '.png');
  // GLib checks the executable before expanding %% in paths. env keeps that check stable.
  const command = '/usr/bin/env -- ' + [appImage, '--user-data-dir', userData].map(execArgument).join(' ');
  const values = {
    Type: 'Application', Name: 'CPA for Desktop', Comment: 'Manage CLIProxyAPI and connected environments',
    Exec: command, Icon: iconFile, Terminal: 'false', StartupNotify: 'false', StartupWMClass: APP_ID,
    Categories: 'Development;Utility;',
  };
  writeChanged(iconFile, fs.readFileSync(iconPath));
  updateEntry(launcherFile, values);
  updateEntry(autostartFile, { ...values, Exec: command + ' --background' });
  return { autostartFile, launcherFile, iconFile };
}

export { APP_ID, DESKTOP_FILE, setupLinuxDesktop };
