const names = { codex: 'Codex CLI', claude: 'Claude Code CLI' };
let models = [];
let state = {};
let defaults = {};
let busy = false;
const $ = (id) => document.getElementById(id);
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme.name;
  for (const [key, value] of Object.entries(theme.tokens)) if (value) document.documentElement.style.setProperty(key, value);
}
window.harness.onTheme(applyTheme);
void window.harness.theme().then(applyTheme).catch(() => {});
function status(message, kind = '') {
  $('status').textContent = message; $('status').className = kind;
  if (kind) $('status').scrollIntoView({ block: 'nearest' });
}
function element(tag, text, className) { const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node; }
function selected(key, id) { return state[key].all || state[key].models.includes(id); }
function updateApply() {
  const enabled = Object.values(state).filter((item) => item.enabled);
  $('apply').disabled = busy || !models.length || !enabled.length || enabled.some((item) => !item.all && !item.models.length);
  $('restore').disabled = busy || !state.codex || !state.claude;
  $('clients').inert = busy;
  document.querySelector('.models').inert = busy;
}
function updateDefaults(key) {
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
async function inspect(key) {
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
    all.addEventListener('change', () => { state[key].all = all.checked; state[key].models = all.checked ? models.map((model) => model.id) : []; renderRows(); updateDefaults(key); updateApply(); });
    allLabel.append(all, document.createTextNode(' Expose all available models')); top.append(allLabel);
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
      const cell = element('td'); const input = document.createElement('input'); input.type = 'checkbox'; input.checked = selected(key, model.id); input.disabled = !state[key].enabled;
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
      state[key].models = previous.filter((id) => models.some((model) => model.id === id));
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
void load();
