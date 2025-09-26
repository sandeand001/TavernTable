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

import { logger, LOG_CATEGORY } from '../utils/Logger.js';
import {
  ErrorHandler,
  errorHandler,
  ERROR_SEVERITY,
  ERROR_CATEGORY,
} from '../utils/ErrorHandler.js';
import { Sanitizers } from '../utils/Validation.js';
import { GRID_CONFIG } from '../config/GameConstants.js';

// Import coordinators
import { RenderCoordinator } from '../coordinators/RenderCoordinator.js';
import { StateCoordinator } from '../coordinators/StateCoordinator.js';
import { InputCoordinator } from '../coordinators/InputCoordinator.js';
import { TerrainCoordinator } from '../coordinators/TerrainCoordinator.js';
// 3D Transition Phase 0: Spatial coordinator (grid <-> world abstraction)
import { SpatialCoordinator } from '../scene/SpatialCoordinator.js';
import { ThreeSceneManager } from '../scene/ThreeSceneManager.js';
import { CameraRig } from '../scene/CameraRig.js';
import { TerrainMeshBuilder } from '../scene/TerrainMeshBuilder.js';
import { TerrainRebuilder } from '../scene/TerrainRebuilder.js';
import { PlaceableMeshPool } from '../scene/PlaceableMeshPool.js';

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
  /**
   * Initialize the GameManager with coordinators
   * @param {object} [options] optional overrides
   * @param {number} [options.cols] custom column count for grid
   * @param {number} [options.rows] custom row count for grid
   */
  constructor(options = {}) {
    const { cols, rows } = options || {};

    // Core PIXI and rendering state
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

    // Managers will be initialized after PIXI app creation in initialize()
    this.tokenManager = null;
    this.interactionManager = null;
    this.gridRenderer = null;

    // 3D Transition: canonical spatial mapping (grid -> world) used by future Three.js scene
    this.spatial = new SpatialCoordinator();

    // Rendering mode flag: '2d-iso' (legacy) | '3d-hybrid' (in-progress) | future: '3d'
    this.renderMode = '2d-iso';
    this.threeSceneManager = null; // lazy init when entering hybrid mode
    this.terrainRebuilder = null; // Phase 2: debounced terrain mesh updates
    this.placeableMeshPool = null; // Phase 4: instanced placeables (scaffold)
    // Feature flags (incremental enablement of new systems)
    this.features = {
      instancedPlaceables: false, // gated until lifecycle wiring complete
    };

    // Internal: track pending async instancing operations so tests/tools can await completion
    this._pendingInstancingPromises = [];

    // Initialize error handler
    errorHandler.initialize();

    // Configure logger context
    logger.pushContext({ component: 'GameManager' });
  }

  // Property getters for backward compatibility with null safety
  get selectedTokenType() {
    return this.tokenManager?.getSelectedTokenType() || 'goblin';
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
   * Initialize the game manager and set up all components
   * @returns {Promise<void>} Promise that resolves when initialization is complete
   */
  async initialize() {
    return this.stateCoordinator.initializeApplication();
  }

  /**
   * Create manager instances after PIXI app is ready
   */
  // createManagers() no longer needed here (handled by StateCoordinator.createManagers())

  // === RENDERING OPERATIONS (Delegated to RenderCoordinator) ===

  /**
   * Enable hybrid 2D + 3D rendering. Idempotent.
   * Initializes ThreeSceneManager and switches renderMode.
   */
  async enableHybridRender() {
    if (this.renderMode === '3d-hybrid') return;
    if (!this.threeSceneManager) {
      this.threeSceneManager = new ThreeSceneManager(this);
      await this.threeSceneManager.initialize();
      // Attach camera rig abstraction (Phase 1)
      try {
        if (this.threeSceneManager.camera) {
          this.cameraRig = new CameraRig();
          this.cameraRig.attach(this.threeSceneManager.camera);
        }
      } catch (_) {
        /* ignore */
      }
      // Phase 2: initialize terrain mesh pipeline
      try {
        if (!this.terrainRebuilder) {
          const builder = new TerrainMeshBuilder({
            tileWorldSize: this.spatial.tileWorldSize,
            elevationUnit: this.spatial.elevationUnit,
          });
          this.terrainRebuilder = new TerrainRebuilder({ gameManager: this, builder });
          // Perform initial build (flat or current heights) if Three initialized
          const threeNS = (await import('three')).default || (await import('three'));
          this.terrainRebuilder.rebuild({ three: threeNS });
        }
      } catch (e) {
        /* non-fatal terrain mesh init failure */
      }
      // Phase 3 (initial scaffold): attach Token3DAdapter for existing tokens
      try {
        const { Token3DAdapter } = await import('../scene/Token3DAdapter.js');
        if (!this.token3DAdapter) {
          this.token3DAdapter = new Token3DAdapter(this);
          this.token3DAdapter.attach();
        }
      } catch (_) {
        /* ignore */
      }
      // Phase 4 scaffold: initialize placeable instancing pool (no migration yet unless flag enabled)
      try {
        if (this.features.instancedPlaceables && !this.placeableMeshPool) {
          this.placeableMeshPool = new PlaceableMeshPool({ gameManager: this });
        }
      } catch (_) {
        /* non-fatal instancing scaffold failure */
      }
    }
    this.renderMode = '3d-hybrid';
    // Dev convenience: expose on window during early phases
    try {
      if (typeof window !== 'undefined') {
        window.__TT_HYBRID_ACTIVE__ = true;
        // Convenience runtime hook for toggling isometric camera once hybrid active
        if (!window.__TT_SET_ISO_MODE__) {
          window.__TT_SET_ISO_MODE__ = (v) => {
            try {
              return this.setIsometricCamera(!!v);
            } catch (e) {
              return false;
            }
          };
        }
      }
    } catch (_) {
      /* ignore */
    }
    return this.threeSceneManager;
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
   * Ensure the instanced placeables mesh pool exists if the feature flag is enabled.
   * Safe to call repeatedly (idempotent). Returns the pool instance or null if not created.
   * This allows enabling the flag AFTER hybrid mode was already initialized.
   */
  ensureInstancing() {
    try {
      if (!this.features.instancedPlaceables) return null; // feature still disabled
      if (this.renderMode !== '3d-hybrid') return null; // wait until hybrid active
      if (!this.placeableMeshPool) {
        this.placeableMeshPool = new PlaceableMeshPool({ gameManager: this });
        try {
          if (typeof window !== 'undefined') {
            (window.__TT_METRICS__ = window.__TT_METRICS__ || {}).placeables = {
              groups: 0,
              liveInstances: 0,
              capacityExpansions: 0,
            };
            // Dev aid so console explorers discover the helper
            window.__TT_ENSURE_INSTANCING__ = () => this.ensureInstancing();
          }
        } catch (_) {
          /* ignore metrics priming errors */
        }
        logger.debug(
          'Instanced placeables pool created (late ensure)',
          { context: 'GameManager.ensureInstancing', renderMode: this.renderMode },
          LOG_CATEGORY.SYSTEM
        );
      }
      return this.placeableMeshPool;
    } catch (_) {
      return null;
    }
  }

  /**
   * Public helper to enable instanced placeables feature at runtime.
   * If hybrid mode already active, the mesh pool is created immediately.
   * If not, pool creation will occur automatically during enableHybridRender().
   */
  enableInstancedPlaceables() {
    this.features.instancedPlaceables = true;
    const pool = this.ensureInstancing();
    // Attach a lightweight pointer hover listener (once) to drive preview highlighting in 3D
    try {
      if (!this._instancingPreviewListener && typeof window !== 'undefined') {
        const canvas = this.threeSceneManager?.canvas;
        const targetEl = canvas || document.body;
        this._instancingPreviewListener = async (evt) => {
          try {
            if (!this.features.instancedPlaceables || this.renderMode !== '3d-hybrid') return;
            if (!this.threeSceneManager || !this.placeableMeshPool) return;
            // Map client coords -> grid via existing PIXI interaction (coarse) fallback to spatial
            const rect = targetEl.getBoundingClientRect();
            const x = evt.clientX - rect.left;
            const y = evt.clientY - rect.top;
            // Use spatial projection heuristics (orthographic iso assumption): ray onto XZ plane at y=0.
            const cam = this.threeSceneManager.camera;
            let three = this.threeSceneManager._three || window.THREE || null;
            if (!three) {
              try {
                three = await import('three');
                this.threeSceneManager._three = three; // cache for later
              } catch (_) {
                three = null;
              }
            }
            if (cam && three && typeof three.Raycaster === 'function') {
              try {
                const ndcX = (x / rect.width) * 2 - 1;
                const ndcY = -(y / rect.height) * 2 + 1;
                const raycaster = new three.Raycaster();
                raycaster.setFromCamera({ x: ndcX, y: ndcY }, cam);
                const plane = new three.Plane(new three.Vector3(0, 1, 0), 0); // y=0 plane
                const hitPoint = new three.Vector3();
                raycaster.ray.intersectPlane(plane, hitPoint);
                if (Number.isFinite(hitPoint.x) && Number.isFinite(hitPoint.z)) {
                  const grid = this.spatial.worldToGrid(hitPoint.x, hitPoint.z);
                  const gx = Math.floor(grid.gridX);
                  const gy = Math.floor(grid.gridY);
                  if (Number.isFinite(gx) && Number.isFinite(gy)) {
                    this.placeableMeshPool.setPreview(gx, gy);
                  }
                }
              } catch (_) {
                /* ignore ray errors */
              }
            }
          } catch (_) {
            /* ignore */
          }
        };
        targetEl.addEventListener('pointermove', this._instancingPreviewListener);
      }
    } catch (_) {
      /* ignore listener attach issues */
    }
    return pool;
  }

  /**
   * Create and configure the PIXI application
   * @throws {Error} When PIXI application cannot be created or container not found
   */
  createPixiApp() {
    return this.renderCoordinator.createPixiApp();
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

  // === STATE MANAGEMENT (Delegated to StateCoordinator) ===

  /**
   * Set up global variables for backward compatibility
   * @deprecated - This is maintained for legacy code compatibility
   */
  setupGlobalVariables() {
    return this.stateCoordinator.setupGlobalVariables();
  }

  /**
   * Initialize sprite manager and load creature sprites
   * @returns {Promise<void>} Promise that resolves when sprites are loaded
   */
  async initializeSprites() {
    return this.stateCoordinator.initializeSprites();
  }

  /**
   * Validate and remove tokens that are outside grid boundaries
   */
  validateTokenPositions() {
    return this.stateCoordinator.validateTokenPositions();
  }

  // === INPUT HANDLING (Delegated to InputCoordinator) ===

  /**
   * Handle left mouse click for token placement
   * @param {MouseEvent} event - Mouse click event
   */
  handleLeftClick(event) {
    return this.inputCoordinator.handleLeftClick(event);
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
   * @param {PIXI.Sprite} token - Token sprite to snap
   */
  snapToGrid(token) {
    return this.inputCoordinator.snapToGrid(token);
  }

  // === TERRAIN OPERATIONS (Delegated to TerrainCoordinator) ===

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

  /** Phase 2 hook: invoked by TerrainCoordinator after height edits to schedule 3D rebuild. */
  notifyTerrainHeightsChanged() {
    if (!this.terrainRebuilder || !this.threeSceneManager || this.renderMode !== '3d-hybrid') {
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

  /**
   * Await all pending asynchronous instancing operations (test/dev utility).
   * Safe to call when instancing disabled; resolves immediately.
   */
  async flushInstancing() {
    if (!this._pendingInstancingPromises || this._pendingInstancingPromises.length === 0) return;
    const pending = [...this._pendingInstancingPromises];
    this._pendingInstancingPromises.length = 0;
    try {
      await Promise.allSettled(pending);
    } catch (_) {
      /* ignore */
    }
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

  // === VIEW MODE (Delegated to StateCoordinator) ===
  getViewMode() {
    return this.stateCoordinator?.getViewMode() || 'isometric';
  }

  toggleViewMode() {
    if (this.stateCoordinator?.toggleViewMode) {
      this.stateCoordinator.toggleViewMode();
    }
  }

  // === GRID MANAGEMENT ===

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
}

// Legacy global wrapper functions removed (2025-08 cleanup). UI now binds directly to gameManager methods.

// Export the GameManager class for ES6 module usage
export { GameManager }; // provide named export for compatibility with older test imports
export default GameManager;
