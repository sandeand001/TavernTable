import { GameErrors } from '../../utils/error/ErrorHandler.js';

export function attachPanelToggles() {
  for (const panel of document.querySelectorAll('[data-collapsible-panel]')) {
    const button = panel.querySelector('[data-panel-toggle]');
    if (button.dataset.boundPanelToggle) continue;
    let collapsed = false;
    try {
      collapsed = localStorage.getItem(`taverntable.panels.${panel.id}.collapsed`) === 'true';
    } catch (error) {
      GameErrors.input(error, {
        component: 'PanelVisibilityControls',
        operation: 'restorePreference',
      });
    }
    setPanelCollapsed(panel, collapsed, { persist: false });
    button.addEventListener('click', () =>
      setPanelCollapsed(panel, panel.dataset.collapsed !== 'true')
    );
    button.dataset.boundPanelToggle = 'true';
  }
}

export function setPanelCollapsed(panel, collapsed, { persist = true } = {}) {
  const button = panel.querySelector('[data-panel-toggle]');
  const contents = button
    .getAttribute('aria-controls')
    .split(/\s+/)
    .map((id) => document.getElementById(id));
  if (contents.some((content) => !content)) {
    throw new Error(`Missing collapsible content for ${panel.id}`);
  }
  const changed = panel.dataset.collapsed !== String(collapsed);
  if (collapsed && contents.some((content) => content.contains(document.activeElement))) {
    button.focus();
  }
  for (const content of contents) {
    content.hidden = collapsed;
    content.inert = collapsed;
  }
  panel.dataset.collapsed = String(collapsed);
  panel.classList.toggle('is-collapsed', collapsed);
  document.body.classList.toggle(`${panel.id}-collapsed`, collapsed);
  button.setAttribute('aria-expanded', String(!collapsed));
  const label = `${collapsed ? 'Expand' : 'Collapse'} ${button.dataset.panelLabel}`;
  button.setAttribute('aria-label', label);
  button.title = label;
  button.querySelector('[data-panel-indicator]').textContent = collapsed ? '+' : '-';
  if (!changed) return;
  if (panel.id === 'right-sidebar') window.dispatchEvent(new Event('resize'));
  if (persist) {
    try {
      localStorage.setItem(`taverntable.panels.${panel.id}.collapsed`, String(collapsed));
    } catch (error) {
      GameErrors.input(error, {
        component: 'PanelVisibilityControls',
        operation: 'savePreference',
      });
    }
  }
}
