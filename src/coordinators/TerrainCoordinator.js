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
import { validateTerrainSystemState as _validateSystemState, validateTerrainDataConsistency as _validateDataConsistency } from './terrain-coordinator/internals/validation.js';
import { validateApplicationRequirements as _validateApplyReqs, initializeBaseHeights as _initBaseHeights, processAllGridTiles as _processAllTiles, logCompletion as _logApplyComplete, handleApplicationError as _handleApplyError } from './terrain-coordinator/internals/apply.js';
import { getGridCoordinatesFromEvent as _getCoordsFromEvent, modifyTerrainAtPosition as _modifyAtPos } from './terrain-coordinator/internals/inputs.js';
import { setRichShadingEnabled as _setRichShadingEnabled, setBiomeSeed as _setBiomeSeed } from './terrain-coordinator/internals/biome.js';
import { getBiomeOrBaseColor as _getBiomeOrBaseColorInternal } from './terrain-coordinator/internals/color.js';
import { handleGridResize as _handleResize } from './terrain-coordinator/internals/resize.js';
import { getTerrainHeight as _getHeight } from './terrain-coordinator/internals/height.js';
import { isValidGridPosition as _isValidPos } from './terrain-coordinator/internals/coords.js';
import { modifyTerrainHeightAtCell as _modifyAtCell } from './terrain-coordinator/internals/brush.js';
import { setTerrainTool as _setTool, getBrushSize as _getBrushSize, setBrushSize as _setBrushSize, increaseBrushSize as _incBrush, decreaseBrushSize as _decBrush } from './terrain-coordinator/internals/tools.js';
import { updateBaseGridTileInPlace as _updateBaseGridTileInPlace, replaceBaseGridTile as _replaceBaseGridTile } from './terrain-coordinator/internals/baseGridUpdates.js';
import { resetTerrain as _resetTerrain } from './terrain-coordinator/internals/reset.js';
import { loadBaseTerrainIntoWorkingState as _loadBaseIntoWorking } from './terrain-coordinator/internals/state.js';
import { initializeTerrainData as _initTerrainData } from './terrain-coordinator/internals/init.js';
import { validateDependencies as _validateDeps } from './terrain-coordinator/internals/deps.js';
import { generateBiomeElevationField, isAllDefaultHeight, getBiomeElevationScaleHint } from '../terrain/BiomeElevationGenerator.js';

export class TerrainCoordinator {
  constructor(gameManager) {
    this.gameManager = gameManager;
    this.terrainManager = null;

    // Validate dependencies at construction time
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
    this._biomeSeed = (typeof window !== 'undefined' && Number.isFinite(window.richShadingSettings?.seed))
      ? (window.richShadingSettings.seed >>> 0)
      : (Math.floor(Math.random() * 1e9) >>> 0);

    logger.debug('TerrainCoordinator initialized', {
      context: 'TerrainCoordinator.constructor',
      stage: 'initialization',
      defaultTool: this.brush.tool,
      defaultBrushSize: this.brush.brushSize,
      timestamp: new Date().toISOString()
    }, LOG_CATEGORY.SYSTEM);
  }

  /**
   * Validate that all required dependencies are available
   * @private
   */
  validateDependencies() { return _validateDeps(this); }

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

