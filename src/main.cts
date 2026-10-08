import { app, BrowserWindow, Menu, Tray, dialog, shell, nativeImage, ipcMain } from 'electron';
import fs = require('node:fs');
import path = require('node:path');
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { option, prepareConfig, assertPortFree } from './runtime.cjs';
import { createUpdateChecker, CHECK_INTERVAL } from './updates.cjs';
import { setupTray } from './tray.cjs';
import { setupTaskbar } from './taskbar.cjs';

function getAppIcon(resources: string) {
  const candidates = [
    path.join(__dirname, 'assets', 'icon.png'),
    path.join(__dirname, 'assets', 'icon.ico'),
    path.join(resources, 'icon.ico'),
    path.join(resources, 'icon.png'),
    path.join(__dirname, 'resources', 'icon.ico'),
    path.join(__dirname, 'resources', 'icon.png'),
    ...(app.isPackaged ? [
      path.join(process.resourcesPath, 'proxy', 'icon.ico'),
      path.join(process.resourcesPath, 'proxy', 'icon.png'),
      path.join(process.resourcesPath, 'icon.ico'),
      path.join(process.resourcesPath, 'icon.png'),
    ] : []),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      try {
        const img = nativeImage.createFromPath(candidate);
        if (!img.isEmpty()) return img;
      } catch { /* Try next */ }
    }
  }
  return undefined;
}

app.setName('CLIProxyAPI Desktop');
app.setPath('userData', path.join(app.getPath('appData'), 'CLIProxyAPI Desktop'));
const dataOverride = option(process.argv, '--user-data-dir');
if (dataOverride) app.setPath('userData', path.resolve(dataOverride));
app.setAppUserModelId('io.cliproxy.desktop');
const launchedInBackground = process.argv.includes('--background');
let window: BrowserWindow;
let backend: import("node:child_process").ChildProcess;
let exiting = false;
let bootError: Error;
let log: fs.WriteStream;
let tray: Electron.Tray;
let updates: ReturnType<typeof createUpdateChecker>;
let updateTimer: ReturnType<typeof setInterval>;

function stopBackend() {
  if (!backend || backend.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    backend.once('exit', resolve);
    backend.kill();
  });
}

async function waitForBackend(runtime: ReturnType<typeof prepareConfig>) {
  for (let attempt = 0; attempt < 240; attempt++) {
    if (bootError) throw bootError;
    if (backend.exitCode !== null) throw new Error('The proxy stopped during startup. See proxy.log in the app data folder.');
    try {
      const result = await fetch(`${runtime.origin}/v0/management/config`, {
        headers: { Authorization: `Bearer ${runtime.managementKey}` },
        signal: AbortSignal.timeout(1000),
      });
      await result.arrayBuffer();
      if (result.ok) return;
    } catch { /* The listener may not be ready yet. */ }
    await delay(250);
  }
  throw new Error('The proxy did not become ready. See proxy.log in the app data folder.');
}

