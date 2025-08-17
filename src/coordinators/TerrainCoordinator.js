/**
 * TerrainCoordinator.js - Manages terrain height modification system
 * 
 * Follows the established coordinator pattern for the TavernTable application
 * Handles terrain height data management, rendering coordination, and system lifecycle
 */

import { logger, LOG_CATEGORY } from '../utils/Logger.js';
import { GameErrors } from '../utils/ErrorHandler.js';
import { GameValidators, Sanitizers } from '../utils/Validation.js';
import { TERRAIN_CONFIG } from '../config/TerrainConstants.js';
// import { TerrainHeightUtils } from '../utils/TerrainHeightUtils.js';
// import { darkenColor, lightenColor } from '../utils/ColorUtils.js';
// import { TerrainValidation } from '../utils/TerrainValidation.js';
import { TerrainDataStore } from '../terrain/TerrainDataStore.js';
import { TerrainBrushController } from '../terrain/TerrainBrushController.js';
import { TerrainFacesRenderer } from '../terrain/TerrainFacesRenderer.js';
// import { TerrainPixiUtils } from '../utils/TerrainPixiUtils.js';
// import { TerrainHeightUtils } from '../utils/TerrainHeightUtils.js';
import { CoordinateUtils } from '../utils/CoordinateUtils.js';
import { TerrainInputHandlers } from './terrain-coordinator/TerrainInputHandlers.js';
import { ElevationScaleController } from './terrain-coordinator/ElevationScaleController.js';
import { ActivationHelpers } from './terrain-coordinator/ActivationHelpers.js';
import { BiomeShadingController } from './terrain-coordinator/BiomeShadingController.js';
import { TileLifecycleController } from './terrain-coordinator/TileLifecycleController.js';
import { ElevationVisualsController } from './terrain-coordinator/ElevationVisualsController.js';
import { prepareBaseGridForEditing as _prepareGridForEdit, resetTerrainContainerSafely as _resetContainerSafely, validateContainerIntegrity as _validateContainer } from './terrain-coordinator/internals/container.js';
import { validateTerrainSystemState as _validateSystemState, validateTerrainDataConsistency as _validateDataConsistency } from './terrain-coordinator/internals/validation.js';
import { validateApplicationRequirements as _validateApplyReqs, initializeBaseHeights as _initBaseHeights, processAllGridTiles as _processAllTiles, logCompletion as _logApplyComplete, handleApplicationError as _handleApplyError } from './terrain-coordinator/internals/apply.js';
import { activateTerrainMode as _activateMode, loadTerrainStateAndDisplay as _loadStateAndDisplay, handleTerrainModeActivationError as _handleActivationError } from './terrain-coordinator/internals/mode.js';
import { getGridCoordinatesFromEvent as _getCoordsFromEvent, modifyTerrainAtPosition as _modifyAtPos } from './terrain-coordinator/internals/inputs.js';
import { setRichShadingEnabled as _setRichShadingEnabled, setBiomeSeed as _setBiomeSeed, handlePostResetShading as _handlePostResetShading } from './terrain-coordinator/internals/biome.js';
import { getBiomeOrBaseColor as _getBiomeOrBaseColorInternal } from './terrain-coordinator/internals/color.js';
import { handleGridResize as _handleResize } from './terrain-coordinator/internals/resize.js';
import { setTerrainTool as _setTool, getBrushSize as _getBrushSize, setBrushSize as _setBrushSize, increaseBrushSize as _incBrush, decreaseBrushSize as _decBrush } from './terrain-coordinator/internals/tools.js';
import { updateBaseGridTileInPlace as _updateBaseGridTileInPlace, replaceBaseGridTile as _replaceBaseGridTile } from './terrain-coordinator/internals/baseGridUpdates.js';
import { resetTerrain as _resetTerrain } from './terrain-coordinator/internals/reset.js';

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
  validateDependencies() {
    const missingDependencies = [];

    // Check required utilities
    if (!GameValidators) {
      missingDependencies.push('GameValidators');
    }
    if (!Sanitizers) {
      missingDependencies.push('Sanitizers');
    }

    // Check specific methods we need
    if (typeof Sanitizers?.enum !== 'function') {
      logger.warn('Sanitizers.enum method not available', {
        context: 'TerrainCoordinator.validateDependencies',
        sanitizersType: typeof Sanitizers,
        enumType: typeof Sanitizers?.enum,
        availableMethods: Sanitizers ? Object.keys(Sanitizers) : []
      });
    }

    if (missingDependencies.length > 0) {
      throw new Error(`Missing required dependencies: ${missingDependencies.join(', ')}`);
    }

    logger.debug('Dependencies validated', {
      context: 'TerrainCoordinator.validateDependencies',
      sanitizersEnumAvailable: typeof Sanitizers?.enum === 'function',
      allDependenciesValid: missingDependencies.length === 0
    }, LOG_CATEGORY.SYSTEM);
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
  initializeTerrainData() {
    try {
      const cols = this.gameManager.cols;
      const rows = this.gameManager.rows;

      // Validate grid dimensions
      if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols <= 0 || rows <= 0) {
        throw new Error(`Invalid grid dimensions: ${cols}x${rows}`);
      }

      // Ensure datastore is sized properly
      this.dataStore.resize(cols, rows);

      logger.debug('Terrain data initialized', {
        context: 'TerrainCoordinator.initializeTerrainData',
        stage: 'data_initialization',
        gridDimensions: { cols, rows },
        totalCells: cols * rows,
        defaultHeight: TERRAIN_CONFIG.DEFAULT_HEIGHT,
        dataStructure: 'complete'
      }, LOG_CATEGORY.SYSTEM);
    } catch (error) {
      GameErrors.initialization(error, {
        stage: 'initializeTerrainData',
        gridDimensions: {
          cols: this.gameManager?.cols,
          rows: this.gameManager?.rows
        }
      });
      throw error;
    }
  }

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
  setElevationScale(unit) {
    return this._elevationScaleController.apply(unit);
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
    // Delegate to brush controller (kept for compatibility of method name)
    this.brush.applyAt(gridX, gridY);
  }

  /**
   * Check if grid position is valid
   * @param {number} gridX - Grid X coordinate
   * @param {number} gridY - Grid Y coordinate
   * @returns {boolean} True if position is valid
   */
  isValidGridPosition(gridX, gridY) {
    return CoordinateUtils.isValidGridPosition(gridX, gridY, this.gameManager.cols, this.gameManager.rows);
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
  _prepareBaseGridForEditing() {
    return _prepareGridForEdit(this);
  }

  /**
   * DECOMPOSED METHOD: Validate terrain system before activation
   * @private
   */
  _validateTerrainSystemForActivation() {
    // CRITICAL: Validate terrain system state before proceeding
    this.validateTerrainSystemState();
  }

  /**
   * DECOMPOSED METHOD: Reset terrain container state safely
   * @private
   */
  _resetTerrainContainerSafely() {
    return _resetContainerSafely(this);
  }

  /**
   * DECOMPOSED METHOD: Validate container integrity after reset
   * @private
   */
  _validateContainerIntegrity() {
    return _validateContainer(this);
  }

  /**
   * DECOMPOSED METHOD: Activate terrain mode state
   * @private
   */
  _activateTerrainMode() {
    return _activateMode(this);
  }

  /**
   * DECOMPOSED METHOD: Load terrain state and display
   * @private
   */
  _loadTerrainStateAndDisplay() {
    return _loadStateAndDisplay(this);
  }

  /**
   * DECOMPOSED METHOD: Handle terrain mode activation errors
   * @private
   * @param {Error} error - The error that occurred during activation
   */
  _handleTerrainModeActivationError(error) {
    return _handleActivationError(this, error);
  }

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
    // Defensive bounds checks to avoid out-of-range indexing
    const heights = this.dataStore?.working;
    if (!heights || !Array.isArray(heights)) {
      return TERRAIN_CONFIG.DEFAULT_HEIGHT;
    }
    if (!Number.isInteger(gridX) || !Number.isInteger(gridY)) {
      return TERRAIN_CONFIG.DEFAULT_HEIGHT;
    }
    if (gridY < 0 || gridY >= heights.length) {
      return TERRAIN_CONFIG.DEFAULT_HEIGHT;
    }
    const row = heights[gridY];
    if (!Array.isArray(row)) {
      return TERRAIN_CONFIG.DEFAULT_HEIGHT;
    }
    if (gridX < 0 || gridX >= row.length) {
      return TERRAIN_CONFIG.DEFAULT_HEIGHT;
    }
    return row[gridX];
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
  loadBaseTerrainIntoWorkingState() {
    try {
      if (!this.dataStore.base) {
        logger.warn('No base terrain heights available, initializing default state', {
          context: 'TerrainCoordinator.loadBaseTerrainIntoWorkingState'
        });
        this.initializeTerrainData();
        return;
      }

      // Deep copy base terrain heights into working state
      this.dataStore.loadBaseIntoWorking();

      logger.debug('Base terrain loaded into working state', {
        context: 'TerrainCoordinator.loadBaseTerrainIntoWorkingState',
        gridDimensions: {
          cols: this.gameManager.cols,
          rows: this.gameManager.rows
        }
      }, LOG_CATEGORY.SYSTEM);
    } catch (error) {
      GameErrors.gameState(error, {
        stage: 'loadBaseTerrainIntoWorkingState',
        context: 'TerrainCoordinator.loadBaseTerrainIntoWorkingState'
      });
      throw error;
    }
  }

  /**
   * Apply terrain modifications permanently to the base grid
   * SAFER APPROACH: Updates existing tiles instead of mass destruction/recreation
   */
  applyTerrainToBaseGrid() {
    try {
      this._validateTerrainApplicationRequirements();
      this._initializeBaseTerrainHeights();
      const modifiedTiles = this._processAllGridTiles();
      this._logTerrainApplicationCompletion(modifiedTiles);
    } catch (error) {
      this._handleTerrainApplicationError(error);
    }
  }

  /**
   * Validate requirements for terrain application to base grid
   * @private
   * @throws {Error} If requirements are not met
   */
  _validateTerrainApplicationRequirements() {
    return _validateApplyReqs(this);
  }

  /**
   * Initialize base terrain heights from current terrain state
   * @private
   */
  _initializeBaseTerrainHeights() {
    return _initBaseHeights(this);
  }

  /**
   * Process all grid tiles with terrain modifications
   * @private
   * @returns {number} Number of modified tiles
   */
  _processAllGridTiles() {
    return _processAllTiles(this);
  }

  /**
   * Log successful completion of terrain application
   * @private
   * @param {number} modifiedTiles - Number of tiles that were modified
   */
  _logTerrainApplicationCompletion(modifiedTiles) {
    return _logApplyComplete(this, modifiedTiles);
  }

  /**
   * Handle errors during terrain application
   * @private
   * @param {Error} error - The error that occurred
   * @throws {Error} Re-throws the error after logging
   */
  _handleTerrainApplicationError(error) {
    return _handleApplyError(error);
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

  /**
   * Find existing grid tiles at specified coordinates that need removal
   * @private
   * @param {number} x - Grid X coordinate
   * @param {number} y - Grid Y coordinate
   * @returns {Array} Array of tiles to remove
   */
  // moved to TileLifecycleController: findGridTilesToRemove

  /**
   * Safely remove grid tiles with error isolation
   * @private
   * @param {Array} tilesToRemove - Array of tiles to remove
   * @param {number} x - Grid X coordinate for logging
   * @param {number} y - Grid Y coordinate for logging
   */
  // moved to TileLifecycleController: removeGridTilesSafely

  /**
   * Create new terrain tile replacement
   * @private
   * @param {number} x - Grid X coordinate
   * @param {number} y - Grid Y coordinate
   * @param {number} height - Terrain height value
   * @returns {PIXI.Graphics} New tile graphics object
   * @throws {Error} If tile creation fails
   */
  // moved to TileLifecycleController: createReplacementTile

  /**
   * Apply elevation effects and store height data on tile
   * @private
   * @param {PIXI.Graphics} newTile - The newly created tile
   * @param {number} height - Terrain height value
   * @param {number} x - Grid X coordinate for logging
   * @param {number} y - Grid Y coordinate for logging
   */
  // moved to TileLifecycleController: applyTileEffectsAndData

  /**
   * Log successful tile replacement
   * @private
   * @param {number} x - Grid X coordinate
   * @param {number} y - Grid Y coordinate
   * @param {number} height - Terrain height value
   * @param {number} removedTileCount - Number of tiles removed
   */
  // moved to TileLifecycleController: logTileReplacementSuccess

  /**
   * Handle tile replacement errors gracefully
   * @private
   * @param {Error} error - The error that occurred
   * @param {number} x - Grid X coordinate
   * @param {number} y - Grid Y coordinate
   * @param {number} height - Terrain height value
   */
  // moved to TileLifecycleController: handleTileReplacementError

  // moved to ElevationVisualsController: addVisualElevationEffect

  // Add neighbor-aware 3D faces for base grid tiles (all four sides)
  // moved to TileLifecycleController: addBase3DFaces
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

  // moved to ShadingHelpers.js: shadeRand, drawShade* helpers

  /**
   * Public pass-through for elevation visual effect so tests and collaborators
   * can stub/spy this method without depending on private fields.
   * @param {PIXI.DisplayObject} tile
   * @param {number} height
   */
  addVisualElevationEffect(tile, height) {
    return this._elevationVisuals.addVisualElevationEffect(tile, height);
  }
}
