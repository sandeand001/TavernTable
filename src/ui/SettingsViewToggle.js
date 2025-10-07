/**
 * SettingsViewToggle.js - Injects a 'Toggle View' button into the settings menu
 * without assuming a bundler. Loaded after GameManager is on window.
 * Layer: ui
 */

(function initViewToggle() {
  if (typeof window === 'undefined') return;
  const READY = (fn) =>
    document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', fn) : fn();

  READY(() => {
    const inject = () => {
      const gm = window.gameManager;
      if (!gm) return false;
      const settingsPanel = document.getElementById('settings-panel');
      if (!settingsPanel) return false;

      // Ensure a container section for display options or append into existing.
      let displaySection = settingsPanel.querySelector('[data-viewmode-section]');
      if (!displaySection) {
        displaySection = document.createElement('div');
        displaySection.className = 'section';
        displaySection.setAttribute('data-viewmode-section', '');
        const title = document.createElement('div');
        title.className = 'section-title';
        title.textContent = 'View Mode';
        displaySection.appendChild(title);
        settingsPanel.appendChild(displaySection);
      }

      let btn = displaySection.querySelector('#toggle-view-btn');
      if (!btn) {
        btn = document.createElement('button');
        btn.id = 'toggle-view-btn';
        btn.type = 'button';
        btn.className = 'action-button';
        btn.textContent = 'Toggle View';
        btn.style.marginTop = '0.5rem';
        displaySection.appendChild(btn);
      }

      const updateButton = (mode) => {
        btn.setAttribute('aria-pressed', mode === 'topdown');
        btn.title = mode === 'topdown' ? 'Switch to isometric view' : 'Switch to top-down view';
        btn.textContent = mode === 'topdown' ? 'Isometric View' : 'Top-Down View';
      };
      updateButton(gm.getViewMode());

      btn.addEventListener('click', () => gm.toggleViewMode());
      window.addEventListener('viewmode:changed', (e) => updateButton(e.detail.mode));
      return true;
    };

    let attempts = 0;
    const MAX = 200; // ~20s
    // Skip polling loop entirely in Jest to avoid lingering timers
    const isTest =
      typeof globalThis !== 'undefined' &&
      globalThis.process &&
      globalThis.process.env &&
      globalThis.process.env.JEST_WORKER_ID != null;
    if (!isTest) {
      const timer = setInterval(() => {
        if (inject() || ++attempts >= MAX) {
          clearInterval(timer);
          if (attempts >= MAX)
            console.warn('[SettingsViewToggle] Unable to find gameManager/settings-panel');
        }
      }, 100);
    } else {
      // Single attempt in test mode (no timers)
      inject();
    }
  });
})();
