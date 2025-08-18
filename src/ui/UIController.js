/**
 * UIController.js
 * Handles UI interactions and initialization for TavernTable
 * 
 * This module manages all user interface interactions that were previously
 * defined inline in the HTML. It provides clean separation between the
 * game logic and UI control, making the code more maintainable and testable.
 * 
 * Key Features:
 * - Collapsible panel management
 * - Grid resizing controls  
 * - Zoom reset functionality
 * - Game initialization coordination
 * - Global function exposure for HTML compatibility
 * 
 * @module UIController
 * @version 1.0.0
 */

import GameManager from '../core/GameManager.js';
import { GRID_CONFIG } from '../config/GameConstants.js';
import { logger, LOG_LEVEL, LOG_CATEGORY } from '../utils/Logger.js';
import { ErrorHandler, ERROR_SEVERITY, ERROR_CATEGORY } from '../utils/ErrorHandler.js';
import { Sanitizers, GameValidators } from '../utils/Validation.js';
import {
  getCreatureButtons,
  getFacingButton,
  getTerrainToolButtons,
  getGridSizeInputs,
  getTerrainResetButton,
  getElevationScaleControls,
  getBrushSizeDisplay,
  getSpriteAdjustLogEl,
  getCreaturePanelEls,
  getTerrainModeEls,
  getAutoApplyButton
} from './domHelpers.js';
import { getCurrentSpriteKey } from './lib/spriteKeys.js';
import { computeElevationVisualOffset } from './lib/elevationUtils.js';

/**
 * Toggle the visibility of the creature tokens panel
 * Manages the collapsible state and arrow indicator
 */
function toggleCreatureTokens() {
  try {
    const { contentEl: content, arrowEl: arrow } = getCreaturePanelEls();

    // Validate DOM elements
    const contentValidation = GameValidators.domElement(content, 'div');
    if (!contentValidation.isValid) {
      throw new Error(`Content panel validation failed: ${contentValidation.getErrorMessage()}`);
    }

    // Toggle visibility
    const isHidden = content.style.display === 'none';
    content.style.display = isHidden ? 'block' : 'none';

    // Update arrow indicator if present
    if (arrow) {
      arrow.textContent = isHidden ? '▼' : '▶';
    }

  } catch (error) {
    new ErrorHandler().handle(error, ERROR_SEVERITY.LOW, ERROR_CATEGORY.INPUT, {
      context: 'toggleCreatureTokens',
      stage: 'ui_toggle',
      elementIds: ['creature-content', 'creature-arrow'],
      uiAction: 'panel_visibility_toggle'
    });
  }
}

// selector helpers moved to domHelpers.js

/**
 * Resize the game grid based on user input
 * Validates input values and delegates to GameManager for actual resizing
 */
function resizeGrid() {
  try {
    // Validate GameManager availability
    if (!window.gameManager) {
      throw new Error('Game is still loading. Please wait a moment and try again.');
    }

    if (!window.gameManager.resizeGrid) {
      throw new Error('Grid resize feature is not available.');
    }

    // Get and validate input elements
    const { widthInput, heightInput } = getGridSizeInputs();

    const widthValidation = GameValidators.domElement(widthInput, 'input');
    const heightValidation = GameValidators.domElement(heightInput, 'input');

    if (!widthValidation.isValid || !heightValidation.isValid) {
      throw new Error('Grid resize input elements not found or invalid.');
    }

    // Sanitize and validate input values
    const newWidth = Sanitizers.integer(widthInput.value, GRID_CONFIG.DEFAULT_COLS, {
      min: GRID_CONFIG.MIN_COLS,
      max: GRID_CONFIG.MAX_COLS
    });

    const newHeight = Sanitizers.integer(heightInput.value, GRID_CONFIG.DEFAULT_ROWS, {
      min: GRID_CONFIG.MIN_ROWS,
      max: GRID_CONFIG.MAX_ROWS
    });

    // Perform grid resize
    window.gameManager.resizeGrid(newWidth, newHeight);

  } catch (error) {
    new ErrorHandler().handle(error, ERROR_SEVERITY.MEDIUM, ERROR_CATEGORY.INPUT, {
      context: 'resizeGrid',
      stage: 'grid_resize_validation',
      inputValues: {
        width: getGridSizeInputs().widthInput?.value,
        height: getGridSizeInputs().heightInput?.value
      },
      constraints: {
        minWidth: GRID_CONFIG.MIN_COLS,
        maxWidth: GRID_CONFIG.MAX_COLS,
        minHeight: GRID_CONFIG.MIN_ROWS,
        maxHeight: GRID_CONFIG.MAX_ROWS
      }
    });
  }
}

