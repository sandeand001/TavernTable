/**
 * InputCoordinator.js - Manages user input handling and token interactions
 * 
 * Extracted from GameManager to follow single responsibility principle
 * Handles mouse clicks, token placement/removal, and user interaction workflows
 */

import { logger } from '../utils/Logger.js';
import { GameErrors } from '../utils/ErrorHandler.js';
import { GameValidators } from '../utils/Validation.js';
import { CoordinateUtils } from '../utils/CoordinateUtils.js';

export class InputCoordinator {
  constructor(gameManager) {
    this.gameManager = gameManager;
  }

  /**
   * Handle left mouse click for token placement
   * @param {MouseEvent} event - Mouse click event
   */
  handleLeftClick(event) {
    if (this.gameManager.interactionManager) {
      this.gameManager.interactionManager.handleLeftClick(event);
    } else {
      logger.debug('Cannot handle click: InteractionManager not available');
    }
  }

  /**
   * Handle token placement or removal at grid coordinates
   * @param {number} gridX - Grid X coordinate
   * @param {number} gridY - Grid Y coordinate
   */
  handleTokenInteraction(gridX, gridY) {
    try {
      // If a terrain placeable is currently selected, token placement must be disabled.
      const terrainCoordinator = this.gameManager.terrainCoordinator;
      const selectedPlaceable = terrainCoordinator && typeof terrainCoordinator.getSelectedPlaceable === 'function'
        ? terrainCoordinator.getSelectedPlaceable()
        : window.selectedTerrainPlaceable;
      if (selectedPlaceable) {
        logger.debug('Token placement blocked because a terrain placeable is selected');
        return;
      }
      // Validate coordinates first
      const coordValidation = GameValidators.coordinates(gridX, gridY);
      if (!coordValidation.isValid) {
        throw new Error(`Invalid coordinates: ${coordValidation.errors.join(', ')}`);
      }

      const existingToken = this.findExistingTokenAt(gridX, gridY);

      if (existingToken) {
        this.removeToken(existingToken);
      }

      // If remove mode is selected, only remove tokens
      if (this.gameManager.selectedTokenType === 'remove') {
        return;
      }

      // Validate creature type before placement
      const creatureValidation = GameValidators.creatureType(this.gameManager.selectedTokenType);
      if (!creatureValidation.isValid) {
        throw new Error(`Invalid creature type: ${creatureValidation.errors.join(', ')}`);
      }

      this.placeNewToken(gridX, gridY);
    } catch (error) {
      GameErrors.input(error, {
        stage: 'handleTokenInteraction',
        coordinates: { gridX, gridY },
        selectedTokenType: this.gameManager.selectedTokenType
      });
    }
  }

  /**
   * Find existing token at grid coordinates
   * @param {number} gridX - Grid X coordinate
   * @param {number} gridY - Grid Y coordinate
   * @returns {Object|null} Token object if found, null otherwise
   */
  findExistingTokenAt(gridX, gridY) {
    if (this.gameManager.tokenManager) {
      return this.gameManager.tokenManager.findExistingTokenAt(gridX, gridY);
    }
    return null;
  }

  /**
   * Remove a token from the game
   * @param {Object} token - Token to remove
   */
  removeToken(token) {
    if (this.gameManager.tokenManager) {
      this.gameManager.tokenManager.removeToken(token);
      // Update global array for backward compatibility
      window.placedTokens = this.gameManager.placedTokens;
    }
  }

  /**
   * Place a new token at the specified grid coordinates
   * @param {number} gridX - Grid X coordinate
   * @param {number} gridY - Grid Y coordinate
   */
  placeNewToken(gridX, gridY) {
    // Defensive: also check here in case placeNewToken is called programmatically.
    const terrainCoordinator = this.gameManager.terrainCoordinator;
    const selectedPlaceable = terrainCoordinator && typeof terrainCoordinator.getSelectedPlaceable === 'function'
      ? terrainCoordinator.getSelectedPlaceable()
      : window.selectedTerrainPlaceable;
    if (selectedPlaceable) {
      logger.debug('placeNewToken aborted because a terrain placeable is selected');
      return;
    }

    if (this.gameManager.tokenManager && this.gameManager.gridContainer) {
      this.gameManager.tokenManager.placeNewToken(gridX, gridY, this.gameManager.gridContainer);
      // Update global array for backward compatibility
      window.placedTokens = this.gameManager.placedTokens;
    } else {
      logger.debug('Cannot place token: TokenManager or gridContainer not available');
    }
  }

