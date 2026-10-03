(() => {
  const byId = (id: string) => document.getElementById(id)!;
  const integer = new Intl.NumberFormat();
  let summary: CopilotUsageSummary | null = null;
  let unit: 'usd' | 'credits' = 'usd';
  let requestSequence = 0;

  function applyTheme(theme: HarnessTheme) {
    document.documentElement.dataset.theme = theme.name;
    for (const [key, value] of Object.entries(theme.tokens)) if (value) document.documentElement.style.setProperty(key, value);
  }
  window.harness.onTheme(applyTheme);
  void window.harness.theme().then(applyTheme).catch(() => {});

  function cost(model: CopilotUsageModel) {
    const amount = unit === 'usd' ? `$${model.cost_usd.toFixed(4)}` : `${model.ai_credits.toFixed(3)} credits`;
    return model.unpriced_requests ? `${amount} | ${integer.format(model.unpriced_requests)} unpriced` : amount;
  }
  function cell(row: HTMLTableRowElement, value: string, className = '') {
    const td = row.insertCell();
    td.textContent = value;
    if (className) td.className = className;
  }
  function render() {
    if (!summary) return;
    const models = byId('models');
    const history = byId('history');
    const trend = byId('trend');
    models.replaceChildren(); history.replaceChildren(); trend.replaceChildren();
    const all = summary.by_model.reduce((total, model) => ({
      requests: total.requests + model.requests, tokens: total.tokens + model.total_tokens,
      cost: total.cost + (unit === 'usd' ? model.cost_usd : model.ai_credits),
      unpriced: total.unpriced + model.unpriced_requests,
    }), { requests: 0, tokens: 0, cost: 0, unpriced: 0 });
    const totals = byId('totals');
    totals.hidden = all.requests === 0;
    byId('models-section').hidden = all.requests === 0;
    byId('history-section').hidden = all.requests === 0;
    totals.textContent = `${integer.format(all.requests)} requests | ${integer.format(all.tokens)} tokens | ${unit === 'usd' ? `$${all.cost.toFixed(4)}` : `${all.cost.toFixed(3)} credits`} estimated${all.unpriced ? ` (${integer.format(all.unpriced)} unpriced)` : ''}`;
    for (const model of summary.by_model) {
      const row = document.createElement('tr');
      cell(row, model.model, 'model');
      for (const value of [model.requests, model.input_tokens, model.output_tokens, model.total_tokens]) cell(row, integer.format(value));
      cell(row, cost(model), model.unpriced_requests ? 'missing' : '');
      models.append(row);
    }
    const max = Math.max(0, ...summary.days.map((day) => day.by_model.reduce((sum, model) => sum + (unit === 'usd' ? model.cost_usd : model.ai_credits), 0)));
    for (const day of summary.days) {
      const dailyCost = day.by_model.reduce((sum, model) => sum + (unit === 'usd' ? model.cost_usd : model.ai_credits), 0);
      const bar = document.createElement('div');
      bar.className = 'bar';
      bar.style.height = `${max ? Math.max(2, dailyCost / max * 88) : 2}px`;
      bar.title = `${day.date}: ${unit === 'usd' ? `$${dailyCost.toFixed(4)}` : `${dailyCost.toFixed(3)} credits`} estimated`;
      trend.append(bar);
      for (const model of day.by_model) {
        const row = document.createElement('tr');
        cell(row, day.date);
        cell(row, model.model, 'model');
        cell(row, integer.format(model.requests));
        cell(row, integer.format(model.total_tokens));
        cell(row, cost(model), model.unpriced_requests ? 'missing' : '');
        history.append(row);
      }
    }
    trend.setAttribute('aria-label', `${summary.days.length} UTC days of estimated ${unit === 'usd' ? 'USD' : 'AI credit'} usage; values are listed in the daily table`);
    byId('status').textContent = all.requests ? '' : 'No Copilot requests recorded for this period.';
    document.querySelectorAll('.cost-heading').forEach((heading) => { heading.textContent = unit === 'usd' ? 'Estimated USD' : 'Estimated AI credits'; });
  }

  async function load() {
    const sequence = ++requestSequence;
    const period = (byId('period') as HTMLSelectElement).value;
    const start = (byId('start') as HTMLInputElement).value;
    const end = (byId('end') as HTMLInputElement).value;
    if (period === 'custom' && (!start || !end || start > end)) {
      byId('status').textContent = 'Choose a valid start and end date.';
      byId('status').className = 'error';
      (byId('refresh') as HTMLButtonElement).disabled = false;
      return;
    }
    (byId('refresh') as HTMLButtonElement).disabled = true;
    byId('status').textContent = 'Loading usage...';
    byId('status').className = '';
    summary = null;
    byId('totals').hidden = true;
    byId('models-section').hidden = true;
    byId('history-section').hidden = true;
    for (const id of ['models', 'history', 'trend']) byId(id).replaceChildren();
    try { const result = await window.harness.usage(period, start, end); if (sequence === requestSequence) { summary = result; render(); } }
    catch (error) { if (sequence === requestSequence) { byId('status').textContent = error instanceof Error ? error.message : 'Could not load usage.'; byId('status').className = 'error'; } }
    finally { if (sequence === requestSequence) (byId('refresh') as HTMLButtonElement).disabled = false; }
  }

  byId('period').addEventListener('change', () => { byId('dates').hidden = (byId('period') as HTMLSelectElement).value !== 'custom'; if (byId('dates').hidden) void load(); });
  for (const field of ['start', 'end']) byId(field).addEventListener('change', () => { if (!(byId('dates') as HTMLElement).hidden) void load(); });
  for (const value of ['usd', 'credits'] as const) byId(value).addEventListener('click', () => {
    unit = value;
    byId('usd').setAttribute('aria-pressed', String(value === 'usd'));
    byId('credits').setAttribute('aria-pressed', String(value === 'credits'));
    render();
  });
  byId('refresh').addEventListener('click', () => void load());
  void load();
})();