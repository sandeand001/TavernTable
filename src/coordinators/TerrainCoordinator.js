/**
 * TerrainCoordinator.js - Manages terrain height modification system
 *
 * Follows the established coordinator pattern for the TavernTable application
 * Handles terrain height data management, rendering coordination, and system lifecycle
 */

import { logger, LOG_CATEGORY } from '../utils/Logger.js';
import { GameErrors } from '../utils/ErrorHandler.js';
// Validation utilities are referenced within internals; no direct import needed here
import { TERRAIN_CONFIG } from '../config/TerrainConstants.js';
import { TerrainDataStore } from '../terrain/TerrainDataStore.js';
import { TerrainBrushController } from '../terrain/TerrainBrushController.js';
import { TerrainFacesRenderer } from '../terrain/TerrainFacesRenderer.js';
import { TerrainInputHandlers } from './terrain-coordinator/TerrainInputHandlers.js';
import { ElevationScaleController } from './terrain-coordinator/ElevationScaleController.js';
import { ActivationHelpers } from './terrain-coordinator/ActivationHelpers.js';
import { BiomeShadingController } from './terrain-coordinator/BiomeShadingController.js';
import { TileLifecycleController } from './terrain-coordinator/TileLifecycleController.js';
import { ElevationVisualsController } from './terrain-coordinator/ElevationVisualsController.js';
import {
  validateTerrainSystemState as _validateSystemState,
  validateTerrainDataConsistency as _validateDataConsistency,
} from './terrain-coordinator/internals/validation.js';
import {
  validateApplicationRequirements as _validateApplyReqs,
  initializeBaseHeights as _initBaseHeights,
  processAllGridTiles as _processAllTiles,
  logCompletion as _logApplyComplete,
  handleApplicationError as _handleApplyError,
} from './terrain-coordinator/internals/apply.js';
import {
  getGridCoordinatesFromEvent as _getCoordsFromEvent,
  modifyTerrainAtPosition as _modifyAtPos,
} from './terrain-coordinator/internals/inputs.js';
import {
  setRichShadingEnabled as _setRichShadingEnabled,
  setBiomeSeed as _setBiomeSeed,
} from './terrain-coordinator/internals/biome.js';
import { getBiomeOrBaseColor as _getBiomeOrBaseColorInternal } from './terrain-coordinator/internals/color.js';
import { autoPopulateBiomeFlora as _autoPopulateBiomeFlora } from './terrain-coordinator/internals/flora.js';
import { handleGridResize as _handleResize } from './terrain-coordinator/internals/resize.js';
import { getTerrainHeight as _getHeight } from './terrain-coordinator/internals/height.js';
import { isValidGridPosition as _isValidPos } from './terrain-coordinator/internals/coords.js';
import { modifyTerrainHeightAtCell as _modifyAtCell } from './terrain-coordinator/internals/brush.js';
import {
  setTerrainTool as _setTool,
  getBrushSize as _getBrushSize,
  setBrushSize as _setBrushSize,
  increaseBrushSize as _incBrush,
  decreaseBrushSize as _decBrush,
} from './terrain-coordinator/internals/tools.js';
import {
  updateBaseGridTileInPlace as _updateBaseGridTileInPlace,
  replaceBaseGridTile as _replaceBaseGridTile,
} from './terrain-coordinator/internals/baseGridUpdates.js';
import { resetTerrain as _resetTerrain } from './terrain-coordinator/internals/reset.js';
import { loadBaseTerrainIntoWorkingState as _loadBaseIntoWorking } from './terrain-coordinator/internals/state.js';
import { initializeTerrainData as _initTerrainData } from './terrain-coordinator/internals/init.js';
import { validateDependencies as _validateDeps } from './terrain-coordinator/internals/deps.js';
import {
  generateBiomeElevationField,
  isAllDefaultHeight,
  getBiomeElevationScaleHint,
} from '../terrain/BiomeElevationGenerator.js';

