/**
 * StateCoordinator.js - Manages application state and initialization lifecycle
 *
 * Extracted from GameManager to follow single responsibility principle
 * Handles application initialization, global state management, and configuration
 */

import { logger, LOG_LEVEL, LOG_CATEGORY } from '../utils/Logger.js';
import { ErrorHandler, ERROR_SEVERITY, ERROR_CATEGORY } from '../utils/ErrorHandler.js';
import { GRID_CONFIG } from '../config/GameConstants.js';

export class StateCoordinator {
  constructor(gameManager) {
    this.gameManager = gameManager;
    this.initializationComplete = false;
    // View mode state: 'isometric' | 'topdown'
    this.viewMode = 'isometric';
  }

  /**
   * Initialize the game manager and set up all components
   * @returns {Promise<void>} Promise that resolves when initialization is complete
   */
  async initializeApplication() {
    try {
      // Log initialization start
      logger.log(LOG_LEVEL.INFO, 'Initializing TavernTable GameManager', LOG_CATEGORY.SYSTEM, {
        context: 'StateCoordinator.initializeApplication',
        stage: 'initialization_start',
        timestamp: new Date().toISOString(),
      });

      // Create PIXI app with validation
      this.gameManager.renderCoordinator.createPixiApp();

      // NOW create managers after PIXI app exists
      logger.log(LOG_LEVEL.DEBUG, 'Creating manager instances', LOG_CATEGORY.SYSTEM, {
        context: 'StateCoordinator.initializeApplication',
        stage: 'manager_creation',
        pixiAppReady: !!this.gameManager.app,
      });
      await this.createManagers();

      // Set up grid system
      this.gameManager.gridRenderer.setupGrid();

      // Configure global variables
      this.setupGlobalVariables();

      // Enable grid interaction
      this.gameManager.interactionManager.setupGridInteraction();

      // Initialize terrain system
      await this.gameManager.terrainCoordinator.initialize();

      // Initialize sprites with error handling
      await this.initializeSprites();

      // Fix any existing tokens that might be in wrong container
      this.gameManager.renderCoordinator.fixExistingTokens();

      // Initialize view mode (after grid + tokens exist)
      this.initializeViewMode();

      this.initializationComplete = true;
      logger.log(
        LOG_LEVEL.INFO,
        'GameManager initialization completed successfully',
        LOG_CATEGORY.SYSTEM,
        {
          context: 'StateCoordinator.initializeApplication',
          stage: 'initialization_complete',
          gridDimensions: { cols: this.gameManager.cols, rows: this.gameManager.rows },
          spritesReady: this.gameManager.spritesReady,
          timestamp: new Date().toISOString(),
        }
      );
    } catch (error) {
      new ErrorHandler().handle(error, ERROR_SEVERITY.CRITICAL, ERROR_CATEGORY.INITIALIZATION, {
        context: 'StateCoordinator.initializeApplication',
        stage: 'game_manager_initialization',
        initializationSteps: {
          pixiApp: !!this.gameManager.renderCoordinator,
          managers: !!(this.gameManager.tokenManager && this.gameManager.interactionManager),
          grid: !!this.gameManager.gridRenderer,
          globalVars: !!window.gameManager,
          sprites: this.gameManager.spritesReady,
        },
        timestamp: new Date().toISOString(),
      });
      throw error; // Re-throw to allow caller to handle
    }
  }

  /** Initialize view mode from persistent storage (localStorage) */
  initializeViewMode() {
    try {
      this.viewMode = 'isometric'; // hard default
      if (typeof localStorage !== 'undefined') {
        const stored = localStorage.getItem('taverntable.viewMode');
        if (stored === 'topdown') {
          this.viewMode = 'topdown';
        }
      }
      if (this.viewMode === 'topdown') {
        import('../utils/ProjectionUtils.js')
          .then((m) => m.reprojectAll(this.gameManager, 'topdown'))
          .catch(() => {
            this.viewMode = 'isometric';
          });
      }
    } catch (_) {
      this.viewMode = 'isometric';
    }
  }

