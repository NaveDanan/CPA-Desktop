import fs = require('node:fs');
import path = require('node:path');
import os = require('node:os');
import net = require('node:net');
import { randomBytes } from 'node:crypto';
import YAML = require('yaml');

function option(args: string[], name: string) {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

function resolveAuthDir(value: string | undefined, configPath: string) {
  const raw = value || '~/.cli-proxy-api';
  if (raw === '~') return os.homedir();
  if (/^~[\\/]/.test(raw)) return path.join(os.homedir(), raw.slice(2));
  return path.resolve(path.dirname(configPath), raw);
}

function prepareConfig(userData: string, importPath?: string) {
  fs.mkdirSync(userData, { recursive: true });
  const configPath = path.join(userData, 'config.yaml');
  const secretsPath = path.join(userData, 'desktop-secrets.json');
  const firstRun = !fs.existsSync(configPath);
  const source = firstRun && importPath ? path.resolve(importPath) : configPath;
  const config = fs.existsSync(source) ? YAML.parse(fs.readFileSync(source, 'utf8')) || {} : {};
  if (firstRun && importPath && !fs.existsSync(source)) throw new Error('The import configuration does not exist.');
  if (config.home?.enabled) throw new Error('Desktop mode requires a standalone proxy configuration.');
  const v8 = config['config-version'] === 8 || !!(config.server || config.management || config.access || config.oauth);
  const port = v8 ? (config.server?.port || config.port || 8317) : (config.port || 8317);
  const secrets = fs.existsSync(secretsPath)
    ? JSON.parse(fs.readFileSync(secretsPath, 'utf8'))
    : { managementKey: randomBytes(32).toString('hex') };
  if (!fs.existsSync(secretsPath)) fs.writeFileSync(secretsPath, JSON.stringify(secrets), { mode: 0o600 });
  const authDir = path.join(userData, 'auths');
  fs.mkdirSync(authDir, { recursive: true });
  if (firstRun) {
    const oldAuthDir = resolveAuthDir(v8 ? (config.oauth?.['auth-dir'] || config['auth-dir']) : config['auth-dir'], source);
    if (path.resolve(oldAuthDir) !== path.resolve(authDir) && fs.existsSync(oldAuthDir)) {
      for (const entry of fs.readdirSync(oldAuthDir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.json')) {
          fs.copyFileSync(path.join(oldAuthDir, entry.name), path.join(authDir, entry.name), fs.constants.COPYFILE_EXCL);
        }
      }
    }
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('The configured port is invalid.');
  if (v8) {
    config.server = { ...config.server, host: '127.0.0.1', port, tls: { enable: false } };
    config.oauth = { ...config.oauth, 'auth-dir': authDir.replaceAll('\\', '/') };
    config.management = {
      ...config.management,
      'allow-remote': false,
      'secret-key': secrets.managementKey,
      'disable-control-panel': false,
      'disable-auto-update-panel': true,
    };
    config.access ||= {};
    if (!Array.isArray(config.access['api-keys']) || !config.access['api-keys'].length) {
      const legacyKeys = config.access['api-keys'] == null ? config['api-keys'] : undefined;
      config.access['api-keys'] = Array.isArray(legacyKeys) && legacyKeys.length ? legacyKeys : [randomBytes(32).toString('hex')];
    }
    config.observability ||= {};
    config.observability.usage = { ...config.observability.usage, 'usage-statistics-enabled': true };
  } else {
    config.host = '127.0.0.1';
    config.port = port;
    config.tls = { enable: false };
    config['auth-dir'] = authDir.replaceAll('\\', '/');
    config['remote-management'] = {
      ...config['remote-management'],
      'allow-remote': false,
      'secret-key': secrets.managementKey,
      'disable-control-panel': false,
      'disable-auto-update-panel': true,
    };
    if (!Array.isArray(config['api-keys']) || !config['api-keys'].length) {
      config['api-keys'] = [randomBytes(32).toString('hex')];
    }
    config['usage-statistics-enabled'] = true;
  }
  const temporary = configPath + '.next';
  fs.writeFileSync(temporary, YAML.stringify(config), { mode: 0o600 });
  fs.renameSync(temporary, configPath);
  return { configPath, config, port, managementKey: secrets.managementKey, origin: `http://127.0.0.1:${port}` };
}

function assertPortFree(port: number) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () => reject(new Error(`Port ${port} is already in use. Close the other proxy instance and reopen the desktop app.`)));
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => server.close(resolve));
  });
}

export { option, prepareConfig, assertPortFree, resolveAuthDir };
