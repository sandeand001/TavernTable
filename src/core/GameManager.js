/**
 * GameManager.js - Simplified main coordinator for TavernTable
 *
 * REFACTORED: Complexity reduced from 566 lines to ~200 lines
 * Responsibilities delegated to specialized coordinators following SOLID principles
 *
 * This is the main controller for the TavernTable isometric grid game.
 * It coordinates between specialized managers while maintaining backward compatibility.
 *
 * Key Responsibilities:
 * - Coordinate between specialized managers
 * - Maintain backward compatibility interfaces
 * - Provide unified API for external systems
 * - Delegate complex operations to appropriate coordinators
 *
 * Architecture:
 * - Uses coordinator pattern for separation of concerns
 * - Maintains existing public API for compatibility
 * - Implements error handling and user feedback
 * - Integrates with existing manager systems
 */

import { GRID_CONFIG } from '../config/GameConstants.js';
import { TERRAIN_CONFIG } from '../config/terrain/TerrainConstants.js';

import { RenderCoordinator } from '../coordinators/RenderCoordinator.js';
import { StateCoordinator } from '../coordinators/StateCoordinator.js';
import { InputCoordinator } from '../coordinators/InputCoordinator.js';
import { TerrainCoordinator } from '../coordinators/TerrainCoordinator.js';
import { SpatialCoordinator } from '../scene/picking/SpatialCoordinator.js';
import {
  enableHybridRender as enableHybridRenderImpl,
  isTestEnvironment as isTestEnvironmentImpl,
  ensureTestThreeSceneFallback as ensureTestThreeSceneFallbackImpl,
} from './game-manager/internals/init.js';
import {
  ensureInstancing as ensureInstancingImpl,
  enableInstancedPlaceables as enableInstancedPlaceablesImpl,
  reinstanceExistingPlants as reinstanceExistingPlantsImpl,
  disableInstancedPlaceables as disableInstancedPlaceablesImpl,
  flushInstancing as flushInstancingImpl,
} from './game-manager/internals/instancing.js';
import {
  applyTokenCommand as applyTokenCommandImpl,
  _setTokenQuickCommand as _setTokenQuickCommandImpl,
  _resolveTokenEntry as _resolveTokenEntryImpl,
  _extractTokenId as _extractTokenIdImpl,
  _handleEmoteCommand as _handleEmoteCommandImpl,
  _playIdleEmote as _playIdleEmoteImpl,
} from './game-manager/internals/tokenCommands.js';
import {
  startTokenDragByGrid as startTokenDragByGridImpl,
  updateTokenDragToGrid as updateTokenDragToGridImpl,
  commitTokenDrag as commitTokenDragImpl,
  cancelTokenDrag as cancelTokenDragImpl,
} from './game-manager/internals/tokenDrag.js';
import { sync3DElevationScaling as sync3DElevationScalingImpl } from './game-manager/internals/elevation.js';
import { logger, LOG_CATEGORY, LOG_LEVEL } from '../utils/logger/Logger.js';
import {
  ErrorHandler,
  errorHandler,
  ERROR_SEVERITY,
  ERROR_CATEGORY,
} from '../utils/error/ErrorHandler.js';
import { Sanitizers } from '../utils/Validation.js';
import { TerrainHeightUtils } from '../utils/terrain/TerrainHeightUtils.js';

// Import existing managers
// Managers are created dynamically within StateCoordinator to avoid circular dependencies
// import { TokenManager } from '../managers/TokenManager.js';
// import { InteractionManager } from '../managers/InteractionManager.js';
// import { GridRenderer } from '../managers/GridRenderer.js';

/**
 * TavernTable Game Manager
 * Main coordinator for game operations with delegated responsibilities
 */
class GameManager {
  // ── Constructor ─────────────────────────────────────────────