async function start() {
  const userData = app.getPath('userData');
  fs.mkdirSync(userData, { recursive: true });
  const trace = (message: string) => fs.appendFileSync(path.join(userData, 'desktop.log'), `${new Date().toISOString()} ${message}\n`);
  trace('Preparing configuration');
  const runtime = prepareConfig(userData, option(process.argv, '--import-config'));
  trace('Checking local port');
  await assertPortFree(runtime.port);
  trace('Local port available');
  const resources = app.isPackaged ? path.join(process.resourcesPath, 'proxy') : path.join(__dirname, 'resources');
  const staticDir = app.isPackaged ? path.join(resources, 'static') : resources;
  const binary = path.join(resources, 'cli-proxy-api.exe');
  if (!fs.existsSync(binary) || !fs.existsSync(path.join(staticDir, 'management.html'))) {
    throw new Error('Bundled proxy or management page is missing. Run prepare:resources before starting.');
  }
  log = fs.createWriteStream(path.join(userData, 'proxy.log'), { flags: 'a' });
  const env: NodeJS.ProcessEnv = { ...process.env, MANAGEMENT_STATIC_PATH: staticDir };
  for (const key of Object.keys(env)) {
    if (/^(PGSTORE_|GITSTORE_|OBJECTSTORE_)/.test(key) || key === 'MANAGEMENT_PASSWORD') delete env[key];
  }
  backend = spawn(binary, ['--config', runtime.configPath], { cwd: userData, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  trace('Proxy process started');
  backend.stdout.pipe(log, { end: false });
  backend.stderr.pipe(log, { end: false });
  backend.on('error', (error) => { bootError = error; });
  backend.on('exit', () => {
    if (!exiting && window && !window.isDestroyed()) {
      dialog.showErrorBox('CLIProxyAPI stopped', 'The proxy stopped unexpectedly. Close and reopen the app. Details are saved in proxy.log.');
      app.quit();
    }
  });
  await waitForBackend(runtime);
  trace('Proxy management API ready');
  const appIcon = getAppIcon(resources);
  if (process.platform === 'win32' && app.isPackaged && !option(process.argv, '--smoke-test')) {
    app.setLoginItemSettings({ openAtLogin: true, args: ['--background'] });
  }
  Menu.setApplicationMenu(null);
  window = new BrowserWindow({
    width: 1400, height: 940, minWidth: 850, minHeight: 600,
    title: 'CLIProxyAPI Desktop', show: false, backgroundColor: '#141311',
    frame: false,
    icon: appIcon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      // Hidden smoke tests still need animation frames for navigation and layout.
      backgroundThrottling: !option(process.argv, '--smoke-test'),
      nodeIntegration: false, contextIsolation: true, sandbox: true,
      additionalArguments: [`--desktop-origin=${runtime.origin}`],
    },
  });
  if (appIcon && !appIcon.isEmpty()) {
    window.setIcon(appIcon);
  }
  if (process.platform === 'win32') {
    setupTaskbar({ window, app, shell, userData, iconPath: path.join(__dirname, 'assets', 'icon.ico'), updateShortcuts: app.isPackaged && !option(process.argv, '--smoke-test') });
  }
  window.on('maximize', () => {
    if (!window.isDestroyed()) window.webContents.send('desktop-maximize-changed', true);
  });
  window.on('unmaximize', () => {
    if (!window.isDestroyed()) window.webContents.send('desktop-maximize-changed', false);
  });

  ipcMain.on('desktop-minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) win.minimize();
  });
  ipcMain.on('desktop-toggle-maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    }
  });
  ipcMain.on('desktop-close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) win.close();
  });
  ipcMain.handle('desktop-get-maximize-state', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win && !win.isDestroyed() ? win.isMaximized() : false;
  });

  const contents = window.webContents;
  const trustedUpdateEvent = (event: Electron.IpcMainInvokeEvent) => event.sender === contents && event.senderFrame === contents.mainFrame;
  const branding = {
    name: 'CPA for Desktop',
    logo: `data:image/png;base64,${fs.readFileSync(path.join(__dirname, 'assets', 'icon.png')).toString('base64')}`,
  };
  ipcMain.handle('desktop-branding', (event) => trustedUpdateEvent(event) ? branding : null);
  updates = createUpdateChecker({
    currentVersion: app.getVersion(),
    onChange: (state) => {
      if (!window.isDestroyed()) contents.send('desktop-update-state', state);
    },
  });
  ipcMain.handle('desktop-update-state', (event) => trustedUpdateEvent(event) ? updates.getState() : null);
  ipcMain.handle('desktop-check-updates', (event) => trustedUpdateEvent(event) ? updates.check() : null);
  ipcMain.handle('desktop-open-release', async (event) => {
    if (!trustedUpdateEvent(event)) return false;
    const release = updates.getState().release;
    if (!release) return false;
    try { await shell.openExternal(release.url); return true; } catch { return false; }
  });
  tray = setupTray({ Tray, Menu, app, window, icon: appIcon, isExiting: () => exiting, checkForUpdates: updates.check });
  updateTimer = setInterval(() => void updates.check(), CHECK_INTERVAL);
  updateTimer.unref();
  require('./harness-window.cjs').setupHarnessWindow(window, runtime, userData);
  contents.on('page-favicon-updated', (_event, favicons) => {
    if (appIcon) return;
    const embedded = favicons.find((url) => url.startsWith('data:image/'));
    if (embedded) {
      try {
        const icon = nativeImage.createFromDataURL(embedded);
        if (!icon.isEmpty()) window.setIcon(icon);
      } catch { /* Ignore unsupported image formats */ }
    }
  });
  const session = contents.session;
  session.setPermissionRequestHandler((_contents, permission, callback) => callback(permission === 'clipboard-sanitized-write'));
  session.webRequest.onBeforeSendHeaders({ urls: [`${runtime.origin}/v0/management/*`, `${runtime.origin}/v8/management/*`] }, (details, callback) => {
    if (details.webContentsId === contents.id) {
      details.requestHeaders.Authorization = `Bearer ${runtime.managementKey}`;
    }
    callback({ requestHeaders: details.requestHeaders });
  });
  const openExternal = (url: string) => {
    try {
      const parsed = new URL(url);
      if (['https:', 'http:'].includes(parsed.protocol)) void shell.openExternal(url);
    } catch { /* Invalid or privileged URLs are not opened. */ }
  };
  contents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  contents.on('will-navigate', (event, url) => {
    const target = new URL(url);
    if (target.origin !== runtime.origin || target.pathname !== '/management.html') {
      event.preventDefault();
      openExternal(url);
    }
  });
  window.once('ready-to-show', () => {
    if (!launchedInBackground) {
      window.show();
      window.focus();
    }
  });
  await window.loadURL(`${runtime.origin}/management.html`);
  trace('Management window loaded');
  void updates.check();
  const smokeDir = option(process.argv, '--smoke-test');
  if (smokeDir) {
    await require('./smoke.cjs').run({ window, runtime, outputDir: path.resolve(smokeDir), backendPid: backend.pid });
    app.quit();
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', (event) => {
    if (exiting) return;
    event.preventDefault();
    exiting = true;
    clearInterval(updateTimer);
    updates?.stop();
    tray?.destroy();
    void stopBackend().finally(() => { log?.end(); app.quit(); });
  });
  app.whenReady().then(start).catch(async (error) => {
    const smokeDir = option(process.argv, '--smoke-test');
    if (smokeDir) {
      fs.mkdirSync(smokeDir, { recursive: true });
      fs.writeFileSync(path.join(smokeDir, 'failure.txt'), error.stack || error.message);
    } else {
      dialog.showErrorBox('Unable to open CLIProxyAPI Desktop', error.message);
    }
    app.quit();
  });
}
