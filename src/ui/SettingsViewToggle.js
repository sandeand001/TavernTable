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

      const findToggle = () =>
        settingsPanel.querySelector('[data-viewmode-toggle]') ||
        settingsPanel.querySelector('#view-mode-toggle');

      let toggle = findToggle();
      let toggleLabel = toggle?.closest('.toggle-switch')?.querySelector('.toggle-label') || null;

      if (!toggle) {
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

        const wrapper = document.createElement('div');
        wrapper.className = 'setting-item';
        wrapper.setAttribute('data-viewmode-toggle-wrapper', '');
        wrapper.style.marginTop = '0.5rem';

        const toggleSwitch = document.createElement('label');
        toggleSwitch.className = 'toggle-switch';
        toggleSwitch.id = 'view-mode-toggle-switch';

        toggle = document.createElement('input');
        toggle.type = 'checkbox';
        toggle.id = 'view-mode-toggle';
        toggle.setAttribute('data-viewmode-toggle', 'true');
        toggleSwitch.appendChild(toggle);

        const slider = document.createElement('span');
        slider.className = 'toggle-slider';
        toggleSwitch.appendChild(slider);

        toggleLabel = document.createElement('span');
        toggleLabel.className = 'toggle-label';
        toggleLabel.textContent = 'Top-Down View';
        toggleSwitch.appendChild(toggleLabel);

        wrapper.appendChild(toggleSwitch);
        displaySection.appendChild(wrapper);
      } else if (!toggle.hasAttribute('data-viewmode-toggle')) {
        toggle.setAttribute('data-viewmode-toggle', 'true');
      }

      const setMode = (mode) => {
        if (gm.stateCoordinator?.setViewMode) {
          gm.stateCoordinator.setViewMode(mode);
        } else if (gm.toggleViewMode) {
          const current = gm.getViewMode ? gm.getViewMode() : 'isometric';
          if (current !== mode) gm.toggleViewMode();
        }
      };

      const updateToggle = (mode) => {
        const isTopDown = mode === 'topdown';
        if (toggle) {
          toggle.checked = isTopDown;
          toggle.setAttribute('aria-checked', String(isTopDown));
          toggle.setAttribute(
            'aria-label',
            isTopDown ? 'Disable top-down view' : 'Enable top-down view'
          );
        }
        if (toggleLabel) {
          toggleLabel.textContent = isTopDown ? 'Top-Down View Enabled' : 'Top-Down View';
        }
      };

      updateToggle(gm.getViewMode());

      if (toggle && !toggle.dataset.bound) {
        toggle.addEventListener('change', () => {
          const targetMode = toggle.checked ? 'topdown' : 'isometric';
          setMode(targetMode);
        });
        toggle.dataset.bound = 'true';
      }

      if (!toggle.dataset.viewmodeListener) {
        window.addEventListener('viewmode:changed', (e) => {
          if (!e || !e.detail) return;
          updateToggle(e.detail.mode);
        });
        toggle.dataset.viewmodeListener = 'true';
      }
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
