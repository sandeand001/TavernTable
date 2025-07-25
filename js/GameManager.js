// js/GameManager.js - Main game initialization and management

class GameManager {
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

  async initialize() {
    console.log('Starting game initialization...');
    
    // Initialize PIXI application
    this.app = new PIXI.Application({
      width: window.innerWidth,
      height: window.innerHeight,
      backgroundColor: 0x2c2c2c
    });
    document.getElementById('game-container').appendChild(this.app.view);
    
    // Disable PIXI interaction system more safely
    this.app.stage.interactive = false;
    this.app.stage.interactiveChildren = false;
    
    // Make app globally available
    window.app = this.app;
    
    this.setupGrid();
    this.setupGlobalVariables();
    this.setupGridInteraction();
    
    // Initialize sprites
    await this.initializeSprites();
    
    console.log('Game initialization complete');
    
    // Fix any existing tokens that might be in wrong container
    this.fixExistingTokens();
  }

  fixExistingTokens() {
    console.log('Fixing existing tokens...');
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

  resizeGrid(newCols, newRows) {
    console.log(`Resizing grid from ${this.cols}x${this.rows} to ${newCols}x${newRows}`);
    
    // Store old dimensions
    const oldCols = this.cols;
    const oldRows = this.rows;
    
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
    
    console.log(`Grid resized successfully to ${this.cols}x${this.rows}`);
  }

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

  validateTokenPositions() {
    // Remove tokens that are outside the new grid bounds
    const tokensToRemove = [];
    
    this.placedTokens.forEach(tokenData => {
      if (tokenData.gridX >= this.cols || tokenData.gridY >= this.rows) {
        console.log(`Removing token at (${tokenData.gridX}, ${tokenData.gridY}) - outside new grid bounds`);
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

  resetZoom() {
    console.log('Resetting zoom to 100%');
    this.gridScale = 1.0;
    this.gridContainer.scale.set(this.gridScale);
    this.centerGrid();
  }

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
    console.log('Grid tiles created');
  }

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
    // Disable context menu
    this.app.view.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });
    
    // Single mousedown handler for all interactions
    this.app.view.addEventListener('mousedown', (event) => {
      if (event.button === 2) { // Right mouse button - grid dragging
        this.isDragging = true;
        this.dragStartX = event.clientX;
        this.dragStartY = event.clientY;
        this.gridStartX = this.gridContainer.x;
        this.gridStartY = this.gridContainer.y;
        this.app.view.style.cursor = 'grabbing';
        event.preventDefault();
        event.stopPropagation();
        
      } else if (event.button === 0) { // Left mouse button - token placement
        this.handleLeftClick(event);
      }
    });
    
    // Mouse move handler
    this.app.view.addEventListener('mousemove', (event) => {
      if (this.isDragging) {
        const deltaX = event.clientX - this.dragStartX;
        const deltaY = event.clientY - this.dragStartY;
        this.gridContainer.x = this.gridStartX + deltaX;
        this.gridContainer.y = this.gridStartY + deltaY;
      }
    });
    
    // Mouse up handler
    this.app.view.addEventListener('mouseup', (event) => {
      if (this.isDragging && event.button === 2) {
        this.isDragging = false;
        this.app.view.style.cursor = 'default';
      }
    });
    
    // Mouse leave handler
    this.app.view.addEventListener('mouseleave', () => {
      if (this.isDragging) {
        this.isDragging = false;
        this.app.view.style.cursor = 'default';
      }
    });
    
    // Scroll wheel zoom handler
    this.app.view.addEventListener('wheel', (event) => {
      event.preventDefault();
      
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
      
      // Calculate position before zoom
      const localX = (mouseX - this.gridContainer.x) / this.gridScale;
      const localY = (mouseY - this.gridContainer.y) / this.gridScale;
      
      // Apply zoom
      this.gridScale = newScale;
      this.gridContainer.scale.set(this.gridScale);
      
      // Adjust position to zoom towards mouse cursor
      this.gridContainer.x = mouseX - localX * this.gridScale;
      this.gridContainer.y = mouseY - localY * this.gridScale;
      
      console.log(`Zoom: ${(this.gridScale * 100).toFixed(0)}%`);
    });
  }

  handleLeftClick(event) {
    // ONLY handle left clicks (button 0)
    if (event.button !== 0) {
      return;
    }
    
    // Get mouse position relative to the canvas
    const rect = this.app.view.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    
    // Convert to grid container coordinates, accounting for zoom
    // First get position relative to grid container origin
    const gridRelativeX = mouseX - this.gridContainer.x;
    const gridRelativeY = mouseY - this.gridContainer.y;
    
    // Then divide by scale to get local coordinates
    const localX = gridRelativeX / this.gridScale;
    const localY = gridRelativeY / this.gridScale;
    
    // Convert to grid coordinates - find the closest intersection
    const rawGridX = (localX / (this.tileWidth / 2) + localY / (this.tileHeight / 2)) / 2;
    const rawGridY = (localY / (this.tileHeight / 2) - localX / (this.tileWidth / 2)) / 2;
    
    const gridX = Math.round(rawGridX);
    const gridY = Math.round(rawGridY);
    
    // Check bounds
    if (gridX < 0 || gridX >= this.cols || gridY < 0 || gridY >= this.rows) {
      return;
    }
    
    // Skip grid placement when in move mode
    if (this.selectedTokenType === 'move') {
      return;
    }
    
    // Check if there's already a token at this position
    const existingToken = this.placedTokens.find(token => {
      const diffX = Math.abs(token.gridX - gridX);
      const diffY = Math.abs(token.gridY - gridY);
      return diffX <= 1 && diffY <= 1 && (diffX + diffY) <= 1;
    });
    
    if (existingToken) {
      existingToken.creature.removeFromStage();
      this.placedTokens = this.placedTokens.filter(t => t !== existingToken);
      window.placedTokens = this.placedTokens;
    }
    
    // If remove mode is selected, only remove tokens
    if (this.selectedTokenType === 'remove') {
      return;
    }
    
    // Create new token
    const creature = this.createCreatureByType(this.selectedTokenType);
    if (!creature) return;

    // Add to grid container FIRST
    creature.addToStage(this.gridContainer);
    
    // THEN set position relative to grid container
    const isoX = (gridX - gridY) * (this.tileWidth / 2);
    const isoY = (gridX + gridY) * (this.tileHeight / 2);
    creature.setPosition(isoX, isoY);
    
    // Store token info
    const newTokenData = {
      creature: creature,
      gridX: gridX,
      gridY: gridY,
      type: this.selectedTokenType
    };
    this.placedTokens.push(newTokenData);
    
    // Check if we need to enable dragging (if currently in move mode after placing)
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
    console.log('Token dragging disabled - PIXI interaction system removed');
    // Token dragging is disabled since we removed PIXI interaction system
    // This prevents conflicts with grid dragging
  }

  disableTokenDragging() {
    console.log('Token dragging already disabled');
    // Nothing to do since PIXI interaction is disabled
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
    const localX = token.x - this.gridContainer.x;
    const localY = token.y - this.gridContainer.y;

    // Convert back to grid coordinates to find nearest intersection
    const gridX = Math.round((localX / (this.tileWidth / 2) + localY / (this.tileHeight / 2)) / 2);
    const gridY = Math.round((localY / (this.tileHeight / 2) - localX / (this.tileWidth / 2)) / 2);

    const clampedX = Math.max(0, Math.min(this.cols - 1, gridX));
    const clampedY = Math.max(0, Math.min(this.rows - 1, gridY));

    // Position at intersection point
    const isoX = (clampedX - clampedY) * (this.tileWidth / 2);
    const isoY = (clampedX + clampedY) * (this.tileHeight / 2);

    token.x = this.gridContainer.x + isoX;
    token.y = this.gridContainer.y + isoY;
    
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
