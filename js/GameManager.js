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
    
    // Make app globally available
    window.app = this.app;
    
    this.setupGrid();
    this.setupGlobalVariables();
    
    // Initialize sprites
    await this.initializeSprites();
    
    console.log('Game initialization complete');
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
    
    // Make tiles interactive for token placement
    tile.interactive = true;
    tile.cursor = 'pointer';
    tile.on('pointerdown', (event) => this.onGridClick(event));
    
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
    console.log('Enabling token dragging for', this.placedTokens.length, 'tokens');
    this.placedTokens.forEach(tokenData => {
      if (tokenData.creature && tokenData.creature.sprite) {
        const sprite = tokenData.creature.sprite;
        sprite.interactive = true;
        sprite.cursor = 'grab';
        sprite.on('pointerdown', window.onDragStart);
        sprite.on('pointerup', window.onDragEnd);
        sprite.on('pointerupoutside', window.onDragEnd);
        sprite.on('pointermove', window.onDragMove);
      }
    });
  }

  disableTokenDragging() {
    console.log('Disabling token dragging');
    this.placedTokens.forEach(tokenData => {
      if (tokenData.creature && tokenData.creature.sprite) {
        const sprite = tokenData.creature.sprite;
        sprite.interactive = false;
        sprite.cursor = 'default';
        sprite.off('pointerdown', window.onDragStart);
        sprite.off('pointerup', window.onDragEnd);
        sprite.off('pointerupoutside', window.onDragEnd);
        sprite.off('pointermove', window.onDragMove);
        // Reset any drag state
        sprite.dragging = false;
        sprite.alpha = 1.0;
      }
    });
  }

  onGridClick(event) {
    console.log('Grid clicked, selectedTokenType:', this.selectedTokenType);
    
    // Skip grid placement when in move mode
    if (this.selectedTokenType === 'move') {
      console.log('Move mode active, skipping grid placement');
      return;
    }
    
    // Get click position relative to grid container
    const localPos = event.data.getLocalPosition(this.gridContainer);
    
    // Convert to grid coordinates - find the closest intersection
    const rawGridX = (localPos.x / (this.tileWidth / 2) + localPos.y / (this.tileHeight / 2)) / 2;
    const rawGridY = (localPos.y / (this.tileHeight / 2) - localPos.x / (this.tileWidth / 2)) / 2;
    
    const gridX = Math.round(rawGridX);
    const gridY = Math.round(rawGridY);
    
    // Check bounds
    if (gridX < 0 || gridX >= this.cols || gridY < 0 || gridY >= this.rows) {
      console.log('Click outside grid bounds');
      return;
    }
    
    // Check if there's already a token at this position
    const existingToken = this.placedTokens.find(token => {
      const diffX = Math.abs(token.gridX - gridX);
      const diffY = Math.abs(token.gridY - gridY);
      return diffX <= 1 && diffY <= 1 && (diffX + diffY) <= 1;
    });
    
    if (existingToken) {
      console.log('Found existing token at position, removing it');
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

    // Position the creature at the intersection point
    const isoX = (gridX - gridY) * (this.tileWidth / 2);
    const isoY = (gridX + gridY) * (this.tileHeight / 2);
    
    const intersectionX = this.gridContainer.x + isoX;
    const intersectionY = this.gridContainer.y + isoY;
    
    creature.setPosition(intersectionX, intersectionY);
    creature.addToStage(this.app.stage);
    
    // Store token info
    const newTokenData = {
      creature: creature,
      gridX: gridX,
      gridY: gridY,
      type: this.selectedTokenType
    };
    this.placedTokens.push(newTokenData);
    
    // Check if we need to enable dragging (if currently in move mode after placing)
    // This handles the case where user places token then switches to move mode
    if (window.selectedTokenType === 'move') {
      this.enableTokenDragging();
    }
    
    window.placedTokens = this.placedTokens;
    console.log('Token placed. Total tokens now:', this.placedTokens.length);
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
