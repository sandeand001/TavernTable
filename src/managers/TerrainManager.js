/**
 * TerrainManager.js - Handles terrain rendering and visual management
 * 
 * Extracted following single responsibility principle
 * Manages terrain tile rendering, height visualization, and display updates
 * Works in coordination with TerrainCoordinator for complete terrain system
 */

import { logger, LOG_LEVEL, LOG_CATEGORY } from '../utils/Logger.js';
import { GameErrors } from '../utils/ErrorHandler.js';
import { TERRAIN_CONFIG } from '../config/TerrainConstants.js';
// import { GRID_CONFIG } from '../config/GameConstants.js';
import { lightenColor, darkenColor } from '../utils/ColorUtils.js';
import { getBiomeColorHex } from '../config/BiomePalettes.js';
import { TerrainFacesRenderer } from '../terrain/TerrainFacesRenderer.js';
// elevation offset calculation is delegated into internals
import { CoordinateUtils } from '../utils/CoordinateUtils.js';
// shading pattern helpers are used within internals
import { validateContainerState as _validateContainerState, showAllTerrainTiles as _showAll, hideAllTerrainTiles as _hideAll, clearAllTerrainTiles as _clearAll } from './terrain-manager/internals/container.js';
import { validateTileCreationInputs as _validateTileInputs, cleanupExistingTile as _cleanupTile, createBaseTerrainGraphics as _createBase, applyTerrainStyling as _applyStyle, positionTerrainTile as _positionTile, finalizeTerrainTile as _finalizeTile, addVisualEffects as _addEffects } from './terrain-manager/internals/tiles.js';
import { addTileWithDepthSorting as _addWithSort, sortAllTerrainTilesByDepth as _sortAllDepth } from './terrain-manager/internals/sorting.js';
import { updateTerrainDisplay as _updateDisplay, processUpdateQueue as _processUpdates } from './terrain-manager/internals/updates.js';

