// HybridRenderToggle.js - Phase 1 UI bridge for enabling 3D hybrid mode
// Adds a settings panel checkbox to invoke GameManager.enableHybridRender()
// and displays lightweight render stats (frame count & avg frame ms) when active.

import { logger, LOG_CATEGORY, LOG_LEVEL } from '../utils/Logger.js';

function formatStats(stats) {
  if (!stats) return '';
  const { degraded, frameCount, averageFrameMs } = stats;
  if (degraded) return '3D: Degraded (Three.js unavailable)';
  return `3D: ${frameCount}f @ ${averageFrameMs.toFixed(2)}ms avg`;
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

function attachHybridToggle() {
  const toggle = document.getElementById('hybrid-render-toggle');
  if (!toggle) return;
  // Initialize checkbox state reflecting current mode
  try {
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
        .catch(() => {
          /* non-fatal */
        });
    }
  } catch (_) {
    /* ignore */
  }
  toggle.addEventListener('change', async () => {
    try {
      if (!window.gameManager) return;
      if (toggle.checked && !window.gameManager.is3DModeActive?.()) {
        await window.gameManager.enableHybridRender();
        logger.log(LOG_LEVEL.INFO, 'Hybrid 3D mode enabled via UI toggle', LOG_CATEGORY.USER);
      }
      // (No direct disable yet; full revert path will arrive in later phase.)
    } catch (e) {
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

export { attachHybridToggle };