  /**
   * Initialize the GameManager with coordinators
   * @param {object} [options] optional overrides
   * @param {number} [options.cols] custom column count for grid
   * @param {number} [options.rows] custom row count for grid
   */
  constructor(options = {}) {
    const { cols, rows } = options || {};

    // Core rendering state
    this.app = null;
    this.gridContainer = null;
    this.spritesReady = false;

    // Grid configuration from constants (must be set BEFORE coordinators use them)
    this.tileWidth = GRID_CONFIG.TILE_WIDTH;
    this.tileHeight = GRID_CONFIG.TILE_HEIGHT;
    this.cols = Number.isInteger(cols) && cols > 0 ? cols : GRID_CONFIG.DEFAULT_COLS;
    this.rows = Number.isInteger(rows) && rows > 0 ? rows : GRID_CONFIG.DEFAULT_ROWS;

    // Create coordinators after grid dimensions are available
    this.renderCoordinator = new RenderCoordinator(this);
    this.stateCoordinator = new StateCoordinator(this);
    this.inputCoordinator = new InputCoordinator(this);
    this.terrainCoordinator = new TerrainCoordinator(this);

    // Managers will be initialized after app creation in initialize()
    this.tokenManager = null;
    this.interactionManager = null;
    this.gridRenderer = null;

    // 3D Transition: canonical spatial mapping (grid -> world) used by future Three.js scene
    this.spatial = new SpatialCoordinator();

    // Rendering mode flag: '2d-iso' (legacy) | '3d-hybrid' (transition) | '3d' (current default)
    this.renderMode = '3d';
    this.threeSceneManager = null; // lazy init when entering hybrid mode
    this.terrainRebuilder = null; // Phase 2: debounced terrain mesh updates
    this.placeableMeshPool = null; // Phase 4: instanced placeables (scaffold)
    this.pickingService = null; // Centralized picking abstraction
    // Feature flags (incremental enablement of new systems)
    this.features = {
      // Enable instanced placeables by default so the experimental menu reflects ON state.
      // Hybrid mode will lazily create the mesh pool when first entered.
      instancedPlaceables: true,
      // (2025-09 refactor) threePlaceableModels & treeModelsReplaceSprites now permanently enabled
      // and their separate flags removed from branching logic. Retain shadow keys for backward
      // compatibility with any UI code that still reads them.
      threePlaceableModels: true, // deprecated: always true
      treeModelsReplaceSprites: true, // deprecated: always true
    };

    this._defaultElevationPixelsPerLevel = Number.isFinite(TERRAIN_CONFIG?.ELEVATION_SHADOW_OFFSET)
      ? Math.max(1, TERRAIN_CONFIG.ELEVATION_SHADOW_OFFSET)
      : 8;
    const initialPixelsPerLevel = TerrainHeightUtils.getElevationUnit();
    const baselinePixels =
      Number.isFinite(initialPixelsPerLevel) && initialPixelsPerLevel > 0
        ? initialPixelsPerLevel
        : this._defaultElevationPixelsPerLevel;
    const baseWorldUnit = Number.isFinite(this.spatial?.elevationUnit)
      ? this.spatial.elevationUnit
      : 0.5;
    this._baselineWorldElevationUnit =
      Number.isFinite(baseWorldUnit) && baseWorldUnit > 0 ? baseWorldUnit : 0.5;
    this._lastAppliedWorldElevationUnit = this._baselineWorldElevationUnit;
    this._lastPixelsPerLevelApplied = baselinePixels;
    this._worldElevationAttenuation = 0.6; // dial back 3D elevation exaggeration

    // Internal: track pending async instancing operations so tests/tools can await completion
    this._pendingInstancingPromises = [];

    // Initialize error handler
    errorHandler.initialize();

    // Configure logger context
    logger.pushContext({ component: 'GameManager' });
  }

  // ── Coordinator Init ────────────────────────────────────────

