const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { setupTray } = require('../tray.cjs');

test('closing hides the window; tray, activation and second launch restore it; Quit exits', () => {
  const app = new EventEmitter();
  const window = new EventEmitter();
  let exiting = false;
  let visible = true;
  let minimized = false;
  let focused = false;
  let checks = 0;
  Object.assign(window, {
    isDestroyed: () => false, isMinimized: () => minimized,
    hide: () => { visible = false; }, show: () => { visible = true; },
    restore: () => { minimized = false; }, focus: () => { focused = true; },
  });
  app.quit = () => { exiting = true; };
  class Tray extends EventEmitter {
    setToolTip(value) { this.tooltip = value; }
    setContextMenu(value) { this.menu = value; }
  }
  const tray = setupTray({ Tray, Menu: { buildFromTemplate: (items) => items }, app, window, icon: {},
    isExiting: () => exiting, checkForUpdates: () => { checks++; } });
  let prevented = false;
  window.emit('close', { preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(visible, false);
  assert.equal(exiting, false);
  for (const reopen of [() => tray.emit('click'), () => tray.emit('double-click'), () => app.emit('second-instance'), () => app.emit('activate'), () => tray.menu[0].click()]) {
    visible = false; minimized = true; focused = false;
    reopen();
    assert.equal(visible && focused && !minimized, true);
  }
  tray.menu[1].click();
  assert.equal(checks, 1);
  tray.menu[3].click();
  assert.equal(exiting, true);
  window.emit('close', { preventDefault: () => assert.fail('Quit must allow closing') });
});