  /**
   * Convert grid coordinates to isometric coordinates
   * @param {number} gridX - Grid X coordinate
   * @param {number} gridY - Grid Y coordinate
   * @returns {Object} Isometric coordinates {x, y}
   */
  gridToIsometric(gridX, gridY) {
    return CoordinateUtils.gridToIsometric(
      gridX,
      gridY,
      this.gameManager.tileWidth,
      this.gameManager.tileHeight
    );
  }

  /**
   * Add token to the collection tracking
   * @param {Object} creature - Creature object
   * @param {number} gridX - Grid X coordinate
   * @param {number} gridY - Grid Y coordinate
   */
  addTokenToCollection(creature, gridX, gridY) {
    if (this.gameManager.tokenManager) {
      this.gameManager.tokenManager.addTokenToCollection(
        creature,
        gridX,
        gridY,
        this.gameManager.selectedTokenType,
        this.gameManager.placedTokens
      );
      // Update global array for backward compatibility
      window.placedTokens = this.gameManager.placedTokens;
    }
  }

  /**
   * Select a token type for placement
   * @param {string} tokenType - Type of token to select
   */
  selectToken(tokenType) {
    if (this.gameManager.tokenManager) {
      this.gameManager.tokenManager.selectToken(tokenType);
      // Update global variable for backward compatibility
      window.selectedTokenType = this.gameManager.selectedTokenType;
    }
  }

  /**
   * Toggle token facing direction
   */
  toggleFacing() {
    if (this.gameManager.tokenManager) {
      this.gameManager.tokenManager.toggleFacing();
      // Update global variable for backward compatibility
      window.tokenFacingRight = this.gameManager.tokenFacingRight;
    }
  }

  /**
   * Create a creature instance by type
   * @param {string} type - Creature type identifier
   * @returns {Object|null} Creature instance or null if creation fails
   */
  createCreatureByType(type) {
    if (this.gameManager.tokenManager) {
      return this.gameManager.tokenManager.createCreatureByType(type);
    }
    return null;
  }

  /**
   * Snap a token to the nearest grid center
   * @param {PIXI.Sprite} token - Token sprite to snap
   */
  snapToGrid(token) {
    if (this.gameManager.tokenManager) {
      this.gameManager.tokenManager.snapToGrid(token);
    }
  }

  /**
   * Handle batch token operations
   * @param {Array} operations - Array of token operations
   */
  handleBatchTokenOperations(operations) {
    try {
      operations.forEach((operation, index) => {
        try {
          switch (operation.type) {
          case 'place':
            this.placeNewToken(operation.gridX, operation.gridY);
            break;
          case 'remove': {
            const token = this.findExistingTokenAt(operation.gridX, operation.gridY);
            if (token) {
              this.removeToken(token);
            }
            break;
          }
          case 'move': {
            const moveToken = this.findExistingTokenAt(operation.fromX, operation.fromY);
            if (moveToken) {
              this.removeToken(moveToken);
              this.placeNewToken(operation.toX, operation.toY);
            }
            break;
          }
          default:
            logger.warn(`Unknown batch operation type: ${operation.type}`);
          }
        } catch (operationError) {
          GameErrors.input(operationError, {
            stage: 'batchTokenOperation',
            operationIndex: index,
            operation
          });
        }
      });

      logger.debug(`Completed batch token operations: ${operations.length} operations`);
    } catch (error) {
      GameErrors.input(error, {
        stage: 'handleBatchTokenOperations',
        operationsCount: operations.length
      });
    }
  }

  /**
   * Get interaction statistics
   * @returns {Object} Statistics about user interactions
   */
  getInteractionStatistics() {
    return {
      totalTokens: this.gameManager.placedTokens ? this.gameManager.placedTokens.length : 0,
      selectedTokenType: this.gameManager.selectedTokenType,
      tokenFacingRight: this.gameManager.tokenFacingRight,
      gridDimensions: {
        cols: this.gameManager.cols,
        rows: this.gameManager.rows
      }
    };
  }
}
