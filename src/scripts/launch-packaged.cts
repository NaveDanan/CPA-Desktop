// Launch from development tools without inheriting their Electron-as-Node flag.
import { spawn } from 'node:child_process';
import path = require('node:path');
import fs = require('node:fs');
const args = process.argv.slice(2);
const exeIndex = args.indexOf('--exe');
let executable = path.resolve(__dirname, '../dist/win-unpacked/CLIProxyAPI Desktop.exe');
if (exeIndex >= 0) executable = args.splice(exeIndex, 2)[1];
if (!fs.existsSync(executable)) throw new Error('Packaged application not found: ' + executable);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(executable, args, { detached: true, stdio: 'ignore', env });
child.unref();
console.log('Desktop process started: ' + child.pid);
