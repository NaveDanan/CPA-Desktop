// The sandboxed setup frame can request only the operations exposed by the desktop preload.
let nextRequest = 0;
const pending = new Map();
const themeListeners = new Set();
window.addEventListener('message', (event) => {
  if (event.source !== parent || event.data?.channel !== 'harness:response') return;
  const message = event.data;
  if (message.theme) { for (const callback of themeListeners) callback(message.theme); return; }
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  if (message.error) request.reject(new Error(message.error));
  else request.resolve(message.value);
});
const invoke = (name, ...args) => new Promise((resolve, reject) => {
  const id = ++nextRequest;
  pending.set(id, { resolve, reject });
  parent.postMessage({ channel: 'harness:request', id, name, args }, '*');
});
window.harness = {
  load: () => invoke('load'),
  inspect: (name, file) => invoke('inspect', name, file),
  browse: (name, file) => invoke('browse', name, file),
  apply: (selection) => invoke('apply', selection),
  restore: (selection) => invoke('restore', selection),
  theme: () => invoke('theme'),
  onTheme: (callback) => themeListeners.add(callback),
};
