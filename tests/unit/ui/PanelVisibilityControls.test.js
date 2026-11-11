import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import SidebarController from '../../../src/ui/SidebarController.js';
import {
  attachPanelToggles,
  setPanelCollapsed,
} from '../../../src/ui/controls/PanelVisibilityControls.js';
import { getDiceButtons } from '../../../src/ui/dom-helpers.js';
import { GameErrors } from '../../../src/utils/error/ErrorHandler.js';

const html = readFileSync(resolve(__dirname, '../../../index.html'), 'utf8');
const panel = (id) => document.getElementById(id);
const toggle = (id) => panel(id).querySelector('[data-panel-toggle]');

function renderPage() {
  document.body.className = '';
  document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
}

beforeEach(() => {
  localStorage.clear();
  renderPage();
  attachPanelToggles();
});

afterEach(() => {
  jest.restoreAllMocks();
  document.body.replaceChildren();
  document.body.className = '';
  delete window.gameManager;
});

test('both panels start expanded and their controls retain the original dice selectors', () => {
  expect(toggle('dice-panel').getAttribute('aria-expanded')).toBe('true');
  expect(toggle('right-sidebar').getAttribute('aria-expanded')).toBe('true');
  expect(panel('dice-controls').hidden).toBe(false);
  expect(panel('sidebar-tabs').hidden).toBe(false);
  expect(panel('sidebar-content').hidden).toBe(false);
  expect([...getDiceButtons()].map((button) => button.dataset.sides)).toEqual([
    '4',
    '6',
    '8',
    '10',
    '12',
    '20',
  ]);
});

test('the sidebar becomes one reopening tab without discarding its selected tab or roll history', () => {
  const controller = new SidebarController();
  controller.addDiceLogEntry('Earlier roll: 12', 'roll');
  controller.switchTab('settings');
  const resize = jest.fn();
  window.addEventListener('resize', resize);
  try {
    toggle('right-sidebar').click();
    expect(panel('sidebar-tabs').hidden).toBe(true);
    expect(panel('sidebar-content').hidden).toBe(true);
    expect(panel('sidebar-content').inert).toBe(true);
    expect(toggle('right-sidebar').getAttribute('aria-label')).toBe('Expand side menu');
    expect(toggle('right-sidebar').hidden).toBe(false);
    expect(document.body.classList.contains('right-sidebar-collapsed')).toBe(true);
    expect(resize).toHaveBeenCalledTimes(1);
    expect(panel('dice-controls').hidden).toBe(false);

    toggle('right-sidebar').click();
    expect(panel('sidebar-tabs').hidden).toBe(false);
    expect(panel('sidebar-content').inert).toBe(false);
    expect(panel('settings-panel').classList.contains('active')).toBe(true);
    expect(panel('dice-log-content').textContent).toContain('Earlier roll: 12');
    expect(controller.activeTab).toBe('settings');
    expect(resize).toHaveBeenCalledTimes(2);
  } finally {
    window.removeEventListener('resize', resize);
  }
});

test('dice collapse independently and reopening retains the count and last result', () => {
  panel('dice-count').value = '7';
  panel('dice-result').textContent = 'Result: 31';
  toggle('dice-panel').click();
  expect(panel('dice-controls').hidden).toBe(true);
  expect(panel('dice-controls').inert).toBe(true);
  expect(toggle('dice-panel').getAttribute('aria-expanded')).toBe('false');
  expect(panel('sidebar-content').hidden).toBe(false);
  toggle('dice-panel').click();
  expect(panel('dice-controls').hidden).toBe(false);
  expect(panel('dice-count').value).toBe('7');
  expect(panel('dice-result').textContent).toBe('Result: 31');
});

test('both collapsed preferences survive a fresh page and sidebar initialization', () => {
  toggle('dice-panel').click();
  toggle('right-sidebar').click();
  expect(localStorage.getItem('taverntable.panels.dice-panel.collapsed')).toBe('true');
  expect(localStorage.getItem('taverntable.panels.right-sidebar.collapsed')).toBe('true');
  renderPage();
  new SidebarController();
  expect(panel('dice-controls').hidden).toBe(true);
  expect(panel('sidebar-tabs').hidden).toBe(true);
  expect(panel('sidebar-content').hidden).toBe(true);
  expect(document.body.classList.contains('right-sidebar-collapsed')).toBe(true);
});

test('opening a compendium entry reveals the sidebar without reopening dice', async () => {
  const controller = new SidebarController();
  const show = jest.spyOn(controller, '_showCompendium').mockResolvedValue();
  toggle('dice-panel').click();
  toggle('right-sidebar').click();
  await controller.openCompendium('longsword');
  expect(show).toHaveBeenCalledWith('longsword');
  expect(panel('sidebar-content').hidden).toBe(false);
  expect(panel('compendium-panel').classList.contains('active')).toBe(true);
  expect(panel('dice-controls').hidden).toBe(true);
  expect(localStorage.getItem('taverntable.panels.right-sidebar.collapsed')).toBe('false');
});

test('collapsing focused content moves focus to the remaining reopening tab', () => {
  panel('dice-count').focus();
  setPanelCollapsed(panel('dice-panel'), true);
  expect(document.activeElement).toBe(toggle('dice-panel'));
});

test('attaching twice does not double-toggle a panel', () => {
  attachPanelToggles();
  toggle('right-sidebar').click();
  expect(panel('sidebar-content').hidden).toBe(true);
});

test('an unavailable preference store is reported and does not prevent menu use', () => {
  const report = jest.spyOn(GameErrors, 'input').mockImplementation(() => {});
  const failure = new Error('Preferences unavailable');
  jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw failure;
  });
  jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw failure;
  });
  renderPage();
  attachPanelToggles();
  expect(panel('sidebar-content').hidden).toBe(false);
  expect(report).toHaveBeenCalledWith(failure, {
    component: 'PanelVisibilityControls',
    operation: 'restorePreference',
  });
  toggle('right-sidebar').click();
  expect(panel('sidebar-content').hidden).toBe(true);
  expect(report).toHaveBeenCalledWith(failure, {
    component: 'PanelVisibilityControls',
    operation: 'savePreference',
  });
});
