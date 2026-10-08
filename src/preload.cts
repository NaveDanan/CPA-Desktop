import { ipcRenderer } from 'electron';
// Use the management center's existing session format.
// The real management key stays in the main process, never in browser storage.
const originArgument = process.argv.find((arg) => arg.startsWith('--desktop-origin='));
const origin = originArgument?.slice('--desktop-origin='.length);
if (origin && location.origin === origin && location.pathname === '/management.html') {
  localStorage.setItem('cli-proxy-auth', JSON.stringify({
    state: { apiBase: origin, managementKey: 'desktop-session', rememberPassword: true },
    version: 0,
  }));
  localStorage.setItem('isLoggedIn', 'true');

  function setupDesktopTitlebar() {
    if (document.getElementById('desktop-titlebar')) return;

    const style = document.createElement('style');
    style.id = 'desktop-titlebar-styles';
    style.textContent = `
      :root {
        --desktop-titlebar-height: 34px;
        /* Titlebar starts where the sidebar ends, so the sidebar owns the full window height. */
        --desktop-titlebar-left: var(--sidebar-panel-width, 216px);
      }
      :root:has(.app-shell.sidebar-is-collapsed) {
        --desktop-titlebar-left: var(--sidebar-collapsed-width, 60px);
      }
      @media (max-width: 768px) {
        :root, :root:has(.app-shell.sidebar-is-collapsed) {
          --desktop-titlebar-left: 0px;
        }
      }
      #desktop-titlebar {
        position: fixed;
        top: 0;
        left: var(--desktop-titlebar-left);
        right: 0;
        height: var(--desktop-titlebar-height);
        background-color: var(--bg-secondary, #151412);
        border-bottom: 1px solid var(--border-color, rgba(255, 255, 255, 0.08));
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0;
        margin: 0;
        z-index: 100000;
        user-select: none;
        -webkit-user-select: none;
        -webkit-app-region: drag;
        box-sizing: border-box;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Helvetica Neue", sans-serif;
        transition: background-color 0.2s ease, border-color 0.2s ease, left 0.3s ease;
      }
      .desktop-titlebar-center {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        padding-left: 12px;
        -webkit-app-region: drag;
      }
      .desktop-titlebar-center-title {
        font-size: 11px;
        font-weight: 500;
        color: var(--text-tertiary, #9c958d);
        letter-spacing: 0.01em;
        opacity: 0.85;
      }
      .desktop-titlebar-controls {
        display: flex;
        align-items: center;
        height: 100%;
        -webkit-app-region: no-drag;
      }
      #desktop-updates { position: relative; height: 100%; display: flex; align-items: center; -webkit-app-region: no-drag; }
      #desktop-update-button { margin: 0 10px; padding: 3px 9px; border: 1px solid var(--border-color, #514b44); border-radius: 6px; background: transparent; color: var(--text-secondary, #c9c3bb); font: inherit; font-size: 11px; cursor: pointer; }
      #desktop-updates[data-available="true"] #desktop-update-button { color: var(--text-primary, #f6f4f1); background: var(--bg-tertiary, #34302b); font-weight: 600; }
      #desktop-updates button:focus-visible { outline: 2px solid var(--primary-active, #b8a88e); outline-offset: 2px; }
      #desktop-update-panel { position: absolute; top: 100%; right: 0; width: min(380px, calc(100vw - 160px)); max-height: calc(100vh - 50px); overflow-y: auto; box-sizing: border-box; padding: 16px; border: 1px solid var(--border-color, #514b44); border-radius: 8px; background: var(--bg-secondary, #151412); color: var(--text-primary, #f6f4f1); box-shadow: 0 8px 24px #0003; font-size: 12px; line-height: 1.5; user-select: text; }
      #desktop-update-panel[hidden] { display: none; }
      #desktop-update-heading { margin: 0 0 6px; font-size: 13px; }
      #desktop-update-version { color: var(--text-secondary, #c9c3bb); margin: 0 0 12px; }
      #desktop-update-notes { white-space: pre-wrap; overflow-wrap: anywhere; max-height: min(320px, 50vh); overflow-y: auto; margin: 0 0 12px; }
      #desktop-update-progress { width: 100%; height: 8px; accent-color: var(--text-primary, #f6f4f1); }
      #desktop-update-progress-label { margin: 4px 0 12px; color: var(--text-secondary, #c9c3bb); font-variant-numeric: tabular-nums; }
      .desktop-update-actions { display: flex; flex-wrap: wrap; gap: 8px; }
      .desktop-update-actions button { padding: 6px 10px; border: 1px solid var(--border-color, #514b44); border-radius: 5px; color: inherit; background: var(--bg-tertiary, #34302b); font: inherit; cursor: pointer; }
      .desktop-update-actions button:hover:not(:disabled) { border-color: var(--text-secondary, #c9c3bb); }
      #desktop-download-update, #desktop-install-update { font-weight: 600; }
      .desktop-update-actions button:disabled { opacity: .6; cursor: default; }
      .desktop-control-btn {
        background: transparent;
        border: none;
        outline: none;
        margin: 0;
        padding: 0;
        width: 46px;
        height: 100%;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: var(--text-secondary, #c9c3bb);
        cursor: pointer;
        transition: background-color 0.12s ease, color 0.12s ease;
        -webkit-app-region: no-drag;
      }
      .desktop-control-btn:hover {
        background-color: var(--bg-hover, rgba(255, 255, 255, 0.07));
        color: var(--text-primary, #f6f4f1);
      }
      .desktop-control-btn:active {
        background-color: var(--bg-tertiary, rgba(255, 255, 255, 0.12));
      }
      .desktop-control-btn.close:hover {
        background-color: #e81123 !important;
        color: #ffffff !important;
      }
      .desktop-control-btn.close:active {
        background-color: #bf0f1d !important;
        color: #ffffff !important;
      }
      .desktop-control-btn .icon-restore {
        display: none;
      }
      #desktop-titlebar.maximized .desktop-control-btn .icon-maximize {
        display: none;
      }
      #desktop-titlebar.maximized .desktop-control-btn .icon-restore {
        display: block;
      }
      #root {
        height: 100vh !important;
        box-sizing: border-box !important;
      }
      .app-shell {
        height: 100vh !important;
        min-height: 100vh !important;
      }
      /* The sidebar spans the full window height; the titlebar starts beside it. */
      .sidebar {
        height: 100vh !important;
      }
      aside.sidebar, .sidebar.open {
        top: 0 !important;
      }
      .main-body {
        height: 100vh !important;
      }
      /* Everything right of the sidebar moves down to clear the titlebar. */
      .main-header {
        top: var(--desktop-titlebar-height) !important;
        left: var(--desktop-titlebar-left) !important;
      }
      .top-gradient-blur {
        top: var(--desktop-titlebar-height) !important;
      }
      .main-content {
        padding-top: calc(70px + var(--desktop-titlebar-height)) !important;
      }
      .modal-overlay, .sheet-overlay {
        top: var(--desktop-titlebar-height);
      }
    `;
    (document.head || document.documentElement).appendChild(style);

    const titlebar = document.createElement('header');
    titlebar.id = 'desktop-titlebar';
    titlebar.setAttribute('aria-label', 'Application Title Bar');
    titlebar.innerHTML = `
      <div class="desktop-titlebar-center">
        <span class="desktop-titlebar-center-title">Management Center</span>
      </div>
      <div class="desktop-titlebar-controls">
        <div id="desktop-updates">
          <button id="desktop-update-button" type="button" aria-expanded="false" aria-controls="desktop-update-panel">Updates</button>
          <section id="desktop-update-panel" aria-labelledby="desktop-update-heading" hidden>
            <h2 id="desktop-update-heading">App updates</h2>
            <p id="desktop-update-version"></p>
            <div id="desktop-update-notes" tabindex="0"></div>
            <progress id="desktop-update-progress" max="100" value="0" aria-label="Update download" hidden></progress>
            <p id="desktop-update-progress-label" hidden></p>
            <div class="desktop-update-actions">
              <button id="desktop-download-update" type="button" hidden>Download update</button>
              <button id="desktop-install-update" type="button" hidden>Restart and install</button>
              <button id="desktop-cancel-update" type="button" hidden>Cancel download</button>
              <button id="desktop-view-release" type="button" hidden>View release on GitHub</button>
              <button id="desktop-check-updates" type="button">Check for updates</button>
            </div>
            <p id="desktop-update-message" role="status"></p>
          </section>
        </div>
        <button id="desktop-btn-minimize" class="desktop-control-btn minimize" type="button" title="Minimize" aria-label="Minimize">
          <svg width="10" height="1" viewBox="0 0 10 1" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="10" height="1" fill="currentColor"/>
          </svg>
        </button>
        <button id="desktop-btn-maximize" class="desktop-control-btn maximize" type="button" title="Maximize" aria-label="Maximize">
          <svg class="icon-maximize" width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" stroke-width="1"/>
          </svg>
          <svg class="icon-restore" width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M2.5 2.5V0.5H9.5V7.5H7.5" stroke="currentColor" stroke-width="1"/>
            <rect x="0.5" y="2.5" width="7" height="7" stroke="currentColor" stroke-width="1" fill="currentColor" fill-opacity="0.1"/>
          </svg>
        </button>
        <button id="desktop-btn-close" class="desktop-control-btn close" type="button" title="Close to tray" aria-label="Close to tray">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M0.5 0.5L9.5 9.5M9.5 0.5L0.5 9.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
    `;

    document.body.prepend(titlebar);

    const updates = document.getElementById('desktop-updates');
    const updateButton = document.getElementById('desktop-update-button');
    const updatePanel = document.getElementById('desktop-update-panel');
    const checkButton = document.getElementById('desktop-check-updates') as HTMLButtonElement;
    const releaseButton = document.getElementById('desktop-view-release');
    const downloadButton = document.getElementById('desktop-download-update') as HTMLButtonElement;
    const installButton = document.getElementById('desktop-install-update') as HTMLButtonElement;
    const cancelButton = document.getElementById('desktop-cancel-update') as HTMLButtonElement;
    const progress = document.getElementById('desktop-update-progress') as HTMLProgressElement;
    const progressLabel = document.getElementById('desktop-update-progress-label');
    const updateMessage = document.getElementById('desktop-update-message');
    let focusedUpdateAction: HTMLButtonElement | null = null;
    const showUpdates = (open: boolean) => {
      updatePanel.hidden = !open;
      updateButton.setAttribute('aria-expanded', String(open));
    };
    updates.addEventListener('pointerenter', () => showUpdates(true));
    updates.addEventListener('pointerleave', () => {
      if (!updates.contains(document.activeElement)) showUpdates(false);
    });
    updates.addEventListener('focusin', () => showUpdates(true));
    updates.addEventListener('focusout', (event) => {
      if (focusedUpdateAction) return;
      if (!updates.contains((event.relatedTarget as Node | null))) showUpdates(false);
    });
    updateButton.addEventListener('click', () => showUpdates(true));
    updates.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { updateButton.focus(); showUpdates(false); event.stopPropagation(); }
    });
    document.addEventListener('pointerdown', (event) => {
      if (!updates.contains(event.target as Node)) showUpdates(false);
    });
    const renderUpdate = (state: import("./updates.cjs").UpdateState) => {
      if (!state) return;
      const release = state.release;
      const downloading = state.status === 'downloading';
      const downloaded = state.status === 'downloaded';
      const installing = state.status === 'installing';
      const focusedAction = [downloadButton, installButton, cancelButton].find((button) => button === document.activeElement) || focusedUpdateAction;
      focusedUpdateAction = focusedAction || null;
      updates.dataset.available = String(Boolean(release));
      updateButton.textContent = downloading ? 'Downloading update…' : downloaded ? 'Update ready to install' : installing ? 'Installing update…' : release ? `Update ${release.version} available` :
        (({ idle: 'Updates', checking: 'Checking updates…', current: 'Up to date', error: 'Check failed' } as Partial<Record<import('./updates.cjs').UpdateState['status'], string>>)[state.status] || 'Updates');
      document.getElementById('desktop-update-heading').textContent = release ? `What's new in ${release.version}` : 'App updates';
      document.getElementById('desktop-update-version').textContent = `Installed version: ${state.currentVersion}`;
      document.getElementById('desktop-update-notes').textContent = release?.notes ||
        (state.status === 'current' ? 'You have the latest published version. Checks run automatically every six hours.' : 'Checks published releases from NaveDanan/CPA-Desktop on GitHub.');
      releaseButton.hidden = !release;
      downloadButton.hidden = !release?.installer || !state.canInstall || downloaded || installing;
      downloadButton.disabled = downloading || state.status === 'checking';
      downloadButton.textContent = downloading ? 'Downloading…' : 'Download update';
      installButton.hidden = !downloaded && !installing;
      installButton.disabled = installing;
      installButton.textContent = installing ? 'Restarting…' : 'Restart and install';
      cancelButton.hidden = !downloading;
      cancelButton.disabled = false;
      progress.hidden = !downloading;
      progressLabel.hidden = !downloading;
      if (downloading && state.progress) {
        const percent = Math.min(100, Math.floor(state.progress.received / state.progress.total * 100));
        progress.value = percent;
        progressLabel.textContent = `${percent}% · ${(state.progress.received / 1048576).toFixed(1)} of ${(state.progress.total / 1048576).toFixed(1)} MB`;
      }
      checkButton.hidden = downloading || downloaded || installing;
      checkButton.disabled = state.status === 'checking';
      checkButton.textContent = state.status === 'checking' ? 'Checking…' : 'Check for updates';
      updateMessage.textContent = state.error || (downloading ? 'Downloading the update. You can keep using the app.' :
        downloaded ? 'Update downloaded and verified. Restart and install will briefly stop the proxy and interrupt active requests. Your settings and accounts are kept.' :
        installing ? 'Closing the app to install the update. It will reopen when installation finishes.' :
        release && !state.canInstall ? 'In-app installation is available in the installed Windows app. Download the installer from GitHub.' :
        release && !release.installer ? 'The installer is not available for in-app updating. View the release on GitHub, or check again later.' : '');
      if (focusedAction && (focusedAction.hidden || focusedAction.disabled)) {
        const nextAction = [installButton, cancelButton, downloadButton].find((button) => !button.hidden && !button.disabled);
        (nextAction || updateButton).focus();
      }
      focusedUpdateAction = null;
    };
    ipcRenderer.on('desktop-update-state', (_event, state) => renderUpdate(state));
    ipcRenderer.invoke('desktop-update-state').then(renderUpdate).catch(() => {});
    checkButton.addEventListener('click', async () => {
      try { renderUpdate(await ipcRenderer.invoke('desktop-check-updates')); }
      catch { updateMessage.textContent = 'Unable to check for updates. Try again later.'; }
    });
    const runUpdateAction = async (button: HTMLButtonElement, channel: string, failureMessage: string) => {
      focusedUpdateAction = document.activeElement === button ? button : null;
      button.disabled = true;
      try { renderUpdate(await ipcRenderer.invoke(channel)); }
      catch {
        const restoreFocus = focusedUpdateAction === button;
        focusedUpdateAction = null;
        button.disabled = false;
        if (restoreFocus) button.focus();
        updateMessage.textContent = failureMessage;
      }
    };
    downloadButton.addEventListener('click', () => void runUpdateAction(downloadButton, 'desktop-download-update', 'Unable to download the update. Try again.'));
    cancelButton.addEventListener('click', () => void runUpdateAction(cancelButton, 'desktop-cancel-update', 'Unable to cancel the download. Try again.'));
    installButton.addEventListener('click', () => void runUpdateAction(installButton, 'desktop-install-update', 'Unable to start installation. Try again or use the GitHub installer.'));
    releaseButton.addEventListener('click', async () => {
      try {
        if (await ipcRenderer.invoke('desktop-open-release')) return;
      } catch { /* Report browser launch failures in the update panel. */ }
      updateMessage.textContent = 'Unable to open GitHub in your browser. Try again.';
    });

    const btnMin = document.getElementById('desktop-btn-minimize');
    const btnMax = document.getElementById('desktop-btn-maximize');
    const btnClose = document.getElementById('desktop-btn-close');

    btnMin?.addEventListener('click', () => ipcRenderer.send('desktop-minimize'));
    btnMax?.addEventListener('click', () => ipcRenderer.send('desktop-toggle-maximize'));
    btnClose?.addEventListener('click', () => ipcRenderer.send('desktop-close'));

    titlebar.addEventListener('dblclick', (event) => {
      if (!(event.target as Element).closest('.desktop-titlebar-controls')) {
        ipcRenderer.send('desktop-toggle-maximize');
      }
    });

    const updateMaximizeState = (isMaximized: boolean) => {
      if (isMaximized) {
        titlebar.classList.add('maximized');
        if (btnMax) {
          btnMax.title = 'Restore';
          btnMax.setAttribute('aria-label', 'Restore');
        }
      } else {
        titlebar.classList.remove('maximized');
        if (btnMax) {
          btnMax.title = 'Maximize';
          btnMax.setAttribute('aria-label', 'Maximize');
        }
      }
    };

    ipcRenderer.on('desktop-maximize-changed', (_event, isMaximized) => {
      updateMaximizeState(isMaximized);
    });

    ipcRenderer.invoke('desktop-get-maximize-state').then((isMaximized) => {
      updateMaximizeState(Boolean(isMaximized));
    }).catch(() => {});
  }

  window.addEventListener('DOMContentLoaded', () => {
    setupDesktopTitlebar();
    let branding: { name: string; logo: string } | null = null;

    const button = document.createElement('button');
    button.id = 'desktop-cli-models';
    button.type = 'button';
    button.className = 'nav-item';
    button.title = 'Configure CLI';
    button.setAttribute('aria-label', 'Configure CLI');
    button.innerHTML = '<span class="nav-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3m6 0h4"/></svg></span><span class="nav-text"><span class="nav-label">Configure CLI</span></span>';
    const usageButton = document.createElement('button');
    usageButton.id = 'desktop-copilot-usage';
    usageButton.type = 'button';
    usageButton.className = 'nav-item';
    usageButton.innerHTML = '<span class="nav-text"><span class="nav-label">Copilot usage</span></span>';
    const style = document.createElement('style');
    style.textContent = '#desktop-cli-models,#desktop-copilot-usage{background:transparent;text-align:left;font-family:inherit;width:100%}#desktop-cli-models:focus-visible,#desktop-copilot-usage:focus-visible{outline:2px solid var(--primary-active);outline-offset:2px}.sidebar.collapsed #desktop-cli-models .nav-text,.sidebar.collapsed #desktop-copilot-usage .nav-text{display:none}';
    document.head.append(style);
    style.textContent += ':root[data-theme="dark"] .sidebar-brand-logo{background-color:#f4f3ef}';
    let selected: 'cli' | 'usage' | null = null;
    let content: HTMLElement;
    let frame: number;
    const pane = document.createElement('iframe');
    pane.id = 'desktop-cli-content';
    pane.title = 'Configure CLI';
    pane.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals');
    pane.hidden = true;
    const usagePane = document.createElement('iframe');
    usagePane.id = 'desktop-copilot-content';
    usagePane.title = 'Copilot usage';
    usagePane.setAttribute('sandbox', 'allow-scripts');
    usagePane.hidden = true;
    const allowed = new Set(['load', 'inspect', 'browse', 'apply', 'restore', 'theme', 'usage']);
    window.addEventListener('message', async (event) => {
      const message = event.data;
      const source = event.source === pane.contentWindow ? pane : event.source === usagePane.contentWindow ? usagePane : null;
      if (!source || message?.channel !== 'harness:request' || !allowed.has(message.name) || !Array.isArray(message.args) || (source === usagePane && !['usage', 'theme'].includes(message.name))) return;
      try {
        const result = await ipcRenderer.invoke('harness:' + message.name, ...message.args);
        source.contentWindow?.postMessage({ channel: 'harness:response', id: message.id, ...result }, '*');
      } catch (error) {
        source.contentWindow?.postMessage({ channel: 'harness:response', id: message.id, error: error.message }, '*');
      }
    });
    ipcRenderer.on('harness:theme-changed', (_event, theme) => {
      for (const view of [pane, usagePane]) view.contentWindow?.postMessage({ channel: 'harness:response', theme }, '*');
    });
    const resize = new ResizeObserver(() => schedule());
    const sync = () => {
      frame = null;
      const next = document.querySelector<HTMLElement>('.content');
      if (next !== content) {
        if (content) { resize.unobserve(content); content.inert = false; }
        content = next;
        if (content) resize.observe(content);
      }
      const visible = Boolean(selected && content && !location.hash.includes('/login'));
      button.classList.toggle('active', visible && selected === 'cli');
      button.setAttribute('aria-current', visible && selected === 'cli' ? 'page' : 'false');
      usageButton.classList.toggle('active', visible && selected === 'usage');
      usageButton.setAttribute('aria-current', visible && selected === 'usage' ? 'page' : 'false');
      document.body.classList.toggle('desktop-cli-selected', Boolean(visible));
      for (const link of document.querySelectorAll<HTMLElement>('.sidebar a[aria-current="page"], .sidebar a[data-desktop-current]')) {
        if (visible) {
          link.dataset.desktopCurrent = 'true';
          link.removeAttribute('aria-current');
        } else {
          if (link.classList.contains('active')) link.setAttribute('aria-current', 'page');
          delete link.dataset.desktopCurrent;
        }
      }
      if (content) content.inert = Boolean(visible);
      pane.hidden = !visible || selected !== 'cli';
      usagePane.hidden = !visible || selected !== 'usage';
      if (!visible) return;
      const rect = content.getBoundingClientRect();
      const header = document.querySelector('.main-header')?.getBoundingClientRect();
      const top = Math.max(rect.top, header?.bottom || 34);
      Object.assign(pane.style, { left: `${rect.left}px`, top: `${top}px`, width: `${rect.width}px`, height: `${Math.max(0, innerHeight - top)}px` });
      Object.assign(usagePane.style, { left: `${rect.left}px`, top: `${top}px`, width: `${rect.width}px`, height: `${Math.max(0, innerHeight - top)}px` });
    };
    const schedule = () => { if (frame == null) frame = requestAnimationFrame(sync); };
    const show = async (name: 'cli' | 'usage') => {
      selected = name;
      schedule();
      const view = name === 'cli' ? pane : usagePane;
      if (!view.parentElement) {
        document.body.append(view);
        const result = await ipcRenderer.invoke(name === 'cli' ? 'harness:page' : 'harness:usage-page');
        if (result.error) { if (selected === name) selected = null; view.remove(); schedule(); return; }
        view.srcdoc = result.value;
      }
      schedule();
    };
    button.addEventListener('click', () => void show('cli'));
    usageButton.addEventListener('click', () => void show('usage'));
    document.addEventListener('click', (event) => {
      if ((event.target as Element).closest('.sidebar a[href]')) { selected = null; schedule(); }
    }, true);
    window.addEventListener('hashchange', () => { selected = null; schedule(); });
    window.addEventListener('resize', schedule);
    style.textContent += '#desktop-cli-content,#desktop-copilot-content{position:fixed;border:0;z-index:10;background:var(--bg-primary)}.desktop-cli-selected .content{visibility:hidden}.desktop-cli-selected .sidebar a.active{background:transparent;box-shadow:none;border-color:transparent;color:var(--text-secondary)}#desktop-cli-models.active,#desktop-copilot-usage.active{background:var(--bg-tertiary);color:var(--text-primary)}';
    const attach = () => {
      if (branding) {
        const brand = document.querySelector<HTMLElement>('.sidebar-brand');
        const title = brand?.querySelector<HTMLElement>('.sidebar-brand-title');
        const logo = brand?.querySelector<HTMLImageElement>('.sidebar-brand-logo');
        if (brand && brand.title !== branding.name) brand.title = branding.name;
        if (title && title.textContent !== branding.name) title.textContent = branding.name;
        if (logo && logo.src !== branding.logo) logo.src = branding.logo;
        if (logo && logo.alt !== branding.name) logo.alt = branding.name;
      }
      // Find Controls by its stable route, including when labels are translated or hidden.
      const control = document.querySelector('.sidebar a[href="#/config"]') || document.querySelector('.sidebar a[href="#/settings"]');
      const group = control?.closest('.nav-group') || [...document.querySelectorAll('.sidebar .nav-group')].find((item) => item.querySelector('.nav-group-label')?.textContent.trim().toLowerCase() === 'controls');
      if (group && button.parentElement !== group) group.append(button);
      const usageGroup = [...document.querySelectorAll('.sidebar .nav-group')].find((item) => /^(observe|observability)$/i.test(item.querySelector('.nav-group-label')?.textContent.trim() || '')) || group;
      if (!usageButton.querySelector('.nav-icon')) {
        const icon = usageGroup?.querySelector('.nav-icon')?.cloneNode(true);
        if (icon) usageButton.prepend(icon);
      }
      if (usageGroup && usageButton.parentElement !== usageGroup) usageGroup.append(usageButton);
      schedule();
    };
    new MutationObserver(attach).observe(document.body, { childList: true, subtree: true });
    attach();
    ipcRenderer.invoke('desktop-branding').then((value) => { branding = value; attach(); }).catch(() => {});
    new MutationObserver(() => ipcRenderer.send('harness:theme-updated')).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  });
}
