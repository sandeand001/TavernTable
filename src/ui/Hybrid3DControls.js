// Hybrid3DControls.js - Adds streamlined experimental 3D controls into the Settings panel.

import { logger, LOG_CATEGORY, LOG_LEVEL } from '../utils/Logger.js';

function el(id) {
  return document.getElementById(id);
}

function ensureHybrid() {
  if (!window.gameManager) return null;
  if (!window.gameManager.is3DModeActive?.()) return null;
  return window.gameManager.threeSceneManager || null;
}

function getStoredGridVisibility(defaultValue = true) {
  if (typeof window === 'undefined') return defaultValue;
  if (typeof window.__TT_PENDING_BOOTSTRAP_GRID_VISIBLE === 'boolean') {
    return !!window.__TT_PENDING_BOOTSTRAP_GRID_VISIBLE;
  }
  return defaultValue;
}

function setStoredGridVisibility(value) {
  if (typeof window !== 'undefined') {
    window.__TT_PENDING_BOOTSTRAP_GRID_VISIBLE = !!value;
  }
}

function attach3DControls() {
  const settingsPanel = el('settings-panel');
  if (!settingsPanel) return;
  if (el('hybrid-3d-extended-section')) return;

  const section = document.createElement('div');
  section.className = 'section';
  section.id = 'hybrid-3d-extended-section';
  section.innerHTML = `
    <div class="section-title">3D Experimental Controls</div>
    <div class="setting-item">
      <label class="toggle-switch" for="bootstrap-grid-toggle">
        <input type="checkbox" id="bootstrap-grid-toggle" checked />
        <span class="toggle-slider"></span>
        <span class="toggle-label">Show 3D Wire Grid</span>
      </label>
    </div>
    <div class="setting-item" style="margin-top:0.5rem;display:flex;flex-direction:column;gap:6px;">
      <label class="toggle-switch" for="topdown-view-toggle" style="align-self:flex-start;">
        <input type="checkbox" id="topdown-view-toggle" data-viewmode-toggle="true" />
        <span class="toggle-slider"></span>
        <span class="toggle-label">Top-Down Camera</span>
      </label>
      <div class="small-text" style="opacity:0.75;">Lock the hybrid camera to a tactical top-down angle.</div>
    </div>
  `;

  const firstSection = settingsPanel.querySelector('.section');
  if (firstSection && firstSection.nextSibling) {
    firstSection.parentNode.insertBefore(section, firstSection.nextSibling);
  } else {
    settingsPanel.appendChild(section);
  }

  const bootstrapToggle = el('bootstrap-grid-toggle');
  if (bootstrapToggle) {
    const initialVisible = getStoredGridVisibility(true);
    bootstrapToggle.checked = initialVisible;
    setStoredGridVisibility(initialVisible);
    const mgr = ensureHybrid();
    if (mgr) mgr.setBootstrapGridVisible(initialVisible);
    const settingsToggle = el('visual-grid-toggle');
    if (settingsToggle) settingsToggle.checked = initialVisible;
    bootstrapToggle.addEventListener('change', () => {
      const visible = !!bootstrapToggle.checked;
      setStoredGridVisibility(visible);
      const sceneMgr = ensureHybrid();
      if (sceneMgr) sceneMgr.setBootstrapGridVisible(visible);
      const settingsToggleEl = el('visual-grid-toggle');
      if (settingsToggleEl) settingsToggleEl.checked = visible;
    });
    if (typeof window !== 'undefined') {
      window.__TT_GRID_VISIBILITY_LISTENERS__ = window.__TT_GRID_VISIBILITY_LISTENERS__ || [];
      if (!bootstrapToggle.dataset.gridListenerBound) {
        const syncFn = (visible) => {
          bootstrapToggle.checked = !!visible;
          const settingsToggleEl = el('visual-grid-toggle');
          if (settingsToggleEl) settingsToggleEl.checked = !!visible;
        };
        window.__TT_GRID_VISIBILITY_LISTENERS__.push(syncFn);
        bootstrapToggle.dataset.gridListenerBound = 'true';
      }
    }
  }

  let storedIsoPitch = null;

  const toDegrees = (radians) => (Number.isFinite(radians) ? (radians * 180) / Math.PI : null);

  const applyTopDownLock = (shouldLock) => {
    const mgr = ensureHybrid();
    if (!mgr) return;

    if (shouldLock && storedIsoPitch == null) {
      storedIsoPitch = toDegrees(mgr._isoPitch) ?? 45;
    }

    if (!shouldLock && storedIsoPitch == null) {
      storedIsoPitch = 45;
    }

    const targetPitch = shouldLock ? 89.9 : storedIsoPitch;

    if (typeof mgr.setCameraPitchDegrees === 'function') {
      mgr.setCameraPitchDegrees(targetPitch, { lock: shouldLock });
    } else if (typeof mgr.setIsoPitchDegrees === 'function') {
      mgr.setIsoPitchDegrees(targetPitch);
    }

    if (!shouldLock) {
      storedIsoPitch = null;
      if (typeof mgr._isoManualLock === 'boolean') {
        mgr._isoManualLock = false;
      }
    }

    if (typeof mgr.reframe === 'function') mgr.reframe();
  };

  const viewToggle = el('topdown-view-toggle');
  if (viewToggle) {
    viewToggle.setAttribute('data-viewmode-toggle', 'true');
    const gm = window.gameManager;
    const getCurrentMode = () => (gm?.getViewMode ? gm.getViewMode() : 'isometric');

    const setViewMode = (mode) => {
      if (!gm) return;
      const current = getCurrentMode();
      if (current === mode) return;
      if (gm.stateCoordinator?.setViewMode) {
        gm.stateCoordinator.setViewMode(mode);
      } else if (gm.toggleViewMode) {
        gm.toggleViewMode();
      }
    };

    const syncToggle = (mode) => {
      viewToggle.checked = mode === 'topdown';
    };

    syncToggle(getCurrentMode());

    viewToggle.addEventListener('change', () => {
      const enablingTopDown = !!viewToggle.checked;
      if (enablingTopDown && storedIsoPitch == null) {
        const mgr = ensureHybrid();
        if (mgr) storedIsoPitch = toDegrees(mgr._isoPitch) ?? storedIsoPitch;
      }

      const targetMode = enablingTopDown ? 'topdown' : 'isometric';
      setViewMode(targetMode);

      if (!enablingTopDown && storedIsoPitch == null) {
        const mgr = ensureHybrid();
        storedIsoPitch = toDegrees(mgr?._isoPitch) ?? 45;
      }
    });

    window.addEventListener('viewmode:changed', (event) => {
      const detail = event?.detail;
      if (!detail || detail.error) return;
      syncToggle(detail.mode);
      if (detail.mode !== detail.previous) {
        applyTopDownLock(detail.mode === 'topdown');
        const message =
          detail.mode === 'topdown'
            ? 'Camera locked to top-down view'
            : 'Camera returned to isometric view';
        logger.log(LOG_LEVEL.INFO, message, LOG_CATEGORY.USER);
      }
    });
  }
}

window.addEventListener('load', () => {
  try {
    attach3DControls();
  } catch (_) {
    /* ignore */
  }
});

export { attach3DControls };
