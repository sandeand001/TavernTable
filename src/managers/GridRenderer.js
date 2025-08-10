/**
 * GridRenderer.js - Handles grid rendering and visual management
 * 
 * Extracted from GameManager to follow single responsibility principle
 * Manages all grid rendering operations while preserving existing functionality
 */

import { logger, LOG_LEVEL, LOG_CATEGORY } from '../utils/Logger.js';
import { ErrorHandler, ERROR_SEVERITY, ERROR_CATEGORY, GameErrors } from '../utils/ErrorHandler.js';
import { GameValidators } from '../utils/Validation.js';
import { GRID_CONFIG } from '../config/GameConstants.js';

export class GridRenderer {
  constructor(gameManager) {
    this.gameManager = gameManager;
  }

  /**
   * Set up the isometric grid with tiles and visual elements
   */
  setupGrid() {
    try {
      // Defensive check - ensure PIXI app is properly initialized
      if (!this.gameManager.app || !this.gameManager.app.stage) {
        throw new Error('GameManager PIXI app not initialized before grid setup');
      }
      
      logger.log(LOG_LEVEL.DEBUG, 'Creating grid container', LOG_CATEGORY.SYSTEM, {
        context: 'GridRenderer.setupGrid',
        stage: 'container_creation',
        pixiApp: !!(this.gameManager.app),
        pixiStage: !!(this.gameManager.app?.stage)
      });
      
      // Create main grid container
      this.gameManager.gridContainer = new PIXI.Container();
      this.gameManager.app.stage.addChild(this.gameManager.gridContainer);
      
      // Draw grid tiles
      for (let y = 0; y < this.gameManager.rows; y++) {
        for (let x = 0; x < this.gameManager.cols; x++) {
          this.drawIsometricTile(x, y);
        }
      }
      
      // Center the grid after initial setup
      this.gameManager.centerGrid();
      
      logger.log(LOG_LEVEL.DEBUG, 'Grid setup completed', LOG_CATEGORY.SYSTEM, {
        context: 'GridRenderer.setupGrid',
        stage: 'setup_completion',
        gridDimensions: { 
          cols: this.gameManager.cols, 
          rows: this.gameManager.rows,
          totalTiles: this.gameManager.cols * this.gameManager.rows
        },
        gridCentered: true,
        performance: {
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      new ErrorHandler().handle(error, ERROR_SEVERITY.CRITICAL, ERROR_CATEGORY.RENDERING, {
        context: 'setupGrid',
        stage: 'grid_initialization',
        gridDimensions: { 
          cols: this.gameManager.cols, 
          rows: this.gameManager.rows 
        },
        pixiAppAvailable: !!(this.gameManager.app),
        pixiStageAvailable: !!(this.gameManager.app?.stage),
        gameManagerState: {
          initialized: !!this.gameManager,
          hasContainer: !!(this.gameManager.gridContainer)
        }
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
      tile.moveTo(0, this.gameManager.tileHeight / 2);
      tile.lineTo(this.gameManager.tileWidth / 2, 0);
      tile.lineTo(this.gameManager.tileWidth, this.gameManager.tileHeight / 2);
      tile.lineTo(this.gameManager.tileWidth / 2, this.gameManager.tileHeight);
      tile.lineTo(0, this.gameManager.tileHeight / 2);
      tile.endFill();
      
      // Position tile in isometric space
      tile.x = (x - y) * (this.gameManager.tileWidth / 2);
      tile.y = (x + y) * (this.gameManager.tileHeight / 2);
      // Store baseline isometric Y to avoid cumulative elevation offsets
      tile.baseIsoY = tile.y;
      
      // Mark this as a grid tile (not a creature token)
      tile.isGridTile = true;
      
      // Store grid coordinates on the tile for reference
      tile.gridX = x;
      tile.gridY = y;
      
      this.gameManager.gridContainer.addChild(tile);
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
   * Clear all grid tiles from the display while preserving tokens
   */
  clearGridTiles() {
    // Remove all grid tiles (but keep tokens)
    const tilesToRemove = [];
    this.gameManager.gridContainer.children.forEach(child => {
      // Only remove grid tiles, not creature sprites
      if (child.isGridTile) {
        tilesToRemove.push(child);
      }
    });
    
    tilesToRemove.forEach(tile => {
      this.gameManager.gridContainer.removeChild(tile);
    });
  }

  /**
   * Redraw the grid with current dimensions
   */
  redrawGrid() {
    // Clear existing grid tiles
    this.clearGridTiles();
    
    // Redraw grid with current dimensions
    for (let y = 0; y < this.gameManager.rows; y++) {
      for (let x = 0; x < this.gameManager.cols; x++) {
        this.drawIsometricTile(x, y);
      }
    }
  }
}
