/**
 * TerrainManager.js - Handles terrain rendering and visual management
 * 
 * Extracted following single responsibility principle
 * Manages terrain tile rendering, height visualization, and display updates
 * Works in coordination with TerrainCoordinator for complete terrain system
 */

import { logger, LOG_LEVEL, LOG_CATEGORY } from '../utils/Logger.js';
import { ErrorHandler, ERROR_SEVERITY, ERROR_CATEGORY, GameErrors } from '../utils/ErrorHandler.js';
import { GameValidators } from '../utils/Validation.js';
import { TERRAIN_CONFIG } from '../config/TerrainConstants.js';

export class TerrainManager {
  constructor(gameManager, terrainCoordinator) {
    this.gameManager = gameManager;
    this.terrainCoordinator = terrainCoordinator;
    
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
      
      // Add terrain container to the grid container AFTER grid tiles
      // This ensures terrain tiles appear above the base grid for proper height visualization
      // Grid tiles are added first, then terrain on top
      this.gameManager.gridContainer.addChild(this.terrainContainer);
      
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
   * Show all terrain tiles (when terrain mode is enabled)
   */
  showAllTerrainTiles() {
    try {
      this.terrainContainer.visible = true;
      
      // Create tiles for all positions if not already created
      for (let y = 0; y < this.gameManager.rows; y++) {
        for (let x = 0; x < this.gameManager.cols; x++) {
          const tileKey = `${x},${y}`;
          if (!this.terrainTiles.has(tileKey)) {
            this.createTerrainTile(x, y);
          }
        }
      }
      
      // Ensure all tiles are properly depth sorted
      this.sortAllTerrainTilesByDepth();
      
      logger.log(LOG_LEVEL.DEBUG, 'All terrain tiles shown with depth sorting', LOG_CATEGORY.SYSTEM, {
        context: 'TerrainManager.showAllTerrainTiles',
        totalTiles: this.terrainTiles.size
      });
    } catch (error) {
      GameErrors.rendering(error, {
        stage: 'showAllTerrainTiles'
      });
    }
  }

  /**
   * Hide all terrain tiles (when terrain mode is disabled)
   */
  hideAllTerrainTiles() {
    try {
      this.terrainContainer.visible = false;
      
      logger.log(LOG_LEVEL.DEBUG, 'All terrain tiles hidden', LOG_CATEGORY.SYSTEM, {
        context: 'TerrainManager.hideAllTerrainTiles'
      });
    } catch (error) {
      GameErrors.rendering(error, {
        stage: 'hideAllTerrainTiles'
      });
    }
  }

  /**
   * Create a terrain tile at specified coordinates
   * @param {number} x - Grid X coordinate
   * @param {number} y - Grid Y coordinate
   */
  createTerrainTile(x, y) {
    try {
      // Validate coordinates
      const coordValidation = GameValidators.coordinates(x, y);
      if (!coordValidation.isValid) {
        throw new Error(`Invalid tile coordinates: ${coordValidation.getErrorMessage()}`);
      }
      
      const height = this.terrainCoordinator.getTerrainHeight(x, y);
      const tileKey = `${x},${y}`;
      
      // Remove existing tile if present
      if (this.terrainTiles.has(tileKey)) {
        const existingTile = this.terrainTiles.get(tileKey);
        
        // Clean up shadow and overlay effects
        if (existingTile.shadowTile) {
          this.terrainContainer.removeChild(existingTile.shadowTile);
        }
        if (existingTile.depressionOverlay) {
          existingTile.removeChild(existingTile.depressionOverlay);
        }
        
        this.terrainContainer.removeChild(existingTile);
        this.terrainTiles.delete(tileKey);
      }
      
      // Always create terrain tile to provide visual feedback
      // Show different appearance for default vs modified heights
      const isDefaultHeight = (height === TERRAIN_CONFIG.DEFAULT_HEIGHT);
      
      // Create terrain tile graphics
      const terrainTile = new PIXI.Graphics();
      const color = this.getColorForHeight(height);
      
      // Use different styling for default vs modified heights
      if (isDefaultHeight) {
        // Subtle indicator for default height when terrain mode is active
        terrainTile.lineStyle(1, 0x666666, 0.3);
        terrainTile.beginFill(color, 0.1); // Very subtle for default height
      } else {
        // Prominent display for modified heights
        terrainTile.lineStyle(
          TERRAIN_CONFIG.HEIGHT_BORDER_WIDTH, 
          this.getBorderColorForHeight(height), 
          TERRAIN_CONFIG.HEIGHT_BORDER_ALPHA
        );
        terrainTile.beginFill(color, TERRAIN_CONFIG.HEIGHT_ALPHA);
      }
      
      // Draw diamond shape
      terrainTile.moveTo(0, this.gameManager.tileHeight / 2);
      terrainTile.lineTo(this.gameManager.tileWidth / 2, 0);
      terrainTile.lineTo(this.gameManager.tileWidth, this.gameManager.tileHeight / 2);
      terrainTile.lineTo(this.gameManager.tileWidth / 2, this.gameManager.tileHeight);
      terrainTile.lineTo(0, this.gameManager.tileHeight / 2);
      terrainTile.endFill();
      
      // Position tile in isometric space (same calculation as grid tiles)
      terrainTile.x = (x - y) * (this.gameManager.tileWidth / 2);
      terrainTile.y = (x + y) * (this.gameManager.tileHeight / 2);
      
      // Apply elevation effect for ALL heights relative to base level (height 0)
      // Positive heights: move UP (negative Y offset) to appear elevated
      // Negative heights: move DOWN (positive Y offset) to appear as depressions
      // Height 0: no offset (base reference level)
      const elevationOffset = -height * TERRAIN_CONFIG.ELEVATION_SHADOW_OFFSET;
      terrainTile.y += elevationOffset;
      
      // Add visual depth cues for better height perception
      if (height > 0) {
        // Elevated terrain: add shadow effect
        this.addElevationShadow(terrainTile, height, x, y);
      } else if (height < 0) {
        // Depressed terrain: add darkening effect
        this.addDepressionEffect(terrainTile, height);
      }
      
      // Mark as terrain tile and store coordinates
      terrainTile.isTerrainTile = true;
      terrainTile.gridX = x;
      terrainTile.gridY = y;
      terrainTile.terrainHeight = height;
      
      // Calculate depth value for isometric ordering
      // In isometric view, tiles with higher x+y values should appear behind tiles with lower x+y values
      terrainTile.depthValue = x + y;
      
      // Add to container with proper depth ordering
      this.addTileWithDepthSorting(terrainTile);
      this.terrainTiles.set(tileKey, terrainTile);
      
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
   * Get color for terrain height
   * @param {number} height - Terrain height
   * @returns {number} Hex color value
   */
  getColorForHeight(height) {
    const colorKey = height.toString();
    return TERRAIN_CONFIG.HEIGHT_COLOR_SCALE[colorKey] || TERRAIN_CONFIG.HEIGHT_COLOR_SCALE['0'];
  }

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
      return this.lightenColor(baseColor, 0.3);
    } else if (height < 0) {
      return this.darkenColor(baseColor, 0.3);
    } else {
      return baseColor;
    }
  }

  /**
   * Lighten a hex color by a factor
   * @param {number} color - Hex color
   * @param {number} factor - Lightening factor (0-1)
   * @returns {number} Lightened hex color
   */
  lightenColor(color, factor) {
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;
    
    const newR = Math.min(255, Math.floor(r + (255 - r) * factor));
    const newG = Math.min(255, Math.floor(g + (255 - g) * factor));
    const newB = Math.min(255, Math.floor(b + (255 - b) * factor));
    
    return (newR << 16) | (newG << 8) | newB;
  }

  /**
   * Darken a hex color by a factor
   * @param {number} color - Hex color
   * @param {number} factor - Darkening factor (0-1)
   * @returns {number} Darkened hex color
   */
  darkenColor(color, factor) {
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;
    
    const newR = Math.max(0, Math.floor(r * (1 - factor)));
    const newG = Math.max(0, Math.floor(g * (1 - factor)));
    const newB = Math.max(0, Math.floor(b * (1 - factor)));
    
    return (newR << 16) | (newG << 8) | newB;
  }

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
    try {
      const targetDepth = terrainTile.depthValue;
      const isShadow = terrainTile.isShadowTile;
      const children = this.terrainContainer.children;
      
      // Find insertion point for proper depth ordering
      // Order: shadows first (behind), then terrain tiles, for each depth level
      let insertIndex = 0;
      
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        
        if (child.depthValue !== undefined) {
          const childDepth = child.depthValue;
          const childIsShadow = child.isShadowTile;
          
          // Skip to correct depth level
          if (childDepth < targetDepth) {
            insertIndex = i + 1;
            continue;
          }
          
          // Same depth level - position shadows before terrain tiles
          if (childDepth === targetDepth) {
            if (isShadow && !childIsShadow) {
              // Insert shadow before terrain tile at same depth
              insertIndex = i;
              break;
            } else if (!isShadow && childIsShadow) {
              // Insert terrain tile after shadow at same depth
              insertIndex = i + 1;
              continue;
            } else {
              // Same type at same depth - insert after
              insertIndex = i + 1;
              continue;
            }
          }
          
          // Higher depth level - insert before
          if (childDepth > targetDepth) {
            insertIndex = i;
            break;
          }
        } else {
          // For children without depth value, increment insertion point
          insertIndex = i + 1;
        }
      }
      
      // Insert tile at calculated position
      this.terrainContainer.addChildAt(terrainTile, insertIndex);
      
      logger.log(LOG_LEVEL.TRACE, 'Terrain tile added with depth sorting', LOG_CATEGORY.RENDERING, {
        context: 'TerrainManager.addTileWithDepthSorting',
        coordinates: { x: terrainTile.gridX, y: terrainTile.gridY },
        depthValue: targetDepth,
        isShadow,
        insertIndex,
        totalChildren: this.terrainContainer.children.length
      });
    } catch (error) {
      // Fallback to simple addChild if sorting fails
      logger.warn('Depth sorting failed, using fallback addChild', { 
        coordinates: { x: terrainTile.gridX, y: terrainTile.gridY },
        error: error.message 
      });
      this.terrainContainer.addChild(terrainTile);
    }
  }

  /**
   * Re-sort all terrain tiles by depth to ensure proper isometric rendering order
   * Call this method if depth ordering becomes inconsistent
   */
  sortAllTerrainTilesByDepth() {
    try {
      // Get all children and separate them by type
      const allChildren = [...this.terrainContainer.children];
      const terrainTiles = [];
      const shadowTiles = [];
      const otherChildren = [];
      
      // Categorize children
      allChildren.forEach(child => {
        if (child.isTerrainTile) {
          terrainTiles.push(child);
        } else if (child.isShadowTile) {
          shadowTiles.push(child);
        } else {
          otherChildren.push(child);
        }
      });
      
      // Sort terrain tiles by depth value
      terrainTiles.sort((a, b) => (a.depthValue || 0) - (b.depthValue || 0));
      shadowTiles.sort((a, b) => (a.depthValue || 0) - (b.depthValue || 0));
      
      // Clear container and re-add in correct order
      this.terrainContainer.removeChildren();
      
      // Add in depth order: shadows first, then terrain tiles, for each depth level
      let currentDepth = -1;
      let terrainIndex = 0;
      let shadowIndex = 0;
      
      while (terrainIndex < terrainTiles.length || shadowIndex < shadowTiles.length) {
        // Find next depth level to process
        const nextTerrainDepth = terrainIndex < terrainTiles.length ? 
                                terrainTiles[terrainIndex].depthValue : Infinity;
        const nextShadowDepth = shadowIndex < shadowTiles.length ? 
                               shadowTiles[shadowIndex].depthValue : Infinity;
        
        currentDepth = Math.min(nextTerrainDepth, nextShadowDepth);
        
        // Add all shadows at current depth level
        while (shadowIndex < shadowTiles.length && 
               shadowTiles[shadowIndex].depthValue === currentDepth) {
          this.terrainContainer.addChild(shadowTiles[shadowIndex]);
          shadowIndex++;
        }
        
        // Add all terrain tiles at current depth level
        while (terrainIndex < terrainTiles.length && 
               terrainTiles[terrainIndex].depthValue === currentDepth) {
          this.terrainContainer.addChild(terrainTiles[terrainIndex]);
          terrainIndex++;
        }
      }
      
      // Add any other children at the end
      otherChildren.forEach(child => {
        this.terrainContainer.addChild(child);
      });
      
      logger.log(LOG_LEVEL.DEBUG, 'All terrain tiles re-sorted by depth', LOG_CATEGORY.RENDERING, {
        context: 'TerrainManager.sortAllTerrainTilesByDepth',
        terrainTilesCount: terrainTiles.length,
        shadowTilesCount: shadowTiles.length,
        otherChildrenCount: otherChildren.length,
        totalChildren: this.terrainContainer.children.length
      });
    } catch (error) {
      GameErrors.rendering(error, {
        stage: 'sortAllTerrainTilesByDepth'
      });
    }
  }

  /**
   * Update terrain display for specific area
   * @param {number} centerX - Center X coordinate
   * @param {number} centerY - Center Y coordinate
   * @param {number} brushSize - Size of area to update
   */
  updateTerrainDisplay(centerX, centerY, brushSize) {
    try {
      // Add affected cells to update queue
      for (let dy = -Math.floor(brushSize / 2); dy <= Math.floor(brushSize / 2); dy++) {
        for (let dx = -Math.floor(brushSize / 2); dx <= Math.floor(brushSize / 2); dx++) {
          const x = centerX + dx;
          const y = centerY + dy;
          
          if (this.isValidGridPosition(x, y)) {
            this.updateQueue.add(`${x},${y}`);
          }
        }
      }
      
      // Process updates with throttling
      this.processUpdateQueue();
    } catch (error) {
      GameErrors.rendering(error, {
        stage: 'updateTerrainDisplay',
        centerCoordinates: { x: centerX, y: centerY },
        brushSize
      });
    }
  }

  /**
   * Process queued terrain tile updates with performance throttling
   */
  processUpdateQueue() {
    const now = Date.now();
    
    // Throttle updates to maintain 60fps
    if (this.isUpdating || (now - this.lastUpdateTime) < TERRAIN_CONFIG.UPDATE_THROTTLE_MS) {
      return;
    }
    
    this.isUpdating = true;
    this.lastUpdateTime = now;
    
    try {
      let updatesProcessed = 0;
      const maxUpdatesPerFrame = TERRAIN_CONFIG.BATCH_UPDATE_SIZE;
      
      for (const tileKey of this.updateQueue) {
        if (updatesProcessed >= maxUpdatesPerFrame) {
          break;
        }
        
        const [x, y] = tileKey.split(',').map(Number);
        this.createTerrainTile(x, y);
        this.updateQueue.delete(tileKey);
        updatesProcessed++;
      }
      
      // Schedule next update if more tiles remain
      if (this.updateQueue.size > 0) {
        requestAnimationFrame(() => {
          this.isUpdating = false;
          this.processUpdateQueue();
        });
      } else {
        this.isUpdating = false;
      }
      
      logger.log(LOG_LEVEL.TRACE, 'Terrain display update processed', LOG_CATEGORY.RENDERING, {
        context: 'TerrainManager.processUpdateQueue',
        updatesProcessed,
        remainingUpdates: this.updateQueue.size,
        processingTime: Date.now() - now
      });
    } catch (error) {
      this.isUpdating = false;
      GameErrors.rendering(error, {
        stage: 'processUpdateQueue',
        queueSize: this.updateQueue.size
      });
    }
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
  clearAllTerrainTiles() {
    try {
      // Remove all terrain tiles from container
      for (const [tileKey, tile] of this.terrainTiles) {
        this.terrainContainer.removeChild(tile);
      }
      
      // Clear the tiles map
      this.terrainTiles.clear();
      
      // Clear update queue
      this.updateQueue.clear();
      
      logger.log(LOG_LEVEL.DEBUG, 'All terrain tiles cleared', LOG_CATEGORY.SYSTEM, {
        context: 'TerrainManager.clearAllTerrainTiles',
        stage: 'tiles_cleared'
      });
    } catch (error) {
      GameErrors.rendering(error, {
        stage: 'clearAllTerrainTiles'
      });
      throw error;
    }
  }

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
    return Number.isInteger(x) && Number.isInteger(y) &&
           x >= 0 && x < this.gameManager.cols &&
           y >= 0 && y < this.gameManager.rows;
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
