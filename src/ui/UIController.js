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

import { GRID_CONFIG } from '../config/GameConstants.js';
import { TOKEN_COMMANDS, getTokenCommand } from '../config/TokenCommandConfig.js';
import { CHARACTER_DEFINITIONS } from '../config/CharacterCatalog.js';
import { MANUAL_ACTIONS } from '../config/HumanoidActionCatalog.js';

import {
  getCreatureButtons,
  getFacingButton,
  getTerrainToolButtons,
  getTerrainWallControls,
  getTerrainHistoryControls,
  getGridSizeInputs,
  getTerrainResetButton,
  getElevationScaleControls,
  getTreeDensityControls,
  getBrushSizeDisplay,
  getCreaturePanelEls,
  getTerrainModeEls,
  getGameContainer,
} from './dom-helpers.js';
import { getDiceButtons, getGridActionButtons } from './dom-helpers.js';
import RadialMenu from './components/RadialMenu.js';
import CharacterSheetWindow from './components/CharacterSheetWindow.js';

import { isJest } from '../utils/env.js';
import GameManager from '../core/GameManager.js';
import { logger, LOG_LEVEL, LOG_CATEGORY } from '../utils/logger/Logger.js';
import { ErrorHandler, ERROR_SEVERITY, ERROR_CATEGORY } from '../utils/error/ErrorHandler.js';
import { Sanitizers, GameValidators } from '../utils/Validation.js';
import { rollDice } from '../systems/dice/dice.js';
import CampaignLauncher, { mountCampaignControls } from './campaigns/CampaignLauncher.js';
import { connectCharacterServices } from './characters/characterServices.js';
import CampaignAutosave from '../campaigns/CampaignAutosave.js';
import { TerrainConstructionPanel } from './TerrainConstructionPanel.js';

// ── Constants ──────────────────────────────────────────────────
const TOKEN_DRAG_MIME = 'application/taverntable-token';

// ── Private Helpers ─────────────────────────────────────────

let radialMenuInstance = null;
let characterSheetWindow = null;
let applicationStartup = null;
let terrainConstruction = null;

function getRadialMenuInstance() {
  if (!radialMenuInstance) {
    radialMenuInstance = new RadialMenu({ actions: TOKEN_COMMANDS });
    const mountTarget = document.body || document.documentElement;
    if (mountTarget) {
      radialMenuInstance.attach(mountTarget);
    }
    radialMenuInstance.onAction(({ actionId, token }) => {
      handleRadialCommand(actionId, token);
    });
  }
  return radialMenuInstance;
}

async function handleRadialCommand(actionId, token) {
  try {
    if (!actionId) return;
    const gm = window.gameManager;
    if (actionId === 'character-sheet') {
      if (!gm) throw new Error('Character sheets require an active game session');
      if (!characterSheetWindow || characterSheetWindow.gameManager !== gm) {
        characterSheetWindow?.destroy();
        characterSheetWindow = new CharacterSheetWindow({
          gameManager: gm,
          initialBounds: { left: 32, top: 56, width: 860, height: 760 },
          onOpenCompendium: (entryId) => {
            if (!window.sidebarController?.openCompendium) {
              throw new Error('The compendium sidebar is not available');
            }
            return window.sidebarController.openCompendium(entryId);
          },
        }).attach();
      }
      characterSheetWindow.open(token);
      return;
    }
    if (!gm || typeof gm.applyTokenCommand !== 'function') {
      throw new Error('Creature actions require an active game session');
    }
    const applied = await gm.applyTokenCommand(token, actionId);
    if (applied && !getTokenCommand(actionId)?.flight) {
      const normalized = actionId === 'clear' ? null : actionId;
      getRadialMenuInstance().setActiveCommand(normalized, token);
    }
  } catch (error) {
    new ErrorHandler().handle(error, ERROR_SEVERITY.MEDIUM, ERROR_CATEGORY.UI, {
      context: 'handleRadialCommand',
      actionId,
      tokenId: token?.id,
    });
  }
}

