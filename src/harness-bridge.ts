(() => {
// The sandboxed setup frame can request only the operations exposed by the desktop preload.
let nextRequest = 0;
const pending = new Map();
const themeListeners = new Set<(theme: HarnessTheme) => void>();
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
const invoke = <T>(name: string, ...args: unknown[]): Promise<T> => new Promise<T>((resolve, reject) => {
  const id = ++nextRequest;
  pending.set(id, { resolve, reject });
  parent.postMessage({ channel: 'harness:request', id, name, args }, '*');
});
window.harness = {
  load: () => invoke<HarnessLoad>('load'),
  inspect: (name, file) => invoke<HarnessPath>('inspect', name, file),
  browse: (name, file) => invoke<HarnessPath | null>('browse', name, file),
  apply: (selection) => invoke<HarnessSave>('apply', selection),
  restore: (selection) => invoke<HarnessRestore>('restore', selection),
  theme: () => invoke<HarnessTheme>('theme'),
  usage: (period, start, end) => invoke<CopilotUsageSummary>('usage', period, start, end),
  onTheme: (callback) => themeListeners.add(callback),
};

})();
