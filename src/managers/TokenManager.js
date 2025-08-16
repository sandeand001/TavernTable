/**
 * TokenManager.js - Manages token creation, placement, and interactions
 * 
 * Extracted from GameManager to follow single responsibility principle
 * Handles all token-related operations while preserving existing functionality
 */

import { logger, LOG_CATEGORY } from '../utils/Logger.js';
import { CoordinateUtils } from '../utils/CoordinateUtils.js';
import { TerrainHeightUtils } from '../utils/TerrainHeightUtils.js';
import { ErrorHandler, ERROR_SEVERITY, ERROR_CATEGORY } from '../utils/ErrorHandler.js';
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
      
      logger.debug(`All ${this.placedTokens.length} tokens are within grid bounds`, {
        tokenCount: this.placedTokens.length,
        gridSize: { cols, rows }
      }, LOG_CATEGORY.SYSTEM);
    } catch (error) {
      const errorHandler = new ErrorHandler();
      errorHandler.handle(error, ERROR_SEVERITY.WARNING, ERROR_CATEGORY.VALIDATION, {
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

      logger.info(`Token type selected: ${tokenType}`, {
        tokenType,
        previousType: this.selectedTokenType
      }, LOG_CATEGORY.USER);
    } catch (error) {
      const errorHandler = new ErrorHandler();
      errorHandler.handle(error, ERROR_SEVERITY.WARNING, ERROR_CATEGORY.VALIDATION, {
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
    
    // Update button display securely to prevent XSS
    const facingBtn = document.getElementById('facing-right');
    if (facingBtn) {
      facingBtn.textContent = this.tokenFacingRight ? '➡️ Right' : '⬅️ Left';
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
      
      // Calculate isometric base position
      const isoCoords = CoordinateUtils.gridToIsometric(
        gridX,
        gridY,
        this.gameManager.tileWidth,
        this.gameManager.tileHeight
      );

      // Elevation adjustment (terrain height -> vertical offset)
      let elevationOffset = 0;
      try {
        const height = this.gameManager?.terrainCoordinator?.dataStore?.get(gridX, gridY) ?? 0;
        elevationOffset = TerrainHeightUtils.calculateElevationOffset(height);
      } catch (_) { /* graceful fallback */ }

      creature.setPosition(isoCoords.x, isoCoords.y + elevationOffset);
      // Ensure token renders above its tile but respects depth ordering
      if (creature.sprite) {
        // Flag as token for pickers to ignore when selecting tiles
        creature.sprite.isCreatureToken = true;
        const depth = gridX + gridY; // same metric tiles use
        creature.sprite.zIndex = depth * 100 + 1; // tiles: depth*100
      }
      
      // Store token info and set up interactions
      this.addTokenToCollection(creature, gridX, gridY);
      
      logger.info(`Placed ${this.selectedTokenType} at grid (${gridX}, ${gridY})`, {
        creatureType: this.selectedTokenType,
        coordinates: { gridX, gridY },
        position: isoCoords
      }, LOG_CATEGORY.USER);
    } catch (error) {
      const errorHandler = new ErrorHandler();
      errorHandler.handle(error, ERROR_SEVERITY.ERROR, ERROR_CATEGORY.TOKEN, {
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
      
      logger.debug(`Created creature: ${type}`, {
        creatureType: type,
        hasSprite: !!creature.sprite
      }, LOG_CATEGORY.SYSTEM);

      return creature;
    } catch (error) {
      const errorHandler = new ErrorHandler();
      errorHandler.handle(error, ERROR_SEVERITY.ERROR, ERROR_CATEGORY.TOKEN, {
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
  snapToGrid(token, pointerLocalX = null, pointerLocalY = null) {
    try {
      // Determine the local point to evaluate under the cursor; prefer pointer-local coords
      const localX = (pointerLocalX !== null && pointerLocalY !== null) ? pointerLocalX : token.x;
      const localY = (pointerLocalX !== null && pointerLocalY !== null) ? pointerLocalY : token.y;

      // Prefer visually topmost picking for snap target
      let target = null;
      try {
        const im = this.gameManager?.interactionManager;
        if (im && typeof im.pickTopmostGridCellAt === 'function') {
          target = im.pickTopmostGridCellAt(localX, localY);
        }
      } catch (_) { /* ignore and fallback */ }

      // Fallback to geometric inversion if picker returned nothing
      if (!target) {
        const coarse = CoordinateUtils.isometricToGrid(localX, localY, this.gameManager.tileWidth, this.gameManager.tileHeight);
        target = CoordinateUtils.clampToGrid(coarse.gridX, coarse.gridY, this.gameManager.cols, this.gameManager.rows);
      }

      // Position at diamond center using CoordinateUtils + elevation
      const isoCoords = CoordinateUtils.gridToIsometric(target.gridX, target.gridY, this.gameManager.tileWidth, this.gameManager.tileHeight);

      let elevationOffset = 0;
      try {
        const height = this.gameManager?.terrainCoordinator?.dataStore?.get(target.gridX, target.gridY) ?? 0;
        elevationOffset = TerrainHeightUtils.calculateElevationOffset(height);
      } catch (_) { /* ignore */ }

      token.x = isoCoords.x;
      token.y = isoCoords.y + elevationOffset;
      // Maintain correct layering after snapping
      const newDepth = target.gridX + target.gridY;
      token.zIndex = newDepth * 100 + 1;
      
      // Update the token's grid position in the placedTokens array
      const tokenEntry = this.placedTokens.find(t => t.creature && t.creature.sprite === token);
      if (tokenEntry) {
        tokenEntry.gridX = target.gridX;
        tokenEntry.gridY = target.gridY;
        logger.debug(`Token snapped to grid (${target.gridX}, ${target.gridY})`, {
          coordinates: target,
          originalPosition: { localX, localY },
          newPosition: isoCoords
        }, LOG_CATEGORY.USER);
      }
    } catch (error) {
      const errorHandler = new ErrorHandler();
      errorHandler.handle(error, ERROR_SEVERITY.WARNING, ERROR_CATEGORY.INPUT, {
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
    // Ensure pickers ignore tokens when selecting tiles
    sprite.isCreatureToken = true;
    
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
        // Capture starting pointer local position and compute offset so cursor "grabs" sprite at contact point
        const startLocal = this.dragData.getLocalPosition(this.parent);
        this.dragOffsetX = this.x - startLocal.x;
        this.dragOffsetY = this.y - startLocal.y;
        this.dragStartX = this.x; // for potential future cancel logic
        this.dragStartY = this.y;
        
        event.stopPropagation();
        event.preventDefault();
      }
    });
    
    // Mouse move - update token position if right-dragging (allow full directional movement)
    const gm = this.gameManager; // capture for closure
    sprite.on('pointermove', function(event) {
      if (this.isRightDragging && this.dragData) {
        const moveData = event?.data || this.dragData;
        const newLocal = moveData.getLocalPosition(this.parent);
        const candidateX = newLocal.x + (this.dragOffsetX || 0);
        const candidateBaseY = newLocal.y + (this.dragOffsetY || 0);

        let finalY = candidateBaseY;
        if (gm) {
          // First invert using baseline (remove any prior elevation we might have added)
          const baselineGrid = CoordinateUtils.isometricToGrid(candidateX, candidateBaseY, gm.tileWidth, gm.tileHeight);
          try {
            const height = gm?.terrainCoordinator?.dataStore?.get(baselineGrid.gridX, baselineGrid.gridY) ?? 0;
            const elev = TerrainHeightUtils.calculateElevationOffset(height);
            finalY = candidateBaseY + elev; // add elevation effect after determining grid
            this.zIndex = (baselineGrid.gridX + baselineGrid.gridY) * 100 + 1;
          } catch (_) { /* ignore */ }
        }

        this.x = candidateX;
        this.y = finalY;
      }
    });
    
    // Right mouse button up - end dragging and snap to grid
    sprite.on('pointerup', function(event) {
      // Some browsers report button=0 on pointerup for a right-button drag; rely on state instead of button check
      if (this.isRightDragging) {
        logger.debug(`Right-drag ended on ${this.tokenData.type} - snapping to grid`);
        
        this.isRightDragging = false;
        this.alpha = 1.0; // Restore full opacity
        // Capture pointer-local coordinates before clearing drag state
        let localX = null, localY = null;
        try {
          const data = event?.data || this.dragData;
          if (data && this.parent) {
            const p = data.getLocalPosition(this.parent);
            localX = p.x;
            localY = p.y;
          }
        } catch(_) { /* ignore getLocalPosition errors */ }
        
        // Snap to grid using the topmost picker via TokenManager (pass pointer coords when available)
        if (window.snapToGrid) {
          window.snapToGrid(this, localX, localY);
        } else if (gm?.tokenManager) {
          gm.tokenManager.snapToGrid(this, localX, localY);
        }
        
        // Now clear drag data
        this.dragData = null;
        this.dragOffsetX = this.dragOffsetY = undefined;
        
        event.stopPropagation();
      }
    });
    
    // Handle mouse leaving the canvas area
    sprite.on('pointerupoutside', function(event) {
      if (this.isRightDragging) {
        logger.debug('Right-drag cancelled (mouse left canvas) - snapping to grid');
        
        this.isRightDragging = false;
        this.alpha = 1.0;
        // Capture pointer-local coordinates if available before clearing
        let localX = null, localY = null;
        try {
          const data = event?.data || this.dragData;
          if (data && this.parent) {
            const p = data.getLocalPosition(this.parent);
            localX = p.x;
            localY = p.y;
          }
        } catch(_) { /* ignore getLocalPosition errors */ }
        
        // Snap to grid
        if (window.snapToGrid) {
          window.snapToGrid(this, localX, localY);
        } else if (gm?.tokenManager) {
          gm.tokenManager.snapToGrid(this, localX, localY);
        }
        
        // Clear drag data
        this.dragData = null;
        this.dragOffsetX = this.dragOffsetY = undefined;
      }
    });

    // One-time context menu suppression for right-drag UX
    if (!window.__ttContextMenuSuppressed && this.gameManager?.app?.view) {
      window.__ttContextMenuSuppressed = true;
      this.gameManager.app.view.addEventListener('contextmenu', e => {
        if (e.target === this.gameManager.app.view) {
          e.preventDefault();
        }
      });
    }

    // Ensure a global snapToGrid bridge exists (backward compatibility for existing handlers)
    if (typeof window !== 'undefined' && !window.snapToGrid) {
      window.snapToGrid = (tokenSprite, localX = null, localY = null) => {
        try {
          this.snapToGrid(tokenSprite, localX, localY);
        } catch (e) {
          console.error('snapToGrid bridge error', e);
        }
      };
    }
  }
}