/**
 * Reset the grid zoom to default scale and center the view
 * Provides user-friendly zoom reset functionality
 */
function resetZoom() {
  try {
    if (!window.gameManager) {
      throw new Error('Game manager not available');
    }

    if (!window.gameManager.resetZoom) {
      throw new Error('Reset zoom feature not available');
    }

    window.gameManager.resetZoom();
  } catch (error) {
    new ErrorHandler().handle(error, ERROR_SEVERITY.MEDIUM, ERROR_CATEGORY.RENDERING, {
      context: 'resetZoom',
      stage: 'zoom_reset_operation',
      gameManagerAvailable: !!window.gameManager,
      resetZoomAvailable: !!(window.gameManager?.resetZoom)
    });
  }
}

// === TERRAIN CONTROL FUNCTIONS ===

/**
 * Toggle terrain modification mode on/off
 */
function toggleTerrainMode() {
  try {
    const { toggleEl: terrainToggle, toolsEl: terrainTools } = getTerrainModeEls();

    if (!terrainToggle || !terrainTools) {
      throw new Error('Terrain UI elements not found');
    }

    const isEnabled = terrainToggle.checked;

    // Show/hide terrain tools
    terrainTools.style.display = isEnabled ? 'block' : 'none';

    // Enable/disable terrain mode in game
    if (window.gameManager) {
      if (isEnabled) {
        window.gameManager.enableTerrainMode();
      } else {
        window.gameManager.disableTerrainMode();
      }
    }

    logger.log(LOG_LEVEL.INFO, 'Terrain mode toggled', LOG_CATEGORY.USER, {
      context: 'toggleTerrainMode',
      terrainModeEnabled: isEnabled,
      gameManagerAvailable: !!window.gameManager
    });

  } catch (error) {
    new ErrorHandler().handle(error, ERROR_SEVERITY.MEDIUM, ERROR_CATEGORY.INPUT, {
      context: 'toggleTerrainMode',
      stage: 'terrain_mode_toggle',
      gameManagerAvailable: !!window.gameManager
    });
  }
}

/**
 * Attach event listeners replacing legacy inline onclick globals
 * Called after DOMContentLoaded and gameManager initialization
 */
