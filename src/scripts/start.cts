import { spawn } from 'node:child_process';
import path = require('node:path');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), [path.resolve(__dirname, '..'), ...process.argv.slice(2)], { env, stdio: 'inherit', windowsHide: true });
child.on('exit', (code) => process.exit(code || 0));