export class TerrainCoordinator {
  /**
   * Extended constructor with optional injected collaborators and DOM ports.
   * @param {object} gameManager
   * @param {object} [terrainManager]
   * @param {object} [biomeShadingController]
   * @param {object} [domPorts] shape: { getTerrainHeightDisplay, getScaleMarks, getGameContainer }
   */
  constructor(gameManager, terrainManager = null, biomeShadingController = null, domPorts = {}) {
    this.gameManager = gameManager;
    this.terrainManager = terrainManager;
    this.biomeShadingController = biomeShadingController;
    // Injected DOM accessors (UI layer) to avoid violating layering in submodules.
    const defaultGetTerrainHeightDisplay = () => {
      if (typeof document === 'undefined') {
        return null;
      }
      return document.getElementById('terrain-height-display');
    };
    const defaultGetScaleMarks = () => {
      if (typeof document === 'undefined') {
        return [];
      }
      return document.querySelectorAll('.scale-mark');
    };
    const defaultGetGameContainer = () => {
      if (typeof document === 'undefined') {
        return null;
      }
      return document.getElementById('game-container');
    };
    this.domPorts = {
      getTerrainHeightDisplay: domPorts.getTerrainHeightDisplay || defaultGetTerrainHeightDisplay,
      getScaleMarks: domPorts.getScaleMarks || defaultGetScaleMarks,
      getGameContainer: domPorts.getGameContainer || defaultGetGameContainer,
    };
    this.validateDependencies();

    // Terrain modification state & helpers
    this.isTerrainModeActive = false;
    this.dataStore = new TerrainDataStore(this.gameManager.cols, this.gameManager.rows);
    this.brush = new TerrainBrushController(this.dataStore);
    this.faces = new TerrainFacesRenderer(this.gameManager);
    // Façade-backed extractions
    this._inputHandlers = new TerrainInputHandlers(this);
    this._elevationScaleController = new ElevationScaleController(this);
    this._activationHelpers = new ActivationHelpers(this);
    this._tileLifecycle = new TileLifecycleController(this);
    this._elevationVisuals = new ElevationVisualsController(this);

    // UI state
    this.isDragging = false;
    this.lastModifiedCell = null;

    // Elevation perception runtime state (pixels per level). Initialized from config default.
    this._elevationScale = TERRAIN_CONFIG.ELEVATION_SHADOW_OFFSET;
    // Continuous biome canvas painter (used outside terrain mode)
    this._biomeCanvas = null;
    // Biome shading façade
    this._biomeShading = new BiomeShadingController(this);
    // Shared seed for biome color/painter coherence (can be overridden by UI)
    this._biomeSeed =
      typeof window !== 'undefined' && Number.isFinite(window.richShadingSettings?.seed)
        ? window.richShadingSettings.seed >>> 0
        : Math.floor(Math.random() * 1e9) >>> 0;

    // Currently selected terrain placeable id (managed by coordinator)
    this._selectedPlaceable = null;
    // Whether the Placeable Tiles panel is visible in the UI. Controlled by UI layer.
    // When false, placeable selection/preview/placement should be inert.
    // Default to hidden (DOM default uses display:none) and let UI sync actual state
    this._placeablesPanelVisible = false;
    // Placeable Tiles brush size (independent from terrain brush)
    // Initialized to current terrain brush size so UI starts consistent but remains independent
    this._ptBrushSize = this.brush?.brushSize || 1;

    // Placeable removal mode flag (UI toggle). When true, clicks remove plant/tree placeables
    // instead of placing or editing height. Drag removal not yet supported (intentional
    // to reduce accidental large wipes). Accessors provided below.
    this._placeableRemovalMode = false;

    logger.debug(
      'TerrainCoordinator initialized',
      {
        context: 'TerrainCoordinator.constructor',
        stage: 'initialization',
        defaultTool: this.brush.tool,
        defaultBrushSize: this.brush.brushSize,
        timestamp: new Date().toISOString(),
      },
      LOG_CATEGORY.SYSTEM
    );
  }

  // ------------------------------
  // Placeables UI & Removal Mode API
  // ------------------------------
  /** Current selected placeable id (string|null). */
  getSelectedPlaceable() {
    return this._selectedPlaceable || null;
  }