function showRadialMenu(detail = {}) {
  const radial = getRadialMenuInstance();
  const adapter = window.gameManager?.token3DAdapter;
  const availability =
    typeof adapter?.getManualActionAvailability === 'function'
      ? Object.fromEntries(
          MANUAL_ACTIONS.map(({ id }) => [
            id,
            adapter.getManualActionAvailability(detail.token, id),
          ])
        )
      : {};
  if (typeof adapter?.getFlightCommandAvailability === 'function') {
    for (const action of TOKEN_COMMANDS.filter((entry) => entry.flight)) {
      for (const entry of [action, ...(action.subActions || [])]) {
        availability[entry.id] = adapter.getFlightCommandAvailability(
          detail.token,
          entry.flight.kind,
          entry.flight.feet
        );
      }
    }
  }
  radial.setActionAvailability(availability);
  radial.show({
    ...detail,
    getFlightStatus: () => adapter?.getFlightStatus?.(detail.token) || null,
  });
  const activeCommand = detail.token?.quickCommand || null;
  radial.setActiveCommand(activeCommand);
}

function hasTokenDragPayload(event) {
  const dt = event?.dataTransfer;
  if (!dt) return false;
  try {
    if (dt.types && typeof dt.types.includes === 'function') {
      return dt.types.includes(TOKEN_DRAG_MIME) || dt.types.includes('text/plain');
    }
    if (Array.isArray(dt.types)) {
      return dt.types.includes(TOKEN_DRAG_MIME) || dt.types.includes('text/plain');
    }
  } catch (_) {
    /* ignore */
  }
  try {
    return !!(dt.getData(TOKEN_DRAG_MIME) || dt.getData('text/plain'));
  } catch (_) {
    return false;
  }
}

function getTokenDragType(event) {
  const dt = event?.dataTransfer;
  if (!dt) return '';
  try {
    return dt.getData(TOKEN_DRAG_MIME) || dt.getData('text/plain') || '';
  } catch (_) {
    return '';
  }
}

// ── DOM Helpers ────────────────────────────────────────────

function setupTokenDrag(button, tokenType) {
  if (!button || button.dataset.boundTokenDrag) return;
  button.setAttribute('draggable', 'true');
  button.addEventListener('dragstart', (event) => {
    if (!event?.dataTransfer) return;
    event.dataTransfer.effectAllowed = 'copy';
    try {
      event.dataTransfer.setData(TOKEN_DRAG_MIME, tokenType);
      event.dataTransfer.setData('text/plain', tokenType);
    } catch (_) {
      /* ignore */
    }
    button.classList.add('token-dragging');
  });
  button.addEventListener('dragend', () => {
    button.classList.remove('token-dragging');
  });
  button.dataset.boundTokenDrag = 'true';
}

function ensureTokenDropTargets() {
  const gm = window.gameManager;
  if (!gm) return;

  const bindTarget = (target) => {
    if (!target || target.dataset?.boundTokenDrop) return;
    target.addEventListener('dragover', (event) => {
      if (!hasTokenDragPayload(event)) return;
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy';
      }
    });
    target.addEventListener('drop', (event) => {
      if (!hasTokenDragPayload(event)) return;
      event.preventDefault();
      const tokenType = getTokenDragType(event);
      if (!tokenType) return;
      const coordinator = window.gameManager?.inputCoordinator;
      if (!coordinator?.handleTokenDrop) return;
      const result = coordinator.handleTokenDrop(tokenType, event.clientX, event.clientY);
      if (result && typeof result.catch === 'function') {
        result.catch((error) => {
          logger.warn(
            'Token drop failed',
            { error: error?.message || String(error) },
            LOG_CATEGORY.INTERACTION
          );
        });
      }
    });
    target.dataset.boundTokenDrop = 'true';
  };

  bindTarget(gm.app?.view || null);
  const container = getGameContainer();
  if (container) {
    bindTarget(container);
  }
}

// ── Public API ──────────────────────────────────────────────

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

