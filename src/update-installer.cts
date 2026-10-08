import fs = require('node:fs/promises');
import path = require('node:path');
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

export interface DownloadedUpdate {
  version: string;
  directory: string;
  file: string;
  sha256: string;
  size: number;
}

function assertUpdateDirectory(cacheDir: string, directory: string) {
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== path.resolve(cacheDir) || !/^update-[A-Za-z0-9]+$/.test(path.basename(resolved))) {
    throw new Error('Invalid temporary update directory.');
  }
  return resolved;
}

export async function removeUpdateDirectory(cacheDir: string, directory: string) {
  const target = assertUpdateDirectory(cacheDir, directory);
  const stat = await fs.lstat(target).catch((): null => null);
  if (!stat) return;
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid temporary update directory.');
  await fs.rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

export async function cleanupUpdateCache(cacheDir: string) {
  await fs.mkdir(cacheDir, { recursive: true });
  for (const entry of await fs.readdir(cacheDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !/^update-[A-Za-z0-9]+$/.test(entry.name)) continue;
    const directory = path.join(cacheDir, entry.name);
    try {
      const runner = JSON.parse(await fs.readFile(path.join(directory, 'ready.json'), 'utf8'));
      if (Number.isSafeInteger(runner.pid) && runner.pid > 0) {
        try { process.kill(runner.pid, 0); continue; } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') continue;
        }
      }
    } catch { /* Interrupted downloads have no running installer helper. */ }
    await removeUpdateDirectory(cacheDir, directory);
  }
}

export async function takeInstallError(cacheDir: string) {
  const file = path.join(cacheDir, 'last-install.json');
  try {
    const result = JSON.parse(await fs.readFile(file, 'utf8'));
    await fs.unlink(file);
    return result.success === false ? 'The update could not be installed. Download it again and retry, or use the GitHub installer.' : null;
  } catch { return null; }
}

export async function verifyInstaller(update: DownloadedUpdate) {
  const stat = await fs.lstat(update.file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== update.size) throw new Error('The downloaded installer has changed. Download it again.');
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(update.file)) hash.update(bytes);
  if (hash.digest('hex') !== update.sha256) throw new Error('The downloaded installer has changed. Download it again.');
}

interface LaunchOptions extends DownloadedUpdate {
  cacheDir: string;
  appPath: string;
  userData: string;
}

// The helper runs outside Electron so Windows can replace the app executable.
// Readiness is acknowledged before the app quits; a blocked helper leaves it running.
export async function launchUpdateInstaller(update: LaunchOptions) {
  if (process.platform !== 'win32') throw new Error('In-app installation is available on Windows.');
  assertUpdateDirectory(update.cacheDir, update.directory);
  if (path.dirname(path.resolve(update.file)) !== path.resolve(update.directory)) throw new Error('Invalid installer path.');
  const script = path.join(update.directory, 'install.ps1');
  await fs.copyFile(path.join(__dirname, 'src', 'update-runner.ps1'), script);
  await fs.writeFile(path.join(update.directory, 'job.json'), JSON.stringify({
    cacheDir: path.resolve(update.cacheDir),
    directory: path.resolve(update.directory),
    installer: update.file,
    sha256: update.sha256,
    parentPid: process.pid,
    appPath: update.appPath,
    restartArgs: ['--user-data-dir', update.userData],
    version: update.version,
  }));
  const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const helperLog = path.join(update.directory, 'helper.log');
  // Start-Process gives the hidden helper its own console so it survives parent exit.
  // Node's DETACHED_PROCESS flag makes Windows PowerShell skip -File on some systems.
  // Keep the command static; the script path travels through an environment variable.
  const bootstrap = "$ErrorActionPreference = 'Stop'; $helper = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ('\"' + $env:CPA_DESKTOP_UPDATE_SCRIPT + '\"')) -WindowStyle Hidden -PassThru; [Console]::WriteLine($helper.Id)";
  const child = spawn(executable, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(bootstrap, 'utf16le').toString('base64')], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CPA_DESKTOP_UPDATE_SCRIPT: script },
  });
  let output = '';
  let errors = '';
  child.stdout.on('data', (bytes) => { output = (output + bytes.toString()).slice(0, 16000); });
  child.stderr.on('data', (bytes) => { errors = (errors + bytes.toString()).slice(0, 16000); });
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`Windows could not launch the update helper. ${errors}`)));
  });
  const helperPid = Number(output.trim());
  if (!Number.isSafeInteger(helperPid) || helperPid <= 0) throw new Error('Windows did not return an update helper process.');
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      try { process.kill(helperPid, 0); }
      catch { throw new Error('The update helper stopped before installation.'); }
      try {
        const ready = JSON.parse(await fs.readFile(path.join(update.directory, 'ready.json'), 'utf8'));
        if (ready.pid === helperPid) return;
      } catch { /* Wait until the helper has validated its job and is ready. */ }
      await delay(100);
    }
    throw new Error('Windows could not start the update helper. Try again or use the GitHub installer.');
  } catch (error) {
    try { process.kill(helperPid); } catch { /* The helper may have already exited. */ }
    const details = await fs.readFile(helperLog, 'utf8').catch(() => '');
    throw new Error(`${(error as Error).message}${details ? '\n' + details.slice(0, 16000) : ''}`);
  }
}
