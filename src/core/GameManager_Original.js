// src/core/GameManager.js - Main game initialization and management

// Import creature creation functions
import { 
  createGoblin, 
  createOrc, 
  createSkeleton, 
  createDragon, 
  createBeholder, 
  createTroll, 
  createOwlbear, 
  createMinotaur, 
  createMindFlayer 
} from '../entities/creatures/index.js';

// Import configuration and utilities
import logger from '../utils/Logger.js';
import { CoordinateUtils } from '../utils/CoordinateUtils.js';
import { TokenManager } from '../managers/TokenManager.js';
import { InteractionManager } from '../managers/InteractionManager.js';
import { GridRenderer } from '../managers/GridRenderer.js';
import { 
  GRID_CONFIG, 
  CREATURE_SCALES, 
  VALIDATION 
} from '../config/GameConstants.js';
import { errorHandler, GameErrors } from '../utils/ErrorHandler.js';
import { GameValidators, Sanitizers } from '../utils/Validation.js';

/**
 * TavernTable Game Manager
 * 
 * This is the main controller for the TavernTable isometric grid game.
 * It manages the PIXI.js application, grid rendering, token placement,
 * user interactions, and coordinate transformations.
 * 
 * Key Responsibilities:
 * - Initialize and manage the PIXI.js application
 * - Render the isometric grid with proper tile placement
 * - Handle token creation, placement, and removal
 * - Manage grid panning, zooming, and resizing
 * - Convert between screen coordinates and grid coordinates
 * - Provide error handling and user feedback
 * 
 * Architecture:
 * - Uses ES6 modules for clean imports/exports
 * - Follows object-oriented design patterns
 * - Implements event-driven user interactions
 * - Integrates with SpriteManager for asset loading
 * - Coordinates with UIController for interface management
 */

/**
 * TavernTable Game Manager
 * Handles the main game logic, grid rendering, and token management
 */
class GameManager {
  /**
   * Initialize the GameManager with default values
   */
  constructor() {
    this.app = null;
    this.gridContainer = null;
    this.spritesReady = false;
    
    // Managers will be initialized after PIXI app creation in initialize()
    this.tokenManager = null;
    this.interactionManager = null;
    this.gridRenderer = null;
    
    // Grid configuration from constants
    this.tileWidth = GRID_CONFIG.TILE_WIDTH;
    this.tileHeight = GRID_CONFIG.TILE_HEIGHT;
    this.cols = GRID_CONFIG.DEFAULT_COLS;
    this.rows = GRID_CONFIG.DEFAULT_ROWS;
    
    // Initialize error handler
    errorHandler.initialize();
    
    // Configure logger context
    logger.setContext('GameManager');
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
    try {
      // Log initialization start
      logger.info('Initializing TavernTable GameManager...');
      
      // Create PIXI app with validation
      this.createPixiApp();
      
      // NOW create managers after PIXI app exists
      logger.debug('Creating manager instances...');
      this.tokenManager = new TokenManager(this);
      this.interactionManager = new InteractionManager(this);
      this.gridRenderer = new GridRenderer(this);
      
      // Set up grid system
      this.gridRenderer.setupGrid();
      
      // Configure global variables
      this.setupGlobalVariables();
      
      // Enable grid interaction
      this.interactionManager.setupGridInteraction();
      
      // Initialize sprites with error handling
      await this.initializeSprites();
      
      // Fix any existing tokens that might be in wrong container
      this.fixExistingTokens();
      
      logger.info('GameManager initialization completed successfully');
    } catch (error) {
      GameErrors.initialization(error, {
        stage: 'GameManager.initialize',
        timestamp: new Date().toISOString()
      });
      throw error; // Re-throw to allow caller to handle
    }
  }

  /**
   * Create and configure the PIXI application
   * @throws {Error} When PIXI application cannot be created or container not found
   */
  createPixiApp() {
    try {
      // Validate PIXI availability
      if (typeof PIXI === 'undefined') {
        throw new Error('PIXI.js library is not loaded');
      }
      
      // Initialize PIXI application with configuration
      this.app = new PIXI.Application({
        width: window.innerWidth,
        height: window.innerHeight,
        backgroundColor: GRID_CONFIG.BACKGROUND_COLOR
      });
      
      // Validate application creation
      const appValidation = GameValidators.pixiApp(this.app);
      if (!appValidation.isValid) {
        throw new Error(`PIXI application validation failed: ${appValidation.getErrorMessage()}`);
      }
      
      // Find and validate game container
      const gameContainer = document.getElementById('game-container');
      const containerValidation = GameValidators.domElement(gameContainer, 'div');
      if (!containerValidation.isValid) {
        throw new Error(`Game container validation failed: ${containerValidation.getErrorMessage()}`);
      }
      
      // Attach canvas to container (PIXI 7 compatibility)
      const canvas = this.app.canvas || this.app.view;
      if (!canvas) {
        throw new Error('PIXI application canvas not found');
      }
      gameContainer.appendChild(canvas);
      
      // Configure stage interaction
      this.app.stage.interactive = false;
      this.app.stage.interactiveChildren = true;
      
      // Make app globally available for debugging
      window.app = this.app;
      
      logger.debug('PIXI application created successfully');
    } catch (error) {
      GameErrors.initialization(error, {
        stage: 'createPixiApp',
        pixiAvailable: typeof PIXI !== 'undefined',
        containerExists: !!document.getElementById('game-container')
      });
      throw error;
    }
  }