  /** Set or clear the currently selected placeable id. */
  setSelectedPlaceable(id) {
    // Block selection changes while removal mode is active
    if (this._placeableRemovalMode) {
      return false;
    }
    if (id === null || id === undefined || id === '') {
      this._selectedPlaceable = null;
      return true;
    }
    if (typeof id === 'string') {
      this._selectedPlaceable = id;
      // Selecting a placeable implicitly disables placeable removal mode (mutually exclusive UX)
      this._placeableRemovalMode = false;
      return true;
    }
    return false;
  }

  /** Whether the placeables panel is currently visible to the user. */
  isPlaceablesPanelVisible() {
    return !!this._placeablesPanelVisible;
  }

  /** Inform coordinator of placeables panel visibility (affects preview + placement). */
  setPlaceablesPanelVisible(visible) {
    this._placeablesPanelVisible = !!visible;
    // If panel is hidden, clear selection to avoid confusing hidden-state placement
    if (!this._placeablesPanelVisible) {
      this._selectedPlaceable = null;
    }
  }

  /** Enable/disable placeable removal mode (clears selected placeable when enabling). */
  setPlaceableRemovalMode(enabled) {
    this._placeableRemovalMode = !!enabled;
    if (this._placeableRemovalMode) {
      // Ensure no placeable is selected while removing
      this._selectedPlaceable = null;
      // Optionally reflect globally used fallback variable
      if (typeof window !== 'undefined') {
        window.selectedTerrainPlaceable = null;
      }
    }
  }

  /** Returns true if placeable removal mode is active. */
  isPlaceableRemovalMode() {
    return !!this._placeableRemovalMode;
  }

  /**
   * Validate that all required dependencies are available
   * @private
   */
  validateDependencies() {
    return _validateDeps(this);
  }

  /**
   * Initialize terrain system and create managers
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      // Validate that grid system is ready
      if (!this.gameManager.gridContainer) {
        throw new Error('Grid container must be created before terrain system initialization');
      }

      // Import TerrainManager dynamically to avoid circular dependencies
      const { TerrainManager } = await import('../managers/TerrainManager.js');
      this.terrainManager = new TerrainManager(this.gameManager, this);

      // Initialize terrain height data array
      this.initializeTerrainData();

      // Initialize terrain rendering system
      this.terrainManager.initialize();

      // Set up terrain-specific input handlers
      this.setupTerrainInputHandlers();

      logger.info(
        'Terrain system initialized',
        {
          context: 'TerrainCoordinator.initialize',
          stage: 'initialization_complete',
          gridDimensions: {
            cols: this.gameManager.cols,
            rows: this.gameManager.rows,
          },
          terrainManagerReady: !!this.terrainManager,
          inputHandlersConfigured: true,
          timestamp: new Date().toISOString(),
        },
        LOG_CATEGORY.SYSTEM
      );
    } catch (error) {
      GameErrors.initialization(error, {
        stage: 'TerrainCoordinator.initialize',
        gameManagerAvailable: !!this.gameManager,
        gridDimensions: {
          cols: this.gameManager?.cols,
          rows: this.gameManager?.rows,
        },
      });
      throw error;
    }
  }

  /**
   * Initialize terrain height data for the current grid
   */
  initializeTerrainData() {
    return _initTerrainData(this);
  }

  /**
   * Set up terrain-specific input event handlers
   */
  setupTerrainInputHandlers() {
    try {
      this._inputHandlers.setup();
    } catch (error) {
      GameErrors.initialization(error, {
        stage: 'setupTerrainInputHandlers',
        appViewAvailable: !!this.gameManager?.app?.view,
      });
      throw error;
    }
  }

  /**
   * Handle mouse down events for terrain modification
   * @param {MouseEvent} event - Mouse event
   */
  handleTerrainMouseDown(event) {
    if (this.gameManager?.getViewMode && this.gameManager.getViewMode() === 'topdown') return false;
    return this._inputHandlers.handleMouseDown(event);
  }

  /**
   * Handle mouse move events for continuous terrain painting
   * @param {MouseEvent} event - Mouse event
   */
  handleTerrainMouseMove(event) {
    if (this.gameManager?.getViewMode && this.gameManager.getViewMode() === 'topdown') return false;
    return this._inputHandlers.handleMouseMove(event);
  }

