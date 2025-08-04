/**
 * TokenManager.js - Manages token creation, placement, and interactions
 * 
 * Extracted from GameManager to follow single responsibility principle
 * Handles all token-related operations while preserving existing functionality
 */

import logger from '../utils/Logger.js';
import { CoordinateUtils } from '../utils/CoordinateUtils.js';
import { GameErrors } from '../utils/ErrorHandler.js';
import { GameValidators } from '../utils/Validation.js';

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

export class TokenManager {
  constructor(gameManager) {
    this.gameManager = gameManager;
    this.selectedTokenType = 'goblin';
    this.tokenFacingRight = true;
    this.placedTokens = [];
  }

  // Getters for backward compatibility
  getSelectedTokenType() {
    return this.selectedTokenType;
  }

  getTokenFacingRight() {
    return this.tokenFacingRight;
  }

  getPlacedTokens() {
    return this.placedTokens;
  }

  // Setters for proper state management
  setSelectedTokenType(tokenType) {
    this.selectedTokenType = tokenType;
    // Sync with global variable for backward compatibility
    if (typeof window !== 'undefined') {
      window.selectedTokenType = tokenType;
    }
  }

  setTokenFacingRight(facing) {
    this.tokenFacingRight = facing;
    // Sync with global variable for backward compatibility
    if (typeof window !== 'undefined') {
      window.tokenFacingRight = facing;
    }
  }

  /**
   * Validate positions of all placed tokens
   * @param {number} cols - Number of grid columns
   * @param {number} rows - Number of grid rows
   */
  validateTokenPositions(cols, rows) {
    try {
      const outOfBounds = this.placedTokens.filter(token => 
        !CoordinateUtils.isValidGridPosition(token.gridX, token.gridY, cols, rows)
      );
      
      if (outOfBounds.length > 0) {
        const invalidPositions = outOfBounds.map(t => `(${t.gridX}, ${t.gridY})`).join(', ');
        throw new Error(`${outOfBounds.length} tokens are out of bounds: ${invalidPositions}`);
      }
      
      logger.debug(`All ${this.placedTokens.length} tokens are within grid bounds`);
    } catch (error) {
      GameErrors.validation(error, {
        stage: 'validateTokenPositions',
        gridSize: { cols, rows },
        tokenCount: this.placedTokens.length
      });
    }
  }

