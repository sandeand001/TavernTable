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
  getTreeDensityControls,
  getBrushSizeDisplay,
  getCreaturePanelEls,
  getTerrainModeEls,
} from './domHelpers.js';
import { getDiceButtons, getGridActionButtons } from './domHelpers.js';
import { rollDice } from '../systems/dice/dice.js';

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
      const clampElevationUnit = (raw) => {
        const numeric = Number.parseFloat(raw);
        if (!Number.isFinite(numeric)) return null;
        return Math.max(0, Math.min(20, Math.round(numeric)));
      };
      const updateDisplay = (val) => {
        if (elevValue) elevValue.textContent = `${val} px/level`;
      };
      const applyScale = (val) => {
        const unit = clampElevationUnit(val);
        if (unit == null) return;
        if (window.gameManager?.terrainCoordinator?.setElevationScale) {
          window.gameManager.terrainCoordinator.setElevationScale(unit);
        }
      };
      elevSlider.addEventListener('input', (e) => {
        const unit = clampElevationUnit(e.target.value);
        if (unit == null) return;
        updateDisplay(unit);
        if (debounceId) clearTimeout(debounceId);
        debounceId = setTimeout(() => applyScale(unit), DEBOUNCE_MS);
      });
      elevSlider.addEventListener('change', (e) => {
        const unit = clampElevationUnit(e.target.value);
        if (unit == null) return;
        updateDisplay(unit);
        if (debounceId) clearTimeout(debounceId);
        applyScale(unit);
        elevSlider.value = String(unit);
      });
      // Initialize from current config if available
      try {
        const current = clampElevationUnit(
          window.gameManager?.terrainCoordinator?.getElevationScale?.()
        );
        if (current != null) {
          elevSlider.value = String(current);
          updateDisplay(current);
        }
      } catch {
        /* ignore getElevationScale failure */
      }
      elevSlider.dataset.boundElevHandler = 'true';
    }

    const { slider: treeSlider, valueEl: treeValue } = getTreeDensityControls();
    if (treeSlider && !treeSlider.dataset.boundTreeDensity) {
      const clampPercent = (raw) => {
        const num = Number(raw);
        if (!Number.isFinite(num)) return 100;
        return Math.min(200, Math.max(0, Math.round(num)));
      };
      const updateDisplay = (pct) => {
        if (treeValue) treeValue.textContent = `${pct}%`;
      };
      const applyMultiplier = (pct) => {
        const multiplier = clampPercent(pct) / 100;
        window.treeDensityMultiplier = multiplier;
        window.gameManager?.terrainCoordinator?.setTreeDensityMultiplier?.(multiplier);
      };
      treeSlider.addEventListener('input', (e) => {
        const pct = clampPercent(e.target.value);
        updateDisplay(pct);
        applyMultiplier(pct);
      });
      treeSlider.addEventListener('change', (e) => {
        const pct = clampPercent(e.target.value);
        updateDisplay(pct);
        applyMultiplier(pct);
      });
      try {
        const current = window.gameManager?.terrainCoordinator?.getTreeDensityMultiplier?.();
        if (Number.isFinite(current)) {
          const pct = clampPercent(current * 100);
          treeSlider.value = String(pct);
          updateDisplay(pct);
          applyMultiplier(pct);
        } else {
          const pct = clampPercent(treeSlider.value);
          updateDisplay(pct);
          applyMultiplier(pct);
        }
      } catch (_) {
        const pct = clampPercent(treeSlider.value);
        updateDisplay(pct);
        applyMultiplier(pct);
      }
      treeSlider.dataset.boundTreeDensity = 'true';
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

    // Grid apply button
    const { applySize } = getGridActionButtons();
    if (applySize && !applySize.dataset.boundClick) {
      applySize.addEventListener('click', resizeGrid);
      applySize.dataset.boundClick = 'true';
    }

    // Terrain mode toggle
    const { toggleEl: terrainToggle } = getTerrainModeEls();
    if (terrainToggle && !terrainToggle.dataset.boundChange) {
      terrainToggle.addEventListener('change', toggleTerrainMode);
      terrainToggle.dataset.boundChange = 'true';
    }

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

    logger.debug('Dynamic UI handlers attached');
  } catch (error) {
    new ErrorHandler().handle(error, ERROR_SEVERITY.LOW, ERROR_CATEGORY.UI, {
      context: 'attachDynamicUIHandlers',
    });
  }
}

// Expressive/Atlas 3D style controls removed; keep stub for any legacy calls.
function wireTerrainStyleControls() { }

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

// NFC NOTE (2025-09-19): UIController appears orphaned (few direct imports) because it is
// primarily bootstrapped via index.html and attaches itself to window for interaction tests / manual
// exploration. Retain until a formal application bootstrap module supersedes window exposure.