      logger.info('Terrain system initialized', {
        context: 'TerrainCoordinator.initialize',
        stage: 'initialization_complete',
        gridDimensions: {
          cols: this.gameManager.cols,
          rows: this.gameManager.rows
        },
        terrainManagerReady: !!this.terrainManager,
        inputHandlersConfigured: true,
        timestamp: new Date().toISOString()
      }, LOG_CATEGORY.SYSTEM);
    } catch (error) {
      GameErrors.initialization(error, {
        stage: 'TerrainCoordinator.initialize',
        gameManagerAvailable: !!this.gameManager,
        gridDimensions: {
          cols: this.gameManager?.cols,
          rows: this.gameManager?.rows
        }
      });
      throw error;
    }
  }

  /**
   * Initialize terrain height data for the current grid
   */
  initializeTerrainData() { return _initTerrainData(this); }

  /**
   * Set up terrain-specific input event handlers
   */
  setupTerrainInputHandlers() {
    try { this._inputHandlers.setup(); }
    catch (error) {
      GameErrors.initialization(error, {
        stage: 'setupTerrainInputHandlers',
        appViewAvailable: !!this.gameManager?.app?.view
      });
      throw error;
    }
  }

  /**
   * Handle mouse down events for terrain modification
   * @param {MouseEvent} event - Mouse event
   */
  handleTerrainMouseDown(event) {
    return this._inputHandlers.handleMouseDown(event);
  }

  /**
   * Handle mouse move events for continuous terrain painting
   * @param {MouseEvent} event - Mouse event
   */
  handleTerrainMouseMove(event) {
    return this._inputHandlers.handleMouseMove(event);
  }

  /**
   * Handle mouse up events to stop terrain painting
   * @param {MouseEvent} event - Mouse event
   */
  handleTerrainMouseUp(event) {
    return this._inputHandlers.handleMouseUp(event);
  }

  /**
   * Handle mouse leave events to stop terrain painting
   */
  handleTerrainMouseLeave() {
    return this._inputHandlers.handleMouseLeave();
  }

  /**
   * Handle keyboard shortcuts for terrain tools
   * @param {KeyboardEvent} event - Keyboard event
   */
  handleTerrainKeyDown(event) {
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
    return _modifyAtCell(this, gridX, gridY);
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
  resetTerrain() { return _resetTerrain(this); }

  /** Enable or disable the rich biome canvas shading outside terrain mode. */
  setRichShadingEnabled(enabled) {
    return _setRichShadingEnabled(this, enabled);
  }

  /**
   * Handle grid resize - reinitialize terrain data
   * @param {number} newCols - New column count
   * @param {number} newRows - New row count
   */
  handleGridResize(newCols, newRows) {
    return _handleResize(this, newCols, newRows);
  }

  /**
   * Load base terrain state into working terrain heights for editing
   */
  loadBaseTerrainIntoWorkingState() { return _loadBaseIntoWorking(this); }

  /**
   * Apply terrain modifications permanently to the base grid
   * SAFER APPROACH: Updates existing tiles instead of mass destruction/recreation
   */
  applyTerrainToBaseGrid() {
    try {
      _validateApplyReqs(this);
      _initBaseHeights(this);
      const modifiedTiles = _processAllTiles(this);
      _logApplyComplete(this, modifiedTiles);
    } catch (error) {
      _handleApplyError(error);
    }
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
    } catch (_) { /* ignore and fall back */ }
    return this._getBiomeOrBaseColor(height);
  }

  /**
   * Generate and apply biome-based elevations if the terrain is flat (no manual edits).
   * Safe to call repeatedly; it will no-op once edits exist.
   * Only affects base/working data and base tiles; does nothing in terrain edit mode.
   */
  generateBiomeElevationIfFlat(biomeKey, options = {}) {
    try {
      if (!this.gameManager?.gridContainer || this.isTerrainModeActive) return false;
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
      const seed = Number.isFinite(options.seed) ? options.seed : (this._biomeSeed >>> 0);
      const field = generateBiomeElevationField(
        biomeKey || (typeof window !== 'undefined' && window.selectedBiome) || 'grassland',
        rows,
        cols,
        { ...options, seed }
      );

      // Update data store
      this.dataStore.base = field.map(r => [...r]);
      this.dataStore.working = field.map(r => [...r]);

      // Repaint base tiles to reflect new elevations
      _validateApplyReqs(this); // throws if missing requirements
      const modified = _processAllTiles(this);
      _logApplyComplete(this, modified);
      // Ensure rich biome canvas (if enabled) repaints using the new heights to avoid stale overlays
      try { this.applyBiomePaletteToBaseGrid(); } catch (_) { /* non-fatal */ }
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
    try {
      if (!this.gameManager?.gridContainer || this.isTerrainModeActive) return false;
      if (this._isGenerating) return false;
      this._isGenerating = true;

      const rows = this.gameManager.rows;
      const cols = this.gameManager.cols;
      const seed = Number.isFinite(options.seed) ? options.seed : (this._biomeSeed >>> 0);
      const activeBiome = biomeKey || (typeof window !== 'undefined' && window.selectedBiome) || 'grassland';
      // Auto-apply biome-appropriate elevation perception (pixels per level) before generation
      try {
        const hintedUnit = getBiomeElevationScaleHint(activeBiome);
        if (Number.isFinite(hintedUnit) && this.setElevationScale) {
          // Avoid mid-generation repaint to reduce flicker/ghosting
          this.setElevationScale(hintedUnit, { repaintBiome: false });
        }
      } catch (_) { /* non-fatal: fall back to current unit */ }
      const field = generateBiomeElevationField(
        activeBiome,
        rows,
        cols,
        { ...options, seed }
      );

      // Update data store
      this.dataStore.base = field.map(r => [...r]);
      this.dataStore.working = field.map(r => [...r]);

      // Repaint base tiles to reflect new elevations
      _validateApplyReqs(this);
      const modified = _processAllTiles(this);
      _logApplyComplete(this, modified);
      // Repaint biome canvas/shading with updated heights to prevent ghosting from the previous map
      try { this.applyBiomePaletteToBaseGrid(); } catch (_) { /* non-fatal */ }
      return true;
    } catch (_) {
      return false;
    } finally {
      this._isGenerating = false;
    }
  }
}
