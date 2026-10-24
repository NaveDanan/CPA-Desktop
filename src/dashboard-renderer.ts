(() => {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  // Chart geometry, curves, and colors follow T3 Code's usage page.
  const VIEW_WIDTH = 960;
  const VIEW_HEIGHT = 260;
  const TICK_COUNT = 4;
  const PLOT_TOP = 8;
  const COPILOT = 'github-copilot';
  type Metric = 'cost' | 'tokens';
  type Resolution = 'hour' | 'day';
  interface Point { x: number; y: number }
  interface Mark { viewBox: string; paths: { d: string; fill?: string; evenOdd?: boolean }[] }
  interface Harness { label: string; color: string; mark?: Mark; initials?: string; description?: string }

  const OPENAI_PATH = 'M252.794 108.802C289.191 99.0484 326.265 110.305 351.148 135.135C385.113 126.072 422.85 134.862 449.492 161.505C476.136 188.149 484.925 225.888 475.862 259.85V259.854C500.696 284.735 511.95 321.81 502.198 358.207C492.447 394.602 464.161 421.084 430.215 430.217C421.083 464.162 394.603 492.448 358.206 502.199C321.812 511.951 284.734 500.693 259.852 475.864C225.887 484.927 188.15 476.137 161.507 449.495C134.864 422.851 126.073 385.111 135.136 351.149C110.304 326.266 99.0496 289.192 108.801 252.795C118.552 216.4 146.84 189.918 180.784 180.785C189.917 146.841 216.396 118.553 252.794 108.802ZM374.292 407.145C374.292 411.271 372.092 415.086 368.517 417.148L283.723 466.102C302.487 480.585 327.555 486.459 352.217 479.852C386.997 470.532 410.068 439.312 410.555 405.006V317.717C410.555 315.08 409.125 312.621 406.843 311.303L374.292 292.509V407.145ZM251.868 415.897C248.296 417.959 243.893 417.959 240.317 415.897L155.526 366.942C152.366 390.436 159.811 415.08 177.866 433.136H177.863C203.325 458.594 241.896 462.962 271.85 446.232L347.449 402.586C349.735 401.268 351.148 398.8 351.148 396.163V358.579L251.868 415.897ZM368.602 220.628C366.319 219.309 363.474 219.318 361.191 220.637L328.641 239.431L427.921 296.749C431.496 298.811 433.697 302.627 433.697 306.752V404.661C455.622 395.654 473.244 376.881 479.851 352.218C489.169 317.442 473.668 281.85 444.201 264.274L368.602 220.628ZM177.303 206.34C155.377 215.348 137.756 234.122 131.148 258.783C121.832 293.561 137.331 329.153 166.799 346.727L242.398 390.373C244.68 391.692 247.525 391.684 249.807 390.366L282.357 371.572L183.078 314.253C179.504 312.189 177.303 308.375 177.303 304.251V206.34ZM259.849 279.145V331.858L305.5 358.213L351.15 331.858V279.145L305.5 252.789L259.849 279.145ZM327.276 144.9C308.512 130.418 283.445 124.543 258.782 131.15C224.002 140.471 200.931 171.691 200.445 205.995V293.286C200.445 295.923 201.875 298.381 204.158 299.7L236.707 318.493V203.856C236.707 199.731 238.909 195.916 242.483 193.853L327.276 144.9ZM433.137 177.867C407.675 152.407 369.103 148.038 339.149 164.769L263.55 208.415C261.265 209.734 259.852 212.202 259.852 214.838V252.423L359.132 195.105C362.703 193.041 367.108 193.041 370.682 195.105L455.473 244.06C458.635 220.567 451.189 195.922 433.135 177.867H433.137Z';
  const CLAUDE_PATH = 'm50.228 170.321 50.357-28.257.843-2.463-.843-1.361h-2.462l-8.426-.518-28.775-.778-24.952-1.037-24.175-1.296-6.092-1.297L0 125.796l.583-3.759 5.12-3.434 7.324.648 16.202 1.101 24.304 1.685 17.629 1.037 26.118 2.722h4.148l.583-1.685-1.426-1.037-1.101-1.037-25.147-17.045-27.22-18.017-14.258-10.37-7.713-5.25-3.888-4.925-1.685-10.758 7-7.713 9.397.649 2.398.648 9.527 7.323 20.35 15.75L94.817 91.9l3.889 3.24 1.555-1.102.195-.777-1.75-2.917-14.453-26.118-15.425-26.572-6.87-11.018-1.814-6.61c-.648-2.723-1.102-4.991-1.102-7.778l7.972-10.823L71.42 0 82.05 1.426l4.472 3.888 6.61 15.101 10.694 23.786 16.591 32.34 4.861 9.592 2.592 8.879.973 2.722h1.685v-1.556l1.36-18.211 2.528-22.36 2.463-28.776.843-8.1 4.018-9.722 7.971-5.25 6.222 2.981 5.12 7.324-.713 4.73-3.046 19.768-5.962 30.98-3.889 20.739h2.268l2.593-2.593 10.499-13.934 17.628-22.036 7.778-8.749 9.073-9.657 5.833-4.601h11.018l8.1 12.055-3.628 12.443-11.342 14.388-9.398 12.184-13.48 18.147-8.426 14.518.778 1.166 2.01-.194 30.46-6.481 16.462-2.982 19.637-3.37 8.88 4.148.971 4.213-3.5 8.62-20.998 5.184-24.628 4.926-36.682 8.685-.454.324.519.648 16.526 1.555 7.065.389h17.304l32.21 2.398 8.426 5.574 5.055 6.805-.843 5.184-12.962 6.611-17.498-4.148-40.83-9.721-14-3.5h-1.944v1.167l11.666 11.406 21.387 19.314 26.767 24.887 1.36 6.157-3.434 4.86-3.63-.518-23.526-17.693-9.073-7.972-20.545-17.304h-1.36v1.814l4.73 6.935 25.017 37.59 1.296 11.536-1.814 3.76-6.481 2.268-7.13-1.297-14.647-20.544-15.1-23.138-12.185-20.739-1.49.843-7.194 77.448-3.37 3.953-7.778 2.981-6.48-4.925-3.436-7.972 3.435-15.749 4.148-20.544 3.37-16.333 3.046-20.285 1.815-6.74-.13-.454-1.49.194-15.295 20.999-23.267 31.433-18.406 19.702-4.407 1.75-7.648-3.954.713-7.064 4.277-6.286 25.47-32.405 15.36-20.092 9.917-11.6-.065-1.686h-.583L44.07 198.125l-12.055 1.555-5.185-4.86.648-7.972 2.463-2.593 20.35-13.999-.064.065Z';
  const ink = (percent: number) => `color-mix(in oklab, var(--text-primary) ${percent}%, var(--bg-primary))`;
  const HARNESSES: Record<string, Harness> = {
    codex: { label: 'Codex', color: 'var(--text-primary)', mark: { viewBox: '100 100 411 411', paths: [{ d: OPENAI_PATH, evenOdd: true }] } },
    'claude-code': { label: 'Claude Code', color: '#d97757', mark: { viewBox: '0 0 256 257', paths: [{ d: CLAUDE_PATH, fill: '#d97757' }] } },
    opencode: { label: 'OpenCode', color: '#5b9bbd', mark: { viewBox: '0 0 32 40', paths: [{ d: 'M24 32H8V16H24V32Z', fill: ink(30) }, { d: 'M24 8H8V32H24V8ZM32 40H0V0H32V40Z' }] } },
    'gemini-cli': { label: 'Gemini CLI', color: '#4c8df6', initials: 'G' },
    antigravity: { label: 'Antigravity', color: '#8c7bd1', initials: 'AG' },
    other: { label: 'Other clients', color: '#8b8b8b', initials: '…', description: 'Clients that did not identify themselves' },
    unknown: { label: 'Not recorded', color: ink(40), initials: '?', description: 'Saved before the app recorded which harness sent each request' },
  };
  const HARNESS_ORDER = Object.keys(HARNESSES);
  const PROVIDERS: Record<string, string> = {
    all: 'All providers',
    [COPILOT]: 'GitHub Copilot', codex: 'OpenAI subscription', claude: 'Claude subscription', 'gemini-cli': 'Gemini CLI',
    gemini: 'Gemini API', aistudio: 'Google AI Studio', vertex: 'Vertex AI', antigravity: 'Antigravity', kimi: 'Kimi', xai: 'xAI', qwen: 'Qwen', iflow: 'iFlow',
  };
  const harnessOf = (id: string): Harness => HARNESSES[id] || { label: id, color: '#8b8b8b', initials: id.slice(0, 2).toUpperCase() };
  const providerLabel = (id: string) => PROVIDERS[id] || id.replace(/(^|[-_])(\w)/g, (_match, gap: string, letter: string) => (gap ? ' ' : '') + letter.toUpperCase());

  const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const integer = new Intl.NumberFormat('en-US');
  const dayFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
  const hourFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric' });
  const dateTimeFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const trim = (value: number) => value.toFixed(Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 10 ? 1 : 2).replace(/\.0+$/, '');
  function formatTokens(value: number) {
    const abs = Math.abs(value);
    if (abs >= 1e12) return `${trim(value / 1e12)}T`;
    if (abs >= 1e9) return `${trim(value / 1e9)}B`;
    if (abs >= 1e6) return `${trim(value / 1e6)}M`;
    if (abs >= 1e3) return `${trim(value / 1e3)}K`;
    return integer.format(Math.round(value));
  }
  const formatUsd = (value: number) => currency.format(value);
  const formatCredits = (value: number) => `${new Intl.NumberFormat('en-US', { maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 2 }).format(value)} credits`;
  const formatCount = (value: number) => integer.format(Math.round(value));
  const rateUsd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 });
  const rateCredits = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
  function formatPercent(share: number) {
    const percent = share * 100;
    return percent > 0 && percent < 0.1 ? '<0.1%' : `${percent.toFixed(1)}%`;
  }
  const plural = (count: number, noun: string) => `${formatCount(count)} ${noun}${count === 1 ? '' : 's'}`;

  let metric: Metric = 'cost';
  let windowDays = 30;
  let resolution: Resolution = 'day';
  let periods: Date[] = [];
  let dashboard: UsageDashboard | null = null;
  let requestSequence = 0;
  const creditProviders = new Set<string>();
  const breakdownByTime = new Set<string>();
  const pricingTier = new Map<string, number>();
  let openPricing: { cell: HTMLElement; trigger: HTMLButtonElement; card: HTMLElement } | null = null;
  let pricingTimer = 0;
  let pricingRefocus = false;
  const byId = (id: string) => document.getElementById(id)!;
  let environments: EnvironmentView[] = [];
  let scope = 'all';
  let environmentBusy = false;
  const selectedEnvironments = new Set<string>();

  function environmentMessage(message: string, error = false) {
    byId('environment-message').textContent = message;
    byId('environment-message').className = error ? 'status error' : 'status';
  }
  function updateEnvironmentButtons() {
    for (const id of ['environment-models', 'environment-version']) (byId(id) as HTMLButtonElement).disabled = environmentBusy || selectedEnvironments.size === 0;
    (byId('environment-refresh') as HTMLButtonElement).disabled = environmentBusy;
    for (const field of document.querySelectorAll<HTMLInputElement | HTMLButtonElement>('#environment-connect input, #environment-connect button, #environment-list input, #environment-list button')) field.disabled = environmentBusy;
  }
  function renderEnvironments() {
    const picker = byId('environment-scope') as HTMLSelectElement;
    picker.replaceChildren(new Option('All environments', 'all'), ...environments.map(item => new Option(item.name, item.id)));
    if (!environments.some(item => item.id === scope) && scope !== 'all') scope = 'all';
    picker.value = scope;
    byId('environment-count').textContent = `${environments.length} environment${environments.length === 1 ? '' : 's'}`;
    for (const id of selectedEnvironments) if (!environments.some(item => item.id === id)) selectedEnvironments.delete(id);
    byId('environment-list').replaceChildren(...environments.map(item => {
      const row = el('div', 'environment-row');
      const label = el('label');
      const check = el('input'); check.type = 'checkbox'; check.checked = selectedEnvironments.has(item.id);
      check.setAttribute('aria-label', `Select ${item.name}`);
      check.addEventListener('change', () => { if (check.checked) selectedEnvironments.add(item.id); else selectedEnvironments.delete(item.id); updateEnvironmentButtons(); });
      const text = el('span'); text.append(el('strong', '', item.name), el('small', '', item.address)); label.append(check, text);
      const state = el('span', 'environment-state' + (item.error || item.updateError ? ' error' : ''), `${item.version ? 'v' + item.version + ' · ' : ''}${item.status === 'connected' ? 'Connected' : item.status === 'offline' ? 'Offline' : 'Not checked'}`);
      if (item.error || item.updateError) state.append(el('small', '', item.error || item.updateError));
      row.append(label, state);
      if (item.id !== 'local') {
        const remove = el('button', 'environment-button', 'Disconnect'); remove.type = 'button'; remove.setAttribute('aria-label', `Disconnect ${item.name}`);
        remove.addEventListener('click', () => void environmentOperation(async () => {
          environments = await window.harness.removeEnvironment(item.id); renderEnvironments(); await load(); environmentMessage(`${item.name} disconnected.`);
        })); row.append(remove);
      }
      return row;
    })); updateEnvironmentButtons();
  }
  async function environmentOperation(action: () => Promise<void>) {
    if (environmentBusy) return;
    environmentBusy = true; updateEnvironmentButtons();
    try { await action(); } catch (error) { environmentMessage(error instanceof Error ? error.message : 'Environment operation failed.', true); }
    finally { environmentBusy = false; updateEnvironmentButtons(); }
  }
  async function syncEnvironments(action: 'models' | 'version') {
    const ids = [...selectedEnvironments];
    await environmentOperation(async () => {
      byId('environment-results').replaceChildren();
      environmentMessage(action === 'models' ? 'Applying saved models…' : 'Updating versions. Waiting for each VM to restart…');
      const results = await window.harness.bulkEnvironments(action, ids);
      byId('environment-results').replaceChildren(...results.map(result => el('li', result.ok ? '' : 'error', `${environments.find(item => item.id === result.id)?.name || result.id}: ${result.message}`)));
      environmentMessage(results.every(result => result.ok) ? 'Selected environments updated.' : 'Some environments could not be updated. See results below.', results.some(result => !result.ok));
      environments = await window.harness.environments(); renderEnvironments(); await load();
    });
  }

  function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function svg<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string | number> = {}) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    return node;
  }
  function harnessMark(id: string, size = '') {
    const harness = harnessOf(id);
    if (!harness.mark) {
      const badge = el('span', `mark initials ${size}`, harness.initials);
      badge.setAttribute('aria-hidden', 'true');
      return badge;
    }
    const icon = svg('svg', { viewBox: harness.mark.viewBox, class: `mark ${size}`, 'aria-hidden': 'true', preserveAspectRatio: 'xMidYMid' });
    for (const part of harness.mark.paths) {
      const path = svg('path', { d: part.d });
      if (part.evenOdd) { path.setAttribute('fill-rule', 'evenodd'); path.setAttribute('clip-rule', 'evenodd'); }
      path.style.fill = part.fill || 'currentColor';
      icon.append(path);
    }
    return icon;
  }
  function dot(color: string) {
    const node = el('span', 'dot');
    node.style.backgroundColor = color;
    node.setAttribute('aria-hidden', 'true');
    return node;
  }

  const inCredits = (provider: string) => provider === COPILOT && creditProviders.has(provider);
  const costValue = (provider: string, usd: number) => inCredits(provider) ? usd * 100 : usd;
  const formatCost = (provider: string, usd: number) => inCredits(provider) ? formatCredits(usd * 100) : formatUsd(usd);
  const metricValue = (provider: string, totals: { cost_usd: number; total_tokens: number }) => metric === 'tokens' ? totals.total_tokens : costValue(provider, totals.cost_usd);
  const formatMetric = (provider: string, value: number) => metric === 'tokens' ? formatTokens(value) : inCredits(provider) ? formatCredits(value) : formatUsd(value);
  function formatTick(provider: string, value: number) {
    if (value === 0) return '0';
    if (metric === 'tokens') return formatTokens(value);
    return inCredits(provider) ? formatTokens(value) : formatUsd(value);
  }
  const unpricedOnly = (totals: UsageTotals) => totals.requests > 0 && totals.unpriced_requests === totals.requests && totals.total_tokens > 0;

  function makeWindow(days: number) {
    const boundaries: Date[] = [];
    if (days === 1) {
      const end = new Date();
      end.setMinutes(0, 0, 0);
      end.setHours(end.getHours() + 1);
      for (let hours = 24; hours >= 0; hours--) boundaries.push(new Date(end.getTime() - hours * 3_600_000));
      return { boundaries, resolution: 'hour' as Resolution };
    }
    const today = new Date();
    for (let offset = days - 1; offset >= -1; offset--) boundaries.push(new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset));
    return { boundaries, resolution: 'day' as Resolution };
  }
  const formatPeriod = (start: Date) => resolution === 'hour' ? hourFormat.format(start) : dayFormat.format(start);
  const formatPeriodLong = (start: Date) => resolution === 'hour' ? `${dayFormat.format(start)}, ${hourFormat.format(start)}` : dayFormat.format(start);

  function monotoneTangents(points: readonly Point[]): number[] {
    const count = points.length;
    if (count < 2) return [0];
    const slopes: number[] = [];
    for (let index = 0; index < count - 1; index++) {
      const dx = points[index + 1].x - points[index].x;
      slopes.push(dx === 0 ? 0 : (points[index + 1].y - points[index].y) / dx);
    }
    const tangents = Array.from({ length: count }, () => 0);
    tangents[0] = slopes[0];
    tangents[count - 1] = slopes[count - 2];
    for (let index = 1; index < count - 1; index++) {
      const previous = slopes[index - 1];
      const next = slopes[index];
      tangents[index] = previous * next <= 0 ? 0 : (previous + next) / 2;
    }
    for (let index = 0; index < count - 1; index++) {
      const slope = slopes[index];
      if (slope === 0) { tangents[index] = 0; tangents[index + 1] = 0; continue; }
      const a = tangents[index] / slope;
      const b = tangents[index + 1] / slope;
      const magnitude = a * a + b * b;
      if (magnitude > 9) {
        const scale = 3 / Math.sqrt(magnitude);
        tangents[index] = scale * a * slope;
        tangents[index + 1] = scale * b * slope;
      }
    }
    return tangents;
  }
  function curvePath(points: readonly Point[]) {
    if (points.length < 2) return '';
    const tangents = monotoneTangents(points);
    let path = `M${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`;
    for (let index = 0; index < points.length - 1; index++) {
      const from = points[index];
      const to = points[index + 1];
      const dx = to.x - from.x;
      path += ` C${(from.x + dx / 3).toFixed(2)},${(from.y + tangents[index] * dx / 3).toFixed(2)} ${(to.x - dx / 3).toFixed(2)},${(to.y - tangents[index + 1] * dx / 3).toFixed(2)} ${to.x.toFixed(2)},${to.y.toFixed(2)}`;
    }
    return path;
  }
  function niceScale(peak: number, count: number) {
    if (peak <= 0) return { max: 0, ticks: [0] };
    const rawStep = peak / count;
    const magnitude = 10 ** Math.floor(Math.log10(rawStep));
    const normalized = rawStep / magnitude;
    const step = (normalized > 5 ? 10 : normalized > 2 ? 5 : normalized > 1 ? 2 : 1) * magnitude;
    const max = Math.ceil(peak / step) * step;
    const ticks: number[] = [];
    for (let value = 0; value <= max + step * 1e-6; value += step) ticks.push(value);
    return { max, ticks };
  }
  // Leave room above the top gridline so a series at the peak is not clipped.
  const valueToY = (value: number, max: number) => max === 0 ? VIEW_HEIGHT : VIEW_HEIGHT - value / max * (VIEW_HEIGHT - PLOT_TOP);

  function activeHarnesses(provider: ProviderUsage) {
    const used = new Set(provider.series.filter((series) => series.requests > 0).map((series) => series.harness));
    return [...HARNESS_ORDER.filter((id) => used.has(id)), ...[...used].filter((id) => !HARNESSES[id]).sort()];
  }

  function chart(provider: ProviderUsage) {
    const harnesses = activeHarnesses(provider);
    const pointValue = (point: UsageBucketPoint) => metric === 'tokens' ? point.total_tokens : costValue(provider.provider, point.cost_usd);
    const columns = periods.map((_start, index) => {
      const points = provider.buckets[index] || [];
      const bands = harnesses.map((id) => points.filter((point) => provider.series[point.series]?.harness === id).reduce((sum, point) => sum + pointValue(point), 0));
      return { points, bands, total: bands.reduce((sum, value) => sum + value, 0) };
    });
    // Layered series each start at zero, so the scale follows the largest single series.
    const scale = niceScale(columns.reduce((max, column) => Math.max(max, ...column.bands), 0), TICK_COUNT);
    const stepX = periods.length < 2 ? 0 : VIEW_WIDTH / (periods.length - 1);
    const toY = (value: number) => valueToY(value, scale.max);

    const wrapper = el('div', 'chart');
    wrapper.append(el('h4', '', `${resolution === 'hour' ? 'Hourly' : 'Daily'} ${metric === 'tokens' ? 'processed tokens' : inCredits(provider.provider) ? 'AI credits' : 'cost'}`));
    const row = el('div', 'chart-row');
    const axis = el('div', 'y-axis');
    axis.setAttribute('aria-hidden', 'true');
    for (const tick of scale.ticks) {
      const label = el('span', '', formatTick(provider.provider, tick));
      label.style.top = `${toY(tick) / VIEW_HEIGHT * 100}%`;
      axis.append(label);
    }
    const plot = el('div', 'plot');
    const graph = svg('svg', { viewBox: `0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`, preserveAspectRatio: 'none', role: 'img' });
    graph.setAttribute('aria-label', `${resolution === 'hour' ? 'Hourly' : 'Daily'} ${metric === 'tokens' ? 'processed tokens' : 'cost'} for ${providerLabel(provider.provider)} by harness. Exact values are in the breakdown table.`);
    for (const tick of scale.ticks) {
      const line = svg('line', { x1: 0, x2: VIEW_WIDTH, y1: toY(tick), y2: toY(tick), 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' });
      line.style.stroke = 'var(--border-color)';
      graph.append(line);
    }
    const series = harnesses.map((id, slot) => {
      const line = curvePath(columns.map((column, index) => ({ x: index * stepX, y: toY(column.bands[slot]) })));
      return { id, line, total: columns.reduce((sum, column) => sum + column.bands[slot], 0) };
    }).sort((a, b) => b.total - a.total);
    for (const { id, line } of series) {
      if (!line) continue;
      const area = svg('path', { d: `${line} L${VIEW_WIDTH},${VIEW_HEIGHT} L0,${VIEW_HEIGHT} Z`, 'fill-opacity': 0.12 });
      area.style.fill = harnessOf(id).color;
      graph.append(area);
    }
    for (const { id, line } of series) {
      if (!line) continue;
      const stroke = svg('path', { d: line, fill: 'none', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' });
      stroke.style.stroke = harnessOf(id).color;
      graph.append(stroke);
    }
    const hoverLine = svg('line', { y1: PLOT_TOP, y2: VIEW_HEIGHT, 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke', visibility: 'hidden' });
    hoverLine.style.stroke = 'var(--text-secondary)';
    graph.append(hoverLine);
    const tooltip = el('div', 'tooltip');
    tooltip.hidden = true;
    plot.append(graph, tooltip);

    let hoverPosition: Point | null = null;
    const positionTooltip = () => {
      if (!hoverPosition || tooltip.hidden) return;
      const gap = 12;
      const width = tooltip.offsetWidth;
      const height = tooltip.offsetHeight;
      const left = hoverPosition.x + gap + width <= plot.clientWidth ? hoverPosition.x + gap : hoverPosition.x - gap - width;
      const top = hoverPosition.y + gap + height <= plot.clientHeight ? hoverPosition.y + gap : hoverPosition.y - gap - height;
      tooltip.style.left = `${Math.min(Math.max(0, left), Math.max(0, plot.clientWidth - width))}px`;
      tooltip.style.top = `${Math.min(Math.max(0, top), Math.max(0, plot.clientHeight - height))}px`;
    };
    const showTooltip = (index: number) => {
      const column = columns[index];
      tooltip.replaceChildren(el('div', 'tooltip-title', formatPeriodLong(periods[index])));
      harnesses.forEach((id, slot) => {
        const harness = harnessOf(id);
        const label = el('span');
        label.append(dot(harness.color), harnessMark(id, 'tiny'), document.createTextNode(harness.label));
        const line = el('div', 'tooltip-row');
        line.append(label, el('span', '', formatMetric(provider.provider, column.bands[slot])));
        tooltip.append(line);
        const models = column.points.filter((point) => provider.series[point.series]?.harness === id && pointValue(point) > 0)
          .sort((a, b) => pointValue(b) - pointValue(a));
        for (const point of models) {
          const model = el('div', 'tooltip-row model');
          model.append(el('span', '', provider.series[point.series].model), el('span', '', formatMetric(provider.provider, pointValue(point))));
          tooltip.append(model);
        }
      });
      const total = el('div', 'tooltip-row total');
      total.append(el('span', '', 'Total'), el('span', '', formatMetric(provider.provider, column.total)));
      tooltip.append(total);
      tooltip.hidden = false;
      hoverLine.setAttribute('x1', String(index * stepX));
      hoverLine.setAttribute('x2', String(index * stepX));
      hoverLine.setAttribute('visibility', 'visible');
      positionTooltip();
    };
    plot.addEventListener('mousemove', (event) => {
      const bounds = plot.getBoundingClientRect();
      if (!bounds.width || !periods.length) return;
      const x = Math.min(bounds.width, Math.max(0, event.clientX - bounds.left));
      hoverPosition = { x, y: Math.min(bounds.height, Math.max(0, event.clientY - bounds.top)) };
      showTooltip(Math.min(periods.length - 1, Math.max(0, Math.round(x / bounds.width * (periods.length - 1)))));
    });
    plot.addEventListener('mouseleave', () => {
      hoverPosition = null;
      tooltip.hidden = true;
      hoverLine.setAttribute('visibility', 'hidden');
    });
    row.append(axis, plot);
    const xAxis = el('div', 'x-axis');
    xAxis.setAttribute('aria-hidden', 'true');
    for (const start of [periods[0], periods[Math.floor(periods.length / 2)], periods[periods.length - 1]]) xAxis.append(el('span', '', start ? formatPeriod(start) : ''));
    wrapper.append(row, xAxis);
    return { node: wrapper, columns, harnesses };
  }

  function summary(provider: ProviderUsage, harnesses: string[]) {
    const node = el('div', 'summary figures');
    const total = metricValue(provider.provider, provider);
    const head = el('div', 'summary-total');
    head.append(el('span', 'big', formatMetric(provider.provider, total)));
    const notes = [plural(provider.requests, 'request')];
    if (metric === 'cost') notes.push('API estimate');
    if (provider.estimated_requests) notes.push(`${formatCount(provider.estimated_requests)} estimated`);
    if (provider.unpriced_requests) notes.push(`${formatCount(provider.unpriced_requests)} unpriced`);
    const note = el('span', 'figure-note', notes.join(' · '));
    if (provider.estimated_requests) note.title = 'Requests saved before cache details were recorded are estimated from the requests around them.';
    head.append(note);
    node.append(head);
    for (const id of harnesses) {
      const rows = provider.series.filter((series) => series.harness === id);
      const totals = rows.reduce((sum, series) => ({ requests: sum.requests + series.requests, cost_usd: sum.cost_usd + series.cost_usd, total_tokens: sum.total_tokens + series.total_tokens }), { requests: 0, cost_usd: 0, total_tokens: 0 });
      const value = metricValue(provider.provider, totals);
      const harness = harnessOf(id);
      const row = el('div', 'harness-row');
      const top = el('div', 'row-top');
      const name = el('span', 'harness-name');
      const text = el('span', 'text');
      text.append(el('span', '', harness.label));
      name.append(dot(harness.color), harnessMark(id), text);
      if (harness.description) name.title = harness.description;
      top.append(name, el('span', 'row-value', formatMetric(provider.provider, value)));
      const share = total > 0 ? value / total : 0;
      row.append(top, el('span', 'row-sub', metric === 'cost'
        ? `${formatPercent(share)} of cost · ${formatTokens(totals.total_tokens)} tokens · ${plural(totals.requests, 'request')}`
        : `${formatPercent(share)} of tokens · ${formatCost(provider.provider, totals.cost_usd)} · ${plural(totals.requests, 'request')}`));
      node.append(row);
    }
    return node;
  }

  function shareBar(label: string, segments: { label: string; value: number; color: string }[], format: (value: number) => string) {
    const visible = segments.filter((segment) => segment.value > 0);
    const total = visible.reduce((sum, segment) => sum + segment.value, 0);
    const node = el('div', 'share');
    node.append(el('h4', '', label));
    if (total <= 0) {
      node.append(el('span', 'figure-note', 'Nothing to show in this window.'));
      return node;
    }
    const bar = el('div', 'share-bar');
    bar.setAttribute('role', 'img');
    bar.setAttribute('aria-label', `${label}: ${visible.map((segment) => `${segment.label} ${format(segment.value)}`).join(', ')}`);
    const legend = el('div', 'legend');
    for (const segment of visible) {
      const part = el('span');
      part.style.flex = `${segment.value} 1 0`;
      part.style.backgroundColor = segment.color;
      part.title = `${segment.label} · ${format(segment.value)} · ${formatPercent(segment.value / total)}`;
      bar.append(part);
      const swatch = el('i');
      swatch.style.backgroundColor = segment.color;
      const entry = el('span');
      entry.append(swatch, el('span', 'muted', segment.label), el('b', '', format(segment.value)));
      legend.append(entry);
    }
    node.append(bar, legend);
    return node;
  }
  function shares(provider: ProviderUsage) {
    const node = el('div', 'shares figures');
    const cost = (usd: number) => costValue(provider.provider, usd);
    node.append(
      shareBar(inCredits(provider.provider) ? 'AI credits by type' : 'Cost by type', [
        { label: 'Input', value: cost(provider.input_cost_usd), color: ink(60) },
        { label: 'Cache read', value: cost(provider.cache_read_cost_usd), color: ink(30) },
        { label: 'Cache write', value: cost(provider.cache_write_cost_usd), color: ink(72) },
        { label: 'Output', value: cost(provider.output_cost_usd), color: ink(100) },
        { label: 'Other', value: cost(provider.other_cost_usd), color: ink(44) },
      ], (value) => inCredits(provider.provider) ? formatCredits(value) : formatUsd(value)),
      shareBar('Tokens by type', [
        { label: 'Input', value: provider.input_tokens, color: ink(60) },
        { label: 'Cache read', value: provider.cache_read_tokens, color: ink(30) },
        { label: 'Cache write', value: provider.cache_write_tokens, color: ink(72) },
        { label: 'Output', value: provider.output_tokens, color: ink(100) },
      ], formatTokens),
    );
    return node;
  }

  function segmented(label: string, options: { value: string; label: string }[], selected: string, choose: (value: string) => void) {
    const group = el('div', 'segmented');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', label);
    for (const option of options) {
      const button = el('button', '', option.label);
      button.type = 'button';
      button.setAttribute('aria-pressed', String(option.value === selected));
      button.addEventListener('click', () => choose(option.value));
      group.append(button);
    }
    return group;
  }

  // GitHub prices some models higher once a prompt passes a threshold. Each
  // tier is named by the largest prompt it covers, as Copilot's model picker does.
  function contextTiers(pricing: ModelPricing) {
    const prompt = pricing.prompt_tokens ? formatTokens(pricing.prompt_tokens) : '';
    if (!pricing.threshold || !pricing.long_context) return [{ label: prompt, rate: pricing as UsageRate }];
    const threshold = formatTokens(pricing.threshold);
    return [
      { label: threshold, rate: pricing as UsageRate },
      { label: pricing.prompt_tokens && pricing.prompt_tokens > pricing.threshold ? prompt : `Over ${threshold}`, rate: pricing.long_context },
    ];
  }

  function pricingCard(provider: string, series: UsageSeries) {
    const pricing = dashboard?.rates?.[series.model];
    const card = el('div', 'pricing-card');
    card.id = 'pricing-card';
    card.setAttribute('role', 'group');
    card.setAttribute('aria-label', `${series.model} pricing`);
    const head = el('div', 'pricing-head');
    const title = el('div', 'pricing-title');
    title.append(el('strong', '', pricing?.name || series.model));
    if (pricing?.name && pricing.name !== series.model) title.append(el('span', '', series.model));
    head.append(title);
    if (pricing?.category) head.append(el('span', 'pricing-badge', pricing.category));
    const usage = [`From ${harnessOf(series.harness).label}`, plural(series.requests, 'request')];
    if (series.estimated_requests) usage.push(`${formatCount(series.estimated_requests)} estimated`);
    if (series.unpriced_requests) usage.push(`${formatCount(series.unpriced_requests)} unpriced`);
    card.append(head, el('p', 'pricing-note', usage.join(' · ')));
    if (!pricing) {
      card.append(el('p', 'pricing-note', 'GitHub does not publish a price for this model.'));
      return card;
    }
    const tiers = contextTiers(pricing);
    const rates = el('div', 'pricing-rates');
    const credits = inCredits(provider);
    const show = (index: number) => {
      const { rate } = tiers[index];
      rates.replaceChildren(el('span', 'pricing-unit', `${credits ? 'Credits' : 'USD'} per 1M tokens`));
      for (const [label, usd] of [['Input', rate.input], ['Output', rate.output], ['Cache read', rate.cached], ['Cache write', rate.write]] as const) {
        const row = el('div', 'pricing-row');
        row.append(el('span', '', label), el('span', '', label === 'Cache write' && !usd ? 'Not applicable' : credits ? rateCredits.format(usd * 100) : rateUsd.format(usd)));
        rates.append(row);
      }
    };
    if (tiers.length > 1) {
      const selected = Math.min(pricingTier.get(series.model) ?? 0, tiers.length - 1);
      const group = segmented(`${series.model} context size`, tiers.map((tier, index) => ({ value: String(index), label: tier.label })), String(selected), (value) => {
        group.querySelectorAll('button').forEach((button, index) => button.setAttribute('aria-pressed', String(index === Number(value))));
        pricingTier.set(series.model, Number(value));
        show(Number(value));
      });
      group.classList.add('pricing-tiers');
      card.append(el('span', 'pricing-label', 'Context size'), group, el('p', 'pricing-note', `Prompts over ${formatTokens(pricing.threshold!)} input tokens are billed at the long-context rate.`));
      show(selected);
    } else {
      if (tiers[0].label) {
        const row = el('div', 'pricing-row context');
        row.append(el('span', 'pricing-label', 'Context size'), el('span', '', tiers[0].label));
        card.append(row);
      }
      show(0);
    }
    card.append(rates);
    return card;
  }

  function closePricing() {
    clearTimeout(pricingTimer);
    if (!openPricing) return;
    openPricing.card.remove();
    openPricing.trigger.setAttribute('aria-expanded', 'false');
    openPricing = null;
  }
  function showPricing(cell: HTMLElement, trigger: HTMLButtonElement, provider: string, series: UsageSeries) {
    clearTimeout(pricingTimer);
    if (openPricing?.trigger === trigger) return;
    closePricing();
    const card = pricingCard(provider, series);
    cell.append(card);
    trigger.setAttribute('aria-expanded', 'true');
    openPricing = { cell, trigger, card };
    // The frame is sized to the page, so open upward when the card would pass its bottom edge.
    const fits = trigger.getBoundingClientRect().bottom + 6 + card.offsetHeight <= document.body.getBoundingClientRect().bottom;
    card.style.left = `${trigger.offsetLeft}px`;
    card.style.top = `${fits ? trigger.offsetTop + trigger.offsetHeight + 6 : trigger.offsetTop - 6 - card.offsetHeight}px`;
  }
  // The card opens on hover or focus and stays open while the pointer or focus is inside its cell.
  function attachPricing(cell: HTMLElement, trigger: HTMLButtonElement, provider: string, series: UsageSeries) {
    const open = () => showPricing(cell, trigger, provider, series);
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', 'pricing-card');
    trigger.addEventListener('pointerenter', () => {
      clearTimeout(pricingTimer);
      pricingTimer = window.setTimeout(open, openPricing ? 0 : 150);
    });
    trigger.addEventListener('click', open);
    trigger.addEventListener('focus', () => {
      if (pricingRefocus) pricingRefocus = false; else open();
    });
    cell.addEventListener('pointerleave', () => {
      clearTimeout(pricingTimer);
      if (openPricing?.cell === cell && !cell.contains(document.activeElement)) pricingTimer = window.setTimeout(closePricing, 120);
    });
    cell.addEventListener('focusout', (event) => {
      if (openPricing?.cell === cell && !cell.contains(event.relatedTarget as Node | null) && !cell.matches(':hover')) closePricing();
    });
    cell.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || openPricing?.cell !== cell) return;
      closePricing();
      pricingRefocus = true;
      trigger.focus();
    });
  }

  function breakdown(provider: ProviderUsage, columns: ReturnType<typeof chart>['columns'], harnesses: string[]) {
    const node = el('div', 'breakdown');
    const head = el('div', 'breakdown-head');
    const byTime = breakdownByTime.has(provider.provider);
    head.append(el('h4', '', 'Breakdown'), segmented(`${providerLabel(provider.provider)} breakdown`, [
      { value: 'model', label: 'Model' }, { value: 'time', label: resolution === 'hour' ? 'Hour' : 'Day' },
    ], byTime ? 'time' : 'model', (value) => {
      if (value === 'time') breakdownByTime.add(provider.provider); else breakdownByTime.delete(provider.provider);
      render();
    }));
    node.append(head);
    const table = el('table', 'figures');
    const headRow = el('tr');
    const body = el('tbody');
    const cell = (row: HTMLTableRowElement, text: string, className = '') => row.append(el('td', className, text));
    if (!byTime) {
      for (const [text, className] of [['#', 'left'], ['Model', 'left'], [inCredits(provider.provider) ? 'AI credits' : 'Cost', ''], ['Share', 'share-col'], ['Tokens', '']]) headRow.append(el('th', className, text));
      const models = provider.series.filter((series) => series.requests > 0)
        .sort((a, b) => metricValue(provider.provider, b) - metricValue(provider.provider, a) || b.total_tokens - a.total_tokens);
      const peak = models.reduce((max, series) => Math.max(max, metricValue(provider.provider, series)), 0);
      const total = metricValue(provider.provider, provider);
      models.forEach((series, index) => {
        const row = el('tr');
        const value = metricValue(provider.provider, series);
        cell(row, String(index + 1), 'left');
        const modelCell = el('td', 'left model-cell');
        const name = el('button', 'model-name');
        name.type = 'button';
        name.append(harnessMark(series.harness, 'small'), document.createTextNode(series.model));
        attachPricing(modelCell, name, provider.provider, series);
        modelCell.append(name);
        if (value > 0 && peak > 0) {
          const track = el('div', 'bar-track');
          const bar = el('span');
          bar.style.width = `max(0.5rem, ${value / peak * 100}%)`;
          bar.style.backgroundColor = harnessOf(series.harness).color;
          track.append(bar);
          modelCell.append(track);
        }
        row.append(modelCell);
        cell(row, unpricedOnly(series) ? 'Unpriced' : formatCost(provider.provider, series.cost_usd), 'strong');
        cell(row, metric === 'cost' && unpricedOnly(series) ? '' : total > 0 ? formatPercent(value / total) : '', 'share-col');
        cell(row, formatTokens(series.total_tokens));
        body.append(row);
      });
    } else {
      headRow.append(el('th', 'left', resolution === 'hour' ? 'Hour' : 'Day'));
      for (const id of harnesses) {
        const th = el('th');
        th.append(harnessMark(id, 'tiny'), document.createTextNode(` ${harnessOf(id).label}`));
        headRow.append(th);
      }
      headRow.append(el('th', '', 'Total'), el('th', '', 'Tokens'));
      const tokensFor = (points: UsageBucketPoint[]) => points.reduce((sum, point) => sum + point.total_tokens, 0);
      for (let index = periods.length - 1; index >= 0; index--) {
        const column = columns[index];
        if (!column.points.length) continue;
        const row = el('tr');
        cell(row, formatPeriodLong(periods[index]), 'left strong');
        column.bands.forEach((value) => cell(row, formatMetric(provider.provider, value)));
        cell(row, formatMetric(provider.provider, column.total), 'strong');
        cell(row, formatTokens(tokensFor(column.points)));
        body.append(row);
      }
    }
    if (!body.children.length) {
      const row = el('tr');
      const empty = el('td', 'empty', 'No activity in this window.');
      empty.colSpan = headRow.children.length;
      row.append(empty);
      body.append(row);
    }
    const thead = el('thead');
    thead.append(headRow);
    table.append(thead, body);
    node.append(table);
    return node;
  }

  function providerSection(provider: ProviderUsage) {
    const section = el('section', 'provider');
    section.setAttribute('aria-label', providerLabel(provider.provider));
    const head = el('div', 'provider-head');
    const title = el('h3', '', providerLabel(provider.provider));
    title.append(el('span', '', provider.provider));
    head.append(title);
    if (provider.provider === COPILOT && metric === 'cost') {
      head.append(segmented('GitHub Copilot cost unit', [{ value: 'usd', label: 'USD (API prices)' }, { value: 'credits', label: 'AI credits' }],
        inCredits(provider.provider) ? 'credits' : 'usd', (value) => {
          if (value === 'credits') creditProviders.add(provider.provider); else creditProviders.delete(provider.provider);
          render();
        }));
    }
    const graph = chart(provider);
    const grid = el('div', 'provider-grid');
    grid.append(summary(provider, graph.harnesses), graph.node);
    section.append(head, grid, shares(provider), breakdown(provider, graph.columns, graph.harnesses));
    return section;
  }

  function render() {
    if (!dashboard) return;
    closePricing();
    const providers = dashboard.providers;
    const all = providers.reduce((sum, provider) => ({
      requests: sum.requests + provider.requests, tokens: sum.tokens + provider.total_tokens, cost: sum.cost + provider.cost_usd,
      cached: sum.cached + provider.cache_read_tokens, uncached: sum.uncached + provider.input_tokens + provider.cache_write_tokens,
      output: sum.output + provider.output_tokens, savings: sum.savings + provider.cache_savings_usd,
      estimated: sum.estimated + provider.estimated_requests, unpriced: sum.unpriced + provider.unpriced_requests,
    }), { requests: 0, tokens: 0, cost: 0, cached: 0, uncached: 0, output: 0, savings: 0, estimated: 0, unpriced: 0 });
    byId('overview').hidden = all.requests === 0;
    byId('total-cost').textContent = formatUsd(all.cost);
    byId('total-tokens').textContent = formatTokens(all.tokens);
    const notes = [plural(all.requests, 'request'), plural(providers.length, 'provider'), 'API estimate in USD'];
    if (all.estimated) notes.push(`${formatCount(all.estimated)} older requests estimated`);
    if (all.unpriced) notes.push(`${formatCount(all.unpriced)} unpriced`);
    byId('total-note').textContent = notes.join(' · ');
    const metrics = byId('totals');
    metrics.replaceChildren();
    for (const [label, value] of [['Processed tokens', formatTokens(all.tokens)], ['Cached input', formatTokens(all.cached)], ['Uncached input', formatTokens(all.uncached)], ['Output', formatTokens(all.output)], ['Cache savings', formatUsd(all.savings)]]) {
      const metricNode = el('div', 'metric');
      metricNode.append(el('span', '', label), el('span', '', value));
      metrics.append(metricNode);
    }
    byId('providers').replaceChildren(...providers.map(providerSection));
    const combined: ProviderUsage = { ...providers[0], provider: 'all', series: [], buckets: periods.map((): UsageBucketPoint[] => []) };
    for (const provider of providers) {
      const offset = combined.series.length;
      combined.series.push(...provider.series);
      provider.buckets.forEach((bucket, i) => combined.buckets[i].push(...bucket.map(point => ({ ...point, series: point.series + offset }))));
    }
    byId('combined-chart').replaceChildren(...(providers.length ? [chart(combined).node] : []));
    const pricing = dashboard.pricing;
    byId('pricing').textContent = !pricing?.models ? 'Model prices are unavailable. Click Refresh to retry.'
      : `${pricing.error ? `${pricing.error} Using saved prices. ` : ''}Prices from GitHub's models and pricing page, updated ${dateTimeFormat.format(new Date(pricing.updated_at))}. They refresh when the app starts and when you click Refresh. Requests saved before cache details were recorded are estimated, and requests saved before harness tracking show as Not recorded.`;
    if (!all.requests) setStatus('No usage recorded in this window.');
  }

  function setStatus(text: string, error = false) {
    byId('status').textContent = text;
    byId('status').className = error ? 'status error' : 'status';
  }

  async function load(refreshPricing = false) {
    const sequence = ++requestSequence;
    const range = makeWindow(windowDays);
    const refresh = byId('refresh') as HTMLButtonElement;
    refresh.disabled = true;
    refresh.setAttribute('aria-busy', 'true');
    document.querySelector('main')!.classList.add('loading');
    setStatus(refreshPricing ? 'Updating prices from GitHub and loading usage…' : 'Loading usage…');
    try {
      const result = await window.harness.dashboard(range.boundaries.map((date) => date.getTime()), refreshPricing, scope);
      if (sequence !== requestSequence) return;
      dashboard = result;
      resolution = range.resolution;
      periods = range.boundaries.slice(0, -1);
      const first = range.boundaries[0];
      const last = range.boundaries[range.boundaries.length - 1];
      byId('window-label').textContent = resolution === 'hour'
        ? `${dateTimeFormat.format(first)} to ${dateTimeFormat.format(last)}`
        : `${dayFormat.format(first)} to ${dayFormat.format(new Date(last.getTime() - 1))}`;
      setStatus('');
      render();
      const coverage = result.environments || [];
      const missing = coverage.filter(item => !item.available);
      byId('environment-coverage').hidden = missing.length === 0;
      byId('environment-coverage').textContent = missing.length ? `${coverage.length - missing.length} of ${coverage.length} environments included. ${missing.map(item => item.name + ': ' + item.error).join(' ')}` : '';
      if (coverage.length && missing.length === coverage.length) setStatus('Usage is unavailable for the selected environment. Check the connection and refresh.', true);
    } catch (error) {
      if (sequence === requestSequence) {
        dashboard = null; byId('providers').replaceChildren(); byId('overview').hidden = true; byId('pricing').textContent = ''; byId('environment-coverage').hidden = true;
        setStatus(error instanceof Error ? error.message : 'Could not load usage.', true);
      }
    } finally {
      if (sequence === requestSequence) {
        refresh.disabled = false;
        refresh.removeAttribute('aria-busy');
        document.querySelector('main')!.classList.remove('loading');
      }
    }
  }

  function applyTheme(theme: HarnessTheme) {
    document.documentElement.dataset.theme = theme.name;
    for (const [key, value] of Object.entries(theme.tokens)) if (value) document.documentElement.style.setProperty(key, value);
  }
  window.harness.onTheme(applyTheme);
  void window.harness.theme().then(applyTheme).catch(() => {});

  const press = (selector: string, attribute: string, value: string) => {
    for (const button of document.querySelectorAll<HTMLButtonElement>(selector)) button.setAttribute('aria-pressed', String(button.getAttribute(attribute) === value));
  };
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-metric]')) button.addEventListener('click', () => {
    metric = button.dataset.metric as Metric;
    press('[data-metric]', 'data-metric', metric);
    render();
  });
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-days]')) button.addEventListener('click', () => {
    windowDays = Number(button.dataset.days);
    press('[data-days]', 'data-days', String(windowDays));
    void load();
  });
  byId('refresh').addEventListener('click', () => void load(true));
  byId('environment-scope').addEventListener('change', event => { scope = (event.target as HTMLSelectElement).value; void load(); });
  byId('environment-connect').addEventListener('submit', event => {
    event.preventDefault();
    const name = (byId('environment-name') as HTMLInputElement).value.trim();
    const address = (byId('environment-address') as HTMLInputElement).value.trim();
    const tokenField = byId('environment-token') as HTMLInputElement;
    const token = tokenField.value; tokenField.value = '';
    void environmentOperation(async () => {
      environmentMessage('Connecting…');
      const before = new Set(environments.map(item => item.id));
      environments = await window.harness.connectEnvironment({ name, address, token });
      for (const item of environments) if (!before.has(item.id)) selectedEnvironments.add(item.id);
      renderEnvironments(); environmentMessage(`${name} connected.`); await load();
    });
  });
  byId('environment-refresh').addEventListener('click', () => void environmentOperation(async () => {
    environmentMessage('Checking connections…'); environments = await window.harness.refreshEnvironments(); renderEnvironments(); environmentMessage('Connection check complete.'); await load();
  }));
  byId('environment-models').addEventListener('click', () => void syncEnvironments('models'));
  byId('environment-version').addEventListener('click', () => void syncEnvironments('version'));
  // The parent sizes this frame to its content so the dashboard scrolls as one page.
  new ResizeObserver(() => parent.postMessage({ channel: 'harness:resize', height: Math.ceil(document.body.getBoundingClientRect().height) }, '*')).observe(document.body);
  void window.harness.environments().then(items => { environments = items; renderEnvironments(); }).catch(error => environmentMessage(error.message, true));
  void load();
})();
