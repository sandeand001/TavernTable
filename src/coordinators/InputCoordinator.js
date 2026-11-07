/* eslint-disable indent */
/**
 * InputCoordinator.js - Manages user input handling and token interactions
 *
 * Extracted from GameManager to follow single responsibility principle
 * Handles mouse clicks, token placement/removal, and user interaction workflows
 */

import { logger } from '../utils/logger/Logger.js';
import { GameErrors } from '../utils/error/ErrorHandler.js';
import { GameValidators } from '../utils/Validation.js';
import { CoordinateUtils } from '../utils/coordinates/CoordinateUtils.js';
import { placeSavedCharacter } from '../campaigns/SavedCharacterPlacement.js';
import { changeCampaignView } from '../campaigns/SceneWorld.js';

// ── InputCoordinator Class ───────────────────────────────
export class InputCoordinator {
  constructor(gameManager) {
    this.gameManager = gameManager;
    this.savedCharacterPending = false;
  }

  // ── Click & Drop Handlers ───────────────────────────────
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

  async handleTokenDrop(tokenType, clientX, clientY) {
    try {
      const gm = this.gameManager;
      if (!gm) {
        return false;
      }
      this._assertTokenInputIdle();

      const terrainActive =
        typeof gm.isTerrainModeActive === 'function' && gm.isTerrainModeActive();
      const terrain = gm.terrainEngine;
      const placeableSelected =
        typeof terrain?.getSelectedPlaceable === 'function'
          ? !!terrain.getSelectedPlaceable()
          : false;
      const panelVisible =
        typeof terrain?.isPlaceablesPanelVisible === 'function'
          ? !!terrain.isPlaceablesPanelVisible()
          : false;

      if (terrainActive || (placeableSelected && panelVisible)) {
        return false;
      }

      let targetCoords = null;
      const canUse3D =
        typeof gm.is3DModeActive === 'function' &&
        gm.is3DModeActive() &&
        gm.pickingService &&
        typeof gm.pickingService.pickGround === 'function';

      if (canUse3D) {
        try {
          const ground = await gm.pickingService.pickGround(clientX, clientY);
          if (ground?.grid) {
            const gx = Math.round(ground.grid.gx);
            const gy = Math.round(ground.grid.gy);
            if (Number.isFinite(gx) && Number.isFinite(gy)) {
              targetCoords = { gridX: gx, gridY: gy };
            }
          }
        } catch (_) {
          /* fallback to 2D */
        }
      }

      if (!targetCoords && gm.interactionManager?.getGridCoordinatesFromClick) {
        targetCoords = gm.interactionManager.getGridCoordinatesFromClick({ clientX, clientY });
      }

      if (!targetCoords) {
        return false;
      }

      return this._placeDraggedToken(tokenType, targetCoords.gridX, targetCoords.gridY);
    } catch (error) {
      GameErrors.input(error, {
        stage: 'handleTokenDrop',
        tokenType,
        pointer: { clientX, clientY },
      });
      return false;
    }
  }

  async handleSavedCharacterDrop(payload, clientX, clientY) {
    try {
      const selection = JSON.parse(payload);
      if (
        !selection ||
        typeof selection.characterId !== 'string' ||
        typeof selection.appearance !== 'string'
      )
        throw new Error('Drag a saved character from this campaign roster');
      return this.handleSavedCharacterPlacement(
        selection.characterId,
        selection.appearance,
        clientX,
        clientY
      );
    } catch (error) {
      return this._savedCharacterFailure(error);
    }
  }

