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
import {
  drawIsometricTile as _drawIsoTile,
  clearGridTiles as _clearTiles,
} from './grid-renderer/internals/tiles.js';
import { traceDiamondPath } from '../utils/PixiShapeUtils.js';

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
        pixiApp: !!this.gameManager.app,
        pixiStage: !!this.gameManager.app?.stage,
      });

      // Create main grid container
      this.gameManager.gridContainer = new PIXI.Container();
      // Enable zIndex-based sorting so tokens/tiles can occlude correctly in isometric depth
      this.gameManager.gridContainer.sortableChildren = true;
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
          totalTiles: this.gameManager.cols * this.gameManager.rows,
        },
        gridCentered: true,
        performance: {
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      new ErrorHandler().handle(error, ERROR_SEVERITY.CRITICAL, ERROR_CATEGORY.RENDERING, {
        context: 'setupGrid',
        stage: 'grid_initialization',
        gridDimensions: {
          cols: this.gameManager.cols,
          rows: this.gameManager.rows,
        },
        pixiAppAvailable: !!this.gameManager.app,
        pixiStageAvailable: !!this.gameManager.app?.stage,
        gameManagerState: {
          initialized: !!this.gameManager,
          hasContainer: !!this.gameManager.gridContainer,
        },
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
      const coordValidation = GameValidators.coordinates(x, y);
      if (!coordValidation.isValid) {
        throw new Error(`Invalid tile coordinates: ${coordValidation.getErrorMessage()}`);
      }
      const tile = _drawIsoTile(this, x, y, color);
      // Annotate tile for reprojection logic (ProjectionUtils)
      if (tile) {
        tile.__gridX = x;
        tile.__gridY = y;
        if (typeof tile.__baseColor === 'undefined') tile.__baseColor = color;
        tile.__currentFillColor = color;
        tile.__currentFillAlpha = GRID_CONFIG.TILE_FILL_ALPHA;
        tile.__currentBorderColor = GRID_CONFIG.TILE_BORDER_COLOR;
        tile.__currentBorderAlpha = GRID_CONFIG.TILE_BORDER_ALPHA;
      }
      return tile;
    } catch (error) {
      GameErrors.rendering(error, {
        stage: 'drawIsometricTile',
        coordinates: { x, y },
        color,
      });
      throw error;
    }
  }

  /**
   * Clear all grid tiles from the display while preserving tokens
   */
  clearGridTiles() {
    return _clearTiles(this);
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

  pushGridStyle(style = {}) {
    if (!this.gameManager?.gridContainer?.children) return;
    const fillColor = style.fillColor ?? GRID_CONFIG.TILE_COLOR;
    const fillAlpha =
      typeof style.fillAlpha === 'number' ? style.fillAlpha : GRID_CONFIG.TILE_FILL_ALPHA;
    const borderColor =
      style.borderColor !== undefined ? style.borderColor : GRID_CONFIG.TILE_BORDER_COLOR;
    const borderAlpha =
      typeof style.borderAlpha === 'number' ? style.borderAlpha : GRID_CONFIG.TILE_BORDER_ALPHA;

    for (const child of this.gameManager.gridContainer.children) {
      if (!child?.isGridTile) continue;
      const prev = {
        fillColor: child.__currentFillColor ?? child.__baseColor ?? GRID_CONFIG.TILE_COLOR,
        fillAlpha:
          typeof child.__currentFillAlpha === 'number'
            ? child.__currentFillAlpha
            : GRID_CONFIG.TILE_FILL_ALPHA,
        borderColor:
          child.__currentBorderColor ?? child.__baseBorderColor ?? GRID_CONFIG.TILE_BORDER_COLOR,
        borderAlpha:
          typeof child.__currentBorderAlpha === 'number'
            ? child.__currentBorderAlpha
            : GRID_CONFIG.TILE_BORDER_ALPHA,
      };
      if (!Array.isArray(child.__gridStyleStack)) child.__gridStyleStack = [];
      child.__gridStyleStack.push(prev);
      this._applyTileStyle(child, fillColor, fillAlpha, borderColor, borderAlpha);
    }
  }

  popGridStyle() {
    if (!this.gameManager?.gridContainer?.children) return;
    for (const child of this.gameManager.gridContainer.children) {
      if (!child?.isGridTile) continue;
      const stack = child.__gridStyleStack;
      let prev = stack && stack.length ? stack.pop() : null;
      if (!prev) {
        prev = {
          fillColor: child.__baseColor ?? GRID_CONFIG.TILE_COLOR,
          fillAlpha: GRID_CONFIG.TILE_FILL_ALPHA,
          borderColor: GRID_CONFIG.TILE_BORDER_COLOR,
          borderAlpha: GRID_CONFIG.TILE_BORDER_ALPHA,
        };
      }
      this._applyTileStyle(
        child,
        prev.fillColor,
        prev.fillAlpha,
        prev.borderColor,
        prev.borderAlpha
      );
    }
  }

  _applyTileStyle(tile, fillColor, fillAlpha, borderColor, borderAlpha) {
    if (!tile) return;
    try {
      tile.clear();
      tile.lineStyle(1, borderColor, borderAlpha);
      tile.beginFill(fillColor, fillAlpha);
      traceDiamondPath(tile, this.gameManager.tileWidth, this.gameManager.tileHeight);
      tile.endFill();
      tile.__currentFillColor = fillColor;
      tile.__currentFillAlpha = fillAlpha;
      tile.__currentBorderColor = borderColor;
      tile.__currentBorderAlpha = borderAlpha;
    } catch (error) {
      GameErrors.rendering(error, {
        stage: '_applyTileStyle',
        color: fillColor,
      });
    }
  }
}
