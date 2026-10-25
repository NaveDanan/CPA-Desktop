import { contextBridge, ipcRenderer } from 'electron';
const invoke = async (name: string, ...args: unknown[]) => {
  const result = await ipcRenderer.invoke(name, ...args);
  if (result.error) throw new Error(result.error);
  return result.value;
};
const api: HarnessAPI = {
  load: () => invoke('harness:load'),
  inspect: (name, file) => invoke('harness:inspect', name, file),
  browse: (name, file) => invoke('harness:browse', name, file),
  apply: (selection) => invoke('harness:apply', selection),
  restore: (selection) => invoke('harness:restore', selection),
  theme: () => invoke('harness:theme'),
  usage: (period, start, end) => invoke('harness:usage', period, start, end),
  environments: () => invoke('harness:environments'),
  connectEnvironment: value => invoke('harness:connectEnvironment', value),
  editEnvironment: (id, value) => invoke('harness:editEnvironment', id, value),
  environmentDetails: id => invoke('harness:environmentDetails', id),
  providerAction: (id, value) => invoke('harness:providerAction', id, value),
  openProviderURL: url => invoke('harness:openProviderURL', url),
  computerConnection: showToken => invoke('harness:computerConnection', showToken),
  configureComputerConnection: (enabled, port) => invoke('harness:configureComputerConnection', enabled, port),
  removeEnvironment: id => invoke('harness:removeEnvironment', id),
  refreshEnvironments: () => invoke('harness:refreshEnvironments'),
  bulkEnvironments: (action, ids, source) => invoke('harness:bulkEnvironments', action, ids, source),
  dashboard: (boundaries, refreshPricing, scope) => invoke('harness:dashboard', boundaries, refreshPricing, scope),
  onTheme: (callback) => ipcRenderer.on('harness:theme-changed', (_event, theme) => callback(theme)),
};
contextBridge.exposeInMainWorld('harness', api);