  async handleSavedCharacterPlacement(characterId, appearance, clientX, clientY) {
    if (this.savedCharacterPending)
      return this._savedCharacterFailure(new Error('Wait for the current placement to finish'));
    try {
      this._assertTokenInputIdle();
    } catch (error) {
      return this._savedCharacterFailure(error);
    }
    this.savedCharacterPending = true;
    const gm = this.gameManager;
    window.dispatchEvent(
      new CustomEvent('taverntable:campaignViewStateChanged', {
        detail: { gameManager: gm },
      })
    );
    try {
      const terrain = gm.terrainEngine;
      if (
        gm.isTerrainModeActive?.() ||
        (terrain?.getSelectedPlaceable?.() && terrain?.isPlaceablesPanelVisible?.())
      )
        throw new Error('Leave terrain and placeable editing before retrieving a character');
      if (!gm.is3DModeActive?.())
        throw new Error('Saved character placement requires a walkable floor in the 3D board');
      const picking = gm.pickingService;
      if (!picking?.pickGround && !picking?.pickGroundSync)
        throw new Error('The board is not ready to pick a placement floor');
      const ground = picking.pickGround
        ? await picking.pickGround(clientX, clientY)
        : picking.pickGroundSync(clientX, clientY);
      if (
        !Number.isFinite(ground?.grid?.gx) ||
        !Number.isFinite(ground?.grid?.gy) ||
        (!ground.surface && !Number.isFinite(ground.world?.y))
      )
        throw new Error('Choose a supported floor inside the current area');
      const result = await placeSavedCharacter(
        gm,
        characterId,
        Math.round(ground.grid.gx),
        Math.round(ground.grid.gy),
        {
          appearance,
          surface: ground.surface || {
            kind: 'floor',
            point: ground.world,
            mapId: gm.campaignMapId,
          },
        }
      );
      if (!result.created) {
        if (gm.campaignWorld) await changeCampaignView(gm, { focusTokenId: result.token.id });
        else await gm.token3DAdapter.setSelectedToken(result.token);
      }
      if (gm.tokenManager.selectedSavedCharacterId === characterId)
        gm.tokenManager.cancelSavedCharacterPlacement();
      this._publishSavedCharacterPlacement({
        characterId,
        success: true,
        message: result.created
          ? `${result.token.name} placed using the existing saved character.`
          : `${result.token.name} is already placed; focused its existing sprite.`,
      });
      return true;
    } catch (error) {
      return this._savedCharacterFailure(error, characterId);
    } finally {
      this.savedCharacterPending = false;
      window.dispatchEvent(
        new CustomEvent('taverntable:campaignViewStateChanged', {
          detail: { gameManager: gm },
        })
      );
    }
  }

  _publishSavedCharacterPlacement(detail) {
    window.dispatchEvent(
      new CustomEvent('taverntable:savedCharacterPlacement', {
        detail: { ...detail, gameManager: this.gameManager },
      })
    );
  }

  _savedCharacterFailure(error, characterId = null) {
    GameErrors.input(error, { stage: 'savedCharacterPlacement', characterId });
    this._publishSavedCharacterPlacement({ characterId, success: false, message: error.message });
    return false;
  }

  _assertTokenInputIdle() {
    if (this.gameManager.campaignMapFailure) throw this.gameManager.campaignMapFailure;
    if (this.gameManager.campaignViewBusy || this.savedCharacterPending)
      throw new Error('Wait for the current map change or character placement to finish');
  }