  /**
   * Handle mouse up events to stop terrain painting
   * @param {MouseEvent} event - Mouse event
   */
  handleTerrainMouseUp(event) {
    if (this.gameManager?.getViewMode && this.gameManager.getViewMode() === 'topdown') return false;
    return this._inputHandlers.handleMouseUp(event);
  }

  /**
   * Handle mouse leave events to stop terrain painting
   */
  handleTerrainMouseLeave() {
    if (this.gameManager?.getViewMode && this.gameManager.getViewMode() === 'topdown') return false;
    return this._inputHandlers.handleMouseLeave();
  }

  /**
   * Handle keyboard shortcuts for terrain tools
   * @param {KeyboardEvent} event - Keyboard event
   */
  handleTerrainKeyDown(event) {
    if (this.gameManager?.getViewMode && this.gameManager.getViewMode() === 'topdown') return false;
    return this._inputHandlers.handleKeyDown(event);
  }

  /**
   * Update the height indicator in the UI to show terrain level at cursor position
   * @param {number} gridX - Grid X coordinate
   * @param {number} gridY - Grid Y coordinate
   */
  updateHeightIndicator(gridX, gridY) {
    return this._inputHandlers.updateHeightIndicator(gridX, gridY);
  }

  /**
   * Reset the height indicator to default state
   */
  resetHeightIndicator() {
    return this._inputHandlers.resetHeightIndicator();
  }

  /** Get the current elevation perception scale (pixels per level). */
  getElevationScale() {
    return this._elevationScale;
  }

  /**
   * Set the elevation perception scale (pixels per level) at runtime and refresh visuals.
   * Applies to overlay tiles, base tiles, faces, and tokens.
   * @param {number} unit - Pixels per height level (0 disables vertical exaggeration)
   */
  setElevationScale(unit, options = {}) {
    return this._elevationScaleController.apply(unit, options);
  }

  /**
   * Get grid coordinates from mouse event
   * @param {MouseEvent} event - Mouse event
   * @returns {Object|null} Grid coordinates or null if invalid
   */
  getGridCoordinatesFromEvent(event) {
    return _getCoordsFromEvent(this, event);
  }

  /**
   * Modify terrain height at specified position
   * @param {number} gridX - Grid X coordinate
   * @param {number} gridY - Grid Y coordinate
   */
  modifyTerrainAtPosition(gridX, gridY) {
    return _modifyAtPos(this, gridX, gridY);
  }

  /**
   * Modify height at a specific cell
   * @param {number} gridX - Grid X coordinate
   * @param {number} gridY - Grid Y coordinate
   */
  modifyTerrainHeightAtCell(gridX, gridY) {
    const changed = _modifyAtCell(this, gridX, gridY);
    if (
      changed &&
      this.gameManager &&
      typeof this.gameManager.notifyTerrainHeightsChanged === 'function'
    ) {
      // Debounced 3D terrain mesh rebuild
      this.gameManager.notifyTerrainHeightsChanged();
    }
    return changed;
  }

  /**
   * Check if grid position is valid
   * @param {number} gridX - Grid X coordinate
   * @param {number} gridY - Grid Y coordinate
   * @returns {boolean} True if position is valid
   */
  isValidGridPosition(gridX, gridY) {
    return _isValidPos(this, gridX, gridY);
  }

  /**
   * Enable terrain modification mode with base terrain loading
   */
  /**
   * NEW METHOD: Comprehensive terrain system state validation
   * Validates all critical components before terrain operations
   * @throws {Error} If terrain system state is corrupted or invalid
   * @returns {boolean} True if all validations pass
   */
  validateTerrainSystemState() {
    return _validateSystemState(this);
  }

  /**
   * NEW METHOD: Validate terrain data array consistency
   * @returns {boolean} True if terrain data structures are consistent
   */
  validateTerrainDataConsistency() {
    return _validateDataConsistency(this);
  }

  enableTerrainMode() {
    return this._activationHelpers.enableTerrainMode();
  }

