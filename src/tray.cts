interface TrayOptions {
  Tray: typeof import('electron').Tray;
  Menu: typeof import('electron').Menu;
  app: Electron.App;
  window: Electron.BrowserWindow;
  icon: Electron.NativeImage | string;
  isExiting: () => boolean;
  checkForUpdates: () => Promise<unknown>;
}
function setupTray({ Tray, Menu, app, window, icon, isExiting, checkForUpdates }: TrayOptions) {
  const tray = new Tray(icon);
  const show = () => {
    if (window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  };
  tray.setToolTip('CPA-Desktop • Proxy running');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open CPA-Desktop', click: show },
    { label: 'Check for updates', click: () => { show(); void checkForUpdates(); } },
    { type: 'separator' },
    { label: 'Quit CPA-Desktop', click: () => app.quit() },
  ]));
  tray.on('click', show);
  tray.on('double-click', show);
  window.on('close', (event) => {
    if (isExiting()) return;
    event.preventDefault();
    window.hide();
  });
  app.on('second-instance', show);
  app.on('activate', show);
  return tray;
}

export { setupTray };