  // ── Token Interaction ──────────────────────────────────
  /**
   * Handle token placement or removal at grid coordinates
   * @param {number} gridX - Grid X coordinate
   * @param {number} gridY - Grid Y coordinate
   */
  handleTokenInteraction(gridX, gridY) {
    try {
      this._assertTokenInputIdle();
      if (this.gameManager.tokenManager?.selectedSavedCharacterId)
        throw new Error('Choose a supported 3D floor for the saved character');
      // If a terrain placeable is currently selected, token placement must be disabled.
      const terrain = this.gameManager.terrainEngine;
      const selectedPlaceable =
        terrain && typeof terrain.getSelectedPlaceable === 'function'
          ? terrain.getSelectedPlaceable()
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
        selectedTokenType: this.gameManager.selectedTokenType,
      });
    }
  }

  // ── Token Lookup & Removal ─────────────────────────────
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
    this._assertTokenInputIdle();
    if (this.gameManager.tokenManager) {
      this.gameManager.tokenManager.removeToken(token);
      // Update global array for backward compatibility
      window.placedTokens = this.gameManager.placedTokens;
    }
  }

  // ── Token Placement ───────────────────────────────────
  /**
   * Place a new token at the specified grid coordinates
   * @param {number} gridX - Grid X coordinate
   * @param {number} gridY - Grid Y coordinate
   */
  placeNewToken(gridX, gridY) {
    this._assertTokenInputIdle();
    // Defensive: also check here in case placeNewToken is called programmatically.
    const terrain = this.gameManager.terrainEngine;
    const selectedPlaceable =
      terrain && typeof terrain.getSelectedPlaceable === 'function'
        ? terrain.getSelectedPlaceable()
        : window.selectedTerrainPlaceable;
    if (selectedPlaceable) {
      logger.debug('placeNewToken aborted because a terrain placeable is selected');
      return;
    }

    if (this.gameManager.tokenManager) {
      this.gameManager.tokenManager.placeNewToken(gridX, gridY, null);
      // Update global array for backward compatibility
      window.placedTokens = this.gameManager.placedTokens;
    } else {
      logger.debug('Cannot place token: TokenManager not available');
    }
  }

  _placeDraggedToken(tokenType, gridX, gridY) {
    this._assertTokenInputIdle();
    const coordValidation = GameValidators.coordinates(gridX, gridY);
    if (!coordValidation.isValid) {
      throw new Error(`Invalid coordinates: ${coordValidation.errors.join(', ')}`);
    }

    const existingToken = this.findExistingTokenAt(gridX, gridY);
    if (existingToken) {
      this.removeToken(existingToken);
    }

    if (tokenType === 'remove') {
      return true;
    }

    const creatureValidation = GameValidators.creatureType(tokenType);
    if (!creatureValidation.isValid) {
      throw new Error(`Invalid creature type: ${creatureValidation.errors.join(', ')}`);
    }

    const tm = this.gameManager.tokenManager;
    if (!tm) {
      logger.debug('Cannot place token via drag: TokenManager missing');
      return false;
    }

    if (typeof tm.placeTokenOfType === 'function') {
      tm.placeTokenOfType(tokenType, gridX, gridY, null);
    } else {
      const previousType =
        typeof tm.getSelectedTokenType === 'function'
          ? tm.getSelectedTokenType()
          : this.gameManager.selectedTokenType;
      if (typeof tm.setSelectedTokenType === 'function') {
        tm.setSelectedTokenType(tokenType);
      } else {
        this.gameManager.selectedTokenType = tokenType;
      }
      this.placeNewToken(gridX, gridY);
      if (typeof tm.setSelectedTokenType === 'function') {
        tm.setSelectedTokenType(previousType);
      } else {
        this.gameManager.selectedTokenType = previousType;
      }
    }

    if (typeof window !== 'undefined') {
      window.placedTokens = this.gameManager.placedTokens;
    }

    return true;
  }

  // ── Coordinate Conversion ───────────────────────────────
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

  // ── Token Selection & Facing ───────────────────────────
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
   * @param {Object} token - Token sprite to snap
   */
  snapToGrid(token) {
    if (this.gameManager.tokenManager) {
      this.gameManager.tokenManager.snapToGrid(token);
    }
  }

  // ── Batch Operations ──────────────────────────────────
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
            operation,
          });
        }
      });

      logger.debug(`Completed batch token operations: ${operations.length} operations`);
    } catch (error) {
      GameErrors.input(error, {
        stage: 'handleBatchTokenOperations',
        operationsCount: operations.length,
      });
    }
  }

  // ── Statistics ─────────────────────────────────────────
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
        rows: this.gameManager.rows,
      },
    };
  }
}
