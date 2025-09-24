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