  /**
   * Public: Load base terrain heights into the working buffer.
   * Expected by internals/mode.loadTerrainStateAndDisplay which calls
   * c.loadBaseTerrainIntoWorkingState().
   */
  loadBaseTerrainIntoWorkingState() {
    return _loadBaseIntoWorking(this);
  }

  /**
   * DECOMPOSED METHOD: Prepare base grid visuals for editing overlay
   * Resets per-tile elevation offsets, shadows, and base 3D faces so
   * the editing overlay is the sole visual representation of height.
   * @private
   */
  // Removed: pass-through wrapper now handled by ActivationHelpers directly

  /**
   * DECOMPOSED METHOD: Validate terrain system before activation
   * @private
   */
  // Removed: pass-through wrapper now handled by ActivationHelpers directly

  /**
   * DECOMPOSED METHOD: Reset terrain container state safely
   * @private
   */
  // Removed: pass-through wrapper now handled by ActivationHelpers directly

  /**
   * DECOMPOSED METHOD: Validate container integrity after reset
   * @private
   */
  // Removed: pass-through wrapper now handled by ActivationHelpers directly

  /**
   * DECOMPOSED METHOD: Activate terrain mode state
   * @private
   */
  // Removed: pass-through wrapper now handled by ActivationHelpers directly

  /**
   * Public: Handle grid resize by reinitializing terrain data and preserving overlap.
   * @param {number} newCols
   * @param {number} newRows
   */
  handleGridResize(newCols, newRows) {
    return _handleResize(this, newCols, newRows);
  }

  /**
   * DECOMPOSED METHOD: Load terrain state and display
   * @private
   */
  // Removed: pass-through wrapper now handled by ActivationHelpers directly

  /**
   * DECOMPOSED METHOD: Handle terrain mode activation errors
   * @private
   * @param {Error} error - The error that occurred during activation
   */
  // Removed: pass-through wrapper now handled by ActivationHelpers directly

  /**
   * Disable terrain modification mode and apply changes permanently
   */
  disableTerrainMode() {
    return this._activationHelpers.disableTerrainMode();
  }

  /**
   * Public: Apply current working terrain to the base grid permanently.
   * Used by ActivationHelpers.disableTerrainMode().
   * @returns {number} modifiedTiles - count of non-default tiles updated
   */
  applyTerrainToBaseGrid() {
    try {
      _validateApplyReqs(this);
      _initBaseHeights(this);
      const modified = _processAllTiles(this);
      _logApplyComplete(this, modified);
      return modified;
    } catch (error) {
      _handleApplyError(error);
    }
  }

  /**
   * Set current terrain tool with robust validation
   * @param {string} tool - Tool name ('raise' or 'lower')
   */
  setTerrainTool(tool) {
    return _setTool(this, tool);
  }

  /**
   * Brush size proxy for UI and render calls
   * Getter returns current brush size from controller.
   * Setter clamps value within config bounds.
   */
  get brushSize() {
    return _getBrushSize(this);
  }

  set brushSize(value) {
    _setBrushSize(this, value);
  }

  /**
   * Placeable Tiles brush size (independent of terrain brush size).
   * Getter/Setter are exposed for UI and tests. Setter clamps to config bounds.
   */
  get ptBrushSize() {
    return this._ptBrushSize;
  }

  set ptBrushSize(value) {
    try {
      const min = TERRAIN_CONFIG.MIN_BRUSH_SIZE || 1;
      const max = TERRAIN_CONFIG.MAX_BRUSH_SIZE || 5;
      const n = Math.trunc(Number(value));
      if (Number.isFinite(n)) {
        this._ptBrushSize = Math.max(min, Math.min(max, n));
      }
    } catch (_) {
      // leave as-is on bad input
    }
  }

  /**
   * Increase brush size
   */
  increaseBrushSize() {
    return _incBrush(this);
  }

  /**
   * Decrease brush size
   */
  decreaseBrushSize() {
    return _decBrush(this);
  }

  /**
   * Get terrain height at specific coordinates
   * @param {number} gridX - Grid X coordinate
   * @param {number} gridY - Grid Y coordinate
   * @returns {number} Terrain height
   */
  getTerrainHeight(gridX, gridY) {
    return _getHeight(this, gridX, gridY);
  }