  /**
   * Initialize the game manager and set up all components
   * @returns {Promise<void>} Promise that resolves when initialization is complete
   */
  async initialize() {
    return this.stateCoordinator.initializeApplication();
  }

  /**
   * Create manager instances after app is ready
   */
  // createManagers() no longer needed here (handled by StateCoordinator.createManagers())

  /**
   * Enable hybrid 2D + 3D rendering. Idempotent.
   * Initializes ThreeSceneManager and switches renderMode.
   */
  async enableHybridRender() {
    return enableHybridRenderImpl(this);
  }

  // ── Public API ─────────────────────────────────────────────

  /**
   * Sync the 3D world elevation unit (world Y per level) so that one elevation level
   * produces the same on-screen vertical pixel displacement as the 2D isometric elevation effect.
   *
   * Contract:
   *  - 2D uses TerrainHeightUtils.getElevationUnit() pixels per level (default 8).
   *  - 3D orthographic camera has a vertical world span = (camera.top - camera.bottom).
   *  - Screen pixels per world unit S = rendererHeightPx / (camera.top - camera.bottom).
   *  - Camera pitch compresses vertical axis by cos(pitch) after rotation.
   *  => desired world elevation unit W satisfies: desiredPixels = S * (W * cos(pitch)).
   *  => W = desiredPixels / (S * cos(pitch)).
   *
   * We recompute when: entering hybrid mode, window resize, or 2D elevation scale change.
   * Defensive: if any value missing, fall back to 0.25 (quarter tile) heuristic.
   */
  sync3DElevationScaling(options = {}) {
    return sync3DElevationScalingImpl(this, options);
  }

  /**
   * Report whether the 3D scene is the authoritative render path.
   * Treat legacy '3d-hybrid' as equivalent to the new '3d' mode so callers remain backwards compatible.
   */
  is3DModeActive() {
    const modeActive = this.renderMode === '3d' || this.renderMode === '3d-hybrid';
    if (!modeActive) return false;
    const manager = this.threeSceneManager;
    if (!manager) return false;
    try {
      if (typeof manager.isReady === 'function') {
        const ready = manager.isReady();
        if (ready != null) return !!ready;
      }
    } catch (_) {
      /* ignore readiness check failures */
    }
    return !!manager.scene;
  }

  /**
   * Return the DOM element that should receive pointer/mouse event listeners.
   * Prefers the Three.js canvas, falls back to stub canvas, then the game container div.
   */
  getEventCanvas() {
    const tsm = this.threeSceneManager;
    if (tsm?.canvas) return tsm.canvas;
    return this.app?.view ?? this.app?.canvas ?? document.getElementById('game-container');
  }

  /**
   * The legacy isometric grid should only render when we are explicitly in 2D mode.
   */
  shouldRenderIsometricGrid() {
    return this.renderMode === '2d-iso';
  }

  // Property getters for backward compatibility with null safety
  get selectedTokenType() {
    return this.tokenManager?.getSelectedTokenType() || 'female-humanoid';
  }

  set selectedTokenType(value) {
    if (this.tokenManager) {
      this.tokenManager.setSelectedTokenType(value);
    }
  }

  get tokenFacingRight() {
    return this.tokenManager?.getTokenFacingRight() || true;
  }

  set tokenFacingRight(value) {
    if (this.tokenManager) {
      this.tokenManager.setTokenFacingRight(value);
    }
  }

  get placedTokens() {
    return this.tokenManager?.getPlacedTokens() || [];
  }

  set placedTokens(value) {
    if (this.tokenManager) {
      this.tokenManager.placedTokens = value;
    }
  }

  // Interaction properties delegated to InteractionManager with null safety
  get gridScale() {
    return this.interactionManager?.getGridScale() || 1.0;
  }

  set gridScale(scale) {
    if (this.interactionManager) {
      this.interactionManager.setGridScale(scale);
    }
  }

  get isDragging() {
    return this.interactionManager?.getIsDragging() || false;
  }

