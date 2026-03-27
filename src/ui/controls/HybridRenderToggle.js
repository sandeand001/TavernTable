// HybridRenderToggle.js - Phase 1 UI bridge for enabling 3D hybrid mode
// Adds a settings panel checkbox to invoke GameManager.enableHybridRender()
// and displays lightweight render stats (frame count & avg frame ms) when active.

import { logger, LOG_CATEGORY, LOG_LEVEL } from '../utils/Logger.js';

function formatStats(stats) {
  if (!stats) return '';
  const { degraded, degradeReason, frameCount, averageFrameMs } = stats;
  if (degraded) {
    const reason = degradeReason || 'Three.js unavailable';
    return `3D: Degraded (${reason})`;
  }
  return `3D: ${frameCount}f @ ${averageFrameMs.toFixed(2)}ms avg`;
}

function setHybridUnavailable(reason) {
  const message = reason || 'WebGL not supported on this device.';
  try {
    const statsEl = document.getElementById('hybrid-stats');
    if (statsEl) statsEl.textContent = `3D unavailable: ${message}`;
  } catch (_) {
    /* ignore */
  }
}

function handleHybridFailure(toggle, error) {
  try {
    const reasonFromManager = window.gameManager?.threeSceneManager?.degradeReason;
    const reason =
      error?.details?.reason || error?.message || reasonFromManager || 'WebGL not supported.';
    if (toggle) {
      toggle.checked = false;
      toggle.disabled = true;
      toggle.setAttribute('aria-disabled', 'true');
      toggle.title = reason;
    }
    setHybridUnavailable(reason);
    logger.log(LOG_LEVEL.WARN, 'Hybrid 3D mode unavailable', LOG_CATEGORY.SYSTEM, {
      reason,
    });
  } catch (_) {
    /* ignore */
  }
}

function updateStats() {
  try {
    const el = document.getElementById('hybrid-stats');
    if (!el) return;
    if (!window.gameManager || !window.gameManager.threeSceneManager) {
      el.textContent = '';
      return;
    }
    const stats = window.gameManager.threeSceneManager.getRenderStats();
    el.textContent = formatStats(stats);
  } catch (_) {
    /* ignore */
  }
}

function autoEnableHybridWithoutToggle(retries = 5) {
  try {
    if (!window.gameManager) {
      if (retries > 0) {
        setTimeout(() => autoEnableHybridWithoutToggle(retries - 1), 200);
      }
      return;
    }
    if (window.gameManager?.threeSceneManager?.degraded) {
      setHybridUnavailable(window.gameManager.threeSceneManager.degradeReason);
      return;
    }
    if (!window.gameManager.is3DModeActive?.()) {
      window.gameManager
        .enableHybridRender()
        .then(() => {
          logger.log(
            LOG_LEVEL.INFO,
            'Hybrid 3D mode auto-enabled (no toggle present)',
            LOG_CATEGORY.SYSTEM
          );
        })
        .catch((error) => {
          setHybridUnavailable(error?.message);
          logger.log(LOG_LEVEL.ERROR, 'Failed to enable hybrid render', LOG_CATEGORY.ERROR, {
            error: error?.message,
            source: 'autoEnableHybridWithoutToggle',
          });
        });
    }
  } catch (_) {
    /* ignore */
  }
}

function attachHybridToggle() {
  const toggle = document.getElementById('hybrid-render-toggle');
  if (!toggle) {
    autoEnableHybridWithoutToggle();
    return;
  }
  // Initialize checkbox state reflecting current mode
  try {
    if (window.gameManager?.threeSceneManager?.degraded) {
      handleHybridFailure(toggle, {
        details: { reason: window.gameManager.threeSceneManager.degradeReason },
      });
      return;
    }
    // Always default to checked (feature request: enable 3D Hybrid by default)
    toggle.checked = true;
    if (window.gameManager && !window.gameManager.is3DModeActive?.()) {
      // Kick off hybrid activation immediately (fire & forget)
      window.gameManager
        .enableHybridRender()
        .then(() => {
          logger.log(
            LOG_LEVEL.INFO,
            'Hybrid 3D mode auto-enabled on load (default ON)',
            LOG_CATEGORY.SYSTEM
          );
        })
        .catch((error) => {
          handleHybridFailure(toggle, error);
        });
    }
  } catch (_) {
    /* ignore */
  }
  toggle.addEventListener('change', async () => {
    try {
      if (toggle.disabled) return;
      if (!window.gameManager) return;
      if (toggle.checked && !window.gameManager.is3DModeActive?.()) {
        await window.gameManager.enableHybridRender();
        logger.log(LOG_LEVEL.INFO, 'Hybrid 3D mode enabled via UI toggle', LOG_CATEGORY.USER);
      }
      // (No direct disable yet; full revert path will arrive in later phase.)
    } catch (e) {
      handleHybridFailure(toggle, e);
      logger.log(LOG_LEVEL.ERROR, 'Failed to enable hybrid render', LOG_CATEGORY.ERROR, {
        error: e?.message,
      });
    }
  });

  // Stats updater loop (throttled ~2Hz)
  let last = 0;
  function statsLoop(ts) {
    if (ts - last > 500) {
      updateStats();
      last = ts;
    }
    requestAnimationFrame(statsLoop);
  }
  requestAnimationFrame(statsLoop);
}

// Delay until window load so GameManager and DOM exist
window.addEventListener('load', () => {
  try {
    attachHybridToggle();
  } catch (_) {
    /* ignore */
  }
});

window.addEventListener('tt-hybrid-degraded', (event) => {
  try {
    const toggle = document.getElementById('hybrid-render-toggle');
    if (!toggle) return;
    handleHybridFailure(toggle, { details: { reason: event?.detail?.reason } });
  } catch (_) {
    /* ignore */
  }
});

export { attachHybridToggle };
