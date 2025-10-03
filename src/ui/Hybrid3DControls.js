// Hybrid3DControls.js - Adds additional experimental 3D controls into Settings panel
// Provides UI for: isometric camera toggle, bootstrap grid visibility, PIXI grid visibility,
// and enabling instanced placeables + viewing placeable metrics.

import { logger, LOG_CATEGORY, LOG_LEVEL } from '../utils/Logger.js';

function el(id) {
  return document.getElementById(id);
}

function ensureHybrid() {
  if (!window.gameManager) return null;
  if (!window.gameManager.is3DModeActive?.()) return null;
  return window.gameManager.threeSceneManager || null;
}

function updatePlaceableMetrics() {
  try {
    const target = el('placeable-metrics');
    if (!target) return;
    const metrics = (window.__TT_METRICS__ && window.__TT_METRICS__.placeables) || null;
    if (!metrics) {
      target.textContent = 'Placeables: (no data)';
      return;
    }
    target.textContent = `Placeables: groups=${metrics.groups} instances=${metrics.liveInstances} expansions=${metrics.capacityExpansions}`;
  } catch (_) {
    /* ignore */
  }
}

function attach3DControls() {
  const settingsPanel = el('settings-panel');
  if (!settingsPanel) return;
  // Prevent duplicate injection
  if (el('hybrid-3d-extended-section')) return;

  const section = document.createElement('div');
  section.className = 'section';
  section.id = 'hybrid-3d-extended-section';
  section.innerHTML = `
    <div class="section-title">3D Experimental Controls</div>
    <div class="setting-item">
      <label class="toggle-switch" for="iso-camera-toggle">
        <input type="checkbox" id="iso-camera-toggle" />
        <span class="toggle-slider"></span>
        <span class="toggle-label">Isometric Camera Preset</span>
      </label>
      <div id="iso-warn" class="small-text" style="color:#d88922;display:none;margin-top:4px;">Enable 3D Hybrid first.</div>
    </div>
    <div class="setting-item">
      <label class="toggle-switch" for="bootstrap-grid-toggle">
        <input type="checkbox" id="bootstrap-grid-toggle" checked />
        <span class="toggle-slider"></span>
        <span class="toggle-label">Show 3D Wire Grid</span>
      </label>
    </div>
    <div class="setting-item">
      <label class="toggle-switch" for="pixi-grid-toggle">
        <input type="checkbox" id="pixi-grid-toggle" checked />
        <span class="toggle-slider"></span>
        <span class="toggle-label">Show 2D Grid</span>
      </label>
    </div>
    <div class="setting-item">
      <label class="toggle-switch" for="instanced-placeables-toggle">
        <input type="checkbox" id="instanced-placeables-toggle" checked />
        <span class="toggle-slider"></span>
        <span class="toggle-label">Instanced Placeables</span>
      </label>
      <div id="placeable-metrics" class="small-text" style="margin-top:0.25rem;">Placeables: (inactive)</div>
    </div>
    <div class="setting-item" style="margin-top:0.5rem;">
      <label style="display:flex;flex-direction:column;gap:4px;">
  <span style="font-size:12px;opacity:0.85;">Camera Pitch (0°=Top Down, 90°=Horizon)</span>
  <input type="range" id="iso-pitch-slider" min="0" max="90" step="0.25" value="30" />
  <span id="iso-pitch-value" class="small-text">30.00° (internal 60.00°)</span>
  <div class="small-text" id="iso-pitch-ratio" style="opacity:0.75;margin-top:2px;">ratio: (n/a)</div>
      </label>
    </div>
    <div class="setting-item" style="margin-top:0.25rem;">
      <label style="display:flex;flex-direction:column;gap:4px;">
        <span style="font-size:12px;opacity:0.85;">Iso Yaw (deg)</span>
        <input type="range" id="iso-yaw-slider" min="0" max="360" step="1" value="45" />
        <span id="iso-yaw-value" class="small-text">45°</span>
      </label>
    </div>
    <div class="setting-item" style="margin-top:0.25rem;display:flex;flex-direction:column;gap:4px;">
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <button id="iso-match-2d" style="padding:4px 8px;font-size:12px;">Match 2D Grid</button>
        <button id="pitch-topdown" style="padding:4px 8px;font-size:12px;">Top Down</button>
      </div>
      <div class="small-text" style="opacity:0.75;">Match 2D = aspect solver, Top Down = ~90° (orthographic overhead)</div>
    </div>
  `;

  // Insert after existing Display Options section (first section) if possible
  const firstSection = settingsPanel.querySelector('.section');
  if (firstSection && firstSection.nextSibling) {
    firstSection.parentNode.insertBefore(section, firstSection.nextSibling);
  } else {
    settingsPanel.appendChild(section);
  }

  // Wire events
  const isoToggle = el('iso-camera-toggle');
  isoToggle.addEventListener('change', async () => {
    try {
      if (!window.gameManager) return;
      if (!window.gameManager.is3DModeActive?.()) {
        // Do NOT auto enable hybrid; revert checkbox and inform user.
        isoToggle.checked = false;
        const warn = el('iso-warn');
        if (warn) {
          warn.style.display = 'block';
          setTimeout(() => {
            if (warn) warn.style.display = 'none';
          }, 2500);
        }
        logger.log(
          LOG_LEVEL.WARN,
          'Enable 3D Hybrid before toggling isometric camera preset',
          LOG_CATEGORY.USER
        );
        return;
      }
      // Only adjust camera if hybrid already active; don't change grid visibility.
      await window.gameManager.setIsometricCamera(isoToggle.checked, { autoEnableHybrid: false });
      if (isoToggle.checked) {
        try {
          const mgr = window.gameManager.threeSceneManager;
          if (mgr && mgr._isoPitch != null && pitchSlider) {
            const deg = (mgr._isoPitch * 180) / Math.PI;
            pitchSlider.value = String(deg.toFixed(1));
            updatePitchDisplay(deg);
          }
        } catch (_) {
          /* ignore */
        }
      }
      logger.log(
        LOG_LEVEL.INFO,
        `Isometric camera ${isoToggle.checked ? 'enabled' : 'disabled'}`,
        LOG_CATEGORY.USER
      );
    } catch (e) {
      logger.log(LOG_LEVEL.ERROR, 'Failed to toggle isometric camera', LOG_CATEGORY.ERROR, {
        error: e?.message,
      });
    }
  });

  const bootstrapToggle = el('bootstrap-grid-toggle');
  bootstrapToggle.addEventListener('change', () => {
    const mgr = ensureHybrid();
    if (!mgr) return;
    mgr.setBootstrapGridVisible(bootstrapToggle.checked);
  });

  const pixiToggle = el('pixi-grid-toggle');
  pixiToggle.addEventListener('change', () => {
    const gm = window.gameManager;
    if (!gm) return;
    if (gm.threeSceneManager) {
      gm.threeSceneManager.setPixiGridVisible(pixiToggle.checked);
    }
  });

  const instToggle = el('instanced-placeables-toggle');
  instToggle.addEventListener('change', async () => {
    try {
      if (!window.gameManager) return;
      if (instToggle.checked) {
        // Ensure hybrid first
        if (!window.gameManager.is3DModeActive?.()) {
          await window.gameManager.enableHybridRender();
        }
        window.gameManager.enableInstancedPlaceables();
        updatePlaceableMetrics();
        logger.log(LOG_LEVEL.INFO, 'Instanced placeables enabled via settings', LOG_CATEGORY.USER);
      } else {
        // Disable path: dispose pool and clear metrics
        try {
          window.gameManager.disableInstancedPlaceables?.();
        } catch (_) {
          /* ignore */
        }
        updatePlaceableMetrics();
        logger.log(LOG_LEVEL.INFO, 'Instanced placeables disabled via settings', LOG_CATEGORY.USER);
      }
    } catch (e) {
      logger.log(LOG_LEVEL.ERROR, 'Failed enabling instanced placeables', LOG_CATEGORY.ERROR, {
        error: e?.message,
      });
    }
  });

  // Passive metrics update loop (every 1s)
  function metricsLoop() {
    updatePlaceableMetrics();
    setTimeout(metricsLoop, 1000);
  }
  metricsLoop();

  // --- Pitch & Yaw Controls ---
  const pitchSlider = el('iso-pitch-slider');
  const pitchValue = el('iso-pitch-value');
  const pitchRatio = el('iso-pitch-ratio');
  const yawSlider = el('iso-yaw-slider');
  const yawValue = el('iso-yaw-value');
  // Removed parity/auto-tune/raw controls

  async function ensureIsoEnabled({ requireIso = true } = {}) {
    const gm = window.gameManager;
    if (!gm) return null;
    if (!gm.is3DModeActive?.()) return null; // do not auto enable
    if (!gm.threeSceneManager) return null;
    if (requireIso && !gm.threeSceneManager._isoMode) return null;
    return gm.threeSceneManager;
  }

  function updatePitchDisplay(uiVal) {
    const uiNum = Number(uiVal);
    const internalDeg = 90 - uiNum;
    if (pitchValue)
      pitchValue.textContent = `${uiNum.toFixed(2)}° (internal ${internalDeg.toFixed(2)}°)`;
    try {
      const mgr = ensureHybrid();
      if (mgr && mgr.measureTileStepPixels && mgr._isoMode) {
        const m = mgr.measureTileStepPixels();
        if (m && pitchRatio) {
          pitchRatio.textContent = `ratio: ${(m.ratio || 0).toFixed(3)} (dy/dx)`;
        }
      }
    } catch (_) {
      /* ignore */
    }
  }
  function updateYawDisplay(val) {
    if (yawValue) yawValue.textContent = `${Math.round(val)}°`;
  }

  function refreshParityDisplay() {
    /* parity removed */
  }

  let lastAppliedPitch = null;
  const applyPitch = async (val) => {
    // We allow pitch changes whenever hybrid 3D is active, regardless of iso mode.
    const mgr = ensureHybrid();
    if (!mgr) return; // hybrid not active
    const uiDeg = parseFloat(val);
    if (!Number.isFinite(uiDeg)) return;
    if (lastAppliedPitch !== null && Math.abs(lastAppliedPitch - uiDeg) < 0.05) return; // skip tiny duplicate (UI space)
    lastAppliedPitch = uiDeg;
    const internalDeg = 90 - uiDeg; // convert to angle above ground plane
    if (mgr._isoMode) mgr.setIsoPitchDegrees(internalDeg);
    else if (mgr.setCameraPitchDegrees) mgr.setCameraPitchDegrees(internalDeg);
    else mgr.setIsoPitchDegrees(internalDeg);
    mgr.reframe();
    try {
      if (window.__TT_PITCH_DEBUG__) {
        window.__TT_PITCH_DEBUG__.sliderAppliedUIDeg = uiDeg;
        window.__TT_PITCH_DEBUG__.sliderAppliedInternalDeg = internalDeg;
        window.__TT_PITCH_DEBUG__.timestamp = performance.now();
      }
    } catch (_) {
      /* ignore */
    }
    setTimeout(refreshParityDisplay, 25);
  };
  pitchSlider?.addEventListener('input', async () => {
    updatePitchDisplay(pitchSlider.value);
    applyPitch(pitchSlider.value);
  });
  pitchSlider?.addEventListener('change', async () => {
    updatePitchDisplay(pitchSlider.value);
    applyPitch(pitchSlider.value);
    setTimeout(() => {
      refreshParityDisplay();
      updatePitchDisplay(pitchSlider.value);
    }, 40);
  });
  const matchBtn = el('iso-match-2d');
  const topDownBtn = el('pitch-topdown');
  matchBtn?.addEventListener('click', async () => {
    const mgr = await ensureIsoEnabled();
    if (!mgr) return;
    try {
      const targetRatio = window.gameManager.tileHeight / window.gameManager.tileWidth;
      const result = mgr.solveIsoPitchForTargetRatio(targetRatio, {
        minDeg: 5,
        maxDeg: 80,
        iterations: 60,
      });
      if (result && result.bestDeg) {
        if (pitchSlider) pitchSlider.value = String(result.bestDeg.toFixed(2));
        updatePitchDisplay(result.bestDeg);
        refreshParityDisplay();
      } else if (pitchRatio) {
        pitchRatio.textContent = 'ratio: solve failed';
      }
    } catch (e) {
      if (pitchRatio) pitchRatio.textContent = 'ratio: error';
    }
  });

  topDownBtn?.addEventListener('click', async () => {
    const mgr = ensureHybrid();
    if (!mgr) return;
    const internal = 89.9; // near top-down internally
    if (mgr.setCameraPitchDegrees) mgr.setCameraPitchDegrees(internal, { lock: true });
    else mgr.setIsoPitchDegrees(internal);
    const uiDeg = 90 - internal;
    if (pitchSlider) pitchSlider.value = String(uiDeg.toFixed(2));
    updatePitchDisplay(uiDeg);
  });

  yawSlider?.addEventListener('input', () => updateYawDisplay(yawSlider.value));
  yawSlider?.addEventListener('change', async () => {
    const mgr = await ensureIsoEnabled();
    if (!mgr) return;
    const yawRad = (parseFloat(yawSlider.value) * Math.PI) / 180;
    mgr.setIsoAngles({ yaw: yawRad });
    mgr.reframe();
    setTimeout(refreshParityDisplay, 30);
  });

  // Removed auto-tune & raw mode listeners.

  // (Removed automatic initial auto-tune to preserve 28° baseline; user can press button manually.)

  // Initialize sliders from current camera if present
  try {
    const mgr = ensureHybrid();
    if (mgr) {
      const internalDeg = (mgr._isoPitch * 180) / Math.PI;
      const uiDeg = 90 - internalDeg;
      if (pitchSlider) {
        pitchSlider.value = String(uiDeg.toFixed(1));
        updatePitchDisplay(uiDeg);
      }
      // raw toggle removed
      if (yawSlider) {
        const yawDeg = (mgr._isoYaw * 180) / Math.PI;
        yawSlider.value = String(Math.round(yawDeg));
        updateYawDisplay(yawDeg);
      }
      setTimeout(refreshParityDisplay, 50);
    }
  } catch (_) {
    /* ignore init errors */
  }
}

// Integrate after window load so base DOM exists
window.addEventListener('load', () => {
  try {
    attach3DControls();
  } catch (_) {
    /* ignore */
  }
});

export { attach3DControls };
