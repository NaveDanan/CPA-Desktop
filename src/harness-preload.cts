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
  onTheme: (callback) => ipcRenderer.on('harness:theme-changed', (_event, theme) => callback(theme)),
};
contextBridge.exposeInMainWorld('harness', api);