  /**
   * Reset all terrain heights to default
   */
  resetTerrain() {
    return _resetTerrain(this);
  }

  /** Enable or disable the rich biome canvas shading outside terrain mode. */
  setRichShadingEnabled(enabled) {
    return _setRichShadingEnabled(this, enabled);
  }

  /**
   * NEW METHOD: Update base grid tile in-place without destruction (SAFER)
   * @param {number} x - Grid X coordinate
   * @param {number} y - Grid Y coordinate
   * @param {number} height - Terrain height value
   * @returns {boolean} True if tile was updated successfully, false if replacement needed
   */
  updateBaseGridTileInPlace(x, y, height) {
    return _updateBaseGridTileInPlace(this, x, y, height);
  }

  /**
   * Replace a base grid tile with terrain-modified version (ENHANCED SAFETY)
   * @param {number} x - Grid X coordinate
   * @param {number} y - Grid Y coordinate
   * @param {number} height - Terrain height value
   */
  replaceBaseGridTile(x, y, height) {
    return _replaceBaseGridTile(this, x, y, height);
  }

  // (implementation details for tile lifecycle and elevation visuals are handled
  //  by TileLifecycleController and ElevationVisualsController respectively)
  /** Determine base tile color when not editing: biome palette if selected, else neutral. */
  _getBiomeOrBaseColor(height) {
    return _getBiomeOrBaseColorInternal(this, height);
  }

  /** Re-color existing base grid tiles using currently selected biome palette. */
  applyBiomePaletteToBaseGrid() {
    return this._biomeShading.applyToBaseGrid();
  }

  /** Optional: allow external systems/UI to set a deterministic seed for biome visuals. */
  setBiomeSeed(seed) {
    return _setBiomeSeed(this, seed);
  }

  /** Show or hide the base tile fills (keeping borders) */
  _toggleBaseTileVisibility(show) {
    return this._biomeShading.toggleBaseTileVisibility(show);
  }

  /**
   * Public pass-through for elevation visual effect so tests and collaborators
   * can stub/spy this method without depending on private fields.
   * @param {PIXI.DisplayObject} tile
   * @param {number} height
   */
  addVisualElevationEffect(tile, height) {
    return this._elevationVisuals.addVisualElevationEffect(tile, height);
  }

  /**
   * Pass-through: get color for a given height when editing terrain.
   * Uses TerrainManager's palette logic if available; falls back to biome/base color.
   */
  getColorForHeight(height) {
    try {
      if (this.terrainManager && typeof this.terrainManager.getColorForHeight === 'function') {
        return this.terrainManager.getColorForHeight(height);
      }
    } catch (_) {
      /* ignore and fall back */
    }
    return this._getBiomeOrBaseColor(height);
  }

  /**
   * Generate and apply biome-based elevations if the terrain is flat (no manual edits).
   * Safe to call repeatedly; it will no-op once edits exist.
   * Only affects base/working data and base tiles; does nothing in terrain edit mode.
   */
  generateBiomeElevationIfFlat(biomeKey, options = {}) {
    if (this.gameManager?.getViewMode && this.gameManager.getViewMode() === 'topdown') return false;
    try {
      if (this.isTerrainModeActive) return false;
      // Headless/test mode support: if gridContainer is missing (no PIXI app), create a stub
      if (!this.gameManager?.gridContainer) {
        this.gameManager.gridContainer = {
          removeChildren() {},
          addChild() {},
        };
      }
      if (this._isGenerating) return false;
      this._isGenerating = true;
      const base = this.dataStore?.base;
      const working = this.dataStore?.working;
      if (!base || !working) return false;
      const flatBase = isAllDefaultHeight(base);
      const flatWorking = isAllDefaultHeight(working);
      if (!flatBase || !flatWorking) return false;

      const rows = this.gameManager.rows;
      const cols = this.gameManager.cols;
      const seed = Number.isFinite(options.seed) ? options.seed : this._biomeSeed >>> 0;
      const field = generateBiomeElevationField(
        biomeKey || (typeof window !== 'undefined' && window.selectedBiome) || 'grassland',
        rows,
        cols,
        { ...options, seed }
      );

      // Update data store
      this.dataStore.base = field.map((r) => [...r]);
      this.dataStore.working = field.map((r) => [...r]);

      // Repaint base tiles to reflect new elevations
      _validateApplyReqs(this); // throws if missing requirements
      const modified = _processAllTiles(this);
      _logApplyComplete(this, modified);
      // Ensure rich biome canvas (if enabled) repaints using the new heights to avoid stale overlays
      try {
        this.applyBiomePaletteToBaseGrid();
      } catch (_) {
        /* non-fatal */
      }
      // Populate sparse biome flora (trees)
      try {
        _autoPopulateBiomeFlora(
          this,
          biomeKey || (typeof window !== 'undefined' && window.selectedBiome),
          seed
        );
      } catch (_) {
        /* ignore flora errors */
      }
      return true;
    } catch (_) {
      return false;
    } finally {
      this._isGenerating = false;
    }
  }

