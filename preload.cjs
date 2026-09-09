const { ipcRenderer } = require('electron');
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
        <button id="desktop-btn-close" class="desktop-control-btn close" type="button" title="Close" aria-label="Close">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M0.5 0.5L9.5 9.5M9.5 0.5L0.5 9.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
    `;

    document.body.prepend(titlebar);

    const btnMin = document.getElementById('desktop-btn-minimize');
    const btnMax = document.getElementById('desktop-btn-maximize');
    const btnClose = document.getElementById('desktop-btn-close');

    btnMin?.addEventListener('click', () => ipcRenderer.send('desktop-minimize'));
    btnMax?.addEventListener('click', () => ipcRenderer.send('desktop-toggle-maximize'));
    btnClose?.addEventListener('click', () => ipcRenderer.send('desktop-close'));

    titlebar.addEventListener('dblclick', (event) => {
      if (!event.target.closest('.desktop-titlebar-controls')) {
        ipcRenderer.send('desktop-toggle-maximize');
      }
    });

    const updateMaximizeState = (isMaximized) => {
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

    const button = document.createElement('button');
    button.id = 'desktop-cli-models';
    button.type = 'button';
    button.className = 'nav-item';
    button.title = 'Configure CLI';
    button.setAttribute('aria-label', 'Configure CLI');
    button.innerHTML = '<span class="nav-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3m6 0h4"/></svg></span><span class="nav-text"><span class="nav-label">Configure CLI</span></span>';
    const style = document.createElement('style');
    style.textContent = '#desktop-cli-models{background:transparent;text-align:left;font-family:inherit;width:100%}#desktop-cli-models:focus-visible{outline:2px solid var(--primary-active);outline-offset:2px}.sidebar.collapsed #desktop-cli-models .nav-text{display:none}';
    document.head.append(style);
    let selected = false;
    let content;
    let frame;
    const pane = document.createElement('iframe');
    pane.id = 'desktop-cli-content';
    pane.title = 'Configure CLI';
    pane.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals');
    pane.hidden = true;
    const allowed = new Set(['load', 'inspect', 'browse', 'apply', 'restore', 'theme']);
    window.addEventListener('message', async (event) => {
      const message = event.data;
      if (event.source !== pane.contentWindow || message?.channel !== 'harness:request' || !allowed.has(message.name) || !Array.isArray(message.args)) return;
      try {
        const result = await ipcRenderer.invoke('harness:' + message.name, ...message.args);
        pane.contentWindow?.postMessage({ channel: 'harness:response', id: message.id, ...result }, '*');
      } catch (error) {
        pane.contentWindow?.postMessage({ channel: 'harness:response', id: message.id, error: error.message }, '*');
      }
    });
    ipcRenderer.on('harness:theme-changed', (_event, theme) => pane.contentWindow?.postMessage({ channel: 'harness:response', theme }, '*'));
    const resize = new ResizeObserver(() => schedule());
    const sync = () => {
      frame = null;
      const next = document.querySelector('.content');
      if (next !== content) {
        if (content) { resize.unobserve(content); content.inert = false; }
        content = next;
        if (content) resize.observe(content);
      }
      const visible = selected && content && !location.hash.includes('/login');
      button.classList.toggle('active', Boolean(visible));
      button.setAttribute('aria-current', visible ? 'page' : 'false');
      document.body.classList.toggle('desktop-cli-selected', Boolean(visible));
      for (const link of document.querySelectorAll('.sidebar a[aria-current="page"], .sidebar a[data-desktop-current]')) {
        if (visible) {
          link.dataset.desktopCurrent = 'true';
          link.removeAttribute('aria-current');
        } else {
          if (link.classList.contains('active')) link.setAttribute('aria-current', 'page');
          delete link.dataset.desktopCurrent;
        }
      }
      if (content) content.inert = Boolean(visible);
      pane.hidden = !visible;
      if (!visible) return;
      const rect = content.getBoundingClientRect();
      const header = document.querySelector('.main-header')?.getBoundingClientRect();
      const top = Math.max(rect.top, header?.bottom || 34);
      Object.assign(pane.style, { left: `${rect.left}px`, top: `${top}px`, width: `${rect.width}px`, height: `${Math.max(0, innerHeight - top)}px` });
    };
    const schedule = () => { if (frame == null) frame = requestAnimationFrame(sync); };
    button.addEventListener('click', async () => {
      selected = true;
      if (!pane.parentElement) {
        document.body.append(pane);
        const result = await ipcRenderer.invoke('harness:page');
        if (result.error) { selected = false; schedule(); return; }
        pane.srcdoc = result.value;
      }
      schedule();
    });
    document.addEventListener('click', (event) => {
      if (event.target.closest('.sidebar a[href]')) { selected = false; schedule(); }
    }, true);
    window.addEventListener('hashchange', () => { selected = false; schedule(); });
    window.addEventListener('resize', schedule);
    style.textContent += '#desktop-cli-content{position:fixed;border:0;z-index:10;background:var(--bg-primary)}.desktop-cli-selected .content{visibility:hidden}.desktop-cli-selected .sidebar a.active{background:transparent;box-shadow:none;border-color:transparent;color:var(--text-secondary)}#desktop-cli-models.active{background:var(--bg-tertiary);color:var(--text-primary)}';
    const attach = () => {
      // Find Controls by its stable route, including when labels are translated or hidden.
      const control = document.querySelector('.sidebar a[href="#/config"]') || document.querySelector('.sidebar a[href="#/settings"]');
      const group = control?.closest('.nav-group') || [...document.querySelectorAll('.sidebar .nav-group')].find((item) => item.querySelector('.nav-group-label')?.textContent.trim().toLowerCase() === 'controls');
      if (group && button.parentElement !== group) group.append(button);
      schedule();
    };
    new MutationObserver(attach).observe(document.body, { childList: true, subtree: true });
    attach();
    new MutationObserver(() => ipcRenderer.send('harness:theme-updated')).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  });
}
