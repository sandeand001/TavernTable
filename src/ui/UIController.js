import { isJest } from '../utils/env.js';
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
  getAutoApplyButton,
} from './domHelpers.js';
import { getDiceButtons, getGridActionButtons, getSpriteAdjustButtons } from './domHelpers.js';
import { rollDice } from '../systems/dice/dice.js';
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
      uiAction: 'panel_visibility_toggle',
    });
  }
}

//

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
      max: GRID_CONFIG.MAX_COLS,
    });

    const newHeight = Sanitizers.integer(heightInput.value, GRID_CONFIG.DEFAULT_ROWS, {
      min: GRID_CONFIG.MIN_ROWS,
      max: GRID_CONFIG.MAX_ROWS,
    });

    // Perform grid resize
    window.gameManager.resizeGrid(newWidth, newHeight);
  } catch (error) {
    new ErrorHandler().handle(error, ERROR_SEVERITY.MEDIUM, ERROR_CATEGORY.INPUT, {
      context: 'resizeGrid',
      stage: 'grid_resize_validation',
      inputValues: {
        width: getGridSizeInputs().widthInput?.value,
        height: getGridSizeInputs().heightInput?.value,
      },
      constraints: {
        minWidth: GRID_CONFIG.MIN_COLS,
        maxWidth: GRID_CONFIG.MAX_COLS,
        minHeight: GRID_CONFIG.MIN_ROWS,
        maxHeight: GRID_CONFIG.MAX_ROWS,
      },
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
      resetZoomAvailable: !!window.gameManager?.resetZoom,
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
        try {
          // Also force-disable placeable removal mode when leaving terrain mode
          window.gameManager?.terrainCoordinator?.setPlaceableRemovalMode?.(false);
          const removalToggle = document.getElementById('placeable-removal-toggle');
          if (removalToggle) {
            removalToggle.checked = false;
          }
        } catch (_) {
          /* ignore */
        }
      }
    }

    logger.log(LOG_LEVEL.INFO, 'Terrain mode toggled', LOG_CATEGORY.USER, {
      context: 'toggleTerrainMode',
      terrainModeEnabled: isEnabled,
      gameManagerAvailable: !!window.gameManager,
    });
  } catch (error) {
    new ErrorHandler().handle(error, ERROR_SEVERITY.MEDIUM, ERROR_CATEGORY.INPUT, {
      context: 'toggleTerrainMode',
      stage: 'terrain_mode_toggle',
      gameManagerAvailable: !!window.gameManager,
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
    tokenButtons.forEach((btn) => {
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
      raiseBtn.addEventListener('click', () => setTerrainTool('raise'));
      raiseBtn.dataset.boundTerrainHandler = 'true';
    }
    if (lowerBtn && !lowerBtn.dataset.boundTerrainHandler) {
      lowerBtn.addEventListener('click', () => setTerrainTool('lower'));
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
      } catch {
        /* ignore getElevationScale failure */
      }
      elevSlider.dataset.boundElevHandler = 'true';
    }

    // Ensure brush size label reflects current state on load
    try {
      updateBrushSizeDisplay();
    } catch (_) {
      /* non-fatal UI update */
    }

    // Dice buttons (top panel)
    const diceButtons = getDiceButtons();
    diceButtons.forEach((btn) => {
      if (btn.dataset.boundDiceHandler) return;
      btn.addEventListener('click', () => {
        const sides = parseInt(btn.getAttribute('data-sides'), 10);
        if (Number.isFinite(sides)) rollDice(sides);
      });
      btn.dataset.boundDiceHandler = 'true';
    });

    // Grid apply/reset buttons
    const { applySize, resetZoom: resetZoomBtn } = getGridActionButtons();
    if (applySize && !applySize.dataset.boundClick) {
      applySize.addEventListener('click', resizeGrid);
      applySize.dataset.boundClick = 'true';
    }
    if (resetZoomBtn && !resetZoomBtn.dataset.boundClick) {
      resetZoomBtn.addEventListener('click', resetZoom);
      resetZoomBtn.dataset.boundClick = 'true';
    }

    // Terrain mode toggle
    const { toggleEl: terrainToggle } = getTerrainModeEls();
    if (terrainToggle && !terrainToggle.dataset.boundChange) {
      terrainToggle.addEventListener('change', toggleTerrainMode);
      terrainToggle.dataset.boundChange = 'true';
    }

    // ...existing code...

    // Brush size controls
    const dec = document.getElementById('brush-decrease');
    const inc = document.getElementById('brush-increase');
    if (dec && !dec.dataset.boundClick) {
      dec.addEventListener('click', decreaseBrushSize);
      dec.dataset.boundClick = 'true';
    }
    if (inc && !inc.dataset.boundClick) {
      inc.addEventListener('click', increaseBrushSize);
      inc.dataset.boundClick = 'true';
    }

    // Placeable Tiles UI handlers removed — placeables menu and PT brush are deprecated.

    // Sprite adjust buttons
    const spr = getSpriteAdjustButtons();
    if (spr.up && !spr.up.dataset.boundClick) {
      spr.up.addEventListener('click', () => nudgeSelectedSprite(0, -1));
      spr.up.dataset.boundClick = 'true';
    }
    if (spr.down && !spr.down.dataset.boundClick) {
      spr.down.addEventListener('click', () => nudgeSelectedSprite(0, 1));
      spr.down.dataset.boundClick = 'true';
    }
    if (spr.left && !spr.left.dataset.boundClick) {
      spr.left.addEventListener('click', () => nudgeSelectedSprite(-1, 0));
      spr.left.dataset.boundClick = 'true';
    }
    if (spr.right && !spr.right.dataset.boundClick) {
      spr.right.addEventListener('click', () => nudgeSelectedSprite(1, 0));
      spr.right.dataset.boundClick = 'true';
    }
    if (spr.center && !spr.center.dataset.boundClick) {
      spr.center.addEventListener('click', captureSpriteBaseline);
      spr.center.dataset.boundClick = 'true';
    }
    if (spr.save && !spr.save.dataset.boundClick) {
      spr.save.addEventListener('click', saveSpriteOffset);
      spr.save.dataset.boundClick = 'true';
    }
    if (spr.reset && !spr.reset.dataset.boundClick) {
      spr.reset.addEventListener('click', resetSpriteOffset);
      spr.reset.dataset.boundClick = 'true';
    }
    if (spr.auto && !spr.auto.dataset.boundClick) {
      spr.auto.addEventListener('click', toggleAutoApplyOffsets);
      spr.auto.dataset.boundClick = 'true';
    }

    logger.debug('Dynamic UI handlers attached');
  } catch (error) {
    new ErrorHandler().handle(error, ERROR_SEVERITY.LOW, ERROR_CATEGORY.UI, {
      context: 'attachDynamicUIHandlers',
    });
  }
}

// Expressive/Atlas 3D style controls removed; keep stub for any legacy calls.
function wireTerrainStyleControls() {}

// Attach after DOM ready & when game manager exists
document.addEventListener('DOMContentLoaded', () => {
  // In test (Jest) environment, skip UI polling entirely to avoid lingering timers.
  if (isJest && isJest()) {
    if (window.gameManager) {
      try {
        attachDynamicUIHandlers();
      } catch (e) {
        /* ignore in tests */
      }
    }
    return;
  }
  if (window.gameManager) {
    attachDynamicUIHandlers();
    try {
      wireTerrainStyleControls();
    } catch (_) {
      /* ignore */
    }
    return;
  }
  // Poll briefly until gameManager set by StateCoordinator (browser only)
  const interval = setInterval(() => {
    if (window.gameManager) {
      clearInterval(interval);
      attachDynamicUIHandlers();
      try {
        wireTerrainStyleControls();
      } catch (_) {
        /* ignore */
      }
    }
  }, 100);
  if (typeof interval?.unref === 'function') interval.unref();
  const stopAfterMs = 5000;
  const stopper = setTimeout(() => clearInterval(interval), stopAfterMs);
  if (typeof stopper?.unref === 'function') stopper.unref();
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
        // accessibility state
        raiseBtn.setAttribute('aria-pressed', 'true');
        lowerBtn.setAttribute('aria-pressed', 'false');
      } else if (tool === 'lower') {
        lowerBtn.classList.add('active');
        // accessibility state
        lowerBtn.setAttribute('aria-pressed', 'true');
        raiseBtn.setAttribute('aria-pressed', 'false');
      }
    }

    logger.log(LOG_LEVEL.DEBUG, 'Terrain tool selected', LOG_CATEGORY.USER, {
      context: 'setTerrainTool',
      selectedTool: tool,
      uiUpdated: !!(raiseBtn && lowerBtn),
    });
  } catch (error) {
    new ErrorHandler().handle(error, ERROR_SEVERITY.MEDIUM, ERROR_CATEGORY.INPUT, {
      context: 'setTerrainTool',
      stage: 'terrain_tool_selection',
      requestedTool: tool,
      gameManagerAvailable: !!window.gameManager,
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
    // Placeable Tiles UI removed
    // PT brush display removed
  } catch (error) {
    new ErrorHandler().handle(error, ERROR_SEVERITY.LOW, ERROR_CATEGORY.INPUT, {
      context: 'increaseBrushSize',
      stage: 'brush_size_increase',
      terrainCoordinatorAvailable: !!window.gameManager?.terrainCoordinator,
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

    // Also update Placeable Tiles brush display if present
    try {
      updatePTBrushSizeDisplay();
    } catch (e) {
      /* ignore */
    }
  } catch (error) {
    new ErrorHandler().handle(error, ERROR_SEVERITY.LOW, ERROR_CATEGORY.INPUT, {
      context: 'decreaseBrushSize',
      stage: 'brush_size_decrease',
      terrainCoordinatorAvailable: !!window.gameManager?.terrainCoordinator,
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
    logger.debug('Failed to update brush size display', { error: error.message }, LOG_CATEGORY.UI);
  }
}

/**
 * Update the Placeable Tiles brush size display if present
 */
function updatePTBrushSizeDisplay() {
  try {
    const el = document.getElementById('pt-brush-size-display');
    if (!el) return;
    if (window.gameManager && window.gameManager.terrainCoordinator) {
      const ptSize = window.gameManager.terrainCoordinator.ptBrushSize;
      el.textContent = `${ptSize}x${ptSize}`;
    }
  } catch (error) {
    logger.debug(
      'Failed to update PT brush size display',
      { error: error.message },
      LOG_CATEGORY.UI
    );
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
    if (
      confirm(
        'Are you sure you want to reset all terrain to default height? This action cannot be undone.'
      )
    ) {
      window.gameManager.resetTerrain();

      logger.log(LOG_LEVEL.INFO, 'Terrain reset by user', LOG_CATEGORY.USER, {
        context: 'resetTerrain',
        stage: 'terrain_reset_complete',
      });
    }
  } catch (error) {
    new ErrorHandler().handle(error, ERROR_SEVERITY.MEDIUM, ERROR_CATEGORY.INPUT, {
      context: 'resetTerrain',
      stage: 'terrain_reset',
      gameManagerAvailable: !!window.gameManager,
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
      initializationFailed: true,
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
      timestamp: new Date().toISOString(),
    });
    throw error;
  }
}

// Initialize the game manager and set up event listeners
const gameManager = createGameManager();

logger.log(LOG_LEVEL.DEBUG, 'GameManager created successfully', LOG_CATEGORY.SYSTEM, {
  gameManagerType: gameManager.constructor.name,
  globallyAvailable: !!window.gameManager,
  timestamp: new Date().toISOString(),
});

// No global UI function exposure needed; events are wired via modules

// === SPRITE ADJUSTMENT SYSTEM ===
const spriteAdjustState = {
  baselineCaptured: false,
  baseline: { x: 0, y: 0 },
  totalOffset: { x: 0, y: 0 },
  appliedElevationOffset: 0,
  initialPlacementLogged: false,
  lastSpriteId: null,
};

function getSelectedCreatureSprite() {
  if (!window.gameManager) return null;
  const tokens = window.gameManager.placedTokens;
  if (!tokens || tokens.length === 0) return null;
  const selectedType = window.gameManager.selectedTokenType;
  let candidate = [...tokens].reverse().find((t) => t.type === selectedType);
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
    return window.gameManager.getTerrainHeight
      ? window.gameManager.getTerrainHeight(gridX, gridY)
      : 0;
  } catch {
    return 0;
  }
}

//

// API to auto-adjust all sprites after terrain tweaks (future extension)
// Dev-only helper: intentionally unused in production wiring
// eslint-disable-next-line no-unused-vars
function applyElevationOffsetsToTokens() {
  if (!window.gameManager) return;
  const tokens = window.gameManager.placedTokens || [];
  tokens.forEach((t) => {
    const sprite = t.creature?.sprite;
    if (!sprite) return;
    const elev = window.gameManager.getTerrainHeight
      ? window.gameManager.getTerrainHeight(t.gridX, t.gridY)
      : 0;
    const offset = computeElevationVisualOffset(elev);
    // Only adjust Y to avoid lateral drift
    sprite.y = sprite.y + offset;
  });
}

// ...

// ---------------- Sprite Offset Persistence & Auto-Apply ----------------
//

function ensureSpriteAdjustExtendedState() {
  // Extend existing state object without needing to locate original declaration
  spriteAdjustState.savedOffsets = spriteAdjustState.savedOffsets || {}; // key -> {x,y}
  if (typeof spriteAdjustState.autoApply !== 'boolean') spriteAdjustState.autoApply = false;
}
// Also update Placeable Tiles brush display if present
try {
  updatePTBrushSizeDisplay();
} catch (e) {
  /* ignore */
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
  const candidateFnName = ['placeToken', 'finalizeTokenPlacement', 'addPlacedToken'].find(
    (n) => typeof tm[n] === 'function'
  );
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
    } catch (_) {
      /* ignore auto-apply errors */
    }
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
// Bound retries under Jest to avoid leaking timers in tests
const __isJest = isJest();
const __retryLimit = __isJest ? 3 : Infinity;
let __retryCount = 0;
const __first = setTimeout(function retryHook() {
  try {
    installSpriteOffsetAutoApplyHook();
  } catch (_) {
    /* ignore install errors */
  }
  if (!spriteAdjustState._autoApplyHookInstalled && __retryCount < __retryLimit) {
    __retryCount++;
    const t = setTimeout(retryHook, 800);
    if (typeof t?.unref === 'function') t.unref();
  }
}, 800);
if (typeof __first?.unref === 'function') __first.unref();

logger.log(LOG_LEVEL.DEBUG, 'UI functions exposed globally', LOG_CATEGORY.SYSTEM, {
  exposedFunctions: [],
  compatibilityMode: 'module_event_listeners',
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
  initializeApplication,
};