  get isSpacePressed() {
    return this.interactionManager?.getIsSpacePressed() || false;
  }

  /**
   * Convenience wrapper: ensure hybrid mode (if requested) then toggle isometric camera preset.
   * @param {boolean} enabled whether isometric preset should be active
   * @param {object} [options]
   * @param {boolean} [options.autoEnableHybrid=true] automatically enable hybrid if not yet active
   * @returns {Promise<boolean>} true if applied, false otherwise
   */
  async setIsometricCamera(enabled = true, options = {}) {
    const { autoEnableHybrid = true } = options || {};
    try {
      if (!this.threeSceneManager) {
        if (autoEnableHybrid) {
          await this.enableHybridRender();
        } else {
          return false;
        }
      }
      if (this.threeSceneManager?.setIsometricMode) {
        this.threeSceneManager.setIsometricMode(!!enabled);
        return true;
      }
    } catch (_) {
      /* ignore */
    }
    return false;
  }

  /**
   * 3D Helper: place currently selected token at pointer screen coords using PickingService.
   * Fails gracefully if not in hybrid mode or picking unavailable.
   * @param {number} clientX
   * @param {number} clientY
   * @returns {Promise<boolean>} true if a placement was attempted
   */
  async placeTokenAtPointer(clientX, clientY) {
    try {
      if (!this.is3DModeActive()) return false;
      if (!this.pickingService) return false;
      const ground = await this.pickingService.pickGround(clientX, clientY);
      if (!ground || !ground.grid) return false;
      const gx = Math.round(ground.grid.gx);
      const gy = Math.round(ground.grid.gy);
      if (!Number.isFinite(gx) || !Number.isFinite(gy)) return false;
      // Delegate to existing 2D pipeline (which handles validation/removal logic)
      this.handleTokenInteraction(gx, gy);
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * 3D Drag API (public for tests): initiate a token drag by its grid coords.
   * Records original position but does not mutate token grid yet.
   */
  startTokenDragByGrid(gx, gy) {
    return startTokenDragByGridImpl(this, gx, gy);
  }

  /** Update drag preview (token mesh position only) without committing logical grid. */
  updateTokenDragToGrid(gx, gy) {
    return updateTokenDragToGridImpl(this, gx, gy);
  }

  /** Commit the drag (apply grid change) */
  commitTokenDrag() {
    return commitTokenDragImpl(this);
  }

  /** Cancel current drag reverting mesh to original grid (does not change logical token position) */
  cancelTokenDrag() {
    return cancelTokenDragImpl(this);
  }

  /** Apply a quick command selected from the radial menu. */
  applyTokenCommand(tokenEntry, commandId) {
    return applyTokenCommandImpl(this, tokenEntry, commandId);
  }

  /**
   * Ensure the instanced placeables mesh pool exists if the feature flag is enabled.
   * Safe to call repeatedly (idempotent). Returns the pool instance or null if not created.
   * This allows enabling the flag AFTER hybrid mode was already initialized.
   */
  ensureInstancing() {
    return ensureInstancingImpl(this);
  }

  /**
   * Public helper to enable instanced placeables feature at runtime.
   * If hybrid mode already active, the mesh pool is created immediately.
   * If not, pool creation will occur automatically during enableHybridRender().
   */
  enableInstancedPlaceables() {
    return enableInstancedPlaceablesImpl(this);
  }

  /** Idempotently push all current plant sprites into instancing pool (used after biome repopulation). */
  reinstanceExistingPlants() {
    return reinstanceExistingPlantsImpl(this);
  }

  /**
   * Create and configure the application
   * @throws {Error} When application cannot be created or container not found
   */
  createApp() {
    return this.renderCoordinator.createApp();
  }

  /**
   * Center the grid on the screen
   */
  centerGrid() {
    return this.renderCoordinator.centerGrid();
  }

  /**
   * Reset the grid zoom to default scale and center the view
   */
  resetZoom() {
    return this.renderCoordinator.resetZoom();
  }

  /**
   * Fix any existing tokens that might be in the wrong container
   */
  fixExistingTokens() {
    return this.renderCoordinator.fixExistingTokens();
  }

  /**
   * Handle token placement or removal at grid coordinates
   * @param {number} gridX - Grid X coordinate
   * @param {number} gridY - Grid Y coordinate
   */
  handleTokenInteraction(gridX, gridY) {
    return this.inputCoordinator.handleTokenInteraction(gridX, gridY);
  }

  /**
   * Find existing token at grid coordinates
   * @param {number} gridX - Grid X coordinate
   * @param {number} gridY - Grid Y coordinate
   * @returns {Object|null} Token object if found
   */
  findExistingTokenAt(gridX, gridY) {
    return this.inputCoordinator.findExistingTokenAt(gridX, gridY);
  }

  /**
   * Remove a token from the game
   * @param {Object} token - Token to remove
   */
  removeToken(token) {
    return this.inputCoordinator.removeToken(token);
  }

  /**
   * Place a new token at the specified grid coordinates
   * @param {number} gridX - Grid X coordinate
   * @param {number} gridY - Grid Y coordinate
   */
  placeNewToken(gridX, gridY) {
    return this.inputCoordinator.placeNewToken(gridX, gridY);
  }

  /**
   * Convert grid coordinates to isometric coordinates
   * @param {number} gridX - Grid X coordinate
   * @param {number} gridY - Grid Y coordinate
   * @returns {Object} Isometric coordinates
   */
  gridToIsometric(gridX, gridY) {
    return this.inputCoordinator.gridToIsometric(gridX, gridY);
  }

  /**
   * Add token to collection
   * @param {Object} creature - Creature object
   * @param {number} gridX - Grid X coordinate
   * @param {number} gridY - Grid Y coordinate
   */
  addTokenToCollection(creature, gridX, gridY) {
    return this.inputCoordinator.addTokenToCollection(creature, gridX, gridY);
  }

  /**
   * Select a token type for placement
   * @param {string} tokenType - Type of token to select
   */
  selectToken(tokenType) {
    return this.inputCoordinator.selectToken(tokenType);
  }

  /**
   * Toggle token facing direction
   */
  toggleFacing() {
    return this.inputCoordinator.toggleFacing();
  }

  /**
   * Create a creature instance by type
   * @param {string} type - Creature type identifier
   * @returns {Object|null} Creature instance or null if creation fails
   */
  createCreatureByType(type) {
    return this.inputCoordinator.createCreatureByType(type);
  }

  /**
   * Snap a token to the nearest grid center
   * @param {Object} token - Token sprite to snap
   */
  snapToGrid(token) {
    return this.inputCoordinator.snapToGrid(token);
  }

  /**
   * Enable terrain modification mode
   */
  enableTerrainMode() {
    if (this.terrainCoordinator) {
      this.terrainCoordinator.enableTerrainMode();
    }
  }

  /**
   * Disable terrain modification mode
   */
  disableTerrainMode() {
    if (this.terrainCoordinator) {
      this.terrainCoordinator.disableTerrainMode();
    }
  }

  /**
   * Set current terrain tool
   * @param {string} tool - Tool name ('raise' or 'lower')
   */
  setTerrainTool(tool) {
    if (this.terrainCoordinator) {
      this.terrainCoordinator.setTerrainTool(tool);
    }
  }

  /**
   * Get terrain height at specific coordinates
   * @param {number} gridX - Grid X coordinate
   * @param {number} gridY - Grid Y coordinate
   * @returns {number} Terrain height
   */
  getTerrainHeight(gridX, gridY) {
    return this.terrainCoordinator ? this.terrainCoordinator.getTerrainHeight(gridX, gridY) : 0;
  }

  /**
   * Await all pending asynchronous instancing operations (test/dev utility).
   * Safe to call when instancing disabled; resolves immediately.
   */
  async flushInstancing() {
    return flushInstancingImpl(this);
  }

  /**
   * Reset all terrain heights to default
   */
  resetTerrain() {
    if (this.terrainCoordinator) {
      this.terrainCoordinator.resetTerrain();
    }
  }

  /**
   * Get terrain system statistics
   * @returns {Object} Terrain system statistics
   */
  getTerrainStatistics() {
    return this.terrainCoordinator ? this.terrainCoordinator.getTerrainStatistics() : null;
  }

  /**
   * Check if terrain mode is currently active
   * @returns {boolean} True if terrain mode is active
   */
  isTerrainModeActive() {
    return this.terrainCoordinator ? this.terrainCoordinator.isTerrainModeActive : false;
  }

  getViewMode() {
    return this.stateCoordinator?.getViewMode() || 'isometric';
  }

  toggleViewMode() {
    if (this.stateCoordinator?.toggleViewMode) {
      this.stateCoordinator.toggleViewMode();
    }
  }

  /**
   * Resize the game grid to new dimensions
   * @param {number} newCols - Number of columns
   * @param {number} newRows - Number of rows
   * @param {boolean} centerAfterResize - Whether to center the grid after resizing (default: false)
   * @throws {Error} When dimensions are invalid or out of range
   */
  resizeGrid(newCols, newRows, centerAfterResize = false) {
    try {
      // Sanitize and validate input parameters
      const sanitizedCols = Sanitizers.integer(newCols, GRID_CONFIG.DEFAULT_COLS, {
        min: GRID_CONFIG.MIN_COLS,
        max: GRID_CONFIG.MAX_COLS,
      });

      const sanitizedRows = Sanitizers.integer(newRows, GRID_CONFIG.DEFAULT_ROWS, {
        min: GRID_CONFIG.MIN_ROWS,
        max: GRID_CONFIG.MAX_ROWS,
      });

      // Update grid dimensions through state coordinator
      this.stateCoordinator.updateGridDimensions(sanitizedCols, sanitizedRows);

      // Update terrain system for new grid dimensions
      if (this.terrainCoordinator) {
        this.terrainCoordinator.handleGridResize(sanitizedCols, sanitizedRows);
      }

      // Clear existing grid tiles and redraw
      if (this.gridRenderer) {
        this.gridRenderer.redrawGrid();
      }

      // Check if any tokens are now outside the new grid bounds
      this.stateCoordinator.validateTokenPositions();

      // Only recenter the grid if explicitly requested
      if (centerAfterResize) {
        this.renderCoordinator.centerGrid();
      }

      logger.info(
        `Grid resized to ${sanitizedCols}x${sanitizedRows}`,
        {
          newDimensions: { cols: sanitizedCols, rows: sanitizedRows },
          previousDimensions: { cols: this.cols, rows: this.rows },
        },
        LOG_CATEGORY.SYSTEM
      );
    } catch (error) {
      const errorHandler = new ErrorHandler();
      errorHandler.handle(error, ERROR_SEVERITY.ERROR, ERROR_CATEGORY.VALIDATION, {
        stage: 'resizeGrid',
        requestedCols: newCols,
        requestedRows: newRows,
        currentCols: this.cols,
        currentRows: this.rows,
      });
      throw error;
    }
  }

  // ── Event Handlers ─────────────────────────────────────────

  /** Phase 2 hook: invoked by TerrainCoordinator after height edits to schedule 3D rebuild. */
  notifyTerrainHeightsChanged() {
    if (!this.terrainRebuilder || !this.threeSceneManager || !this.is3DModeActive()) {
      return;
    }
    // Synchronous optimistic request so callers (and tests) can observe the call immediately.
    // A second debounced request with the three namespace (if available) will override args.
    try {
      this.terrainRebuilder.request();
    } catch (_) {
      /* ignore */
    }
    try {
      import('three')
        .then((threeNS) => {
          try {
            this.terrainRebuilder.request({ three: threeNS });
            // After scheduling rebuild, resync token heights (placeables future when we store per-instance coords)
            try {
              this.token3DAdapter?.resyncHeights?.();
            } catch (_) {
              /* ignore */
            }
            try {
              this.placeableMeshPool?.resyncHeights?.();
            } catch (_) {
              /* ignore */
            }
          } catch (_) {
            /* ignore */
          }
        })
        .catch(() => {
          /* ignore dynamic import failure */
        });
    } catch (_) {
      /* ignore */
    }
  }

  // ── Private Helpers ────────────────────────────────────────

  _setTokenQuickCommand(tokenEntry, commandId) {
    return _setTokenQuickCommandImpl(this, tokenEntry, commandId);
  }

  _resolveTokenEntry(tokenLike) {
    return _resolveTokenEntryImpl(this, tokenLike);
  }

  _extractTokenId(tokenLike) {
    return _extractTokenIdImpl(tokenLike);
  }

  _handleEmoteCommand(tokenEntry, commandId) {
    return _handleEmoteCommandImpl(this, tokenEntry, commandId);
  }

  _playIdleEmote(tokenEntry) {
    return _playIdleEmoteImpl(this, tokenEntry);
  }

  _isTestEnvironment() {
    return isTestEnvironmentImpl(this);
  }

  _ensureTestThreeSceneFallbackReady() {
    return ensureTestThreeSceneFallbackImpl(this);
  }

  // ── Cleanup ────────────────────────────────────────────────

  /** Experimental: disable instanced placeables (tears down pool). */
  disableInstancedPlaceables() {
    return disableInstancedPlaceablesImpl(this);
  }

  /** Remove 3D interaction (hover/select) listeners (primarily for tests or hot-reload cleanup). */
  remove3DInteractionListeners() {
    try {
      const canvas = this.threeSceneManager?.canvas;
      const targetEl = canvas || (typeof document !== 'undefined' ? document.body : null);
      if (targetEl) {
        if (this._tokenHoverListener) {
          targetEl.removeEventListener('pointermove', this._tokenHoverListener);
        }
        if (this._tokenSelectListener) {
          targetEl.removeEventListener('pointerdown', this._tokenSelectListener);
        }
        if (this._tokenPointerUpListener) {
          targetEl.removeEventListener('pointerup', this._tokenPointerUpListener);
        }
      }
    } catch (_) {
      /* ignore */
    } finally {
      this._tokenHoverListener = null;
      this._tokenSelectListener = null;
      this._tokenPointerUpListener = null;
    }
    try {
      if (typeof window !== 'undefined') {
        window.__TT_REMOVE_3D_INTERACTIONS__ = () => this.remove3DInteractionListeners();
      }
    } catch (_) {
      /* ignore */
    }
  }

  /** Disable hybrid (dispose three + listeners) mainly for tests / teardown */
  disableHybridRender() {
    if (!this.is3DModeActive()) return;
    try {
      this.remove3DInteractionListeners();
    } catch (_) {
      /* ignore */
    }
    try {
      this.threeSceneManager?.dispose?.();
    } catch (_) {
      /* ignore */
    }
    this.threeSceneManager = null;
    this.pickingService = null;
    this.renderMode = '2d-iso';
    try {
      if (typeof window !== 'undefined') {
        window.__TT_HYBRID_ACTIVE__ = false;
        window.__TT_3D_ACTIVE__ = false;
      }
    } catch (_) {
      /* ignore */
    }
  }
}

// Legacy global wrapper functions removed (2025-08 cleanup). UI now binds directly to gameManager methods.

// Export the GameManager class for ES6 module usage
export { GameManager }; // provide named export for compatibility with older test imports
export default GameManager;
