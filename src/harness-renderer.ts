(() => {
const names: Record<string, string> = { codex: 'Codex CLI', claude: 'Claude Code CLI' };
let models: CopilotModel[] = [];
let state: CliSelections = {};
let defaults: Record<string, string> = {};
let busy = false;
type ControlID = 'apply' | 'restore' | 'refresh' | 'restore-confirm' | 'restore-cancel';
type InputID = 'search' | `${string}-all` | `restore-${string}`;
function $<T extends string>(id: T): T extends ControlID ? HTMLButtonElement : T extends 'restore-dialog' ? HTMLDialogElement : T extends `${string}-default` ? HTMLSelectElement : T extends InputID ? HTMLInputElement : HTMLElement {
  return document.getElementById(id) as ReturnType<typeof $<T>>;
}
function applyTheme(theme: HarnessTheme) {
  document.documentElement.dataset.theme = theme.name;
  for (const [key, value] of Object.entries(theme.tokens)) if (value) document.documentElement.style.setProperty(key, value);
}
window.harness.onTheme(applyTheme);
void window.harness.theme().then(applyTheme).catch(() => {});
function status(message: string, kind = '') {
  $('status').textContent = message; $('status').className = kind;
  if (kind) $('status').scrollIntoView({ block: 'nearest' });
}
function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) { const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node; }
function eligible(key: string, model: CopilotModel) { return !!model && (model.clients?.includes(key) ?? (key === 'claude' ? /(?:^|\/)claude-/.test(model.id) : /(?:^|\/)(gpt-|o\d(?:[.-]|$)|codex(?:[.-]|$))/.test(model.id))); }
function selected(key: string, id: string) { return eligible(key, models.find((model) => model.id === id)) && (state[key].all || state[key].models.includes(id)); }
function updateApply() {
  const enabled = Object.keys(state).filter((key) => state[key].enabled);
  $('apply').disabled = busy || !enabled.length || enabled.some((key) => !models.some((model) => selected(key, model.id)));
  $('restore').disabled = busy || !state.codex || !state.claude;
  $('clients').inert = busy;
  document.querySelector<HTMLElement>('.models').inert = busy;
}
function updateDefaults(key: string) {
  const select = $(`${key}-default`);
  select.replaceChildren();
  const available = models.filter((model) => selected(key, model.id));
  if (!available.some((model) => model.id === state[key].defaultModel)) state[key].defaultModel = available[0]?.id || '';
  for (const model of available) { const option = element('option', model.display_name || model.id); option.value = model.id; select.append(option); }
  if (!available.length) {
    const placeholder = element('option', 'Select a model below, or turn off this CLI');
    placeholder.value = '';
    select.append(placeholder);
  }
  select.value = state[key].defaultModel;
  select.disabled = !state[key].enabled || !available.length;
}
async function inspect(key: string) {
  try { const result = await window.harness.inspect(key, state[key].path); $(`${key}-path-status`).textContent = result.exists ? 'Existing file · original will be backed up' : 'New file · will be created when applied'; }
  catch (error) { $(`${key}-path-status`).textContent = error.message; }
}
function renderClients() {
  $('clients').replaceChildren();
  for (const key of Object.keys(names)) {
    const section = element('section', '', 'client');
    const top = element('div', '', 'client-top');
    const label = element('label', '', 'client-title');
    const enabled = document.createElement('input'); enabled.type = 'checkbox'; enabled.checked = state[key].enabled; enabled.id = `${key}-enabled`;
    enabled.addEventListener('change', () => { state[key].enabled = enabled.checked; renderRows(); updateDefaults(key); updateApply(); });
    label.append(enabled, document.createTextNode(names[key])); top.append(label);
    const allLabel = element('label'); const all = document.createElement('input'); all.type = 'checkbox'; all.checked = state[key].all; all.id = `${key}-all`;
    all.addEventListener('change', () => { state[key].all = all.checked; state[key].models = all.checked ? models.filter((model) => eligible(key, model)).map((model) => model.id) : []; renderRows(); updateDefaults(key); updateApply(); });
    allLabel.append(all, document.createTextNode(` Expose all ${key === 'claude' ? 'Anthropic' : 'OpenAI'} models`)); top.append(allLabel);
    const controls = element('div', '', 'client-controls'); const pathField = element('div');
    const pathLabel = element('label', 'Configuration file', 'field-label'); pathLabel.htmlFor = `${key}-path`;
    const row = element('div', '', 'path-row'); const input = document.createElement('input'); input.id = `${key}-path`; input.value = state[key].path; input.spellcheck = false;
    input.addEventListener('input', () => { state[key].path = input.value; $(`${key}-path-status`).textContent = 'Path changed · check before applying'; });
    input.addEventListener('change', () => inspect(key));
    const browse = element('button', 'Browse…'); browse.type = 'button'; browse.addEventListener('click', async () => {
      try { const result = await window.harness.browse(key, input.value); if (result) { state[key].path = result.path; input.value = result.path; await inspect(key); } }
      catch (error) { status(error.message, 'error'); }
    }); row.append(input, browse);
    const actions = element('div', '', 'default-actions'); const hint = element('p', '', 'path-status'); hint.id = `${key}-path-status`;
    const reset = element('button', 'Use default path', 'text-button'); reset.type = 'button'; reset.addEventListener('click', () => { input.value = state[key].path = defaults[key]; void inspect(key); });
    actions.append(hint, reset); pathField.append(pathLabel, row, actions);
    const defaultField = element('div'); const defaultLabel = element('label', 'Start new sessions with', 'field-label'); defaultLabel.htmlFor = `${key}-default`;
    const select = document.createElement('select'); select.id = `${key}-default`; select.addEventListener('change', () => { state[key].defaultModel = select.value; }); defaultField.append(defaultLabel, select);
    controls.append(pathField, defaultField); section.append(top, controls); $('clients').append(section); updateDefaults(key); void inspect(key);
  }
}
function renderRows() {
  $('model-rows').replaceChildren(); const query = $('search').value.toLowerCase();
  let visible = 0;
  for (const model of models) {
    if (!`${model.id} ${model.display_name || ''}`.toLowerCase().includes(query)) continue;
    visible++;
    const row = element('tr'); const name = element('td', model.display_name || model.id, 'model-name'); if (model.display_name && model.display_name !== model.id) name.append(element('small', model.id)); row.append(name);
    for (const key of Object.keys(names)) {
      const cell = element('td'); const input = document.createElement('input'); input.type = 'checkbox'; input.checked = selected(key, model.id); input.disabled = !state[key].enabled || !eligible(key, model);
      input.setAttribute('aria-label', `${model.id} in ${names[key]}`);
      input.addEventListener('change', () => {
        const ids = models.filter((item) => selected(key, item.id)).map((item) => item.id);
        state[key].all = false; $(`${key}-all`).checked = false;
        state[key].models = input.checked ? [...new Set([...ids, model.id])] : ids.filter((id) => id !== model.id);
        updateDefaults(key); updateApply();
      }); cell.append(input); row.append(cell);
    }
    $('model-rows').append(row);
  }
  $('count').textContent = `(${models.length})`;
  $('empty').hidden = visible > 0;
  $('empty').textContent = models.length ? 'No models match your search.' : 'No Copilot models found. Connect a GitHub Copilot account in OAuth, then refresh.';
}
async function load() {
  busy = true; $('refresh').disabled = true; updateApply(); status('Loading available models…');
  try {
    const result = await window.harness.load(); models = result.models; defaults = result.defaults;
    let removed = 0;
    for (const key of Object.keys(names)) {
      state[key] ||= { enabled: true, all: true, models: [], path: defaults[key], ...result.saved[key] };
      const previous = state[key].models;
      const migrateID = (id: string) => /(?:^|\/)claude-/.test(id || '') && models.some((model) => model.id === id.replaceAll('.', '-')) ? id.replaceAll('.', '-') : id;
      state[key].models = previous.map(migrateID).filter((id) => models.some((model) => model.id === id && eligible(key, model)));
      state[key].defaultModel = migrateID(state[key].defaultModel);
      if (!state[key].all) removed += previous.length - state[key].models.length;
    }
    renderClients(); renderRows();
    status(result.modelError || (removed ? 'Unavailable models were removed from your selections. Check your choices before applying.' : models.length ? 'Select models, check file paths, then apply.' : 'Connect GitHub Copilot to get started.'), result.modelError ? 'error' : '');
  } catch (error) { status(error.message + ' Click Refresh models to retry.', 'error'); }
  finally { busy = false; $('refresh').disabled = false; updateApply(); }
}
$('refresh').addEventListener('click', load);
$('search').addEventListener('input', renderRows);
$('setup').addEventListener('submit', async (event) => {
  event.preventDefault(); if (busy) return;
  busy = true; updateApply(); $('refresh').disabled = true; status('Saving CLI configuration…');
  try {
    const result = await window.harness.apply(structuredClone(state));
    status(`Configured ${result.paths.length} CLI(s). Restart them and open /model.\n${result.paths.join('\n')}\n${result.backups.length} original file(s) backed up alongside the configuration.`, 'success');
    for (const key of Object.keys(names)) void inspect(key);
  } catch (error) { status(error.message, 'error'); }
  finally { busy = false; $('refresh').disabled = false; updateApply(); }
});
const restoreDialog = $('restore-dialog');
restoreDialog.addEventListener('close', () => $('restore').focus());
function updateRestore() {
  $('restore-confirm').disabled = busy || !Object.keys(names).some((key) => $(`restore-${key}`).checked);
}
$('restore').addEventListener('click', () => {
  for (const key of Object.keys(names)) {
    $(`restore-${key}`).checked = true;
    $(`restore-${key}-path`).textContent = state[key].path;
  }
  $('restore-status').textContent = '';
  updateRestore();
  restoreDialog.showModal();
});
for (const key of Object.keys(names)) $(`restore-${key}`).addEventListener('change', updateRestore);
$('restore-cancel').addEventListener('click', () => { restoreDialog.close(); $('restore').focus(); });
restoreDialog.addEventListener('cancel', (event) => { if (busy) event.preventDefault(); });
$('restore-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy || $('restore-confirm').disabled) return;
  const selection = Object.fromEntries(Object.keys(names).map((key) => [key, { path: state[key].path, enabled: $(`restore-${key}`).checked }]));
  busy = true; updateApply(); updateRestore(); $('refresh').disabled = true; $('restore-cancel').disabled = true;
  restoreDialog.querySelector('fieldset').disabled = true;
  $('restore-status').textContent = 'Restoring CLI defaults...';
  try {
    const result = await window.harness.restore(selection);
    Object.assign(state, result.restored);
    renderClients(); renderRows();
    restoreDialog.close();
    status(`Restored defaults for ${Object.keys(result.restored).map((key) => names[key]).join(' and ')}. Restart the selected CLIs to use their normal sign-in and models.\n${result.paths.join('\n')}`, 'success');
  } catch (error) { $('restore-status').textContent = error.message; }
  finally {
    busy = false; updateApply(); updateRestore(); $('refresh').disabled = false; $('restore-cancel').disabled = false;
    restoreDialog.querySelector('fieldset').disabled = false;
  }
});
let environmentItems: EnvironmentView[] = [];
const environmentSelected = new Set<string>();
let environmentBusy = false;
let editingEnvironment = '';
let inspectedEnvironment = '';
let signIn: { id: string; provider: string; state: string; url: string } | null = null;
const envNode = (id: string) => document.getElementById(id)!;
const envInput = (id: string) => envNode(id) as HTMLInputElement;
const envButton = (text: string, action: () => void) => { const button = element('button', text); button.type = 'button'; button.addEventListener('click', action); return button; };
function renderComputerConnection(value: ComputerConnection) {
  envInput('computer-enabled').checked = value.enabled; envInput('computer-port').value = String(value.port);
  envNode('computer-addresses').textContent = value.error || (value.enabled ? value.addresses.join('\n') : 'Connections to this computer are disabled.');
  if (value.token) { envNode('computer-token-label').hidden = false; envInput('computer-token').value = value.token; envInput('computer-token').type = 'text'; }
}
envNode('computer-connection-form').addEventListener('submit', event => { event.preventDefault(); void environmentOperation(async () => {
  renderComputerConnection(await window.harness.configureComputerConnection(envInput('computer-enabled').checked, Number(envInput('computer-port').value)));
  environmentMessage('Connection settings saved.');
}); });
envNode('computer-token-show').addEventListener('click', () => void environmentOperation(async () => {
  if (!envNode('computer-token-label').hidden) { envNode('computer-token-label').hidden = true; envInput('computer-token').value = ''; envNode('computer-token-show').textContent = 'Show connection token'; }
  else { renderComputerConnection(await window.harness.computerConnection(true)); envNode('computer-token-show').textContent = 'Hide connection token'; }
}));
function environmentMessage(message: string, error = false) { envNode('environment-message').textContent = message; envNode('environment-message').className = error ? 'error' : ''; }
function environmentControls() {
  for (const node of envNode('environment-manager').querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input,button,select')) node.disabled = environmentBusy;
  for (const id of ['environment-models', 'environment-providers', 'environment-version']) (envNode(id) as HTMLButtonElement).disabled = environmentBusy || !environmentSelected.size;
  (envNode('environment-all') as HTMLButtonElement).disabled = environmentBusy || environmentItems.length < 2;
}
async function environmentOperation(action: () => Promise<void>) {
  if (environmentBusy) return;
  environmentBusy = true; environmentControls();
  try { await action(); } catch (error) { environmentMessage(error.message || 'Environment operation failed.', true); }
  finally { environmentBusy = false; environmentControls(); }
}
function resetConnection() {
  editingEnvironment = ''; (envNode('environment-connect') as HTMLFormElement).reset();
  envInput('environment-token').required = true; envInput('environment-token').placeholder = '';
  envNode('environment-save').textContent = 'Connect'; envNode('environment-cancel').hidden = true;
  envInput('environment-initial-sync').parentElement.hidden = false;
}
function renderEnvironmentList() {
  const picker = envNode('environment-source') as HTMLSelectElement; const source = picker.value;
  picker.replaceChildren(...environmentItems.map(item => new Option(item.name, item.id)));
  picker.value = environmentItems.some(item => item.id === source) ? source : 'local';
  for (const id of environmentSelected) if (!environmentItems.some(item => item.id === id)) environmentSelected.delete(id);
  envNode('environment-list').replaceChildren(...environmentItems.map(item => {
    const row = element('div', undefined, 'environment-row'); const label = element('label');
    const check = element('input'); check.type = 'checkbox'; check.checked = environmentSelected.has(item.id); check.setAttribute('aria-label', 'Select ' + item.name);
    check.addEventListener('change', () => { check.checked ? environmentSelected.add(item.id) : environmentSelected.delete(item.id); environmentControls(); });
    const name = element('span'); name.append(element('strong', item.name), element('small', item.address)); label.append(check, name);
    const state = element('span', `${item.version ? 'v' + item.version + ' · ' : ''}${item.status}`, 'environment-state');
    if (item.error || item.updateError) state.append(element('small', item.error || item.updateError, 'error'));
    const inspect = envButton('Models and providers', () => void environmentOperation(() => inspectEnvironment(item.id)));
    inspect.setAttribute('aria-label', 'Models and providers on ' + item.name); row.append(label, state, inspect);
    if (item.id !== 'local') {
      const edit = envButton('Edit', () => {
        editingEnvironment = item.id; envInput('environment-name').value = item.name; envInput('environment-address').value = item.address;
        envInput('environment-token').value = ''; envInput('environment-token').required = false; envInput('environment-token').placeholder = 'Leave blank to keep the saved token';
        envNode('environment-save').textContent = 'Save connection'; envNode('environment-cancel').hidden = false;
        envInput('environment-initial-sync').parentElement.hidden = true; envInput('environment-name').focus();
      });
      const remove = envButton('Disconnect', () => void environmentOperation(async () => {
        environmentItems = await window.harness.removeEnvironment(item.id); environmentSelected.delete(item.id);
        if (editingEnvironment === item.id) resetConnection();
        if (inspectedEnvironment === item.id) { inspectedEnvironment = ''; envNode('environment-detail').hidden = true; }
        if (signIn?.id === item.id) { signIn = null; envNode('provider-session').hidden = true; }
        renderEnvironmentList(); environmentMessage(item.name + ' disconnected.');
      }));
      edit.setAttribute('aria-label', 'Edit ' + item.name); remove.setAttribute('aria-label', 'Disconnect ' + item.name); row.append(edit, remove);
    }
    return row;
  })); environmentControls();
}
async function inspectEnvironment(id: string) {
  environmentMessage('Loading models and provider connections...');
  const detail = await window.harness.environmentDetails(id); inspectedEnvironment = id;
  envNode('environment-detail').hidden = false; envNode('environment-detail-title').textContent = environmentItems.find(item => item.id === id)?.name || id;
  envNode('environment-detail-status').textContent = detail.modelError || `${detail.models.length} models · ${detail.providers.length} provider connections`;
  envNode('environment-detail-models').replaceChildren(...(detail.models.length ? detail.models.map(model => element('div', model.display_name ? model.display_name + ' · ' + model.id : model.id)) : [element('p', 'No available models. Connect a provider and refresh.')]));
  envNode('environment-detail-selection').replaceChildren(...(Object.entries(detail.selection).length ? Object.entries(detail.selection).map(([key, value]) => element('p', `${names[key] || key}: ${value.enabled ? (value.all ? 'All available models' : value.models.join(', ')) + (value.defaultModel ? ' · default ' + value.defaultModel : '') : 'Disabled'}`)) : [element('p', 'No CLI model choices saved yet.')]));
  envNode('environment-detail-providers').replaceChildren(...(detail.providers.length ? detail.providers.map(account => {
    const row = element('div', undefined, 'provider-account'); row.append(element('span', `${account.provider} · ${account.name} · ${account.disabled ? 'Disabled' : account.status || 'Enabled'}`));
    const toggle = envButton(account.disabled ? 'Enable' : 'Disable', () => void environmentOperation(async () => { await window.harness.providerAction(id, { action: 'toggle', name: account.name, disabled: !account.disabled }); await inspectEnvironment(id); if (id === 'local') await load(); }));
    toggle.setAttribute('aria-label', `${account.disabled ? 'Enable' : 'Disable'} ${account.name}`); row.append(toggle); return row;
  }) : [element('p', 'No provider connections. Sign in below or sync them from another environment.')]));
  environmentMessage('Models and provider connections loaded.');
}
async function runEnvironmentSync(actions: ('models' | 'providers' | 'version')[], ids: string[], source = (envNode('environment-source') as HTMLSelectElement).value) {
  const results: EnvironmentOutcome[] = [];
  let targets = ids;
  for (const action of actions) {
    environmentMessage(action === 'version' ? 'Updating versions and waiting for restart...' : 'Syncing ' + action + '...');
    const outcomes = await window.harness.bulkEnvironments(action, targets, source);
    results.push(...outcomes.map(item => ({ ...item, message: action + ': ' + item.message })));
    // Never apply models to a machine whose provider sync failed.
    if (action === 'providers') targets = targets.filter(id => outcomes.some(item => item.id === id && item.ok));
    if (!targets.length) break;
  }
  envNode('environment-results').replaceChildren(...results.map(result => element('li', `${environmentItems.find(item => item.id === result.id)?.name || result.id}: ${result.message}`, result.ok ? '' : 'error')));
  const failed = results.some(item => !item.ok);
  environmentItems = await window.harness.refreshEnvironments(); renderEnvironmentList();
  if (inspectedEnvironment) await inspectEnvironment(inspectedEnvironment);
  if (ids.includes('local') && source !== 'local') await load();
  environmentMessage(failed ? 'Some environments could not be updated. See the results below.' : 'Sync complete. Restart affected CLIs to load their models.', failed);
}
envNode('environment-connect').addEventListener('submit', event => {
  event.preventDefault();
  const value = { name: envInput('environment-name').value.trim(), address: envInput('environment-address').value.trim(), token: envInput('environment-token').value };
  const sync = !editingEnvironment && envInput('environment-initial-sync').checked;
  envInput('environment-token').value = '';
  void environmentOperation(async () => {
    environmentMessage(editingEnvironment ? 'Checking and saving connection...' : 'Connecting...');
    const previous = new Set(environmentItems.map(item => item.id));
    environmentItems = editingEnvironment ? await window.harness.editEnvironment(editingEnvironment, value) : await window.harness.connectEnvironment(value);
    const added = environmentItems.filter(item => !previous.has(item.id)).map(item => item.id); for (const id of added) environmentSelected.add(id);
    resetConnection(); renderEnvironmentList(); environmentMessage(value.name + ' connected.');
    if (sync && added.length) await runEnvironmentSync(['providers', 'models'], added, 'local');
  });
});
envNode('environment-cancel').addEventListener('click', resetConnection);
envNode('environment-refresh').addEventListener('click', () => void environmentOperation(async () => { environmentMessage('Checking connections...'); environmentItems = await window.harness.refreshEnvironments(); renderEnvironmentList(); if (inspectedEnvironment) await inspectEnvironment(inspectedEnvironment); else environmentMessage('Connections checked.'); }));
for (const action of ['models', 'providers', 'version'] as const) envNode('environment-' + action).addEventListener('click', () => void environmentOperation(() => runEnvironmentSync([action], [...environmentSelected])));
envNode('environment-all').addEventListener('click', () => void environmentOperation(() => runEnvironmentSync(['providers', 'models'], environmentItems.map(item => item.id))));
envNode('provider-connect').addEventListener('submit', event => {
  event.preventDefault(); if (!inspectedEnvironment) return;
  void environmentOperation(async () => {
    if (signIn) await window.harness.providerAction(signIn.id, { action: 'cancel', state: signIn.state });
    const provider = (envNode('provider-name') as HTMLSelectElement).value;
    const result = await window.harness.providerAction(inspectedEnvironment, { action: 'start', provider });
    signIn = { id: inspectedEnvironment, provider, state: result.state, url: result.url };
    envNode('provider-session').hidden = false; envInput('provider-url').value = result.url; envInput('provider-callback').value = '';
    envNode('provider-instructions').textContent = result.user_code ? 'Open the sign-in page and enter this device code: ' + result.user_code : 'Complete sign-in in your browser. If the final localhost page cannot open, paste its full URL below.';
    envNode('provider-callback-label').hidden = result.flow === 'device'; envNode('provider-complete').hidden = result.flow === 'device';
    environmentMessage('Sign-in started for ' + (environmentItems.find(item => item.id === inspectedEnvironment)?.name || inspectedEnvironment) + '.');
  });
});
envNode('provider-open').addEventListener('click', () => { if (signIn) void environmentOperation(async () => { await window.harness.openProviderURL(signIn.url); }); });
envNode('provider-complete').addEventListener('click', () => void environmentOperation(async () => { if (!signIn) return; const redirect = envInput('provider-callback').value; envInput('provider-callback').value = ''; await window.harness.providerAction(signIn.id, { action: 'callback', provider: signIn.provider, state: signIn.state, redirect }); environmentMessage('Callback submitted. Check sign-in to confirm.'); }));
envNode('provider-check').addEventListener('click', () => void environmentOperation(async () => {
  if (!signIn) return;
  const result = await window.harness.providerAction(signIn.id, { action: 'status', state: signIn.state });
  if (result.status === 'ok') { const id = signIn.id; signIn = null; envNode('provider-session').hidden = true; await inspectEnvironment(id); if (id === 'local') await load(); environmentMessage('Provider connected. Sync providers and models to share this connection.'); }
  else environmentMessage(result.status === 'wait' ? 'Waiting for browser sign-in. Complete it, then check again.' : 'Sign-in failed or expired. Start a new sign-in.', result.status !== 'wait');
}));
envNode('provider-cancel').addEventListener('click', () => void environmentOperation(async () => { if (signIn) await window.harness.providerAction(signIn.id, { action: 'cancel', state: signIn.state }); signIn = null; envNode('provider-session').hidden = true; envInput('provider-callback').value = ''; environmentMessage('Sign-in cancelled.'); }));
void window.harness.environments().then(items => { environmentItems = items; renderEnvironmentList(); }).catch(error => environmentMessage(error.message, true));
void window.harness.computerConnection().then(renderComputerConnection).catch(error => environmentMessage(error.message, true));
void load();

})();