  /**
   * Generate and apply biome-based elevations regardless of current flatness.
   * Overwrites base and working height fields and repaints base tiles.
   * Does nothing while terrain edit mode is active.
   * @param {string} biomeKey
   * @param {{seed?: number}} options
   * @returns {boolean} true if generation applied
   */
  generateBiomeElevation(biomeKey, options = {}) {
    if (this.gameManager?.getViewMode && this.gameManager.getViewMode() === 'topdown') return false;
    try {
      if (this.isTerrainModeActive) return false;
      if (!this.gameManager?.gridContainer) {
        // Headless mode: provide a minimal container so downstream calls succeed
        this.gameManager.gridContainer = {
          removeChildren() {},
          addChild() {},
        };
      }
      if (this._isGenerating) return false;
      this._isGenerating = true;

      const rows = this.gameManager.rows;
      const cols = this.gameManager.cols;
      const seed = Number.isFinite(options.seed) ? options.seed : this._biomeSeed >>> 0;
      const activeBiome =
        biomeKey || (typeof window !== 'undefined' && window.selectedBiome) || 'grassland';
      // Auto-apply biome-appropriate elevation perception (pixels per level) before generation
      try {
        const hintedUnit = getBiomeElevationScaleHint(activeBiome);
        if (Number.isFinite(hintedUnit) && this.setElevationScale) {
          // Avoid mid-generation repaint to reduce flicker/ghosting
          this.setElevationScale(hintedUnit, { repaintBiome: false });
        }
      } catch (_) {
        /* non-fatal: fall back to current unit */
      }
      const field = generateBiomeElevationField(activeBiome, rows, cols, { ...options, seed });

      // Update data store
      this.dataStore.base = field.map((r) => [...r]);
      this.dataStore.working = field.map((r) => [...r]);

      // If running in headless/testing mode, optionally skip expensive tile processing & rendering
      if (options.headless === true) {
        // Provide a stub terrainManager if not already available so flora population can record placements
        if (!this.terrainManager) {
          this.terrainManager = {
            gameManager: this.gameManager,
            placeables: new Map(),
            placeTerrainItem(x, y, id) {
              const key = `${x},${y}`;
              let arr = this.placeables.get(key);
              if (!arr) {
                arr = [];
                this.placeables.set(key, arr);
              }
              const sprite = { placeableType: 'plant', id, x, y, parent: null };
              arr.push(sprite);
              return true;
            },
          };
        }
        try {
          _autoPopulateBiomeFlora(this, activeBiome, seed);
        } catch (_) {
          /* ignore flora errors */
        }
        return true;
      }

      // Repaint base tiles to reflect new elevations (full mode)
      _validateApplyReqs(this);
      const modified = _processAllTiles(this);
      _logApplyComplete(this, modified);
      // Repaint biome canvas/shading with updated heights to prevent ghosting from the previous map
      try {
        this.applyBiomePaletteToBaseGrid();
      } catch (_) {
        /* non-fatal */
      }
      try {
        _autoPopulateBiomeFlora(this, activeBiome, seed);
      } catch (_) {
        /* ignore flora errors */
      }
      return true;
    } catch (_) {
      return false;
    } finally {
      this._isGenerating = false;
    }
  }
}
