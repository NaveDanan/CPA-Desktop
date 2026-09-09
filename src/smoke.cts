import fs = require('node:fs');
import path = require('node:path');
import assert = require('node:assert/strict');
import { setTimeout as delay } from 'node:timers/promises';
import { nativeImage, BrowserWindow } from 'electron';

async function run({ window, runtime, outputDir, backendPid }: { window: Electron.BrowserWindow; runtime: ReturnType<typeof import("./runtime.cjs").prepareConfig>; outputDir: string; backendPid: number }) {
  fs.mkdirSync(outputDir, { recursive: true });
  const screenshot = async (name: string, view: Pick<Electron.WebContents, "capturePage">) => {
    if (!process.argv.includes('--smoke-no-screenshots')) fs.writeFileSync(path.join(outputDir, name), (await view.capturePage()).toPNG());
  };
  const contents = window.webContents;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await contents.executeJavaScript(`document.body.innerText.includes('Dashboard') && !location.hash.includes('/login')`)) break;
    await delay(200);
  }
  const body = await contents.executeJavaScript('document.body.innerText');
  assert.ok(body.includes('Dashboard'), 'Existing dashboard rendered after automatic login');
  assert.ok(!contents.getURL().includes('/login'), 'Automatic local management login completed');
  await contents.executeJavaScript(`new Promise(resolve => {
    const matches = () => document.querySelector('.sidebar-brand-title')?.textContent === 'CPA for Desktop';
    if (matches()) { resolve(); return; }
    const observer = new MutationObserver(() => { if (matches()) { observer.disconnect(); resolve(); } });
    observer.observe(document.body, { childList: true, subtree: true });
  })`);
  assert.equal(await contents.executeJavaScript(`document.querySelector('.sidebar-brand-logo').src`), `data:image/png;base64,${fs.readFileSync(path.join(__dirname, 'assets', 'icon.png')).toString('base64')}`, 'Sidebar uses the new app logo');
  const management = async (route: string) => {
    const response = await fetch(runtime.origin + '/v0/management/' + route, { headers: { Authorization: `Bearer ${runtime.managementKey}` } });
    assert.equal(response.status, 200, route);
    return response.json();
  };
  const auth = await management('auth-files');
  let models;
  for (let attempt = 0; attempt < 90; attempt++) {
    const modelsResponse = await fetch(runtime.origin + '/v1/models', { headers: { Authorization: `Bearer ${runtime.config['api-keys'][0]}` } });
    assert.equal(modelsResponse.status, 200, 'Authenticated model endpoint');
    models = await modelsResponse.json();
    if (models.data?.length || !(auth.files || []).length) break;
    await delay(1000);
  }
  if ((auth.files || []).length) assert.ok(models.data?.length, 'Models discovered for the existing account');
  const unauthenticated = await fetch(runtime.origin + '/v0/management/config');
  assert.equal(unauthenticated.status, 401, 'Management still requires a key outside the desktop window');
  const forbiddenNode = await contents.executeJavaScript(`typeof window.require`);
  assert.equal(forbiddenNode, 'undefined', 'Renderer has no Node access');
  await delay(1500);
  await screenshot('desktop-dashboard.png', contents);
  {
    const layout = await contents.executeJavaScript(`(() => {
      const bar = document.getElementById('desktop-titlebar').getBoundingClientRect();
      const sidebar = document.querySelector('.sidebar').getBoundingClientRect();
      const header = document.querySelector('.main-header').getBoundingClientRect();
      return {
        brand: !!document.querySelector('.desktop-titlebar-badge, .desktop-titlebar-title, .desktop-titlebar-icon'),
        barLeft: Math.round(bar.left), barTop: Math.round(bar.top), barRight: Math.round(bar.right),
        sidebarTop: Math.round(sidebar.top), sidebarRight: Math.round(sidebar.right), sidebarHeight: Math.round(sidebar.height),
        headerLeft: Math.round(header.left), headerTop: Math.round(header.top),
        viewport: { width: innerWidth, height: innerHeight },
      };
    })()`);
    assert.equal(layout.brand, false, 'Titlebar no longer shows the CLI Proxy API brand and DESKTOP badge');
    assert.equal(layout.sidebarTop, 0, 'Sidebar starts at the top of the window');
    assert.equal(layout.sidebarHeight, layout.viewport.height, 'Sidebar takes the full window height');
    assert.equal(layout.barLeft, layout.sidebarRight, 'Titlebar starts where the sidebar ends');
    assert.equal(layout.barTop, 0, 'Titlebar stays at the top of its column');
    assert.equal(layout.barRight, layout.viewport.width, 'Titlebar spans to the window edge');
    assert.equal(layout.headerLeft, layout.sidebarRight, 'Main header starts beside the sidebar');
    assert.ok(layout.headerTop >= 34, 'Main header sits below the titlebar');

    const collapsed = await contents.executeJavaScript(`(async () => {
      document.querySelector('.sidebar-toggle-floating').click();
      await new Promise((resolve) => setTimeout(resolve, 600));
      const bar = document.getElementById('desktop-titlebar').getBoundingClientRect();
      const sidebar = document.querySelector('.sidebar').getBoundingClientRect();
      document.querySelector('.sidebar-toggle-floating').click();
      await new Promise((resolve) => setTimeout(resolve, 600));
      return { barLeft: Math.round(bar.left), sidebarRight: Math.round(sidebar.right), sidebarHeight: Math.round(sidebar.height) };
    })()`);
    assert.equal(collapsed.barLeft, collapsed.sidebarRight, 'Titlebar follows the collapsed sidebar');
    assert.equal(collapsed.sidebarHeight, layout.viewport.height, 'Collapsed sidebar keeps the full window height');
  }
  const logo = await contents.executeJavaScript(`document.querySelector('img')?.src`);
  if (logo?.startsWith('data:image/')) {
    const icon = nativeImage.createFromDataURL(logo).resize({ width: 256, height: 256 }).toPNG();
    const header = Buffer.alloc(22);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(1, 4);
    header.writeUInt16LE(1, 10);
    header.writeUInt16LE(32, 12);
    header.writeUInt32LE(icon.length, 14);
    header.writeUInt32LE(22, 18);
    fs.writeFileSync(path.join(outputDir, 'app.ico'), Buffer.concat([header, icon]));
  }
  const links = await contents.executeJavaScript(`Array.from(document.querySelectorAll('a')).map(a => ({ text: a.innerText, href: a.getAttribute('href') }))`);
  const oauth = links.find((link: { text: string; href: string }) => /OAuth/i.test(link.text));
  if (oauth) {
    await contents.executeJavaScript(`location.hash = ${JSON.stringify(oauth.href.replace(/^.*#/, ''))}`);
    await delay(1500);
    assert.ok((await contents.executeJavaScript('document.body.innerText')).includes('GitHub Copilot'), 'Original Copilot login card exists');
    await screenshot('desktop-copilot.png', contents);
  }
  const accountCount = (auth.files || []).filter((file: AuthAccount) => file.provider === 'github-copilot' || file.type === 'github-copilot').length;
  {
    assert.ok(await contents.executeJavaScript(`!!document.getElementById('desktop-cli-models')`), 'CLI setup button exists');
    assert.ok(await contents.executeJavaScript(`document.getElementById('desktop-cli-models').closest('.nav-group') === document.querySelector('.sidebar a[href="#/config"]').closest('.nav-group')`), 'Configure CLI belongs to Controls');
    const windowCount = BrowserWindow.getAllWindows().length;
    await contents.executeJavaScript("document.getElementById('desktop-cli-models').click()");
    for (let attempt = 0; attempt < 100; attempt++) {
      if (contents.mainFrame.frames.some((frame) => frame.url === 'about:srcdoc')) break;
      await delay(100);
    }
    const setup = { webContents: contents.mainFrame.frames.find((frame) => frame.url === 'about:srcdoc') };
    assert.ok(setup.webContents, 'CLI setup is embedded in the parent');
    assert.equal(BrowserWindow.getAllWindows().length, windowCount, 'CLI setup creates no new window');
    assert.ok(await contents.executeJavaScript("document.getElementById('desktop-cli-models').getAttribute('aria-current') === 'page' && document.querySelector('.content').inert"), 'CLI tab is selected and covered content cannot receive focus');
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await setup.webContents.executeJavaScript(`!!document.getElementById('codex-path')`)) break;
      await delay(100);
    }
    const configDir = path.join(outputDir, 'cli-configs');
    fs.mkdirSync(configDir, { recursive: true });
    await setup.webContents.executeJavaScript(`
      for (const [key, file] of Object.entries(${JSON.stringify({ codex: path.join(configDir, 'config.toml'), claude: path.join(configDir, 'settings.json') })})) {
        const input = document.getElementById(key + '-path');
        input.value = file; input.dispatchEvent(new Event('input'));
      }
    `);
    if (accountCount) {
      assert.ok(await setup.webContents.executeJavaScript(`document.querySelectorAll('#model-rows tr').length > 0`), 'Copilot models shown in setup');
      await setup.webContents.executeJavaScript(`document.getElementById('codex-all').click()`);
      assert.ok(await setup.webContents.executeJavaScript(`document.getElementById('apply').disabled`), 'Empty enabled CLI prevents apply');
      await setup.webContents.executeJavaScript(`document.getElementById('codex-all').click()`);
      await setup.webContents.executeJavaScript(`document.getElementById('apply').click()`);
      for (let attempt = 0; attempt < 100; attempt++) {
        if (await setup.webContents.executeJavaScript(`document.getElementById('status').className !== ''`)) break;
        await delay(100);
      }
      assert.equal(await setup.webContents.executeJavaScript(`document.getElementById('status').className`), 'success', await setup.webContents.executeJavaScript(`document.getElementById('status').textContent`) as string);
      assert.ok(fs.existsSync(path.join(configDir, 'config.toml')), 'Codex configuration saved');
      assert.ok(fs.existsSync(path.join(configDir, 'settings.json')), 'Claude configuration saved');
    }
    await setup.webContents.executeJavaScript(`document.getElementById('status').textContent = 'Select models, check file paths, then apply.'`);
    const originalTheme = await contents.executeJavaScript(`document.documentElement.dataset.theme`);
    for (const theme of ['light', 'white', 'dark']) {
      await contents.executeJavaScript(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
      for (let attempt = 0; attempt < 50; attempt++) {
        if (await setup.webContents.executeJavaScript(`document.documentElement.dataset.theme === ${JSON.stringify(theme)}`)) break;
        await delay(100);
      }
      assert.equal(await setup.webContents.executeJavaScript(`getComputedStyle(document.documentElement).getPropertyValue('--bg-primary').trim()`), await contents.executeJavaScript(`getComputedStyle(document.documentElement).getPropertyValue('--bg-primary').trim()`), `${theme} theme matches management`);
      await screenshot(`cli-models-${theme}.png`, window);
    }
    await contents.executeJavaScript(`document.documentElement.dataset.theme = ${JSON.stringify(originalTheme || 'light')}`);
    await delay(100);
    await screenshot('cli-models-desktop.png', window);
    window.setSize(850, 850); await delay(200);
    assert.ok(await setup.webContents.executeJavaScript(`document.documentElement.scrollWidth <= innerWidth`), 'CLI setup fits narrow window');
    await screenshot('cli-models-narrow.png', window);
    await setup.webContents.executeJavaScript(`document.getElementById('restore').click()`);
    assert.ok(await setup.webContents.executeJavaScript(`document.getElementById('restore-dialog').open && document.getElementById('restore-codex').checked && document.getElementById('restore-claude').checked`), 'Restore dialog defaults to both CLIs');
    await screenshot('cli-restore-dialog.png', window);
    await setup.webContents.executeJavaScript(`document.getElementById('restore-codex').click(); document.getElementById('restore-claude').click()`);
    assert.ok(await setup.webContents.executeJavaScript(`document.getElementById('restore-confirm').disabled`), 'Empty restore selection is disabled');
    await setup.webContents.executeJavaScript(`document.getElementById('restore-cancel').click()`);
    const cancelState = await setup.webContents.executeJavaScript(`({open:document.getElementById('restore-dialog').open,focus:document.activeElement.id,disabled:document.getElementById('restore').disabled})`);
    assert.deepEqual(cancelState, { open: false, focus: 'restore', disabled: false }, 'Cancel returns keyboard focus to Restore Defaults');
    if (accountCount) {
      const codexBefore = fs.readFileSync(path.join(configDir, 'config.toml'), 'utf8');
      await setup.webContents.executeJavaScript(`document.getElementById('restore').click(); document.getElementById('restore-codex').click(); document.getElementById('restore-confirm').click()`);
      for (let attempt = 0; attempt < 100; attempt++) {
        if (await setup.webContents.executeJavaScript(`!document.getElementById('restore-dialog').open`)) break;
        await delay(100);
      }
      assert.equal(fs.readFileSync(path.join(configDir, 'config.toml'), 'utf8'), codexBefore, 'Restoring Claude leaves Codex unchanged');
      const restored = JSON.parse(fs.readFileSync(path.join(configDir, 'settings.json'), 'utf8'));
      assert.equal(restored.env.ANTHROPIC_BASE_URL, undefined, 'Restore removes proxy connection');
      assert.equal(restored.modelPicker, undefined, 'Restore removes custom model picker');
    }
    await contents.executeJavaScript("document.querySelector('.sidebar a[href=\"#/config\"]').click()");
    await delay(300);
    assert.equal(await contents.executeJavaScript("document.getElementById('desktop-cli-content').hidden"), true, 'Other sidebar tabs hide CLI setup');
    assert.equal(await contents.executeJavaScript("document.querySelector('.content').inert"), false, 'Management content is interactive again');
    await contents.executeJavaScript("document.getElementById('desktop-cli-models').click()");
    await delay(300);
    assert.ok(contents.mainFrame.frames.includes(setup.webContents), 'Returning to CLI setup preserves the form');
    assert.equal(await contents.executeJavaScript("document.getElementById('desktop-cli-content').hidden"), false, 'CLI setup is visible on return');
    assert.equal(await setup.webContents.executeJavaScript("document.getElementById('codex-path').value"), path.join(configDir, 'config.toml'), 'Unsaved configuration path survives tab changes');
  }
  fs.writeFileSync(path.join(outputDir, 'result.json'), JSON.stringify({
    passed: true, backendPid, origin: runtime.origin, accountCount, modelCount: models.data?.length || 0,
    models: (models.data || []).map((model: CopilotModel) => model.id),
    checks: ['original dashboard', 'automatic management login', 'auth files API', 'models API', 'unauthorized requests rejected', 'sandboxed renderer', 'original Copilot card', 'embedded CLI page', 'no additional window', 'sidebar navigation', 'form state retained', 'theme synchronization', 'minimum window width'],
  }, null, 2));
}

export { run };