// ── Event Handlers ──────────────────────────────────────────

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
          window.gameManager?.terrainEngine?.setPlaceableRemovalMode?.(false);
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
    const creatureContent = document.getElementById('creature-content');
    if (creatureContent) {
      for (const character of CHARACTER_DEFINITIONS) {
        const id = `token-${character.id}`;
        if (document.getElementById(id)) continue;
        const button = document.createElement('button');
        button.id = id;
        button.dataset.token = character.id;
        button.setAttribute('aria-label', `Select ${character.label} token`);
        button.textContent = `${character.icon} ${character.label}`;
        creatureContent.appendChild(button);
      }
    }
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
      if (id !== 'remove') {
        setupTokenDrag(btn, id);
      }
    });

    ensureTokenDropTargets();

    // Facing button
    const facingBtn = getFacingButton();
    if (facingBtn && !facingBtn.dataset.boundFacingHandler) {
      facingBtn.addEventListener('click', () => window.gameManager.toggleFacing());
      facingBtn.dataset.boundFacingHandler = 'true';
    }

    // Terrain tool buttons
    const { raiseBtn, lowerBtn, wallBtn } = getTerrainToolButtons();
    for (const [tool, button] of [
      ['raise', raiseBtn],
      ['lower', lowerBtn],
      ['wall', wallBtn],
    ]) {
      if (button && !button.dataset.boundTerrainHandler) {
        button.addEventListener('click', () => {
          if (tool === 'wall') window.gameManager?.terrainEngine?.setConstructionTool('wall');
          else setTerrainTool(tool);
        });
        button.dataset.boundTerrainHandler = 'true';
      }
    }

    syncTerrainToolControls(window.gameManager?.terrainEngine?.tool || 'raise');

    const history = getTerrainHistoryControls();
    for (const [operation, button] of [
      ['undo', history.undoBtn],
      ['redo', history.redoBtn],
    ]) {
      if (!button || button.dataset.boundHistoryHandler) continue;
      button.addEventListener('click', () => {
        try {
          const engine = window.gameManager?.terrainEngine;
          if (!engine) throw new Error('Terrain editing is not ready yet');
          engine[operation]();
          syncTerrainHistoryControls();
        } catch (error) {
          new ErrorHandler().handle(error, ERROR_SEVERITY.WARNING, ERROR_CATEGORY.INPUT, {
            context: 'terrainHistory',
            operation,
          });
        }
      });
      button.dataset.boundHistoryHandler = 'true';
    }
    syncTerrainHistoryControls();
    const constructionRoot = document.getElementById('terrain-construction');
    const manager = window.gameManager;
    if (
      constructionRoot &&
      manager?.terrainEngine &&
      (!terrainConstruction ||
        terrainConstruction.root !== constructionRoot ||
        terrainConstruction.gameManager !== manager)
    ) {
      terrainConstruction?.dispose();
      terrainConstruction = new TerrainConstructionPanel({
        root: constructionRoot,
        gameManager: manager,
      });
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
        if (window.gameManager?.terrainEngine?.setElevationScale) {
          window.gameManager.terrainEngine.setElevationScale(unit);
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
        const current = clampElevationUnit(window.gameManager?.terrainEngine?.elevationScale);
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
        window.gameManager?.terrainEngine?.setTreeDensityMultiplier?.(multiplier);
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
        const current = window.gameManager?.terrainEngine?.treeDensityMultiplier;
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
function wireTerrainStyleControls() {}

if (typeof window !== 'undefined') {
  window.addEventListener('taverntable:terrainEditorChanged', (event) => {
    const engine = window.gameManager?.terrainEngine;
    if (!engine || event.detail?.engine !== engine) return;
    syncTerrainToolControls(engine.tool);
    syncTerrainHistoryControls();
    updateBrushSizeDisplay();
    const structures = document.getElementById('biome-structures-toggle');
    if (structures) structures.checked = engine.structureGenerationEnabled;
    const elevation = getElevationScaleControls();
    if (elevation.slider) elevation.slider.value = String(engine.elevationScale);
    if (elevation.valueEl) elevation.valueEl.textContent = `${engine.elevationScale} px/level`;
    const density = getTreeDensityControls();
    const percent = Math.round(engine.treeDensityMultiplier * 100);
    if (density.slider) density.slider.value = String(percent);
    if (density.valueEl) density.valueEl.textContent = `${percent}%`;
    const { toggleEl, toolsEl } = getTerrainModeEls();
    if (toggleEl) toggleEl.checked = engine.isActive;
    if (toolsEl) toolsEl.style.display = engine.isActive ? 'block' : 'none';
    const removal = document.getElementById('placeable-removal-toggle');
    if (removal) removal.checked = engine.isPlaceableRemovalMode();
  });
  window.addEventListener('taverntable:tokenRadial', (event) => {
    try {
      showRadialMenu(event?.detail || {});
    } catch (error) {
      logger.debug('Failed to show radial menu', { error: error?.message }, LOG_CATEGORY.UI);
    }
  });
}

// Attach after DOM ready & when game manager exists
document.addEventListener('DOMContentLoaded', () => {
  attachDynamicUIHandlers();
  // In test (Jest) environment, skip UI polling entirely to avoid lingering timers.
  if (isJest && isJest()) {
    return;
  }
  if (window.gameManager) {
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

// ── Public API (Terrain Controls) ──────────────────────────

function syncTerrainToolControls(tool) {
  const construction = window.gameManager?.terrainEngine?.constructionTool;
  const { raiseBtn, lowerBtn, wallBtn } = getTerrainToolButtons();
  for (const [value, button] of [
    ['raise', raiseBtn],
    ['lower', lowerBtn],
    ['wall', wallBtn],
  ]) {
    if (!button) continue;
    const active = construction ? construction === 'wall' && value === 'wall' : tool === value;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  const { brushControlsEl } = getTerrainWallControls();
  if (brushControlsEl) brushControlsEl.hidden = !!construction || tool === 'wall';
}

function syncTerrainHistoryControls() {
  const engine = window.gameManager?.terrainEngine;
  const { undoBtn, redoBtn, statusEl } = getTerrainHistoryControls();
  if (undoBtn) {
    undoBtn.disabled = !engine?.canUndo;
    undoBtn.title = engine?.undoLabel ? `Undo: ${engine.undoLabel} (Ctrl+Z)` : 'Nothing to undo';
  }
  if (redoBtn) {
    redoBtn.disabled = !engine?.canRedo;
    redoBtn.title = engine?.redoLabel
      ? `Redo: ${engine.redoLabel} (Ctrl+Shift+Z)`
      : 'Nothing to redo';
  }
  if (statusEl) {
    statusEl.textContent = engine?.hasPendingStroke
      ? 'Preview only. Release on the map to apply, or press Escape to cancel.'
      : engine?.canUndo || engine?.canRedo
        ? 'Terrain and construction history is available for this editing session.'
        : 'No terrain or construction edits to undo.';
  }
}

/**
 * Set the active terrain tool
 * @param {string} tool - Tool name ('raise', 'lower', or 'wall')
 */
function setTerrainTool(tool) {
  try {
    if (!window.gameManager) {
      throw new Error('Game is still loading. Please wait a moment and try again.');
    }

    // Update tool in game manager
    window.gameManager.setTerrainTool(tool);

    syncTerrainToolControls(window.gameManager.terrainEngine?.tool || tool);

    logger.log(LOG_LEVEL.DEBUG, 'Terrain tool selected', LOG_CATEGORY.USER, {
      context: 'setTerrainTool',
      selectedTool: tool,
      uiUpdated: !!getTerrainToolButtons().wallBtn,
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
    if (!window.gameManager || !window.gameManager.terrainEngine) {
      throw new Error('Terrain system not available');
    }

    // Increase brush size in game
    window.gameManager.terrainEngine.increaseBrush();

    // Update UI display
    updateBrushSizeDisplay();
    // Placeable Tiles UI removed
    // PT brush display removed
  } catch (error) {
    new ErrorHandler().handle(error, ERROR_SEVERITY.LOW, ERROR_CATEGORY.INPUT, {
      context: 'increaseBrushSize',
      stage: 'brush_size_increase',
      terrainEngineAvailable: !!window.gameManager?.terrainEngine,
    });
  }
}

/**
 * Decrease brush size for terrain tools
 */
function decreaseBrushSize() {
  try {
    if (!window.gameManager || !window.gameManager.terrainEngine) {
      throw new Error('Terrain system not available');
    }

    // Decrease brush size in game
    window.gameManager.terrainEngine.decreaseBrush();

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
      terrainEngineAvailable: !!window.gameManager?.terrainEngine,
    });
  }
}

// ── DOM Helpers (Display) ──────────────────────────────────

/**
 * Update brush size display in UI
 */
function updateBrushSizeDisplay() {
  try {
    const brushDisplay = getBrushSizeDisplay();
    if (!brushDisplay) {
      return;
    }

    if (window.gameManager && window.gameManager.terrainEngine) {
      const brushSize = window.gameManager.terrainEngine.brushSize;
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
    if (window.gameManager && window.gameManager.terrainEngine) {
      const ptSize = window.gameManager.terrainEngine.ptBrushSize;
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
        'Reset all terrain to default height? You can undo this during the current editing session.'
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

// ── Constructor (Application Bootstrap) ───────────────────

/**
 * Initialize the application when the page loads
 * Sets up the game manager and handles any initialization errors
 */
function initializeApplication() {
  if (!applicationStartup) applicationStartup = startCampaignApplication();
  return applicationStartup;
}

async function startCampaignApplication() {
  let loading = null;
  const previousInert = new Map();
  const pauseControls = () => {
    for (const element of document.body.children) {
      if (element === loading || previousInert.has(element)) continue;
      previousInert.set(element, element.inert);
      element.inert = true;
    }
  };
  try {
    // Validate gameManager exists
    if (!window.gameManager) {
      throw new Error('GameManager not found. Application cannot start.');
    }

    const manager = window.gameManager;
    const services = await new CampaignLauncher().choose();
    loading = document.createElement('section');
    loading.className = 'campaign-picker';
    loading.setAttribute('role', 'dialog');
    loading.setAttribute('aria-modal', 'true');
    loading.setAttribute('aria-label', 'Opening campaign');
    loading.tabIndex = -1;
    const loadingMessage = document.createElement('div');
    loadingMessage.className = 'campaign-shell';
    loadingMessage.setAttribute('role', 'status');
    loadingMessage.textContent = 'Restoring your campaign. Please wait...';
    loading.append(loadingMessage);
    document.body.append(loading);
    pauseControls();
    loading.focus();
    manager.campaignContext = services;
    manager.campaign = services.campaign;
    connectCharacterServices(manager, services);
    const autosave = new CampaignAutosave({
      gameManager: manager,
      library: services.library,
      combat: manager.characterServices.combat,
      getRollLog: () => window.sidebarController.snapshotDiceLog(),
      restoreRollLog: (entries) => window.sidebarController.restoreDiceLog(entries),
    });
    services.autosave = autosave;
    mountCampaignControls(manager, services);
    pauseControls();
    await manager.initialize();
    await manager.enableHybridRender();
    if (!manager.token3DAdapter || !manager.is3DModeActive()) {
      throw new Error('The 3D world could not finish initializing');
    }
    pauseControls();
    await autosave.start(services.scene);
    for (const [element, inert] of previousInert) element.inert = inert;
    loading.remove();
  } catch (error) {
    if (loading) {
      loading.textContent = '';
      const message = document.createElement('div');
      message.className = 'campaign-shell';
      message.textContent = `The campaign could not finish opening: ${error.message}. Your saved board was not reset. `;
      const retry = document.createElement('button');
      retry.textContent = 'Retry opening campaign';
      retry.addEventListener('click', () => window.location.reload());
      message.append(retry);
      loading.append(message);
    }
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
window.addEventListener('load', () => {
  if (!isJest()) void initializeApplication();
});

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
