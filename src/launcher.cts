import fs = require('node:fs');
import path = require('node:path');
import os = require('node:os');
import { fork, type ChildProcess } from 'node:child_process';
import { atomicJSON } from './environments.cjs';
import { VERSION, validateRelease } from './headless-update.cjs';
import { option } from './runtime.cjs';

// This supervisor stays outside the versioned releases and owns activation and rollback.
async function supervise(root: string, args: string[], readyMs = 45000) {
  const stateFile = path.join(root, 'current.json');
  const dataDir = path.resolve(option(args, '--data-dir') || path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local/state'), 'cpa'));
  const errorFile = path.join(dataDir, 'update-error.json');
  const state: { current?: string; pending?: string } = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};
  const directory = (version?: string) => {
    if (!version) return root;
    if (!VERSION.test(version)) throw new Error('Invalid installed version.');
    const release = path.join(root, 'releases', version);
    validateRelease(release, version); return release;
  };
  // An interrupted activation always boots the last known working release.
  if (state.pending) { delete state.pending; atomicJSON(stateFile, state); atomicJSON(errorFile, { error: 'Update interrupted; the previous version was restored.' }); }
  let child: ChildProcess;
  let stopping = false;
  let switching = false;
  const stopChild = () => new Promise<void>(resolve => {
    if (!child || child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
    const timer = setTimeout(() => child.kill('SIGKILL'), 8000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    child.kill('SIGTERM');
  });
  const boot = (version?: string) => new Promise<void>((resolve, reject) => {
    child = fork(path.join(directory(version), 'headless.cjs'), args, {
      env: { ...process.env, CPA_INSTALL_ROOT: root }, stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    });
    const started = child;
    let ready = false;
    const timer = setTimeout(() => { reject(new Error('Environment did not become ready.')); started.kill('SIGTERM'); }, readyMs);
    started.once('error', error => { clearTimeout(timer); reject(error); });
    started.once('exit', code => {
      clearTimeout(timer);
      if (!ready) reject(new Error('Environment failed to start.'));
      else if (!switching && !stopping) { process.exitCode = code || 1; }
    });
    started.on('message', (message: {type?: string; release?: string; version?: string}) => {
      if (message?.type === 'ready' && !ready) {
        clearTimeout(timer);
        if (version && message.version !== version) { reject(new Error('Environment started on the wrong version.')); started.kill('SIGTERM'); return; }
        ready = true; resolve();
      }
      if (message?.type !== 'activate' || !ready || switching || stopping || started !== child) return;
      if (message.release !== message.version || !VERSION.test(message.release)) return;
      switching = true;
      void (async () => {
        const previous = state.current;
        try {
          directory(message.release);
          state.pending = message.release; atomicJSON(stateFile, state);
          await stopChild();
          if (stopping) return;
          await boot(message.release);
          state.current = message.release; delete state.pending; atomicJSON(stateFile, state);
          if (fs.existsSync(errorFile)) fs.unlinkSync(errorFile);
        } catch (error) {
          console.error('CPA activation failed:', error.code || error.name);
          await stopChild();
          state.current = previous; delete state.pending; atomicJSON(stateFile, state);
          atomicJSON(errorFile, { error: 'Update failed; the previous version was restored.' });
          if (!stopping) await boot(previous);
        } finally { switching = false; }
      })().catch(error => { console.error('CPA could not restart:', error.code || error.name, error.syscall || ''); process.exitCode = 1; });
    });
  });
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    void stopChild().then(() => { process.exitCode = 0; });
  };
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
  await boot(state.current);
}

async function main(args = process.argv.slice(2)) {
  if (args[0] === 'serve') { await supervise(__dirname, args); return; }
  const stateFile = path.join(__dirname, 'current.json');
  const version = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')).current : undefined;
  if (version && !VERSION.test(version)) throw new Error('Invalid installed version.');
  const directory = version ? path.join(__dirname, 'releases', version) : __dirname;
  if (version) validateRelease(directory, version);
  await require(path.join(directory, 'headless.cjs')).main(args);
}
if (require.main === module) void main().catch(error => { console.error(error.message); process.exitCode = 1; });
export { supervise };
