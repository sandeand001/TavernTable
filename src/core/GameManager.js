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
    
    // Grid constants
    this.tileWidth = 64;
    this.tileHeight = 32;
    this.rows = 10;
    this.cols = 10;
    
    // Grid panning variables
    this.isDragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.gridStartX = 0;
    this.gridStartY = 0;
    
    // Grid zoom variables
    this.gridScale = 1.0;
    this.minScale = 0.3;
    this.maxScale = 3.0;
    this.zoomSpeed = 0.1;
  }

  /**
   * Initialize the game manager and set up all components
   * @returns {Promise<void>} Promise that resolves when initialization is complete
   */
  async initialize() {
    try {
      this.createPixiApp();
      this.setupGrid();
      this.setupGlobalVariables();
      this.setupGridInteraction();
      
      // Initialize sprites
      await this.initializeSprites();
      
      // Fix any existing tokens that might be in wrong container
      this.fixExistingTokens();
    } catch (error) {
      console.error('Failed to initialize game:', error);
      this.showErrorMessage('Failed to initialize game. Please refresh the page.');
      throw error;
    }
  }

  /**
   * Create and configure the PIXI application
   */
  createPixiApp() {
    try {
      // Initialize PIXI application
      this.app = new PIXI.Application({
        width: window.innerWidth,
        height: window.innerHeight,
        backgroundColor: 0x2c2c2c
      });
      
      const gameContainer = document.getElementById('game-container');
      if (!gameContainer) {
        throw new Error('Game container element not found');
      }
      
      gameContainer.appendChild(this.app.view);
      
      // Disable stage interaction but allow children to be interactive
      this.app.stage.interactive = false;
      this.app.stage.interactiveChildren = true;
      
      // Make app globally available
      window.app = this.app;
    } catch (error) {
      console.error('Failed to create PIXI application:', error);
      throw new Error('Failed to initialize graphics engine');
    }
  }

  /**
   * Display an error message to the user
   * @param {string} message - The error message to display
   */
  showErrorMessage(message) {
    // Simple error notification - could be enhanced with a proper notification system
    alert(message);
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
   * @param {number} newCols - Number of columns (5-50)
   * @param {number} newRows - Number of rows (5-50)
   * @throws {Error} When dimensions are invalid or out of range
   */
  resizeGrid(newCols, newRows) {
    // Validate input parameters
    if (!Number.isInteger(newCols) || !Number.isInteger(newRows)) {
      throw new Error('Grid dimensions must be integers');
    }
    
    if (newCols < 5 || newCols > 50 || newRows < 5 || newRows > 50) {
      throw new Error('Grid dimensions must be between 5 and 50');
    }
    
    try {
      // Update grid dimensions
      this.cols = newCols;
      this.rows = newRows;
      
      // Update global variables
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
      
      // Recenter the grid
      this.centerGrid();
    } catch (error) {
      console.error('Error resizing grid:', error);
      throw new Error(`Failed to resize grid: ${error.message}`);
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
    // Remove tokens that are outside the new grid bounds
    const tokensToRemove = [];
    
    this.placedTokens.forEach(tokenData => {
      if (tokenData.gridX >= this.cols || tokenData.gridY >= this.rows) {
        if (tokenData.creature) {
          tokenData.creature.removeFromStage();
        }
        tokensToRemove.push(tokenData);
      }
    });
    
    // Remove invalid tokens from the array
    tokensToRemove.forEach(tokenData => {
      const index = this.placedTokens.indexOf(tokenData);
      if (index > -1) {
        this.placedTokens.splice(index, 1);
      }
    });
    
    // Update global token array
    window.placedTokens = this.placedTokens;
    
    if (tokensToRemove.length > 0) {
      console.log(`Removed ${tokensToRemove.length} tokens that were outside new grid bounds`);
    }
  }

  centerGrid() {
    // Recenter the grid based on new dimensions and current zoom
    this.gridContainer.x = this.app.screen.width / 2 - (this.cols * this.tileWidth / 4) * this.gridScale;
    this.gridContainer.y = 100;
  }

  /**
   * Reset the grid zoom to default scale and center the view
   */
  resetZoom() {
    this.gridScale = 1.0;
    this.gridContainer.scale.set(this.gridScale);
    this.centerGrid();
  }

  /**
   * Set up the isometric grid with tiles and visual elements
   */
  setupGrid() {
    console.log('Creating grid container...');
    this.gridContainer = new PIXI.Container();
    this.gridContainer.x = this.app.screen.width / 2 - (this.cols * this.tileWidth / 4);
    this.gridContainer.y = 100;
    this.app.stage.addChild(this.gridContainer);
    
    // Draw grid tiles
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        this.drawIsometricTile(x, y);
      }
    }
  }

  /**
   * Draw an isometric tile at the specified grid coordinates
   * @param {number} x - Grid x coordinate
   * @param {number} y - Grid y coordinate  
   * @param {number} color - Hex color value (default: 0x555555)
   * @returns {PIXI.Graphics} The created tile graphics object
   */
  drawIsometricTile(x, y, color = 0x555555) {
    const tile = new PIXI.Graphics();
    tile.lineStyle(1, 0xffffff, 0.3);
    tile.beginFill(color);
    tile.moveTo(0, this.tileHeight / 2);
    tile.lineTo(this.tileWidth / 2, 0);
    tile.lineTo(this.tileWidth, this.tileHeight / 2);
    tile.lineTo(this.tileWidth / 2, this.tileHeight);
    tile.lineTo(0, this.tileHeight / 2);
    tile.endFill();
    tile.x = (x - y) * (this.tileWidth / 2);
    tile.y = (x + y) * (this.tileHeight / 2);
    
    // Mark this as a grid tile (not a creature token)
    tile.isGridTile = true;
    
    // Store grid coordinates on the tile
    tile.gridX = x;
    tile.gridY = y;
    
    this.gridContainer.addChild(tile);
  }

  setupGlobalVariables() {
    // Make variables globally available for other modules
    window.tileWidth = this.tileWidth;
    window.tileHeight = this.tileHeight;
    window.rows = this.rows;
    window.cols = this.cols;
    window.gridContainer = this.gridContainer;
    window.selectedTokenType = this.selectedTokenType;
    window.tokenFacingRight = this.tokenFacingRight;
    window.placedTokens = this.placedTokens;
    window.gameManager = this;
  }

  setupGridInteraction() {
    this.setupContextMenu();
    this.setupMouseInteractions();
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
      if (event.button === 2) { // Right mouse button - grid dragging
        this.startGridDragging(event);
      } else if (event.button === 0) { // Left mouse button - token placement
        this.handleLeftClick(event);
      }
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
      if (this.isDragging && event.button === 2) {
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
    this.app.view.style.cursor = 'default';
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

  handleLeftClick(event) {
    // ONLY handle left clicks (button 0)
    if (event.button !== 0) {
      return;
    }
    
    const gridCoords = this.getGridCoordinatesFromClick(event);
    if (!gridCoords) return;
    
    const { gridX, gridY } = gridCoords;
    
    // Skip grid placement when in move mode
    if (this.selectedTokenType === 'move') {
      return;
    }
    
    this.handleTokenInteraction(gridX, gridY);
  }

  getGridCoordinatesFromClick(event) {
    const mouseCoords = this.getMousePosition(event);
    const localCoords = this.convertToLocalCoordinates(mouseCoords);
    const gridCoords = this.convertToGridCoordinates(localCoords);
    
    // Check bounds
    if (!this.isValidGridPosition(gridCoords)) {
      return null;
    }
    
    return gridCoords;
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
    // Convert to grid coordinates - find the closest intersection
    const rawGridX = (localX / (this.tileWidth / 2) + localY / (this.tileHeight / 2)) / 2;
    const rawGridY = (localY / (this.tileHeight / 2) - localX / (this.tileWidth / 2)) / 2;
    
    return {
      gridX: Math.round(rawGridX),
      gridY: Math.round(rawGridY)
    };
  }

  isValidGridPosition({ gridX, gridY }) {
    return gridX >= 0 && gridX < this.cols && gridY >= 0 && gridY < this.rows;
  }

  handleTokenInteraction(gridX, gridY) {
    const existingToken = this.findExistingTokenAt(gridX, gridY);
    
    if (existingToken) {
      this.removeToken(existingToken);
    }
    
    // If remove mode is selected, only remove tokens
    if (this.selectedTokenType === 'remove') {
      return;
    }
    
    this.placeNewToken(gridX, gridY);
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

  placeNewToken(gridX, gridY) {
    // Create new token
    const creature = this.createCreatureByType(this.selectedTokenType);
    if (!creature) return;

    // Add to grid container FIRST
    creature.addToStage(this.gridContainer);
    
    // THEN set position relative to grid container
    const isoCoords = this.gridToIsometric(gridX, gridY);
    creature.setPosition(isoCoords.isoX, isoCoords.isoY);
    
    // Store token info
    this.addTokenToCollection(creature, gridX, gridY);
  }

  gridToIsometric(gridX, gridY) {
    return {
      isoX: (gridX - gridY) * (this.tileWidth / 2),
      isoY: (gridX + gridY) * (this.tileHeight / 2)
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
    
    // If we're in move mode, make this token draggable immediately
    if (window.selectedTokenType === 'move' && creature && creature.sprite) {
      const sprite = creature.sprite;
      sprite.interactive = true;
      sprite.buttonMode = true;
      sprite.on('pointerdown', window.onDragStart);
      sprite.on('pointerup', window.onDragEnd);
      sprite.on('pointerupoutside', window.onDragEnd);
      sprite.on('pointermove', window.onDragMove);
      console.log(`Made new ${newTokenData.type} token draggable`);
    }
    
    // Check if we need to enable dragging for all tokens
    if (window.selectedTokenType === 'move') {
      this.enableTokenDragging();
    }
    
    window.placedTokens = this.placedTokens;
  }

  async initializeSprites() {
    if (window.spriteManager) {
      console.log('Sprite manager found, initializing...');
      try {
        await window.spriteManager.initialize();
        console.log('Sprites loaded successfully');
        this.spritesReady = true;
        window.spritesReady = true;
      } catch (error) {
        console.error('Failed to load sprites:', error);
        this.spritesReady = true; // Allow fallback to drawn graphics
        window.spritesReady = true;
      }
    } else {
      console.log('No sprite manager found, using drawn graphics');
      this.spritesReady = true;
      window.spritesReady = true;
    }
  }

  selectToken(tokenType) {
    console.log('selectToken called with:', tokenType);
    
    // Update UI selection - look for buttons in both creature tokens and action sections
    document.querySelectorAll('#token-panel button[id^="token-"]').forEach(btn => {
      btn.classList.remove('selected');
    });
    
    const tokenButton = document.getElementById(`token-${tokenType}`);
    if (tokenButton) {
      tokenButton.classList.add('selected');
    } else {
      console.warn(`Button not found for token type: ${tokenType}`);
    }
    
    this.selectedTokenType = tokenType;
    window.selectedTokenType = tokenType;
    
    // Handle move mode - enable/disable dragging for all tokens
    if (tokenType === 'move') {
      this.enableTokenDragging();
    } else {
      this.disableTokenDragging();
    }
    
    // Update info text
    const infoEl = document.getElementById('token-info');
    if (tokenType === 'remove') {
      infoEl.textContent = 'Click on tokens to remove them';
    } else if (tokenType === 'move') {
      infoEl.textContent = 'Drag tokens to move them around';
    } else {
      infoEl.textContent = `Click on grid to place ${tokenType}`;
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

  enableTokenDragging() {
    console.log('Enabling token dragging for all placed tokens');
    
    // Enable interactivity for all placed tokens
    this.placedTokens.forEach(tokenData => {
      if (tokenData.creature && tokenData.creature.sprite) {
        const sprite = tokenData.creature.sprite;
        
        // Make sprite interactive
        sprite.interactive = true;
        sprite.buttonMode = true;
        
        // Attach drag event handlers from DragController
        sprite.on('pointerdown', window.onDragStart);
        sprite.on('pointerup', window.onDragEnd);
        sprite.on('pointerupoutside', window.onDragEnd);
        sprite.on('pointermove', window.onDragMove);
        
        console.log(`Enabled dragging for ${tokenData.type} token`);
      }
    });
  }

  disableTokenDragging() {
    console.log('Disabling token dragging for all placed tokens');
    
    // Disable interactivity for all placed tokens
    this.placedTokens.forEach(tokenData => {
      if (tokenData.creature && tokenData.creature.sprite) {
        const sprite = tokenData.creature.sprite;
        
        // Remove interactivity
        sprite.interactive = false;
        sprite.buttonMode = false;
        
        // Remove drag event handlers
        sprite.off('pointerdown', window.onDragStart);
        sprite.off('pointerup', window.onDragEnd);
        sprite.off('pointerupoutside', window.onDragEnd);
        sprite.off('pointermove', window.onDragMove);
        
        console.log(`Disabled dragging for ${tokenData.type} token`);
      }
    });
  }

  createCreatureByType(type) {
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
    return createFunction ? createFunction() : null;
  }

  snapToGrid(token) {
    // Token position is already relative to gridContainer since that's its parent
    // No need to subtract gridContainer position
    const localX = token.x;
    const localY = token.y;

    // Convert back to grid coordinates to find nearest intersection
    const gridX = Math.round((localX / (this.tileWidth / 2) + localY / (this.tileHeight / 2)) / 2);
    const gridY = Math.round((localY / (this.tileHeight / 2) - localX / (this.tileWidth / 2)) / 2);

    const clampedX = Math.max(0, Math.min(this.cols - 1, gridX));
    const clampedY = Math.max(0, Math.min(this.rows - 1, gridY));

    // Position at intersection point (relative to grid container)
    const isoX = (clampedX - clampedY) * (this.tileWidth / 2);
    const isoY = (clampedX + clampedY) * (this.tileHeight / 2);

    token.x = isoX;
    token.y = isoY;
    
    // Update the token's grid position in the placedTokens array
    const tokenEntry = this.placedTokens.find(t => t.creature && t.creature.sprite === token);
    if (tokenEntry) {
      tokenEntry.gridX = clampedX;
      tokenEntry.gridY = clampedY;
    }
  }
}

// Global functions for UI interaction
function selectToken(tokenType) {
  if (window.gameManager) {
    window.gameManager.selectToken(tokenType);
  }
}

function toggleFacing() {
  if (window.gameManager) {
    window.gameManager.toggleFacing();
  }
}

function snapToGrid(token) {
  if (window.gameManager) {
    window.gameManager.snapToGrid(token);
  }
}

// Make functions globally available
window.selectToken = selectToken;
window.toggleFacing = toggleFacing;
window.snapToGrid = snapToGrid;

// Export the GameManager class
export default GameManager;
