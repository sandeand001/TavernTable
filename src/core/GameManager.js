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
    this.selectedTokenType = 'goblin';
    this.tokenFacingRight = true;
    this.placedTokens = [];
    
    // Grid configuration from constants
    this.tileWidth = GRID_CONFIG.TILE_WIDTH;
    this.tileHeight = GRID_CONFIG.TILE_HEIGHT;
    this.cols = GRID_CONFIG.DEFAULT_COLS;
    this.rows = GRID_CONFIG.DEFAULT_ROWS;
    
    // Grid panning variables
    this.isDragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.gridStartX = 0;
    this.gridStartY = 0;
    this.isSpacePressed = false; // Track space bar state for panning
    
    // Grid zoom variables
    this.gridScale = GRID_CONFIG.DEFAULT_SCALE;
    this.minScale = GRID_CONFIG.MIN_SCALE;
    this.maxScale = GRID_CONFIG.MAX_SCALE;
    this.zoomSpeed = GRID_CONFIG.ZOOM_SPEED;
    
    // Testing mode variables
    this.testingMode = {
      logSprite: false,
      logCenter: false
    };
    
    // Initialize error handler
    errorHandler.initialize();
  }

  /**
   * Initialize the game manager and set up all components
   * @returns {Promise<void>} Promise that resolves when initialization is complete
   */
  async initialize() {
    try {
      // Log initialization start
      console.log('Initializing TavernTable GameManager...');
      
      // Create PIXI app with validation
      this.createPixiApp();
      
      // Set up grid system
      this.setupGrid();
      
      // Configure global variables
      this.setupGlobalVariables();
      
      // Enable grid interaction
      this.setupGridInteraction();
      
      // Initialize sprites with error handling
      await this.initializeSprites();
      
      // Fix any existing tokens that might be in wrong container
      this.fixExistingTokens();
      
      console.log('GameManager initialization completed successfully');
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
      
      console.log('PIXI application created successfully');
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
        
        console.log(`Fixed token at grid (${tokenData.gridX}, ${tokenData.gridY}) -> iso (${isoX}, ${isoY})`);
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
      
      // Clear existing grid tiles
      this.clearGridTiles();
      
      // Redraw grid with new dimensions
      for (let y = 0; y < this.rows; y++) {
        for (let x = 0; x < this.cols; x++) {
          this.drawIsometricTile(x, y);
        }
      }
      
      // Check if any tokens are now outside the new grid bounds
      this.validateTokenPositions();
      
      // Only recenter the grid if explicitly requested
      // Don't auto-center during user-initiated resize to preserve user's view position
      if (centerAfterResize) {
        this.centerGrid();
      }
      
      console.log(`Grid resized to ${sanitizedCols}x${sanitizedRows}`);
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
   * Clear all grid tiles from the display while preserving tokens
   */
  clearGridTiles() {
    // Remove all grid tiles (but keep tokens)
    const tilesToRemove = [];
    this.gridContainer.children.forEach(child => {
      // Only remove grid tiles, not creature sprites
      if (child.isGridTile) {
        tilesToRemove.push(child);
      }
    });
    
    tilesToRemove.forEach(tile => {
      this.gridContainer.removeChild(tile);
    });
  }

  /**
   * Validate and remove tokens that are outside grid boundaries
   * Called after grid resize to ensure all tokens remain within valid positions
   */
  validateTokenPositions() {
    const tokensToRemove = [];
    
    this.placedTokens.forEach(tokenData => {
      // Validate token coordinates
      const coordValidation = GameValidators.coordinates(tokenData.gridX, tokenData.gridY);
      const isOutOfBounds = tokenData.gridX >= this.cols || tokenData.gridY >= this.rows;
      
      if (!coordValidation.isValid || isOutOfBounds) {
        if (tokenData.creature) {
          tokenData.creature.removeFromStage();
        }
        tokensToRemove.push(tokenData);
        
        GameErrors.validation(
          `Token removed due to invalid position: (${tokenData.gridX}, ${tokenData.gridY})`,
          {
            tokenData,
            gridBounds: { cols: this.cols, rows: this.rows },
            coordValidation
          }
        );
      }
    });
    
    // Remove invalid tokens from the array
    tokensToRemove.forEach(tokenData => {
      const index = this.placedTokens.indexOf(tokenData);
      if (index > -1) {
        this.placedTokens.splice(index, 1);
      }
    });
    
    // Update global token array for backward compatibility
    window.placedTokens = this.placedTokens;
    
    if (tokensToRemove.length > 0) {
      console.log(`Removed ${tokensToRemove.length} tokens outside grid bounds`);
    }
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
    try {
      this.gridScale = GRID_CONFIG.DEFAULT_SCALE;
      this.gridContainer.scale.set(this.gridScale);
      this.centerGrid();
      console.log('Grid zoom reset to default');
    } catch (error) {
      GameErrors.rendering(error, { stage: 'resetZoom' });
    }
  }

  /**
   * Set up the isometric grid with tiles and visual elements
   */
  setupGrid() {
    try {
      console.log('Creating grid container...');
      
      // Create main grid container
      this.gridContainer = new PIXI.Container();
      this.app.stage.addChild(this.gridContainer);
      
      // Draw grid tiles
      for (let y = 0; y < this.rows; y++) {
        for (let x = 0; x < this.cols; x++) {
          this.drawIsometricTile(x, y);
        }
      }
      
      // Center the grid after initial setup
      this.centerGrid();
      
      console.log(`Grid setup completed: ${this.cols}x${this.rows} tiles`);
    } catch (error) {
      GameErrors.rendering(error, {
        stage: 'setupGrid',
        cols: this.cols,
        rows: this.rows
      });
      throw error;
    }
  }

  /**
   * Draw an isometric tile at the specified grid coordinates
   * @param {number} x - Grid x coordinate
   * @param {number} y - Grid y coordinate  
   * @param {number} color - Hex color value (default from config)
   * @returns {PIXI.Graphics} The created tile graphics object
   */
  drawIsometricTile(x, y, color = GRID_CONFIG.TILE_COLOR) {
    try {
      // Validate coordinates
      const coordValidation = GameValidators.coordinates(x, y);
      if (!coordValidation.isValid) {
        throw new Error(`Invalid tile coordinates: ${coordValidation.getErrorMessage()}`);
      }
      
      // Create tile graphics
      const tile = new PIXI.Graphics();
      tile.lineStyle(1, GRID_CONFIG.TILE_BORDER_COLOR, GRID_CONFIG.TILE_BORDER_ALPHA);
      tile.beginFill(color);
      
      // Draw isometric diamond shape
      tile.moveTo(0, this.tileHeight / 2);
      tile.lineTo(this.tileWidth / 2, 0);
      tile.lineTo(this.tileWidth, this.tileHeight / 2);
      tile.lineTo(this.tileWidth / 2, this.tileHeight);
      tile.lineTo(0, this.tileHeight / 2);
      tile.endFill();
      
      // Position tile in isometric space
      tile.x = (x - y) * (this.tileWidth / 2);
      tile.y = (x + y) * (this.tileHeight / 2);
      
      // Mark this as a grid tile (not a creature token)
      tile.isGridTile = true;
      
      // Store grid coordinates on the tile for reference
      tile.gridX = x;
      tile.gridY = y;
      
      this.gridContainer.addChild(tile);
      return tile;
    } catch (error) {
      GameErrors.rendering(error, {
        stage: 'drawIsometricTile',
        coordinates: { x, y },
        color
      });
      throw error;
    }
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
      
      console.log('Global variables initialized for backward compatibility');
    } catch (error) {
      GameErrors.initialization(error, { stage: 'setupGlobalVariables' });
    }
  }

  setupGridInteraction() {
    this.setupContextMenu();
    this.setupMouseInteractions();
    this.setupKeyboardInteractions();
    this.setupZoomInteraction();
  }

  setupContextMenu() {
    // Disable context menu
    this.app.view.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });
  }

  setupMouseInteractions() {
    this.setupMouseDown();
    this.setupMouseMove();
    this.setupMouseUp();
    this.setupMouseLeave();
  }

  setupMouseDown() {
    // Single mousedown handler for all interactions
    this.app.view.addEventListener('mousedown', (event) => {
      if (event.button === 0) { // Left mouse button
        if (this.isSpacePressed) {
          // Space + left click = panning
          this.startGridDragging(event);
        } else {
          // Regular left click = token placement
          this.handleLeftClick(event);
        }
      }
      // Note: Right-click is now handled directly by individual sprites
    });
  }

  setupMouseMove() {
    // Mouse move handler
    this.app.view.addEventListener('mousemove', (event) => {
      if (this.isDragging) {
        this.updateGridDragPosition(event);
      }
    });
  }

  setupMouseUp() {
    // Mouse up handler
    this.app.view.addEventListener('mouseup', (event) => {
      if (this.isDragging && event.button === 0) {
        this.stopGridDragging();
      }
    });
  }

  setupMouseLeave() {
    // Mouse leave handler
    this.app.view.addEventListener('mouseleave', () => {
      if (this.isDragging) {
        this.stopGridDragging();
      }
    });
  }

  setupKeyboardInteractions() {
    // Space bar for panning
    document.addEventListener('keydown', (event) => {
      if (event.code === 'Space' && !event.repeat) {
        this.isSpacePressed = true;
        // Change cursor to indicate panning mode when space is held
        if (!this.isDragging) {
          this.app.view.style.cursor = 'grab';
        }
        event.preventDefault(); // Prevent page scrolling
      }
    });

    document.addEventListener('keyup', (event) => {
      if (event.code === 'Space') {
        this.isSpacePressed = false;
        // Reset cursor when space is released
        if (!this.isDragging) {
          this.app.view.style.cursor = 'default';
        }
      }
    });
  }

  startGridDragging(event) {
    this.isDragging = true;
    this.dragStartX = event.clientX;
    this.dragStartY = event.clientY;
    this.gridStartX = this.gridContainer.x;
    this.gridStartY = this.gridContainer.y;
    this.app.view.style.cursor = 'grabbing';
    event.preventDefault();
    event.stopPropagation();
  }

  updateGridDragPosition(event) {
    const deltaX = event.clientX - this.dragStartX;
    const deltaY = event.clientY - this.dragStartY;
    this.gridContainer.x = this.gridStartX + deltaX;
    this.gridContainer.y = this.gridStartY + deltaY;
  }

  stopGridDragging() {
    this.isDragging = false;
    // Set cursor based on whether space is still pressed
    this.app.view.style.cursor = this.isSpacePressed ? 'grab' : 'default';
  }

  setupZoomInteraction() {
    // Scroll wheel zoom handler
    this.app.view.addEventListener('wheel', (event) => {
      event.preventDefault();
      this.handleZoomWheel(event);
    });
  }

  handleZoomWheel(event) {
    // Get mouse position relative to canvas
    const rect = this.app.view.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    
    // Calculate zoom factor
    const zoomDirection = event.deltaY > 0 ? -1 : 1;
    const zoomFactor = 1 + (this.zoomSpeed * zoomDirection);
    const newScale = this.gridScale * zoomFactor;
    
    // Clamp zoom level
    if (newScale < this.minScale || newScale > this.maxScale) {
      return;
    }
    
    this.applyZoom(newScale, mouseX, mouseY);
    console.log(`Zoom: ${(this.gridScale * 100).toFixed(0)}%`);
  }

  applyZoom(newScale, mouseX, mouseY) {
    // Calculate position before zoom
    const localX = (mouseX - this.gridContainer.x) / this.gridScale;
    const localY = (mouseY - this.gridContainer.y) / this.gridScale;
    
    // Apply zoom
    this.gridScale = newScale;
    this.gridContainer.scale.set(this.gridScale);
    
    // Adjust position to zoom towards mouse cursor
    this.gridContainer.x = mouseX - localX * this.gridScale;
    this.gridContainer.y = mouseY - localY * this.gridScale;
  }

  /**
   * Handle left mouse click for token placement
   * @param {MouseEvent} event - Mouse click event
   */
  handleLeftClick(event) {
    try {
      // Only handle left clicks (button 0)
      if (event.button !== 0) {
        return;
      }
      
      // Handle testing mode clicks
      if (this.testingMode.logSprite || this.testingMode.logCenter) {
        this.handleTestingClick(event);
        return;
      }
      
      const gridCoords = this.getGridCoordinatesFromClick(event);
      if (!gridCoords) {
        GameErrors.validation('Click outside valid grid area', {
          event: { x: event.clientX, y: event.clientY }
        });
        return;
      }
      
      const { gridX, gridY } = gridCoords;
      this.handleTokenInteraction(gridX, gridY);
    } catch (error) {
      GameErrors.input(error, {
        stage: 'handleLeftClick',
        event: { button: event.button, x: event.clientX, y: event.clientY }
      });
    }
  }

  /**
   * Get grid coordinates from mouse click event
   * @param {MouseEvent} event - Mouse click event
   * @returns {Object|null} Grid coordinates or null if invalid
   */
  getGridCoordinatesFromClick(event) {
    try {
      const mouseCoords = this.getMousePosition(event);
      const localCoords = this.convertToLocalCoordinates(mouseCoords);
      const gridCoords = this.convertToGridCoordinates(localCoords);
      
      // Validate coordinates
      if (!this.isValidGridPosition(gridCoords)) {
        return null;
      }
      
      return gridCoords;
    } catch (error) {
      GameErrors.input(error, { stage: 'getGridCoordinatesFromClick' });
      return null;
    }
  }

  getMousePosition(event) {
    const rect = this.app.view.getBoundingClientRect();
    return {
      mouseX: event.clientX - rect.left,
      mouseY: event.clientY - rect.top
    };
  }

  convertToLocalCoordinates({ mouseX, mouseY }) {
    // Convert to grid container coordinates, accounting for zoom
    const gridRelativeX = mouseX - this.gridContainer.x;
    const gridRelativeY = mouseY - this.gridContainer.y;
    
    // Then divide by scale to get local coordinates
    return {
      localX: gridRelativeX / this.gridScale,
      localY: gridRelativeY / this.gridScale
    };
  }

  convertToGridCoordinates({ localX, localY }) {
    // Account for tile centering offset - subtract half tile dimensions
    const adjustedX = localX - (this.tileWidth / 2);
    const adjustedY = localY - (this.tileHeight / 2);
    
    // Convert to grid coordinates using adjusted coordinates
    const rawGridX = (adjustedX / (this.tileWidth / 2) + adjustedY / (this.tileHeight / 2)) / 2;
    const rawGridY = (adjustedY / (this.tileHeight / 2) - adjustedX / (this.tileWidth / 2)) / 2;
    
    return {
      gridX: Math.round(rawGridX),
      gridY: Math.round(rawGridY)
    };
  }

  /**
   * Validate if grid position is within bounds
   * @param {Object} gridCoords - Grid coordinates {gridX, gridY}
   * @returns {boolean} True if position is valid
   */
  isValidGridPosition({ gridX, gridY }) {
    const coordValidation = GameValidators.coordinates(gridX, gridY);
    return coordValidation.isValid && 
           gridX >= 0 && gridX < this.cols && 
           gridY >= 0 && gridY < this.rows;
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
    return this.placedTokens.find(token => {
      const diffX = Math.abs(token.gridX - gridX);
      const diffY = Math.abs(token.gridY - gridY);
      return diffX <= 1 && diffY <= 1 && (diffX + diffY) <= 1;
    });
  }

  removeToken(token) {
    token.creature.removeFromStage();
    this.placedTokens = this.placedTokens.filter(t => t !== token);
    window.placedTokens = this.placedTokens;
  }

  /**
   * Place a new token at the specified grid coordinates
   * @param {number} gridX - Grid X coordinate
   * @param {number} gridY - Grid Y coordinate
   */
  placeNewToken(gridX, gridY) {
    try {
      // Create new creature instance
      const creature = this.createCreatureByType(this.selectedTokenType);
      if (!creature) {
        throw new Error(`Failed to create creature of type: ${this.selectedTokenType}`);
      }

      // Add to grid container first
      creature.addToStage(this.gridContainer);
      
      // Calculate isometric position
      const isoCoords = this.gridToIsometric(gridX, gridY);
      creature.setPosition(isoCoords.isoX, isoCoords.isoY);
      
      // Store token info and set up interactions
      this.addTokenToCollection(creature, gridX, gridY);
      
      console.log(`Placed ${this.selectedTokenType} at grid (${gridX}, ${gridY})`);
    } catch (error) {
      GameErrors.sprites(error, {
        stage: 'placeNewToken',
        coordinates: { gridX, gridY },
        creatureType: this.selectedTokenType
      });
    }
  }

  gridToIsometric(gridX, gridY) {
    // Subtract 0.5 offset from both gridX and gridY to center sprites in tile diamonds
    const offsetGridX = gridX - 0.5;
    const offsetGridY = gridY - 0.5;
    
    return {
      isoX: (offsetGridX - offsetGridY) * (this.tileWidth / 2) + (this.tileWidth / 2),
      isoY: (offsetGridX + offsetGridY) * (this.tileHeight / 2) + (this.tileHeight / 2)
    };
  }

  addTokenToCollection(creature, gridX, gridY) {
    const newTokenData = {
      creature: creature,
      gridX: gridX,
      gridY: gridY,
      type: this.selectedTokenType
    };
    this.placedTokens.push(newTokenData);
    
    // Set up right-click drag system for all tokens
    if (creature && creature.sprite) {
      const sprite = creature.sprite;
      sprite.interactive = true;
      sprite.buttonMode = true;
      
      // Store references for event handling
      sprite.tokenData = newTokenData;
      sprite.gameManager = this;
      sprite.isRightDragging = false;
      
      console.log(`Created ${newTokenData.type} token - right-click and drag to move`);
      
      // Right mouse button down - start dragging immediately
      sprite.on('pointerdown', function(event) {
        if (event.data.originalEvent.button === 2) { // Right click
          console.log(`🟡 Right-drag started on ${this.tokenData.type}`);
          
          this.isRightDragging = true;
          this.alpha = 0.7; // Visual feedback - make semi-transparent
          this.dragData = event.data;
          
          // Store initial position for potential cancellation
          this.dragStartX = this.x;
          this.dragStartY = this.y;
          
          event.stopPropagation();
          event.preventDefault();
        }
      });
      
      // Mouse move - update token position if right-dragging
      sprite.on('pointermove', function() {
        if (this.isRightDragging && this.dragData) {
          const newPosition = this.dragData.getLocalPosition(this.parent);
          this.x = newPosition.x;
          this.y = newPosition.y;
        }
      });
      
      // Right mouse button up - end dragging and snap to grid
      sprite.on('pointerup', function(event) {
        if (this.isRightDragging && event.data.originalEvent.button === 2) {
          console.log(`🟢 Right-drag ended on ${this.tokenData.type} - snapping to grid`);
          
          this.isRightDragging = false;
          this.alpha = 1.0; // Restore full opacity
          this.dragData = null;
          
          // Snap to grid using the game manager's snap function
          if (window.snapToGrid) {
            window.snapToGrid(this);
          }
          
          event.stopPropagation();
        }
      });
      
      // Handle mouse leaving the canvas area
      sprite.on('pointerupoutside', function() {
        if (this.isRightDragging) {
          console.log('Right-drag cancelled (mouse left canvas) - snapping to grid');
          
          this.isRightDragging = false;
          this.alpha = 1.0;
          this.dragData = null;
          
          // Snap to grid
          if (window.snapToGrid) {
            window.snapToGrid(this);
          }
        }
      });
    }
    
    window.placedTokens = this.placedTokens;
  }

  /**
   * Initialize sprite manager and load creature sprites
   * @returns {Promise<void>} Promise that resolves when sprites are loaded
   */
  async initializeSprites() {
    try {
      if (window.spriteManager) {
        console.log('Sprite manager found, initializing...');
        await window.spriteManager.initialize();
        console.log('Sprites loaded successfully');
        this.spritesReady = true;
        window.spritesReady = true;
      } else {
        console.log('No sprite manager found, using drawn graphics');
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
    try {
      console.log('selectToken called with:', tokenType);
      
      // Validate token type
      if (tokenType !== 'remove') {
        const typeValidation = GameValidators.creatureType(tokenType);
        if (!typeValidation.isValid) {
          throw new Error(`Invalid token type: ${typeValidation.getErrorMessage()}`);
        }
      }
      
      // Update UI selection - look for buttons in creature content and action sections
      document.querySelectorAll('#creature-content button[id^="token-"], #token-remove').forEach(btn => {
        btn.classList.remove('selected');
        btn.setAttribute('aria-pressed', 'false');
      });
      
      const tokenButton = document.getElementById(`token-${tokenType}`);
      if (tokenButton) {
        tokenButton.classList.add('selected');
        tokenButton.setAttribute('aria-pressed', 'true');
      } else {
        console.warn(`Button not found for token type: ${tokenType}`);
      }
      
      this.selectedTokenType = tokenType;
      window.selectedTokenType = tokenType;
      
      // Update sidebar if available
      if (window.sidebarController) {
        window.sidebarController.updateTokenSelection(tokenType);
      }
      
      // Update info text
      const infoEl = document.getElementById('token-info');
      if (infoEl) {
        if (tokenType === 'remove') {
          infoEl.textContent = 'Click on tokens to remove them';
        } else {
          infoEl.textContent = `Click on grid to place ${tokenType}`;
        }
      }
    } catch (error) {
      GameErrors.validation(error, {
        stage: 'selectToken',
        tokenType
      });
    }
  }

  toggleFacing() {
    this.tokenFacingRight = !this.tokenFacingRight;
    window.tokenFacingRight = this.tokenFacingRight;
    
    // Update button display
    const facingBtn = document.getElementById('facing-right');
    if (facingBtn) {
      facingBtn.innerHTML = this.tokenFacingRight ? '➡️ Right' : '⬅️ Left';
    }
  }

  /**
   * Create a creature instance by type
   * @param {string} type - Creature type identifier
   * @returns {Object|null} Creature instance or null if creation fails
   */
  createCreatureByType(type) {
    try {
      // Validate creature type
      const typeValidation = GameValidators.creatureType(type);
      if (!typeValidation.isValid) {
        throw new Error(`Invalid creature type: ${typeValidation.getErrorMessage()}`);
      }
      
      const creationFunctions = {
        'goblin': () => createGoblin(),
        'orc': () => createOrc(),
        'skeleton': () => createSkeleton(),
        'dragon': () => createDragon(),
        'beholder': () => createBeholder(),
        'troll': () => createTroll(),
        'owlbear': () => createOwlbear(),
        'minotaur': () => createMinotaur(),
        'mindflayer': () => createMindFlayer()
      };
      
      const createFunction = creationFunctions[type];
      if (!createFunction) {
        throw new Error(`No creation function found for creature type: ${type}`);
      }
      
      const creature = createFunction();
      if (!creature) {
        throw new Error(`Creation function returned null for creature type: ${type}`);
      }
      
      return creature;
    } catch (error) {
      GameErrors.sprites(error, {
        stage: 'createCreatureByType',
        creatureType: type
      });
      return null;
    }
  }

  /**
   * Snap a token to the nearest grid center
   * @param {PIXI.Sprite} token - Token sprite to snap
   */
  snapToGrid(token) {
    try {
      // Token position is already relative to gridContainer since that's its parent
      const localX = token.x;
      const localY = token.y;

      // Account for tile centering offset - subtract half tile dimensions
      const adjustedX = localX - (this.tileWidth / 2);
      const adjustedY = localY - (this.tileHeight / 2);

      // Convert back to grid coordinates using adjusted coordinates  
      const gridX = Math.round((adjustedX / (this.tileWidth / 2) + adjustedY / (this.tileHeight / 2)) / 2);
      const gridY = Math.round((adjustedY / (this.tileHeight / 2) - adjustedX / (this.tileWidth / 2)) / 2);

      // Clamp to grid bounds
      const clampedX = Math.max(0, Math.min(this.cols - 1, gridX));
      const clampedY = Math.max(0, Math.min(this.rows - 1, gridY));

      // Position at diamond center - same logic as gridToIsometric with -0.5 offset for both coordinates
      const offsetGridX = clampedX - 0.5;
      const offsetGridY = clampedY - 0.5;
      const isoX = (offsetGridX - offsetGridY) * (this.tileWidth / 2) + (this.tileWidth / 2);
      const isoY = (offsetGridX + offsetGridY) * (this.tileHeight / 2) + (this.tileHeight / 2);

      token.x = isoX;
      token.y = isoY;
      
      // Update the token's grid position in the placedTokens array
      const tokenEntry = this.placedTokens.find(t => t.creature && t.creature.sprite === token);
      if (tokenEntry) {
        tokenEntry.gridX = clampedX;
        tokenEntry.gridY = clampedY;
        console.log(`Token snapped to grid (${clampedX}, ${clampedY})`);
      }
    } catch (error) {
      GameErrors.input(error, {
        stage: 'snapToGrid',
        tokenPosition: { x: token.x, y: token.y }
      });
    }
  }

  /**
   * Handle testing mode clicks for position logging
   * @param {MouseEvent} event - Mouse click event
   */
  handleTestingClick(event) {
    try {
      const mouseCoords = this.getMousePosition(event);
      const localCoords = this.convertToLocalCoordinates(mouseCoords);
      const gridCoords = this.convertToGridCoordinates(localCoords);
      
      const timestamp = new Date().toLocaleTimeString();
      
      if (this.testingMode.logSprite) {
        console.log(`🔴 SPRITE POSITION LOG [${timestamp}]:`);
        console.log(`  Screen: (${event.clientX}, ${event.clientY})`);
        console.log(`  Canvas: (${mouseCoords.mouseX}, ${mouseCoords.mouseY})`);
        console.log(`  Local: (${localCoords.localX.toFixed(1)}, ${localCoords.localY.toFixed(1)})`);
        console.log(`  Grid: (${gridCoords.gridX}, ${gridCoords.gridY})`);
        
        this.addTestingLogEntry(`🔴 Sprite at Grid(${gridCoords.gridX},${gridCoords.gridY}) Local(${localCoords.localX.toFixed(1)},${localCoords.localY.toFixed(1)})`, timestamp);
        
        // Auto-disable after logging
        this.toggleSpriteLogging();
      }
      
      if (this.testingMode.logCenter) {
        console.log(`🔵 TILE CENTER LOG [${timestamp}]:`);
        console.log(`  Screen: (${event.clientX}, ${event.clientY})`);
        console.log(`  Canvas: (${mouseCoords.mouseX}, ${mouseCoords.mouseY})`);
        console.log(`  Local: (${localCoords.localX.toFixed(1)}, ${localCoords.localY.toFixed(1)})`);
        console.log(`  Grid: (${gridCoords.gridX}, ${gridCoords.gridY})`);
        
        this.addTestingLogEntry(`🔵 Center at Grid(${gridCoords.gridX},${gridCoords.gridY}) Local(${localCoords.localX.toFixed(1)},${localCoords.localY.toFixed(1)})`, timestamp);
        
        // Auto-disable after logging
        this.toggleCenterLogging();
      }
    } catch (error) {
      GameErrors.input(error, {
        stage: 'handleTestingClick',
        event: { button: event.button, x: event.clientX, y: event.clientY }
      });
    }
  }

  /**
   * Toggle sprite position logging mode
   */
  toggleSpriteLogging() {
    this.testingMode.logSprite = !this.testingMode.logSprite;
    
    // Ensure only one mode is active at a time
    if (this.testingMode.logSprite) {
      this.testingMode.logCenter = false;
      this.updateTestingButton('testing-log-center', false);
    }
    
    this.updateTestingButton('testing-log-sprite', this.testingMode.logSprite);
    
    const status = this.testingMode.logSprite ? 'ENABLED' : 'DISABLED';
    console.log(`🔴 Sprite position logging ${status}`);
  }

  /**
   * Toggle tile center logging mode
   */
  toggleCenterLogging() {
    this.testingMode.logCenter = !this.testingMode.logCenter;
    
    // Ensure only one mode is active at a time
    if (this.testingMode.logCenter) {
      this.testingMode.logSprite = false;
      this.updateTestingButton('testing-log-sprite', false);
    }
    
    this.updateTestingButton('testing-log-center', this.testingMode.logCenter);
    
    const status = this.testingMode.logCenter ? 'ENABLED' : 'DISABLED';
    console.log(`🔵 Tile center logging ${status}`);
  }

  /**
   * Update testing button visual state
   * @param {string} buttonId - ID of the button to update
   * @param {boolean} active - Whether the button should be active
   */
  updateTestingButton(buttonId, active) {
    const button = document.getElementById(buttonId);
    if (button) {
      if (active) {
        button.classList.add('selected');
        button.setAttribute('aria-pressed', 'true');
      } else {
        button.classList.remove('selected');
        button.setAttribute('aria-pressed', 'false');
      }
    }
  }

  /**
   * Add entry to testing log display
   * @param {string} message - Log message
   * @param {string} timestamp - Timestamp
   */
  addTestingLogEntry(message, timestamp) {
    const logContent = document.getElementById('testing-log-content');
    if (logContent) {
      // Remove placeholder if present
      const placeholder = logContent.querySelector('.testing-log-entry');
      if (placeholder && placeholder.textContent === 'No tests performed yet') {
        placeholder.remove();
      }
      
      const entry = document.createElement('div');
      entry.className = 'testing-log-entry';
      entry.innerHTML = `<small>${timestamp}</small><br>${message}`;
      logContent.appendChild(entry);
      
      // Keep only last 10 entries
      const entries = logContent.querySelectorAll('.testing-log-entry');
      if (entries.length > 10) {
        entries[0].remove();
      }
      
      // Scroll to bottom
      logContent.scrollTop = logContent.scrollHeight;
    }
  }

  /**
   * Clear testing log
   */
  clearTestingLog() {
    const logContent = document.getElementById('testing-log-content');
    if (logContent) {
      logContent.innerHTML = '<div class="testing-log-entry">No tests performed yet</div>';
    }
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

/**
 * Testing Functions
 */

/**
 * Toggle sprite position logging mode
 */
function toggleSpriteLogging() {
  if (window.gameManager) {
    window.gameManager.toggleSpriteLogging();
  } else {
    console.error('GameManager not initialized');
  }
}

/**
 * Toggle tile center logging mode
 */
function toggleCenterLogging() {
  if (window.gameManager) {
    window.gameManager.toggleCenterLogging();
  } else {
    console.error('GameManager not initialized');
  }
}

/**
 * Clear testing log
 */
function clearTestingLog() {
  if (window.gameManager) {
    window.gameManager.clearTestingLog();
  } else {
    console.error('GameManager not initialized');
  }
}

// Make global functions available for backward compatibility
window.selectToken = selectToken;
window.toggleFacing = toggleFacing;
window.snapToGrid = snapToGrid;
window.toggleSpriteLogging = toggleSpriteLogging;
window.toggleCenterLogging = toggleCenterLogging;
window.clearTestingLog = clearTestingLog;

// Export the GameManager class for ES6 module usage
export default GameManager;
