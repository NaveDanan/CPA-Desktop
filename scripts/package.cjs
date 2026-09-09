const { spawn } = require('node:child_process');
const env = { ...process.env };
delete env.ELECTRON_MIRROR;
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(process.execPath, [require.resolve('electron-builder/cli.js'), '--win', 'nsis', '--x64', '--config.electronDist=node_modules/electron/dist'], { env, stdio: 'inherit', windowsHide: true });
child.on('exit', (code) => process.exit(code || 0));