function attachDynamicUIHandlers() {
  try {
    if (!window.gameManager) return;

    // Token buttons (data-token attribute or legacy id naming)
    const tokenButtons = getCreatureButtons();
    tokenButtons.forEach(btn => {
      if (btn.dataset.boundTokenHandler) return; // avoid duplicate
      const id = btn.id.replace('token-', '');
      btn.addEventListener('click', () => {
        if (id === 'remove') {
          window.gameManager.selectToken('remove');
        } else {
          window.gameManager.selectToken(id);
        }
      });
      btn.dataset.boundTokenHandler = 'true';
    });

    // Facing button
    const facingBtn = getFacingButton();
    if (facingBtn && !facingBtn.dataset.boundFacingHandler) {
      facingBtn.addEventListener('click', () => window.gameManager.toggleFacing());
      facingBtn.dataset.boundFacingHandler = 'true';
    }

    // Terrain tool buttons
    const { raiseBtn, lowerBtn } = getTerrainToolButtons();
    if (raiseBtn && !raiseBtn.dataset.boundTerrainHandler) {
      raiseBtn.addEventListener('click', () => window.gameManager.setTerrainTool('raise'));
      raiseBtn.dataset.boundTerrainHandler = 'true';
    }
    if (lowerBtn && !lowerBtn.dataset.boundTerrainHandler) {
      lowerBtn.addEventListener('click', () => window.gameManager.setTerrainTool('lower'));
      lowerBtn.dataset.boundTerrainHandler = 'true';
    }

    // Terrain reset
    const resetTerrainBtn = getTerrainResetButton();
    if (resetTerrainBtn && !resetTerrainBtn.dataset.boundResetHandler) {
      // Use global resetTerrain wrapper to preserve confirmation & logging
      resetTerrainBtn.addEventListener('click', () => {
        if (typeof window.resetTerrain === 'function') {
          window.resetTerrain();
        } else if (window.gameManager?.resetTerrain) {
          // Fallback if wrapper not yet defined
          window.gameManager.resetTerrain();
        }
      });
      resetTerrainBtn.dataset.boundResetHandler = 'true';
    }

    // Elevation perception slider (debounced to reduce log/render spam during drag)
    const { slider: elevSlider, valueEl: elevValue } = getElevationScaleControls();
    if (elevSlider && !elevSlider.dataset.boundElevHandler) {
      const DEBOUNCE_MS = 120;
      let debounceId = null;
      const updateDisplay = (val) => {
        if (elevValue) elevValue.textContent = `${val} px/level`;
      };
      const applyScale = (val) => {
        if (window.gameManager?.terrainCoordinator?.setElevationScale) {
          window.gameManager.terrainCoordinator.setElevationScale(Number(val));
        }
      };
      elevSlider.addEventListener('input', (e) => {
        const val = e.target.value;
        updateDisplay(val);
        if (debounceId) clearTimeout(debounceId);
        debounceId = setTimeout(() => applyScale(val), DEBOUNCE_MS);
      });
      elevSlider.addEventListener('change', (e) => {
        const val = e.target.value;
        updateDisplay(val);
        if (debounceId) clearTimeout(debounceId);
        applyScale(val);
      });
      // Initialize from current config if available
      try {
        const current = window.gameManager?.terrainCoordinator?.getElevationScale?.();
        if (Number.isFinite(current)) {
          elevSlider.value = String(current);
          updateDisplay(current);
        }
      } catch { /* ignore getElevationScale failure */ }
      elevSlider.dataset.boundElevHandler = 'true';
    }

    // Ensure brush size label reflects current state on load
    try { updateBrushSizeDisplay(); } catch (_) { /* non-fatal UI update */ }

    logger.debug('Dynamic UI handlers attached');
  } catch (error) {
    new ErrorHandler().handle(error, ERROR_SEVERITY.LOW, ERROR_CATEGORY.UI, {
      context: 'attachDynamicUIHandlers'
    });
  }
}

// Attach after DOM ready & when game manager exists
document.addEventListener('DOMContentLoaded', () => {
  if (window.gameManager) {
    attachDynamicUIHandlers();
  } else {
    // Poll briefly until gameManager set by StateCoordinator
    const interval = setInterval(() => {
      if (window.gameManager) {
        clearInterval(interval);
        attachDynamicUIHandlers();
      }
    }, 100);
    setTimeout(() => clearInterval(interval), 5000); // stop after 5s
  }
});

/**
 * Set the active terrain tool
 * @param {string} tool - Tool name ('raise' or 'lower')
 */
function setTerrainTool(tool) {
  try {
    if (!window.gameManager) {
      throw new Error('Game is still loading. Please wait a moment and try again.');
    }

    // Update tool in game manager
    window.gameManager.setTerrainTool(tool);

    // Update UI button states
    const { raiseBtn, lowerBtn } = getTerrainToolButtons();

    if (raiseBtn && lowerBtn) {
      // Remove active class from all buttons
      raiseBtn.classList.remove('active');
      lowerBtn.classList.remove('active');

      // Add active class to selected tool
      if (tool === 'raise') {
        raiseBtn.classList.add('active');
      } else if (tool === 'lower') {
        lowerBtn.classList.add('active');
      }
    }

    logger.log(LOG_LEVEL.DEBUG, 'Terrain tool selected', LOG_CATEGORY.USER, {
      context: 'setTerrainTool',
      selectedTool: tool,
      uiUpdated: !!(raiseBtn && lowerBtn)
    });

  } catch (error) {
    new ErrorHandler().handle(error, ERROR_SEVERITY.MEDIUM, ERROR_CATEGORY.INPUT, {
      context: 'setTerrainTool',
      stage: 'terrain_tool_selection',
      requestedTool: tool,
      gameManagerAvailable: !!window.gameManager
    });
  }
}

/**
 * Increase brush size for terrain tools
 */
