const { contextBridge, ipcRenderer } = require('electron');
const invoke = async (name, ...args) => {
  const result = await ipcRenderer.invoke(name, ...args);
  if (result.error) throw new Error(result.error);
  return result.value;
};
contextBridge.exposeInMainWorld('harness', {
  load: () => invoke('harness:load'),
  inspect: (name, file) => invoke('harness:inspect', name, file),
  browse: (name, file) => invoke('harness:browse', name, file),
  apply: (selection) => invoke('harness:apply', selection),
  restore: (selection) => invoke('harness:restore', selection),
  theme: () => invoke('harness:theme'),
  onTheme: (callback) => ipcRenderer.on('harness:theme-changed', (_event, theme) => callback(theme)),
});
