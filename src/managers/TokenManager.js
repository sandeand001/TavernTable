/**
 * TokenManager.js - Manages token creation, placement, and interactions
 * 
 * Extracted from GameManager to follow single responsibility principle
 * Handles all token-related operations while preserving existing functionality
 */

import { logger, LOG_CATEGORY } from '../utils/Logger.js';
import { ErrorHandler, ERROR_SEVERITY, ERROR_CATEGORY } from '../utils/ErrorHandler.js';
// Validation and creature creation are handled in internals now
// Internals for selection helpers
import { findExistingTokenAt as _findExistingTokenAt, selectToken as _selectToken } from './token-manager/internals/selection.js';
// Internals for token interaction wiring
import { setupTokenInteractions as _setupTokenInteractions } from './token-manager/internals/interactions.js';
// Internals for positioning helpers
import { snapTokenToGrid as _snapTokenToGrid } from './token-manager/internals/positioning.js';
// Internals for collection management
import { addTokenToCollection as _addTokenToCollection } from './token-manager/internals/collection.js';
// Internals for creature creation
import { createCreatureByType as _createCreatureByType } from './token-manager/internals/creatures.js';
// Internals for validation
import { validateTokenPositions as _validateTokenPositions } from './token-manager/internals/validation.js';
// Internals for simple state toggles and removal
import { toggleFacing as _toggleFacing } from './token-manager/internals/facing.js';
import { removeToken as _removeToken } from './token-manager/internals/removal.js';
// Internals for placement
import { placeNewToken as _placeNewToken } from './token-manager/internals/placement.js';

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
    return _validateTokenPositions(this, cols, rows);
  }

  /**
   * Select a token type for placement
   * @param {string} tokenType - Type of token to select
   */
  selectToken(tokenType) {
    try {
      logger.debug('selectToken called with:', tokenType);
      _selectToken(this, tokenType);
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
    return _toggleFacing(this);
  }

  /**
   * Find existing token at grid coordinates
   * @param {number} gridX - Grid X coordinate
   * @param {number} gridY - Grid Y coordinate
   * @returns {Object|null} Found token or null
   */
  findExistingTokenAt(gridX, gridY) {
    return _findExistingTokenAt(this, gridX, gridY);
  }

  /**
   * Remove a token from the game
   * @param {Object} token - Token to remove
   */
  removeToken(token) {
    return _removeToken(this, token);
  }

  /**
   * Place a new token at the specified grid coordinates
   * @param {number} gridX - Grid X coordinate
   * @param {number} gridY - Grid Y coordinate
   * @param {PIXI.Container} gridContainer - Grid container to add token to
   */
  placeNewToken(gridX, gridY, gridContainer) {
    return _placeNewToken(this, gridX, gridY, gridContainer);
  }

  createCreatureByType(type) {
    return _createCreatureByType(this, type);
  }

  /**
   * Snap a token to the nearest grid center
   * @param {PIXI.Sprite} token - Token sprite to snap
   */
  snapToGrid(token, pointerLocalX = null, pointerLocalY = null) {
    return _snapTokenToGrid(this, token, pointerLocalX, pointerLocalY);
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
    return _addTokenToCollection(this, creature, gridX, gridY, selectedTokenType, placedTokens);
  }

  /**
   * Set up token interaction events
   * @param {PIXI.Sprite} sprite - Token sprite
   * @param {Object} tokenData - Token data
   */
  setupTokenInteractions(sprite, tokenData) {
    return _setupTokenInteractions(this, sprite, tokenData);
  }
}