export class TerrainManager {
  constructor(gameManager, terrainCoordinator) {
    this.gameManager = gameManager;
    this.terrainCoordinator = terrainCoordinator;
    this.facesRenderer = new TerrainFacesRenderer(gameManager);

    // PIXI containers for terrain rendering
    this.terrainContainer = null;
    this.terrainTiles = new Map(); // Map of "x,y" -> PIXI.Graphics terrain tile

    // Performance optimization
    this.updateQueue = new Set(); // Cells that need visual updates
    this.isUpdating = false;
    this.lastUpdateTime = 0;

    logger.log(LOG_LEVEL.DEBUG, 'TerrainManager initialized', LOG_CATEGORY.SYSTEM, {
      context: 'TerrainManager.constructor',
      stage: 'initialization',
      hasGameManager: !!gameManager,
      hasTerrainCoordinator: !!terrainCoordinator,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Initialize terrain rendering system
   */
  initialize() {
    try {
      // Create terrain container - positioned above grid tiles
      this.terrainContainer = new PIXI.Container();
      // Allow internal ordering if needed and ensure this container renders above base grid/tokens
      this.terrainContainer.sortableChildren = true;
      // Grid tiles use zIndex depth*100; tokens use depth*100+10, so pick a value higher than any expected
      this.terrainContainer.zIndex = 100000;

      // Add terrain container to the grid container AFTER grid tiles
      // This ensures terrain tiles appear above the base grid for proper height visualization
      // Grid tiles are added first, then terrain on top
      this.gameManager.gridContainer.addChild(this.terrainContainer);
      // If parent sorts by zIndex, ensure our container is placed accordingly
      if (this.gameManager.gridContainer.sortableChildren && typeof this.gameManager.gridContainer.sortChildren === 'function') {
        this.gameManager.gridContainer.sortChildren();
      }

      // Initialize terrain tiles for the current grid
      this.createInitialTerrainTiles();

      logger.log(LOG_LEVEL.INFO, 'Terrain rendering system initialized', LOG_CATEGORY.SYSTEM, {
        context: 'TerrainManager.initialize',
        stage: 'rendering_initialization',
        terrainContainerReady: !!this.terrainContainer,
        gridDimensions: {
          cols: this.gameManager.cols,
          rows: this.gameManager.rows
        },
        initialTilesCreated: this.terrainTiles.size,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      GameErrors.initialization(error, {
        stage: 'TerrainManager.initialize',
        hasGridContainer: !!this.gameManager?.gridContainer,
        gridDimensions: {
          cols: this.gameManager?.cols,
          rows: this.gameManager?.rows
        }
      });
      throw error;
    }
  }

  /**
   * Create initial terrain tiles for all grid positions
   * Only creates tiles when terrain mode is active
   */
  createInitialTerrainTiles() {
    try {
      // Only create initial tiles if terrain mode is active
      if (!this.terrainCoordinator.isTerrainModeActive) {
        return;
      }

      for (let y = 0; y < this.gameManager.rows; y++) {
        for (let x = 0; x < this.gameManager.cols; x++) {
          this.createTerrainTile(x, y);
        }
      }

      logger.log(LOG_LEVEL.DEBUG, 'Initial terrain tiles created', LOG_CATEGORY.SYSTEM, {
        context: 'TerrainManager.createInitialTerrainTiles',
        stage: 'tile_creation',
        tilesCreated: this.terrainTiles.size,
        expectedTiles: this.gameManager.cols * this.gameManager.rows
      });
    } catch (error) {
      GameErrors.rendering(error, {
        stage: 'createInitialTerrainTiles',
        gridDimensions: {
          cols: this.gameManager?.cols,
          rows: this.gameManager?.rows
        }
      });
      throw error;
    }
  }

  /**
   * NEW METHOD: Validate terrain container state before operations
   * @throws {Error} If containers are in invalid state
   * @returns {boolean} True if validation passes
   */
  validateContainerState() {
    return _validateContainerState(this);
  }

  /**
   * Show all terrain tiles (when terrain mode is enabled)
   */
  showAllTerrainTiles() {
    return _showAll(this);
  }

  /**
   * Hide all terrain tiles (when terrain mode is disabled)
   */
  hideAllTerrainTiles() {
    return _hideAll(this);
  }

  /**
   * Clear all terrain tiles completely (for terrain mode transitions)
   */
  clearAllTerrainTiles() {
    return _clearAll(this);
  }

  /**
   * Create a terrain tile at specified coordinates
   * @param {number} x - Grid X coordinate
   * @param {number} y - Grid Y coordinate
   */
  createTerrainTile(x, y) {
    try {
      this._validateTileCreationInputs(x, y);
      const height = this.terrainCoordinator.getTerrainHeight(x, y);
      const tileKey = `${x},${y}`;

      this._cleanupExistingTile(tileKey);
      const terrainTile = this._createBaseTerrainGraphics(x, y, height);
      this._applyTerrainStyling(terrainTile, height);
      this._positionTerrainTile(terrainTile, x, y, height);
      // Add tile to container BEFORE adding any faces/shadows to ensure parentage is set
      this._finalizeTerrainTile(terrainTile, x, y, tileKey);
      // Now add visual effects that rely on parent/indices
      this._addVisualEffects(terrainTile, height, x, y);

      return terrainTile;
    } catch (error) {
      GameErrors.rendering(error, {
        stage: 'createTerrainTile',
        coordinates: { x, y },
        height: this.terrainCoordinator?.getTerrainHeight(x, y)
      });
      throw error;
    }
  }

  /**
   * DECOMPOSED METHOD: Validate tile creation inputs
   * @private
   * @param {number} x - Grid X coordinate
   * @param {number} y - Grid Y coordinate
   */
  _validateTileCreationInputs(x, y) { return _validateTileInputs(this, x, y); }

  /**
   * DECOMPOSED METHOD: Cleanup existing tile if present
   * @private
   * @param {string} tileKey - Tile key for cleanup
   */
  _cleanupExistingTile(tileKey) { return _cleanupTile(this, tileKey); }

  /**
   * DECOMPOSED METHOD: Create base terrain graphics object
   * @private
   * @param {number} x - Grid X coordinate
   * @param {number} y - Grid Y coordinate
   * @param {number} height - Terrain height
   * @returns {PIXI.Graphics} Created terrain tile graphics
   */
  _createBaseTerrainGraphics(x, y, height) { return _createBase(this, x, y, height); }

  /**
   * DECOMPOSED METHOD: Apply styling to terrain tile
   * @private
   * @param {PIXI.Graphics} terrainTile - Terrain tile to style
   * @param {number} height - Terrain height
   */
  _applyTerrainStyling(terrainTile, height) { return _applyStyle(this, terrainTile, height); }

  /**
   * DECOMPOSED METHOD: Position terrain tile in isometric space
   * @private
   * @param {PIXI.Graphics} terrainTile - Terrain tile to position
   * @param {number} x - Grid X coordinate
   * @param {number} y - Grid Y coordinate
   * @param {number} height - Terrain height
   */
  _positionTerrainTile(terrainTile, x, y, height) { return _positionTile(this, terrainTile, x, y, height); }

  /**
   * DECOMPOSED METHOD: Add visual effects for height perception
   * @private
   * @param {PIXI.Graphics} terrainTile - Terrain tile for effects
   * @param {number} height - Terrain height
   * @param {number} x - Grid X coordinate
   * @param {number} y - Grid Y coordinate
   */
  _addVisualEffects(terrainTile, height, x, y) { return _addEffects(this, terrainTile, height, x, y); }

  /**
   * DECOMPOSED METHOD: Finalize terrain tile and add to container
   * @private
   * @param {PIXI.Graphics} terrainTile - Terrain tile to finalize
   * @param {number} x - Grid X coordinate
   * @param {number} y - Grid Y coordinate
   * @param {string} tileKey - Tile key for storage
   */
  _finalizeTerrainTile(terrainTile, x, y, tileKey) { return _finalizeTile(this, terrainTile, x, y, tileKey); }

  /**
   * Get color for terrain height
   * @param {number} height - Terrain height
   * @returns {number} Hex color value
   */
  getColorForHeight(height) {
    // Terrain mode should not be affected by biome selection
    try {
      if (!this.terrainCoordinator?.isTerrainModeActive && typeof window !== 'undefined' && window.selectedBiome) {
        const gx = 0; // Manager has no per-tile eval context outside coordinator; use 0 for stability
        const gy = 0;
        const mapFreq = (typeof window !== 'undefined' && window.richShadingSettings?.mapFreq) || 0.05;
        const seed = (this.terrainCoordinator?._biomeSeed ?? 1337) >>> 0;
        return getBiomeColorHex(window.selectedBiome, height, gx, gy, { moisture: 0.5, slope: 0, aspectRad: 0, seed, mapFreq });
      }
    } catch (_) { /* fall back */ }
    const colorKey = height.toString();
    return TERRAIN_CONFIG.HEIGHT_COLOR_SCALE[colorKey] || TERRAIN_CONFIG.HEIGHT_COLOR_SCALE['0'];
  }

  /**
   * Delegates drawing of biome-specific patterns to shared helpers.
   */

  /**
   * Get border color for terrain height (slightly lighter/darker than fill)
   * @param {number} height - Terrain height
   * @returns {number} Hex color value
   */
  getBorderColorForHeight(height) {
    const baseColor = this.getColorForHeight(height);

    // For positive heights, lighten the border
    // For negative heights, darken the border
    if (height > 0) {
      return lightenColor(baseColor, 0.3);
    } else if (height < 0) {
      return darkenColor(baseColor, 0.3);
    } else {
      return baseColor;
    }
  }

  //

  /**
   * Add shadow effect for elevated terrain
   * @param {PIXI.Graphics} terrainTile - The terrain tile graphics
   * @param {number} height - Height level (positive)
   * @param {number} x - Grid X coordinate
   * @param {number} y - Grid Y coordinate
   */
  addElevationShadow(terrainTile, height, x, y) {
    try {
      // Create a shadow tile slightly offset and darker
      const shadowTile = new PIXI.Graphics();
      const shadowColor = 0x000000; // Black shadow
      const shadowAlpha = 0.2 * height / TERRAIN_CONFIG.MAX_HEIGHT; // Stronger shadow for higher terrain

      shadowTile.beginFill(shadowColor, shadowAlpha);

      // Draw same diamond shape as main tile
      shadowTile.moveTo(0, this.gameManager.tileHeight / 2);
      shadowTile.lineTo(this.gameManager.tileWidth / 2, 0);
      shadowTile.lineTo(this.gameManager.tileWidth, this.gameManager.tileHeight / 2);
      shadowTile.lineTo(this.gameManager.tileWidth / 2, this.gameManager.tileHeight);
      shadowTile.lineTo(0, this.gameManager.tileHeight / 2);
      shadowTile.endFill();

      // Position shadow slightly offset (down and right for 3D effect)
      shadowTile.x = terrainTile.x + 2;
      shadowTile.y = terrainTile.y + 2;

      // Set depth value for shadow (same as main tile but mark as shadow)
      shadowTile.depthValue = terrainTile.depthValue;
      shadowTile.isShadowTile = true;
      // Position shadows below faces/tiles at same depth
      shadowTile.zIndex = (shadowTile.depthValue || 0) * 100 + 0;

      // Add shadow using depth sorting (shadows should appear behind their main tiles)
      this.addTileWithDepthSorting(shadowTile);

      // Store reference for cleanup
      terrainTile.shadowTile = shadowTile;
    } catch (error) {
      // Don't fail tile creation if shadow fails
      logger.warn('Failed to create elevation shadow', {
        coordinates: { x, y },
        height,
        error: error.message
      });
    }
  }

  /**
   * Add darkening effect for depressed terrain
   * @param {PIXI.Graphics} terrainTile - The terrain tile graphics
   * @param {number} height - Height level (negative)
   */
  addDepressionEffect(terrainTile, height) {
    try {
      // Create overlay to darken the tile
      const overlay = new PIXI.Graphics();
      const overlayAlpha = 0.3 * Math.abs(height) / TERRAIN_CONFIG.MAX_HEIGHT; // Darker for deeper depressions

      overlay.beginFill(0x000000, overlayAlpha); // Semi-transparent black

      // Draw same diamond shape as main tile
      overlay.moveTo(0, this.gameManager.tileHeight / 2);
      overlay.lineTo(this.gameManager.tileWidth / 2, 0);
      overlay.lineTo(this.gameManager.tileWidth, this.gameManager.tileHeight / 2);
      overlay.lineTo(this.gameManager.tileWidth / 2, this.gameManager.tileHeight);
      overlay.lineTo(0, this.gameManager.tileHeight / 2);
      overlay.endFill();

      // Position overlay exactly on top of tile
      overlay.x = 0;
      overlay.y = 0;

      // Add overlay as child of the terrain tile
      terrainTile.addChild(overlay);

      // Store reference for cleanup
      terrainTile.depressionOverlay = overlay;
    } catch (error) {
      // Don't fail tile creation if overlay fails
      logger.warn('Failed to create depression effect', {
        height,
        error: error.message
      });
    }
  }

  /**
   * Add terrain tile to container with proper depth sorting for isometric rendering
   * Ensures tiles further from viewer (higher x+y values) appear behind closer tiles
   * @param {PIXI.Graphics} terrainTile - The terrain tile to add
   */
  addTileWithDepthSorting(terrainTile) {
    return _addWithSort(this, terrainTile);
  }

  /**
   * Re-sort all terrain tiles by depth to ensure proper isometric rendering order
   * Call this method if depth ordering becomes inconsistent
   */
  sortAllTerrainTilesByDepth() {
    return _sortAllDepth(this);
  }

  /**
   * Update terrain display for specific area
   * @param {number} centerX - Center X coordinate
   * @param {number} centerY - Center Y coordinate
   * @param {number} brushSize - Size of area to update
   */
  updateTerrainDisplay(centerX, centerY, brushSize) {
    return _updateDisplay(this, centerX, centerY, brushSize);
  }

  /**
   * Process queued terrain tile updates with performance throttling
   */
  processUpdateQueue() {
    return _processUpdates(this);
  }

  /**
   * Refresh all terrain display (useful after grid resize or terrain reset)
   */
  refreshAllTerrainDisplay() {
    try {
      // Clear existing terrain tiles
      this.clearAllTerrainTiles();

      // Recreate all terrain tiles
      this.createInitialTerrainTiles();

      logger.log(LOG_LEVEL.INFO, 'All terrain display refreshed', LOG_CATEGORY.SYSTEM, {
        context: 'TerrainManager.refreshAllTerrainDisplay',
        stage: 'complete_refresh',
        gridDimensions: {
          cols: this.gameManager.cols,
          rows: this.gameManager.rows
        },
        tilesCreated: this.terrainTiles.size
      });
    } catch (error) {
      GameErrors.rendering(error, {
        stage: 'refreshAllTerrainDisplay',
        gridDimensions: {
          cols: this.gameManager?.cols,
          rows: this.gameManager?.rows
        }
      });
      throw error;
    }
  }

  /**
   * Clear all terrain tiles from display
   */
  // duplicate clearAllTerrainTiles removed; using the primary implementation above

  /**
   * Handle grid resize - update terrain container and tiles
   * @param {number} newCols - New column count
   * @param {number} newRows - New row count
   */
  handleGridResize(newCols, newRows) {
    try {
      // Clear existing terrain tiles
      this.clearAllTerrainTiles();

      // Recreate terrain tiles for new grid dimensions
      // The terrainCoordinator has already handled the data resize
      this.createInitialTerrainTiles();

      logger.log(LOG_LEVEL.INFO, 'Terrain display resized', LOG_CATEGORY.SYSTEM, {
        context: 'TerrainManager.handleGridResize',
        stage: 'resize_complete',
        newDimensions: { cols: newCols, rows: newRows },
        tilesCreated: this.terrainTiles.size
      });
    } catch (error) {
      GameErrors.rendering(error, {
        stage: 'handleGridResize',
        newDimensions: { cols: newCols, rows: newRows },
        existingTiles: this.terrainTiles.size
      });
      throw error;
    }
  }

  /**
   * Check if grid position is valid
   * @param {number} x - Grid X coordinate
   * @param {number} y - Grid Y coordinate
   * @returns {boolean} True if position is valid
   */
  isValidGridPosition(x, y) {
    return CoordinateUtils.isValidGridPosition(x, y, this.gameManager.cols, this.gameManager.rows);
  }

  /**
   * Get terrain rendering statistics
   * @returns {Object} Terrain rendering statistics
   */
  getTerrainRenderingStatistics() {
    return {
      terrainTilesCount: this.terrainTiles.size,
      pendingUpdates: this.updateQueue.size,
      isUpdating: this.isUpdating,
      lastUpdateTime: this.lastUpdateTime,
      hasTerrainContainer: !!this.terrainContainer,
      containerChildCount: this.terrainContainer?.children?.length || 0,
      gridDimensions: {
        cols: this.gameManager.cols,
        rows: this.gameManager.rows
      }
    };
  }

  /**
   * Debug method to highlight a specific terrain tile
   * @param {number} x - Grid X coordinate
   * @param {number} y - Grid Y coordinate
   * @param {number} highlightColor - Hex color for highlight
   */
  highlightTerrainTile(x, y, highlightColor = 0xffff00) {
    try {
      const tileKey = `${x},${y}`;
      const tile = this.terrainTiles.get(tileKey);

      if (tile) {
        const originalTint = tile.tint;
        tile.tint = highlightColor;

        // Reset tint after 1 second
        setTimeout(() => {
          if (this.terrainTiles.has(tileKey)) {
            tile.tint = originalTint;
          }
        }, 1000);
      }
    } catch (error) {
      logger.warn('Failed to highlight terrain tile', {
        coordinates: { x, y },
        error: error.message
      }, LOG_CATEGORY.RENDERING);
    }
  }
}