  /**
   * Fix any existing tokens that might be in the wrong container
   * Ensures all placed tokens are properly positioned in the grid
   */
  fixExistingTokens() {
    this.placedTokens.forEach(tokenData => {
      if (tokenData.creature && tokenData.creature.sprite) {
        const sprite = tokenData.creature.sprite;
        
        // Remove from current parent
        if (sprite.parent) {
          sprite.parent.removeChild(sprite);
        }
        
        // Add to grid container
        this.gridContainer.addChild(sprite);
        
        // Recalculate position relative to grid
        const isoX = (tokenData.gridX - tokenData.gridY) * (this.tileWidth / 2);
        const isoY = (tokenData.gridX + tokenData.gridY) * (this.tileHeight / 2);
        sprite.x = isoX;
        sprite.y = isoY;
      }
    });
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
        max: GRID_CONFIG.MAX_COLS
      });
      
      const sanitizedRows = Sanitizers.integer(newRows, GRID_CONFIG.DEFAULT_ROWS, {
        min: GRID_CONFIG.MIN_ROWS,
        max: GRID_CONFIG.MAX_ROWS
      });
      
      // Update grid dimensions
      this.cols = sanitizedCols;
      this.rows = sanitizedRows;
      
      // Update global variables for backward compatibility
      window.cols = this.cols;
      window.rows = this.rows;
      
      // Clear existing grid tiles and redraw
      this.gridRenderer.redrawGrid();
      
      // Check if any tokens are now outside the new grid bounds
      this.validateTokenPositions();
      
      // Only recenter the grid if explicitly requested
      // Don't auto-center during user-initiated resize to preserve user's view position
      if (centerAfterResize) {
        this.centerGrid();
      }
      
      logger.info(`Grid resized to ${sanitizedCols}x${sanitizedRows}`);
    } catch (error) {
      GameErrors.validation(error, {
        stage: 'resizeGrid',
        requestedCols: newCols,
        requestedRows: newRows,
        currentCols: this.cols,
        currentRows: this.rows
      });
      throw error;
    }
  }



  /**
   * Validate and remove tokens that are outside grid boundaries
   * Called after grid resize to ensure all tokens remain within valid positions
   */
  validateTokenPositions() {
    this.tokenManager.validateTokenPositions(this.cols, this.rows);
    
    // Update global token array for backward compatibility
    window.placedTokens = this.placedTokens;
  }

  /**
   * Center the grid on the screen
   */
  centerGrid() {
    // Calculate the actual grid size in pixels
    const gridWidthPixels = (this.cols * this.tileWidth / 2) * this.gridScale;
    const gridHeightPixels = (this.rows * this.tileHeight / 2) * this.gridScale;
    
    // Center the grid based on current screen size and grid dimensions
    this.gridContainer.x = (this.app.screen.width / 2) - (gridWidthPixels / 2);
    this.gridContainer.y = (this.app.screen.height / 2) - (gridHeightPixels / 2);
    
    // Ensure minimum margins from screen edges
    const minMargin = 50;
    this.gridContainer.x = Math.max(minMargin - gridWidthPixels / 2, this.gridContainer.x);
    this.gridContainer.y = Math.max(minMargin, this.gridContainer.y);
  }

  /**
   * Reset the grid zoom to default scale and center the view
   */
  resetZoom() {
    this.interactionManager.resetZoom();
  }



  /**
   * Set up global variables for backward compatibility
   * @deprecated - This is maintained for legacy code compatibility
   */
  setupGlobalVariables() {
    try {
      // Make variables globally available for other modules (legacy support)
      window.tileWidth = this.tileWidth;
      window.tileHeight = this.tileHeight;
      window.rows = this.rows;
      window.cols = this.cols;
      window.gridContainer = this.gridContainer;
      window.selectedTokenType = this.selectedTokenType;
      window.tokenFacingRight = this.tokenFacingRight;
      window.placedTokens = this.placedTokens;
      window.gameManager = this;
      
      logger.debug('Global variables initialized for backward compatibility');
    } catch (error) {
      GameErrors.initialization(error, { stage: 'setupGlobalVariables' });
    }
  }



  /**
   * Handle left mouse click for token placement
   * @param {MouseEvent} event - Mouse click event
   */
  handleLeftClick(event) {
    this.interactionManager.handleLeftClick(event);
  }



  /**
   * Handle token placement or removal at grid coordinates
   * @param {number} gridX - Grid X coordinate
   * @param {number} gridY - Grid Y coordinate
   */
  handleTokenInteraction(gridX, gridY) {
    try {
      // Validate coordinates first
      const coordValidation = GameValidators.coordinates(gridX, gridY);
      if (!coordValidation.isValid) {
        throw new Error(`Invalid coordinates: ${coordValidation.getErrorMessage()}`);
      }
      
      const existingToken = this.findExistingTokenAt(gridX, gridY);
      
      if (existingToken) {
        this.removeToken(existingToken);
      }
      
      // If remove mode is selected, only remove tokens
      if (this.selectedTokenType === 'remove') {
        return;
      }
      
      // Validate creature type before placement
      const creatureValidation = GameValidators.creatureType(this.selectedTokenType);
      if (!creatureValidation.isValid) {
        throw new Error(`Invalid creature type: ${creatureValidation.getErrorMessage()}`);
      }
      
      this.placeNewToken(gridX, gridY);
    } catch (error) {
      GameErrors.input(error, {
        stage: 'handleTokenInteraction',
        coordinates: { gridX, gridY },
        selectedTokenType: this.selectedTokenType
      });
    }
  }

  findExistingTokenAt(gridX, gridY) {
    return this.tokenManager.findExistingTokenAt(gridX, gridY);
  }

  removeToken(token) {
    this.tokenManager.removeToken(token);
    window.placedTokens = this.placedTokens;
  }

  /**
   * Place a new token at the specified grid coordinates
   * @param {number} gridX - Grid X coordinate
   * @param {number} gridY - Grid Y coordinate
   */
  placeNewToken(gridX, gridY) {
    this.tokenManager.placeNewToken(gridX, gridY, this.gridContainer);
    window.placedTokens = this.placedTokens;
  }

  gridToIsometric(gridX, gridY) {
    return CoordinateUtils.gridToIsometric(gridX, gridY, this.tileWidth, this.tileHeight);
  }

  addTokenToCollection(creature, gridX, gridY) {
    this.tokenManager.addTokenToCollection(creature, gridX, gridY, this.selectedTokenType, this.placedTokens);
    window.placedTokens = this.placedTokens;
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
        this.spritesReady = true;
        window.spritesReady = true;
      } else {
        logger.debug('No sprite manager found, using drawn graphics');
        this.spritesReady = true;
        window.spritesReady = true;
      }
    } catch (error) {
      GameErrors.sprites(error, { stage: 'initializeSprites' });
      // Allow fallback to drawn graphics
      this.spritesReady = true;
      window.spritesReady = true;
    }
  }

  /**
   * Select a token type for placement
   * @param {string} tokenType - Type of token to select
   */
  selectToken(tokenType) {
    if (this.tokenManager) {
      this.tokenManager.selectToken(tokenType);
      window.selectedTokenType = this.selectedTokenType;
    }
  }

  toggleFacing() {
    if (this.tokenManager) {
      this.tokenManager.toggleFacing();
      window.tokenFacingRight = this.tokenFacingRight;
    }
  }

  /**
   * Create a creature instance by type
   * @param {string} type - Creature type identifier
   * @returns {Object|null} Creature instance or null if creation fails
   */
  createCreatureByType(type) {
    return this.tokenManager.createCreatureByType(type);
  }

  /**
   * Snap a token to the nearest grid center
   * @param {PIXI.Sprite} token - Token sprite to snap
   */
  snapToGrid(token) {
    this.tokenManager.snapToGrid(token);
  }
}

/**
 * Global functions for backward compatibility and UI interaction
 * @deprecated - These should be replaced with direct GameManager method calls
 */

/**
 * Select a token type for placement
 * @param {string} tokenType - Type of token to select
 */
function selectToken(tokenType) {
  if (window.gameManager) {
    window.gameManager.selectToken(tokenType);
  } else {
    console.error('GameManager not initialized');
  }
}

/**
 * Toggle token facing direction
 */
function toggleFacing() {
  if (window.gameManager) {
    window.gameManager.toggleFacing();
  } else {
    console.error('GameManager not initialized');
  }
}

/**
 * Snap a token to the nearest grid position
 * @param {PIXI.Sprite} token - Token sprite to snap
 */
function snapToGrid(token) {
  if (window.gameManager) {
    window.gameManager.snapToGrid(token);
  } else {
    console.error('GameManager not initialized');
  }
}

// Make global functions available for backward compatibility
window.selectToken = selectToken;
window.toggleFacing = toggleFacing;
window.snapToGrid = snapToGrid;
console.log('GameManager loaded - token functions available');

// Export the GameManager class for ES6 module usage
export default GameManager;