function increaseBrushSize() {
  try {
    if (!window.gameManager || !window.gameManager.terrainCoordinator) {
      throw new Error('Terrain system not available');
    }

    // Increase brush size in game
    window.gameManager.terrainCoordinator.increaseBrushSize();

    // Update UI display
    updateBrushSizeDisplay();

  } catch (error) {
    new ErrorHandler().handle(error, ERROR_SEVERITY.LOW, ERROR_CATEGORY.INPUT, {
      context: 'increaseBrushSize',
      stage: 'brush_size_increase',
      terrainCoordinatorAvailable: !!(window.gameManager?.terrainCoordinator)
    });
  }
}

/**
 * Decrease brush size for terrain tools
 */
function decreaseBrushSize() {
  try {
    if (!window.gameManager || !window.gameManager.terrainCoordinator) {
      throw new Error('Terrain system not available');
    }

    // Decrease brush size in game
    window.gameManager.terrainCoordinator.decreaseBrushSize();

    // Update UI display
    updateBrushSizeDisplay();

  } catch (error) {
    new ErrorHandler().handle(error, ERROR_SEVERITY.LOW, ERROR_CATEGORY.INPUT, {
      context: 'decreaseBrushSize',
      stage: 'brush_size_decrease',
      terrainCoordinatorAvailable: !!(window.gameManager?.terrainCoordinator)
    });
  }
}

/**
 * Update brush size display in UI
 */
function updateBrushSizeDisplay() {
  try {
    const brushDisplay = getBrushSizeDisplay();
    if (!brushDisplay) {
      return;
    }

    if (window.gameManager && window.gameManager.terrainCoordinator) {
      const brushSize = window.gameManager.terrainCoordinator.brushSize;
      brushDisplay.textContent = `${brushSize}x${brushSize}`;
    }

  } catch (error) {
    logger.debug('Failed to update brush size display', {
      error: error.message
    }, LOG_CATEGORY.UI);
  }
}

/**
 * Reset all terrain to default height
 */
function resetTerrain() {
  try {
    if (!window.gameManager) {
      throw new Error('Game is still loading. Please wait a moment and try again.');
    }

    // Confirm with user before resetting
    if (confirm('Are you sure you want to reset all terrain to default height? This action cannot be undone.')) {
      window.gameManager.resetTerrain();

      logger.log(LOG_LEVEL.INFO, 'Terrain reset by user', LOG_CATEGORY.USER, {
        context: 'resetTerrain',
        stage: 'terrain_reset_complete'
      });
    }

  } catch (error) {
    new ErrorHandler().handle(error, ERROR_SEVERITY.MEDIUM, ERROR_CATEGORY.INPUT, {
      context: 'resetTerrain',
      stage: 'terrain_reset',
      gameManagerAvailable: !!window.gameManager
    });
  }
}

/**
 * Initialize the application when the page loads
 * Sets up the game manager and handles any initialization errors
 */
async function initializeApplication() {
  try {
    // Validate gameManager exists
    if (!window.gameManager) {
      throw new Error('GameManager not found. Application cannot start.');
    }

    // Initialize the game manager
    await window.gameManager.initialize();

  } catch (error) {
    new ErrorHandler().handle(error, ERROR_SEVERITY.CRITICAL, ERROR_CATEGORY.INITIALIZATION, {
      context: 'initializeApplication',
      stage: 'application_startup',
      timestamp: new Date().toISOString(),
      gameManagerAvailable: !!window.gameManager,
      initializationFailed: true
    });
  }
}

/**
 * Create and configure the global GameManager instance
 * This provides the main application controller
 */