  getViewMode() {
    return this.viewMode;
  }

  setViewMode(mode) {
    if (mode !== 'isometric' && mode !== 'topdown') return;
    if (this.viewMode === mode) return;
    const previous = this.viewMode;
    const gm = this.gameManager;
    // Animation system removed; immediate reprojection only.

    // If entering top-down, disable terrain edit mode + prevent generation during that state
    try {
      if (
        mode === 'topdown' &&
        gm?.terrainCoordinator?.isTerrainModeActive &&
        typeof gm.terrainCoordinator.disableTerrainMode === 'function'
      ) {
        gm.terrainCoordinator.disableTerrainMode();
      }
    } catch (_) {
      /* non-fatal */
    }

    const persist = (value) => {
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('taverntable.viewMode', value);
        }
      } catch (_) {
        /* ignore */
      }
    };

    const dispatch = (finalMode, opts = {}) => {
      window.dispatchEvent(
        new CustomEvent('viewmode:changed', { detail: { mode: finalMode, previous, ...opts } })
      );
    };

    // Optimistically set (so getViewMode reflects target during animation)
    this.viewMode = mode;
    persist(mode);

    // Always perform a direct reprojection (transition system removed)
    import('../utils/ProjectionUtils.js')
      .then((m) => {
        const doReproject = () => {
          try {
            m.reprojectAll(gm, mode);
            dispatch(mode);
          } catch (_) {
            this.viewMode = previous;
            persist(previous);
            dispatch(previous, { error: true });
          }
        };
        // If animate was requested, still yield one tick so UI events (click feedback) paint first
        // Immediate reprojection (no animation delay)
        doReproject();
      })
      .catch(() => {
        this.viewMode = previous;
        persist(previous);
        dispatch(previous, { error: true });
      });
  }

  toggleViewMode() {
    const next = this.viewMode === 'isometric' ? 'topdown' : 'isometric';
    this.setViewMode(next);
  }

  /**
   * Create manager instances after PIXI app is ready
   */
  async createManagers() {
    // Create managers synchronously to avoid dependency issues
    const { TokenManager } = await import('../managers/TokenManager.js');
    const { InteractionManager } = await import('../managers/InteractionManager.js');
    const { GridRenderer } = await import('../managers/GridRenderer.js');

    this.gameManager.tokenManager = new TokenManager(this.gameManager);
    this.gameManager.interactionManager = new InteractionManager(this.gameManager);
    this.gameManager.gridRenderer = new GridRenderer(this.gameManager);

    logger.debug('Manager instances created');
  }

  /**
   * Set up global variables for backward compatibility
   * @deprecated - This is maintained for legacy code compatibility
   */
  setupGlobalVariables() {
    try {
      // Make variables globally available for other modules (legacy support)
      window.tileWidth = this.gameManager.tileWidth;
      window.tileHeight = this.gameManager.tileHeight;
      window.rows = this.gameManager.rows;
      window.cols = this.gameManager.cols;
      window.gridContainer = this.gameManager.gridContainer;
      window.selectedTokenType = this.gameManager.selectedTokenType;
      window.tokenFacingRight = this.gameManager.tokenFacingRight;
      window.placedTokens = this.gameManager.placedTokens;
      window.gameManager = this.gameManager;

      logger.debug('Global variables initialized for backward compatibility');
    } catch (error) {
      new ErrorHandler().handle(error, ERROR_SEVERITY.MEDIUM, ERROR_CATEGORY.INITIALIZATION, {
        context: 'StateCoordinator.setupGlobalVariables',
        stage: 'global_variable_setup',
        variables: {
          gameManager: !!this.gameManager,
          gridContainer: !!this.gameManager.gridContainer,
          placedTokens: !!this.gameManager.placedTokens,
        },
        legacyCompatibility: true,
      });
    }
  }

  /**
   * Initialize sprite manager and load creature sprites
   * @returns {Promise<void>} Promise that resolves when sprites are loaded
   */
  async initializeSprites() {
    try {
      if (window.spriteManager) {
        logger.debug('Sprite manager found, initializing...');
        await window.spriteManager.initialize();
        logger.debug('Sprites loaded successfully');
        this.gameManager.spritesReady = true;
        window.spritesReady = true;
      } else {
        logger.debug('No sprite manager found, using drawn graphics');
        this.gameManager.spritesReady = true;
        window.spritesReady = true;
      }

      // Animated sprite system removed (2025-08 cleanup) – static sprites only.
    } catch (error) {
      new ErrorHandler().handle(error, ERROR_SEVERITY.MEDIUM, ERROR_CATEGORY.RENDERING, {
        context: 'StateCoordinator.initializeSprites',
        stage: 'sprite_initialization',
        spriteManagers: { spriteManager: !!window.spriteManager },
        fallbackEnabled: true,
        spritesReady: this.gameManager.spritesReady,
      });
      // Allow fallback to drawn graphics
      this.gameManager.spritesReady = true;
      window.spritesReady = true;
    }
  }

  /**
   * Update application state when grid is resized
   * @param {number} newCols - New column count
   * @param {number} newRows - New row count
   */
  updateGridDimensions(newCols, newRows) {
    // Update internal state
    this.gameManager.cols = newCols;
    this.gameManager.rows = newRows;

    // Update global variables for backward compatibility
    window.cols = this.gameManager.cols;
    window.rows = this.gameManager.rows;

    logger.debug(`Grid dimensions updated to ${newCols}x${newRows}`);
  }

  /**
   * Validate and remove tokens that are outside grid boundaries
   * Called after grid resize to ensure all tokens remain within valid positions
   */
  validateTokenPositions() {
    if (this.gameManager.tokenManager) {
      this.gameManager.tokenManager.validateTokenPositions(
        this.gameManager.cols,
        this.gameManager.rows
      );

      // Update global token array for backward compatibility
      window.placedTokens = this.gameManager.placedTokens;
    }
  }

  /**
   * Get current application state
   * @returns {Object} Current state information
   */
  getApplicationState() {
    return {
      initialized: this.initializationComplete,
      spritesReady: this.gameManager.spritesReady,
      gridDimensions: {
        cols: this.gameManager.cols,
        rows: this.gameManager.rows,
      },
      tileSize: {
        width: this.gameManager.tileWidth,
        height: this.gameManager.tileHeight,
      },
      tokensCount: this.gameManager.placedTokens ? this.gameManager.placedTokens.length : 0,
    };
  }

  /**
   * Reset application to initial state
   */
  resetApplication() {
    try {
      // Clear tokens
      if (this.gameManager.tokenManager) {
        this.gameManager.tokenManager.clearAllTokens();
      }

      // Reset grid to default size
      this.updateGridDimensions(GRID_CONFIG.DEFAULT_COLS, GRID_CONFIG.DEFAULT_ROWS);

      // Recenter and reset zoom
      if (this.gameManager.renderCoordinator) {
        this.gameManager.renderCoordinator.resetZoom();
        this.gameManager.renderCoordinator.centerGrid();
      }

      logger.info('Application state reset to defaults');
    } catch (error) {
      new ErrorHandler().handle(error, ERROR_SEVERITY.MEDIUM, ERROR_CATEGORY.SYSTEM, {
        context: 'StateCoordinator.resetApplication',
        stage: 'application_reset',
        resetSteps: {
          tokensCleared: !!this.gameManager.tokenManager,
          gridReset: true,
          zoomReset: !!this.gameManager.renderCoordinator,
        },
        targetDimensions: {
          cols: GRID_CONFIG.DEFAULT_COLS,
          rows: GRID_CONFIG.DEFAULT_ROWS,
        },
      });
    }
  }
}
