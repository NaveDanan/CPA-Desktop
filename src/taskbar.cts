import fs = require('node:fs');
import path = require('node:path');
import { createHash } from 'node:crypto';

const APP_ID = 'io.cliproxy.desktop';

interface TaskbarOptions {
  window: Pick<Electron.BrowserWindow, 'setAppDetails'>;
  app: Pick<Electron.App, 'isPackaged' | 'getAppPath' | 'getPath'>;
  shell: Pick<typeof Electron.shell, 'readShortcutLink' | 'writeShortcutLink'>;
  iconPath: string;
  userData: string;
  executable?: string;
  updateShortcuts?: boolean;
}

function setupTaskbar({ window, app, shell, iconPath, userData, executable = process.execPath, updateShortcuts = true }: TaskbarOptions) {
  const icon = fs.readFileSync(iconPath);
  const digest = createHash('sha256').update(icon).digest('hex').slice(0, 16);
  const taskbarIcon = path.join(userData, `taskbar-icon-${digest}.ico`);
  fs.mkdirSync(userData, { recursive: true });
  if (!fs.existsSync(taskbarIcon)) fs.writeFileSync(taskbarIcon, icon);
  window.setAppDetails({
    appId: APP_ID,
    appIconPath: taskbarIcon,
    appIconIndex: 0,
    relaunchCommand: app.isPackaged ? `"${executable}"` : `"${executable}" "${app.getAppPath()}"`,
    relaunchDisplayName: 'CPA for Desktop',
  });
  if (!updateShortcuts) return taskbarIcon;
  const folders = [
    app.getPath('desktop'),
    path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    path.join(app.getPath('appData'), 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar'),
  ];
  for (const folder of folders) {
    if (!fs.existsSync(folder)) continue;
    for (const name of fs.readdirSync(folder)) {
      if (!name.toLowerCase().endsWith('.lnk')) continue;
      const file = path.join(folder, name);
      try {
        const shortcut = shell.readShortcutLink(file);
        if (shortcut.appUserModelId !== APP_ID && path.basename(shortcut.target).toLowerCase() !== 'cliproxyapi desktop.exe') continue;
        if (shortcut.icon !== taskbarIcon || shortcut.iconIndex !== 0) {
          shell.writeShortcutLink(file, 'update', { target: shortcut.target, icon: taskbarIcon, iconIndex: 0 });
        }
      } catch { /* An inaccessible shortcut must not prevent the proxy from starting. */ }
    }
  }
  return taskbarIcon;
}

export { setupTaskbar };