  /**
   * Select a token type for placement
   * @param {string} tokenType - Type of token to select
   */
  selectToken(tokenType) {
    try {
      logger.debug('selectToken called with:', tokenType);
      
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

  /**
   * Toggle token facing direction
   */
  toggleFacing() {
    this.tokenFacingRight = !this.tokenFacingRight;
    
    // Update button display
    const facingBtn = document.getElementById('facing-right');
    if (facingBtn) {
      facingBtn.innerHTML = this.tokenFacingRight ? '➡️ Right' : '⬅️ Left';
    }
  }

  /**
   * Find existing token at grid coordinates
   * @param {number} gridX - Grid X coordinate
   * @param {number} gridY - Grid Y coordinate
   * @returns {Object|null} Found token or null
   */
  findExistingTokenAt(gridX, gridY) {
    return this.placedTokens.find(token => {
      const diffX = Math.abs(token.gridX - gridX);
      const diffY = Math.abs(token.gridY - gridY);
      return diffX <= 1 && diffY <= 1 && (diffX + diffY) <= 1;
    });
  }

  /**
   * Remove a token from the game
   * @param {Object} token - Token to remove
   */
  removeToken(token) {
    token.creature.removeFromStage();
    this.placedTokens = this.placedTokens.filter(t => t !== token);
  }

  /**
   * Place a new token at the specified grid coordinates
   * @param {number} gridX - Grid X coordinate
   * @param {number} gridY - Grid Y coordinate
   * @param {PIXI.Container} gridContainer - Grid container to add token to
   */
  placeNewToken(gridX, gridY, gridContainer) {
    try {
      // Create new creature instance
      const creature = this.createCreatureByType(this.selectedTokenType);
      if (!creature) {
        throw new Error(`Failed to create creature of type: ${this.selectedTokenType}`);
      }

      // Add to grid container first
      creature.addToStage(gridContainer);
      
      // Calculate isometric position
      const isoCoords = CoordinateUtils.gridToIsometric(
        gridX, 
        gridY, 
        this.gameManager.tileWidth, 
        this.gameManager.tileHeight
      );
      creature.setPosition(isoCoords.x, isoCoords.y);
      
      // Store token info and set up interactions
      this.addTokenToCollection(creature, gridX, gridY);
      
      logger.info(`Placed ${this.selectedTokenType} at grid (${gridX}, ${gridY})`);
    } catch (error) {
      GameErrors.sprites(error, {
        stage: 'placeNewToken',
        coordinates: { gridX, gridY },
        creatureType: this.selectedTokenType
      });
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

      // Convert to grid coordinates using CoordinateUtils
      const gridCoords = CoordinateUtils.isometricToGrid(localX, localY, this.gameManager.tileWidth, this.gameManager.tileHeight);
      
      // Clamp to grid bounds
      const clampedCoords = CoordinateUtils.clampToGrid(gridCoords.gridX, gridCoords.gridY, this.gameManager.cols, this.gameManager.rows);

      // Position at diamond center using CoordinateUtils
      const isoCoords = CoordinateUtils.gridToIsometric(clampedCoords.gridX, clampedCoords.gridY, this.gameManager.tileWidth, this.gameManager.tileHeight);
      
      token.x = isoCoords.x;
      token.y = isoCoords.y;
      
      // Update the token's grid position in the placedTokens array
      const tokenEntry = this.placedTokens.find(t => t.creature && t.creature.sprite === token);
      if (tokenEntry) {
        tokenEntry.gridX = clampedCoords.gridX;
        tokenEntry.gridY = clampedCoords.gridY;
        logger.debug(`Token snapped to grid (${clampedCoords.gridX}, ${clampedCoords.gridY})`);
      }
    } catch (error) {
      GameErrors.input(error, {
        stage: 'snapToGrid',
        tokenPosition: { x: token.x, y: token.y }
      });
    }
  }

  /**
   * Add a token to the collection and set up interaction handlers
   * @param {Object} creature - Creature to add
   * @param {number} gridX - Grid X coordinate
   * @param {number} gridY - Grid Y coordinate
   * @param {string} selectedTokenType - Currently selected token type
   * @param {Array} placedTokens - Array to add token to
   */
  addTokenToCollection(creature, gridX, gridY, selectedTokenType = null, placedTokens = null) {
    // Use provided parameters or fall back to instance properties
    const tokenType = selectedTokenType || this.selectedTokenType;
    const tokens = placedTokens || this.placedTokens;
    
    const newTokenData = {
      creature: creature,
      gridX: gridX,
      gridY: gridY,
      type: tokenType
    };
    tokens.push(newTokenData);
    
    // Set up right-click drag system for all tokens
    if (creature && creature.sprite) {
      this.setupTokenInteractions(creature.sprite, newTokenData);
    }
  }

  /**
   * Set up token interaction events
   * @param {PIXI.Sprite} sprite - Token sprite
   * @param {Object} tokenData - Token data
   */
  setupTokenInteractions(sprite, tokenData) {
    sprite.interactive = true;
    sprite.buttonMode = true;
    
    // Store references for event handling
    sprite.tokenData = tokenData;
    sprite.isRightDragging = false;
    
    logger.info(`Created ${tokenData.type} token - right-click and drag to move`);
    
    // Right mouse button down - start dragging immediately
    sprite.on('pointerdown', function(event) {
      if (event.data.originalEvent.button === 2) { // Right click
        logger.debug(`Right-drag started on ${this.tokenData.type}`);
        
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
        logger.debug(`Right-drag ended on ${this.tokenData.type} - snapping to grid`);
        
        this.isRightDragging = false;
        this.alpha = 1.0; // Restore full opacity
        this.dragData = null;
        
        // Snap to grid using the global snap function
        if (window.snapToGrid) {
          window.snapToGrid(this);
        }
        
        event.stopPropagation();
      }
    });
    
    // Handle mouse leaving the canvas area
    sprite.on('pointerupoutside', function() {
      if (this.isRightDragging) {
        logger.debug('Right-drag cancelled (mouse left canvas) - snapping to grid');
        
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
}
