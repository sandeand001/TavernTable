/**
 * StateCoordinator.js - Manages application state and initialization lifecycle
 *
 * Extracted from GameManager to follow single responsibility principle
 * Handles application initialization, global state management, and configuration
 */

import { GRID_CONFIG } from '../config/GameConstants.js';

import { logger, LOG_LEVEL, LOG_CATEGORY } from '../utils/logger/Logger.js';
import { ErrorHandler, ERROR_SEVERITY, ERROR_CATEGORY } from '../utils/error/ErrorHandler.js';

// ── StateCoordinator Class ───────────────────────────────
export class StateCoordinator {
  // ── Constructor ──────────────────────────────────────────────
  constructor(gameManager) {
    this.gameManager = gameManager;
    this.initializationComplete = false;
    // View mode state: 'isometric' | 'topdown'
    this.viewMode = 'isometric';
  }

  // ── Application Initialization ─────────────────────────
  /**
   * Initialize the game manager and set up all components
   * @returns {Promise<void>} Promise that resolves when initialization is complete
   */
  async initializeApplication() {
    try {
      logger.log(LOG_LEVEL.INFO, 'Initializing TavernTable GameManager', LOG_CATEGORY.SYSTEM, {
        context: 'StateCoordinator.initializeApplication',
        stage: 'initialization_start',
        timestamp: new Date().toISOString(),
      });

      await this.createManagers();

      this.setupGlobalVariables();

      this.gameManager.interactionManager.setupGridInteraction();

      await this.gameManager.terrainCoordinator.initialize();

      await this.initializeSprites();

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
          managers: !!(this.gameManager.tokenManager && this.gameManager.interactionManager),
          globalVars: !!window.gameManager,
          sprites: this.gameManager.spritesReady,
        },
        timestamp: new Date().toISOString(),
      });
      throw error;
    }
  }

  // ── View Mode Management ───────────────────────────────
  initializeViewMode() {
    try {
      this.viewMode = 'isometric';
      if (typeof localStorage !== 'undefined') {
        const stored = localStorage.getItem('taverntable.viewMode');
        if (stored === 'topdown') this.viewMode = 'topdown';
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

    this.viewMode = mode;
    persist(mode);
    dispatch(mode);
  }

  toggleViewMode() {
    const next = this.viewMode === 'isometric' ? 'topdown' : 'isometric';
    this.setViewMode(next);
  }

  // ── Manager Creation ──────────────────────────────────
  /**
   * Create manager instances after app is ready
   */
  async createManagers() {
    const { TokenManager } = await import('../managers/TokenManager.js');
    const { InteractionManager } = await import('../managers/InteractionManager.js');

    this.gameManager.tokenManager = new TokenManager(this.gameManager);
    this.gameManager.interactionManager = new InteractionManager(this.gameManager);

    logger.debug('Manager instances created');
  }

  // ── Global Variables (Legacy) ──────────────────────────
  /**
   * Set up global variables for backward compatibility
   * @deprecated - This is maintained for legacy code compatibility
   */
  setupGlobalVariables() {
    try {
      window.tileWidth = this.gameManager.tileWidth;
      window.tileHeight = this.gameManager.tileHeight;
      window.rows = this.gameManager.rows;
      window.cols = this.gameManager.cols;
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
          placedTokens: !!this.gameManager.placedTokens,
        },
        legacyCompatibility: true,
      });
    }
  }

  // ── Sprite Initialization ───────────────────────────────
  /**
   * Mark sprites as ready (3D models loaded via Token3DAdapter; legacy SpriteManager removed)
   */
  async initializeSprites() {
    this.gameManager.spritesReady = true;
    window.spritesReady = true;
  }

  // ── Grid Dimensions & Validation ───────────────────────
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

  // ── Application State & Reset ──────────────────────────
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
      const tsm = this.gameManager.threeSceneManager;
      if (tsm) {
        tsm._zoom = 1.0;
        tsm._targetZoom = 1.0;
        tsm._panCx = null;
        tsm._panCz = null;
        tsm.reframe?.();
        const cols = this.gameManager.cols || 25;
        const rows = this.gameManager.rows || 25;
        const span = Math.max(cols, rows) * 0.6;
        tsm._applyCameraBase?.({ cx: cols * 0.5, cz: rows * 0.5, span });
      }

      logger.info('Application state reset to defaults');
    } catch (error) {
      new ErrorHandler().handle(error, ERROR_SEVERITY.MEDIUM, ERROR_CATEGORY.SYSTEM, {
        context: 'StateCoordinator.resetApplication',
        stage: 'application_reset',
        resetSteps: {
          tokensCleared: !!this.gameManager.tokenManager,
          gridReset: true,
          zoomReset: !!this.gameManager.threeSceneManager,
        },
        targetDimensions: {
          cols: GRID_CONFIG.DEFAULT_COLS,
          rows: GRID_CONFIG.DEFAULT_ROWS,
        },
      });
    }
  }
}
