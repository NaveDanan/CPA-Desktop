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
  usage: (period, start, end, refreshPricing) => invoke<CopilotUsageSummary>('usage', period, start, end, refreshPricing),
  environments: () => invoke<EnvironmentView[]>('environments'),
  connectEnvironment: value => invoke<EnvironmentView[]>('connectEnvironment', value),
  editEnvironment: (id, value) => invoke<EnvironmentView[]>('editEnvironment', id, value),
  environmentDetails: id => invoke<EnvironmentDetails>('environmentDetails', id),
  providerAction: (id, value) => invoke<ProviderResult>('providerAction', id, value),
  openProviderURL: url => invoke<void>('openProviderURL', url),
  computerConnection: showToken => invoke<ComputerConnection>('computerConnection', showToken),
  configureComputerConnection: (enabled, port) => invoke<ComputerConnection>('configureComputerConnection', enabled, port),
  removeEnvironment: id => invoke<EnvironmentView[]>('removeEnvironment', id),
  refreshEnvironments: () => invoke<EnvironmentView[]>('refreshEnvironments'),
  bulkEnvironments: (action, ids, source) => invoke<EnvironmentOutcome[]>('bulkEnvironments', action, ids, source),
  dashboard: (boundaries, refreshPricing, scope) => invoke<UsageDashboard>('dashboard', boundaries, refreshPricing, scope),
  onTheme: (callback) => themeListeners.add(callback),
};

})();