function createGameManager() {
  try {
    const gameManager = new GameManager();
    window.gameManager = gameManager;
    return gameManager;
  } catch (error) {
    new ErrorHandler().handle(error, ERROR_SEVERITY.CRITICAL, ERROR_CATEGORY.INITIALIZATION, {
      context: 'createGameManager',
      stage: 'game_manager_instantiation',
      errorType: error.constructor.name,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
}

// Initialize the game manager and set up event listeners
const gameManager = createGameManager();

logger.log(LOG_LEVEL.DEBUG, 'GameManager created successfully', LOG_CATEGORY.SYSTEM, {
  gameManagerType: gameManager.constructor.name,
  globallyAvailable: !!window.gameManager,
  timestamp: new Date().toISOString()
});

// Make functions available globally for HTML onclick handlers (backward compatibility)
window.toggleCreatureTokens = toggleCreatureTokens;
window.resizeGrid = resizeGrid;
window.resetZoom = resetZoom;
window.toggleTerrainMode = toggleTerrainMode;
window.setTerrainTool = setTerrainTool;
window.increaseBrushSize = increaseBrushSize;
window.decreaseBrushSize = decreaseBrushSize;
window.resetTerrain = resetTerrain;

// === SPRITE ADJUSTMENT SYSTEM ===
const spriteAdjustState = {
  baselineCaptured: false,
  baseline: { x: 0, y: 0 },
  totalOffset: { x: 0, y: 0 },
  appliedElevationOffset: 0,
  initialPlacementLogged: false,
  lastSpriteId: null
};

function getSelectedCreatureSprite() {
  if (!window.gameManager) return null;
  const tokens = window.gameManager.placedTokens;
  if (!tokens || tokens.length === 0) return null;
  const selectedType = window.gameManager.selectedTokenType;
  let candidate = [...tokens].reverse().find(t => t.type === selectedType);
  if (!candidate) candidate = tokens[tokens.length - 1];
  if (candidate && candidate.creature && candidate.creature.sprite) {
    const sprite = candidate.creature.sprite;
    sprite._gridRef = { gridX: candidate.gridX, gridY: candidate.gridY };
    if (!sprite._spriteAdjustId) sprite._spriteAdjustId = Math.random().toString(36).slice(2);
    // If new sprite selected, reset state (log preserved until explicitly cleared)
    if (spriteAdjustState.lastSpriteId !== sprite._spriteAdjustId) {
      spriteAdjustState.baselineCaptured = false;
      spriteAdjustState.totalOffset = { x: 0, y: 0 };
      spriteAdjustState.initialPlacementLogged = false;
      spriteAdjustState.lastSpriteId = sprite._spriteAdjustId;
    }
  }
  return candidate?.creature?.sprite || null;
}

function captureSpriteBaseline() {
  const sprite = getSelectedCreatureSprite();
  const logEl = getSpriteAdjustLogEl();
  if (!sprite || !logEl) return;
  if (!spriteAdjustState.initialPlacementLogged) {
    logEl.textContent += `Original placement at (${sprite.x.toFixed(1)}, ${sprite.y.toFixed(1)})\n`;
    spriteAdjustState.initialPlacementLogged = true;
  }
  spriteAdjustState.baselineCaptured = true;
  spriteAdjustState.baseline = { x: sprite.x, y: sprite.y };
  spriteAdjustState.totalOffset = { x: 0, y: 0 };
  const elev = getSpriteElevation(sprite);
  spriteAdjustState.appliedElevationOffset = computeElevationVisualOffset(elev);
  logEl.textContent += `Baseline captured at (${sprite.x.toFixed(1)}, ${sprite.y.toFixed(1)}) elevation=${elev} elevOffset=${spriteAdjustState.appliedElevationOffset}\n`;
}

function nudgeSelectedSprite(dx, dy) {
  const sprite = getSelectedCreatureSprite();
  const logEl = getSpriteAdjustLogEl();
  if (!sprite || !logEl) return;
  if (!spriteAdjustState.initialPlacementLogged) {
    logEl.textContent += `Original placement at (${sprite.x.toFixed(1)}, ${sprite.y.toFixed(1)})\n`;
    spriteAdjustState.initialPlacementLogged = true;
  }
  if (!spriteAdjustState.baselineCaptured) {
    captureSpriteBaseline();
  }
  sprite.x += dx;
  sprite.y += dy;
  spriteAdjustState.totalOffset.x += dx;
  spriteAdjustState.totalOffset.y += dy;
  const off = spriteAdjustState.totalOffset;
  const elev = getSpriteElevation(sprite);
  const base = spriteAdjustState.baseline;
  logEl.textContent += `Nudge (${dx},${dy}) => now (${sprite.x.toFixed(1)}, ${sprite.y.toFixed(1)}) totalΔ=(${off.x},${off.y}) from baseline (${base.x.toFixed(1)}, ${base.y.toFixed(1)}) elev=${elev}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

// Elevation utilities (simple height-based vertical adjustment preview)
function getSpriteElevation(sprite) {
  try {
    if (!sprite || !sprite._gridRef || !window.gameManager) return 0;
    const { gridX, gridY } = sprite._gridRef;
    return window.gameManager.getTerrainHeight ? window.gameManager.getTerrainHeight(gridX, gridY) : 0;
  } catch { return 0; }
}

// computeElevationVisualOffset moved to ./lib/elevationUtils.js

// API to auto-adjust all sprites after terrain tweaks (future extension)
function applyElevationOffsetsToTokens() {
  if (!window.gameManager) return;
  const tokens = window.gameManager.placedTokens || [];
  tokens.forEach(t => {
    const sprite = t.creature?.sprite;
    if (!sprite) return;
    const elev = window.gameManager.getTerrainHeight ? window.gameManager.getTerrainHeight(t.gridX, t.gridY) : 0;
    const offset = computeElevationVisualOffset(elev);
    // Only adjust Y to avoid lateral drift
    sprite.y = sprite.y + offset;
  });
}

window.applyElevationOffsetsToTokens = applyElevationOffsetsToTokens;

// ---------------- Sprite Offset Persistence & Auto-Apply ----------------
// getCurrentSpriteKey moved to ./lib/spriteKeys.js

function ensureSpriteAdjustExtendedState() {
  // Extend existing state object without needing to locate original declaration
  spriteAdjustState.savedOffsets = spriteAdjustState.savedOffsets || {}; // key -> {x,y}
  if (typeof spriteAdjustState.autoApply !== 'boolean') spriteAdjustState.autoApply = false;
}

function saveSpriteOffset() {
  const sprite = getSelectedCreatureSprite();
  const logEl = getSpriteAdjustLogEl();
  if (!sprite || !logEl) return;
  ensureSpriteAdjustExtendedState();
  if (!spriteAdjustState.baselineCaptured) {
    // Capture baseline implicitly so totalOffset is meaningful
    captureSpriteBaseline();
  }
  const key = getCurrentSpriteKey(sprite);
  if (!key) return;
  const off = { ...spriteAdjustState.totalOffset };
  spriteAdjustState.savedOffsets[key] = off;
  logEl.textContent += `Saved offset for [${key}] Δ=(${off.x},${off.y})\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

function resetSpriteOffset() {
  const sprite = getSelectedCreatureSprite();
  const logEl = getSpriteAdjustLogEl();
  if (!sprite || !logEl) return;
  ensureSpriteAdjustExtendedState();
  const key = getCurrentSpriteKey(sprite);
  if (!key) return;
  if (spriteAdjustState.savedOffsets[key]) {
    delete spriteAdjustState.savedOffsets[key];
    logEl.textContent += `Reset saved offset for [${key}]\n`;
    logEl.scrollTop = logEl.scrollHeight;
  }
}

function toggleAutoApplyOffsets() {
  ensureSpriteAdjustExtendedState();
  spriteAdjustState.autoApply = !spriteAdjustState.autoApply;
  const btn = getAutoApplyButton();
  if (btn) btn.textContent = `⚡ Auto Apply: ${spriteAdjustState.autoApply ? 'On' : 'Off'}`;
  const logEl = getSpriteAdjustLogEl();
  if (logEl) {
    logEl.textContent += `Auto-Apply ${spriteAdjustState.autoApply ? 'ENABLED' : 'DISABLED'}\n`;
    logEl.scrollTop = logEl.scrollHeight;
  }
}

function applySavedOffsetToSprite(sprite, silent = false) {
  ensureSpriteAdjustExtendedState();
  if (!sprite) return;
  const key = getCurrentSpriteKey(sprite);
  if (!key) return;
  const saved = spriteAdjustState.savedOffsets && spriteAdjustState.savedOffsets[key];
  if (saved) {
    sprite.x += saved.x;
    sprite.y += saved.y;
    if (!silent) {
      const logEl = getSpriteAdjustLogEl();
      if (logEl) {
        logEl.textContent += `Applied saved offset for [${key}] Δ=(${saved.x},${saved.y}) now=(${sprite.x.toFixed(1)},${sprite.y.toFixed(1)})\n`;
        logEl.scrollTop = logEl.scrollHeight;
      }
    }
  }
}

function installSpriteOffsetAutoApplyHook() {
  ensureSpriteAdjustExtendedState();
  if (spriteAdjustState._autoApplyHookInstalled) return;
  if (!window.gameManager || !window.gameManager.tokenManager) return;
  const tm = window.gameManager.tokenManager;
  // Heuristic: wrap a common placement method if it exists
  const candidateFnName = ['placeToken', 'finalizeTokenPlacement', 'addPlacedToken'].find(n => typeof tm[n] === 'function');
  if (!candidateFnName) return;
  const original = tm[candidateFnName];
  if (original._wrappedForAutoApply) return; // already wrapped
  tm[candidateFnName] = function (...args) {
    const result = original.apply(this, args);
    try {
      if (spriteAdjustState.autoApply) {
        // Attempt to locate sprite from result or args
        let token = result;
        if (!token) {
          // search last placed token list
          const list = window.gameManager.placedTokens || [];
          token = list[list.length - 1];
        }
        const sprite = token?.creature?.sprite;
        if (sprite) applySavedOffsetToSprite(sprite, true);
      }
    } catch (_) { /* ignore auto-apply errors */ }
    return result;
  };
  tm[candidateFnName]._wrappedForAutoApply = true;
  spriteAdjustState._autoApplyHookInstalled = true;
  const logEl = getSpriteAdjustLogEl();
  if (logEl) {
    logEl.textContent += `Installed auto-apply hook on TokenManager.${candidateFnName}\n`;
    logEl.scrollTop = logEl.scrollHeight;
  }
}

// Attempt hook installation repeatedly until tokenManager exists
setTimeout(function retryHook() {
  try { installSpriteOffsetAutoApplyHook(); } catch (_) { /* ignore install errors */ }
  if (!spriteAdjustState._autoApplyHookInstalled) setTimeout(retryHook, 800);
}, 800);

// Expose sprite adjustment globally
window.nudgeSelectedSprite = nudgeSelectedSprite;
window.captureSpriteBaseline = captureSpriteBaseline;
window.reapplySpriteOffsets = function () {
  if (!window.gameManager) return;
  const { placedTokens } = window.gameManager;
  if (!placedTokens) return;
  placedTokens.forEach(t => {
    const sprite = t.creature?.sprite;
    if (!sprite) return;
    // Reset to raw isometric center, then reapply configured offset and manual adjustments
    const iso = window.gameManager.gridToIsometric(t.gridX, t.gridY);
    sprite.x = iso.x;
    sprite.y = iso.y;
    const { getSpriteOffset } = window;
    if (getSpriteOffset) {
      const off = getSpriteOffset(t.type);
      sprite.x += off.dx;
      sprite.y += off.dy;
    }
  });
};
window.logInitialSpritePlacement = () => {
  const s = getSelectedCreatureSprite();
  const logEl = getSpriteAdjustLogEl();
  if (s && logEl && !spriteAdjustState.initialPlacementLogged) {
    logEl.textContent += `Original placement at (${s.x.toFixed(1)}, ${s.y.toFixed(1)})\n`;
    spriteAdjustState.initialPlacementLogged = true;
  }
};
window.saveSpriteOffset = saveSpriteOffset;
window.resetSpriteOffset = resetSpriteOffset;
window.toggleAutoApplyOffsets = toggleAutoApplyOffsets;
window.applySavedOffsetToSprite = applySavedOffsetToSprite;

logger.log(LOG_LEVEL.DEBUG, 'UI functions exposed globally', LOG_CATEGORY.SYSTEM, {
  exposedFunctions: [
    'toggleCreatureTokens',
    'resizeGrid',
    'resetZoom',
    'toggleTerrainMode',
    'setTerrainTool',
    'increaseBrushSize',
    'decreaseBrushSize',
    'resetTerrain'
  ],
  compatibilityMode: 'HTML_onclick_handlers'
});

// Signal that UI modules are loaded (for debugging module loading issues)
window.moduleLoadStatus = window.moduleLoadStatus || {};
window.moduleLoadStatus.loaded = true;

// Start the application when the page loads
window.addEventListener('load', initializeApplication);

// Export functions for ES6 module usage
export {
  toggleCreatureTokens,
  resizeGrid,
  resetZoom,
  toggleTerrainMode,
  setTerrainTool,
  increaseBrushSize,
  decreaseBrushSize,
  resetTerrain,
  initializeApplication
};
