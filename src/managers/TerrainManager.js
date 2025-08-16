/**
 * TerrainManager.js - Handles terrain rendering and visual management
 * 
 * Extracted following single responsibility principle
 * Manages terrain tile rendering, height visualization, and display updates
 * Works in coordination with TerrainCoordinator for complete terrain system
 */

import { logger, LOG_LEVEL, LOG_CATEGORY } from '../utils/Logger.js';
import { GameErrors } from '../utils/ErrorHandler.js';
import { GameValidators } from '../utils/Validation.js';
import { TERRAIN_CONFIG } from '../config/TerrainConstants.js';
import { TerrainPixiUtils } from '../utils/TerrainPixiUtils.js';
// import { GRID_CONFIG } from '../config/GameConstants.js';
import { lightenColor, darkenColor } from '../utils/ColorUtils.js';
import { getBiomeColorHex } from '../config/BiomePalettes.js';
import { TerrainFacesRenderer } from '../terrain/TerrainFacesRenderer.js';
import { TerrainHeightUtils } from '../utils/TerrainHeightUtils.js';
import { CoordinateUtils } from '../utils/CoordinateUtils.js';

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
    try {
      // Use centralized PIXI container validation
      if (!TerrainPixiUtils.validatePixiContainer(this.terrainContainer, 'terrainContainer', 'TerrainManager.validateContainerState')) {
        throw new Error('Terrain container validation failed');
      }
      
      // Check if parent game container exists and is valid
      if (!TerrainPixiUtils.validatePixiContainer(this.gameManager?.gridContainer, 'gridContainer', 'TerrainManager.validateContainerState')) {
        throw new Error('Game grid container validation failed');
      }
      
      // Validate terrain tiles map consistency
      if (!this.terrainTiles) {
        throw new Error('Terrain tiles map is not initialized');
      }
      
      logger.log(LOG_LEVEL.DEBUG, 'Terrain container state validation passed', LOG_CATEGORY.SYSTEM, {
        context: 'TerrainManager.validateContainerState',
        terrainContainerExists: !!this.terrainContainer,
        gridContainerExists: !!this.gameManager?.gridContainer,
        tilesMapSize: this.terrainTiles.size,
        containerChildrenCount: this.terrainContainer.children.length
      });
      
      return true;
    } catch (error) {
      logger.error('Terrain container state validation failed', {
        context: 'TerrainManager.validateContainerState',
        error: error.message,
        terrainContainerExists: !!this.terrainContainer,
        terrainContainerDestroyed: this.terrainContainer?.destroyed,
        gridContainerExists: !!this.gameManager?.gridContainer,
        gridContainerDestroyed: this.gameManager?.gridContainer?.destroyed
      });
      throw error;
    }
  }

  /**
   * Show all terrain tiles (when terrain mode is enabled)
   */
  showAllTerrainTiles() {
    try {
      // ENHANCED: Validate container state before operations
      this.validateContainerState();
      
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
      // Proactively remove any overlay faces attached to terrain tiles
      try {
        const children = [...this.terrainContainer.children];
        children.forEach(child => {
          if (child && child.isTerrainTile) {
            if (child.sideFaces) {
              if (child.sideFaces.parent) {
                child.sideFaces.parent.removeChild(child.sideFaces);
              }
              if (typeof child.sideFaces.destroy === 'function' && !child.sideFaces.destroyed) {
                child.sideFaces.destroy();
              }
              child.sideFaces = null;
            }
            if (child.shadowTile) {
              if (child.shadowTile.parent) {
                child.shadowTile.parent.removeChild(child.shadowTile);
              }
              if (typeof child.shadowTile.destroy === 'function' && !child.shadowTile.destroyed) {
                child.shadowTile.destroy();
              }
              child.shadowTile = null;
            }
            if (child.depressionOverlay) {
              try { child.removeChild(child.depressionOverlay); } catch { /* ignore */ }
              if (typeof child.depressionOverlay.destroy === 'function' && !child.depressionOverlay.destroyed) {
                child.depressionOverlay.destroy();
              }
              child.depressionOverlay = null;
            }
          }
        });
      } catch (_) { /* best-effort cleanup */ }
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
   * Clear all terrain tiles completely (for terrain mode transitions)
   */
  clearAllTerrainTiles() {
    try {
      // Early exit if no terrain tiles exist
      if (!this.terrainTiles || this.terrainTiles.size === 0) {
        logger.log(LOG_LEVEL.DEBUG, 'No terrain tiles to clear', LOG_CATEGORY.SYSTEM, {
          context: 'TerrainManager.clearAllTerrainTiles'
        });
        if (this.terrainContainer) {
          this.terrainContainer.visible = false;
        }
        return;
      }
      
      const tileCount = this.terrainTiles.size;
      
      // Best-effort removal of overlay faces and effects before batch cleanup
      try {
        this.terrainTiles.forEach(tile => {
          if (tile && tile.sideFaces) {
            if (tile.sideFaces.parent) {
              tile.sideFaces.parent.removeChild(tile.sideFaces);
            }
            if (typeof tile.sideFaces.destroy === 'function' && !tile.sideFaces.destroyed) {
              tile.sideFaces.destroy();
            }
            tile.sideFaces = null;
          }
          if (tile && tile.shadowTile) {
            if (tile.shadowTile.parent) {
              tile.shadowTile.parent.removeChild(tile.shadowTile);
            }
            if (typeof tile.shadowTile.destroy === 'function' && !tile.shadowTile.destroyed) {
              tile.shadowTile.destroy();
            }
            tile.shadowTile = null;
          }
          if (tile && tile.depressionOverlay) {
            try { tile.removeChild(tile.depressionOverlay); } catch { /* ignore */ }
            if (typeof tile.depressionOverlay.destroy === 'function' && !tile.depressionOverlay.destroyed) {
              tile.depressionOverlay.destroy();
            }
            tile.depressionOverlay = null;
          }
        });
      } catch (_) { /* ignore */ }

      // Use centralized cleanup utility for consistent behavior
      const cleanupResults = TerrainPixiUtils.batchCleanupTerrainTiles(
        this.terrainTiles, 
        this.terrainContainer, 
        'TerrainManager.clearAllTerrainTiles'
      );
      
      // Clear the terrain tiles map
      this.terrainTiles.clear();
      
      // Hide container
      if (this.terrainContainer) {
        this.terrainContainer.visible = false;
      }
      
      logger.log(LOG_LEVEL.INFO, 'All terrain tiles cleared completely', LOG_CATEGORY.SYSTEM, {
        context: 'TerrainManager.clearAllTerrainTiles',
        clearedTileCount: tileCount,
        cleanupResults
      });
    } catch (error) {
      // Force clear the map even if individual tiles had issues
      if (this.terrainTiles) {
        this.terrainTiles.clear();
      }
      if (this.terrainContainer) {
        this.terrainContainer.visible = false;
      }
      
      GameErrors.rendering(error, {
        stage: 'clearAllTerrainTiles',
        context: 'TerrainManager.clearAllTerrainTiles'
      });
      
      // Don't re-throw to prevent cascade failures
      logger.log(LOG_LEVEL.WARN, 'Terrain tiles cleared with errors', LOG_CATEGORY.SYSTEM, {
        context: 'TerrainManager.clearAllTerrainTiles',
        error: error.message
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
  _validateTileCreationInputs(x, y) {
    // ENHANCED: Validate container state before tile creation
    this.validateContainerState();
    
    // Validate coordinates
    const coordValidation = GameValidators.coordinates(x, y);
    if (!coordValidation.isValid) {
      throw new Error(`Invalid tile coordinates: ${coordValidation.getErrorMessage()}`);
    }
  }

  /**
   * DECOMPOSED METHOD: Cleanup existing tile if present
   * @private
   * @param {string} tileKey - Tile key for cleanup
   */
  _cleanupExistingTile(tileKey) {
    // Remove existing tile if present (with enhanced safety)
    if (this.terrainTiles.has(tileKey)) {
      const existingTile = this.terrainTiles.get(tileKey);
      
      // Use centralized cleanup utility for consistency
      const cleanupSuccess = TerrainPixiUtils.cleanupTerrainTile(
        existingTile, 
        this.terrainContainer, 
        tileKey, 
        'TerrainManager.createTerrainTile'
      );
      
      if (!cleanupSuccess) {
        logger.warn('Tile cleanup had partial failures, continuing with creation', {
          context: 'TerrainManager.createTerrainTile',
          coordinates: { x: existingTile.gridX, y: existingTile.gridY },
          tileKey
        });
      }
      
      this.terrainTiles.delete(tileKey);
    }
  }

  /**
   * DECOMPOSED METHOD: Create base terrain graphics object
   * @private
   * @param {number} x - Grid X coordinate
   * @param {number} y - Grid Y coordinate
   * @param {number} height - Terrain height
   * @returns {PIXI.Graphics} Created terrain tile graphics
   */
  _createBaseTerrainGraphics(x, y, height) {
    // Create terrain tile graphics
    const terrainTile = new PIXI.Graphics();
    
    // Mark as terrain tile and store coordinates
    terrainTile.isTerrainTile = true;
    terrainTile.gridX = x;
    terrainTile.gridY = y;
    terrainTile.terrainHeight = height;
    
    // Calculate depth value for isometric ordering
    // In isometric view, tiles with higher x+y values should appear behind tiles with lower x+y values
    terrainTile.depthValue = x + y;
  // If container uses zIndex sorting, place terrain tile above faces/shadows at its depth
  terrainTile.zIndex = terrainTile.depthValue * 100 + 20;

  // Defensive: ensure clean visual state
  terrainTile.shadowTile = null;
  terrainTile.depressionOverlay = null;
  terrainTile.sideFaces = null;
    
    return terrainTile;
  }

  /**
   * DECOMPOSED METHOD: Apply styling to terrain tile
   * @private
   * @param {PIXI.Graphics} terrainTile - Terrain tile to style
   * @param {number} height - Terrain height
   */
  _applyTerrainStyling(terrainTile, height) {
    // Always create terrain tile to provide visual feedback
    // Show different appearance for default vs modified heights
    const isDefaultHeight = (height === TERRAIN_CONFIG.DEFAULT_HEIGHT);
    const color = this.getColorForHeight(height);
    // Clear previous paint layer if any
    try {
      if (terrainTile.paintLayer) {
        terrainTile.removeChild(terrainTile.paintLayer);
        if (typeof terrainTile.paintLayer.destroy === 'function' && !terrainTile.paintLayer.destroyed) {
          terrainTile.paintLayer.destroy({ children: true });
        }
        terrainTile.paintLayer = null;
      }
      if (terrainTile.paintMask) {
        // Remove and destroy old mask
        try { terrainTile.removeChild(terrainTile.paintMask); } catch {}
        if (typeof terrainTile.paintMask.destroy === 'function' && !terrainTile.paintMask.destroyed) {
          terrainTile.paintMask.destroy();
        }
        terrainTile.paintMask = null;
      }
    } catch (_) { /* best-effort */ }

    // Border style only on the main graphics; fills are drawn in child layers
    if (isDefaultHeight) {
      terrainTile.lineStyle(1, 0x666666, 0.3);
    } else {
      terrainTile.lineStyle(
        TERRAIN_CONFIG.HEIGHT_BORDER_WIDTH,
        this.getBorderColorForHeight(height),
        TERRAIN_CONFIG.HEIGHT_BORDER_ALPHA
      );
    }

  // Draw diamond stroke (no fill on the main graphics)
    terrainTile.moveTo(0, this.gameManager.tileHeight / 2);
    terrainTile.lineTo(this.gameManager.tileWidth / 2, 0);
    terrainTile.lineTo(this.gameManager.tileWidth, this.gameManager.tileHeight / 2);
    terrainTile.lineTo(this.gameManager.tileWidth / 2, this.gameManager.tileHeight);
    terrainTile.lineTo(0, this.gameManager.tileHeight / 2);

    // Create a paint layer with multiple colored sub-shapes covering the diamond
  const paint = new PIXI.Container();
    paint.x = 0;
    paint.y = 0;

  const w = this.gameManager.tileWidth;
  const h = this.gameManager.tileHeight;
  // Rich shading settings
  const settings = (typeof window !== 'undefined' && window.richShadingSettings) ? window.richShadingSettings : null;
  const shadingEnabled = settings ? !!settings.enabled : true;
  const intensityMul = settings && Number.isFinite(settings.intensity) ? settings.intensity : 1.0; // 0..1.5
  const densityMul = settings && Number.isFinite(settings.density) ? settings.density : 1.0;     // 0.5..1.5
  const simplify = settings ? !!settings.performance : false;
  const baseAlphaRaw = isDefaultHeight ? 0.12 : TERRAIN_CONFIG.HEIGHT_ALPHA;
  const baseAlpha = Math.max(0, Math.min(1, baseAlphaRaw * intensityMul));

    // Mask to keep sub-shapes within the diamond
    const mask = new PIXI.Graphics();
    mask.beginFill(0xffffff, 1);
    mask.moveTo(0, h / 2);
    mask.lineTo(w / 2, 0);
    mask.lineTo(w, h / 2);
    mask.lineTo(w / 2, h);
    mask.lineTo(0, h / 2);
    mask.endFill();

    // Choose pattern based on biome, fallback to tri-tone split
    // In terrain mode, ignore biome selector entirely; use neutral/default styling
    const biome = (!this.terrainCoordinator?.isTerrainModeActive && typeof window !== 'undefined' && window.selectedBiome)
      ? String(window.selectedBiome)
      : '';
    const seed = (terrainTile.gridX * 73856093) ^ (terrainTile.gridY * 19349663) ^ ((height || 0) * 83492791);
    if (!shadingEnabled) {
      // Simple single fill if rich shading disabled
      const center = new PIXI.Graphics();
      center.beginFill(color, Math.min(1, baseAlpha + 0.05));
      center.moveTo(w / 2, h * 0.18);
      center.lineTo(w * 0.85, h / 2);
      center.lineTo(w / 2, h * 0.82);
      center.lineTo(w * 0.15, h / 2);
      center.closePath();
      center.endFill();
      paint.addChild(center);
    } else if (/desert|dune|salt|thorn|savanna|steppe/i.test(biome)) {
      this._drawDesertBands(paint, color, w, h, baseAlpha, seed, densityMul, simplify);
    } else if (/forest|grove|bamboo|orchard|cedar|fey/i.test(biome)) {
      this._drawForestDapples(paint, color, w, h, baseAlpha, seed, densityMul, simplify);
    } else if (/swamp|marsh|wetland|mangrove|flood/i.test(biome)) {
      this._drawSwampMottling(paint, color, w, h, baseAlpha, seed, densityMul, simplify);
    } else if (/glacier|tundra|frozen|pack|alpine|mountain|scree/i.test(biome)) {
      this._drawIcyFacets(paint, color, w, h, baseAlpha, seed, densityMul, simplify);
    } else if (/ocean|coast|river|lake|reef/i.test(biome)) {
      this._drawWaterWaves(paint, color, w, h, baseAlpha, seed, /reef/i.test(biome), densityMul, simplify);
    } else if (/volcan|lava|obsidian|ash/i.test(biome)) {
      this._drawVolcanicVeins(paint, color, w, h, baseAlpha, seed, densityMul, simplify);
    } else if (/ruin|urban|grave|waste/i.test(biome)) {
      this._drawRuinGrid(paint, color, w, h, baseAlpha, seed, densityMul, simplify);
    } else {
      // Default tri-tone split
      const lighter = lightenColor(color, 0.15);
      const darker = darkenColor(color, 0.15);
      const topTri = new PIXI.Graphics();
      topTri.beginFill(lighter, baseAlpha);
      topTri.moveTo(w / 2, 0);
      topTri.lineTo(w, h / 2);
      topTri.lineTo(0, h / 2);
      topTri.closePath();
      topTri.endFill();
      paint.addChild(topTri);
      const bottomTri = new PIXI.Graphics();
      bottomTri.beginFill(darker, baseAlpha);
      bottomTri.moveTo(w / 2, h);
      bottomTri.lineTo(w, h / 2);
      bottomTri.lineTo(0, h / 2);
      bottomTri.closePath();
      bottomTri.endFill();
      paint.addChild(bottomTri);
      const center = new PIXI.Graphics();
      center.beginFill(color, Math.min(1, baseAlpha + 0.05));
      center.moveTo(w / 2, h * 0.18);
      center.lineTo(w * 0.85, h / 2);
      center.lineTo(w / 2, h * 0.82);
      center.lineTo(w * 0.15, h / 2);
      center.closePath();
      center.endFill();
      paint.addChild(center);
    }

    // Apply mask
    paint.mask = mask;
    terrainTile.addChild(mask);

    terrainTile.addChild(paint);
    terrainTile.paintLayer = paint;
    terrainTile.paintMask = mask;
  }

  /**
   * DECOMPOSED METHOD: Position terrain tile in isometric space
   * @private
   * @param {PIXI.Graphics} terrainTile - Terrain tile to position
   * @param {number} x - Grid X coordinate
   * @param {number} y - Grid Y coordinate
   * @param {number} height - Terrain height
   */
  _positionTerrainTile(terrainTile, x, y, height) {
    // Position tile in isometric space (same calculation as grid tiles)
    terrainTile.x = (x - y) * (this.gameManager.tileWidth / 2);
    terrainTile.y = (x + y) * (this.gameManager.tileHeight / 2);
    
  // Apply elevation effect using centralized util for consistency
  const elevationOffset = TerrainHeightUtils.calculateElevationOffset(height);
  terrainTile.y += elevationOffset;
  }

  /**
   * DECOMPOSED METHOD: Add visual effects for height perception
   * @private
   * @param {PIXI.Graphics} terrainTile - Terrain tile for effects
   * @param {number} height - Terrain height
   * @param {number} x - Grid X coordinate
   * @param {number} y - Grid Y coordinate
   */
  _addVisualEffects(terrainTile, height, x, y) {
    // Add visual depth cues for better height perception
    if (height > 0) {
      this.addElevationShadow(terrainTile, height, x, y);
    } else if (height < 0) {
      this.addDepressionEffect(terrainTile, height);
    }

    // Add 3D walls for all edges where neighbor height is lower
    try {
      // Cleanup previous faces if present
      if (terrainTile.sideFaces && terrainTile.sideFaces.parent) {
        terrainTile.sideFaces.parent.removeChild(terrainTile.sideFaces);
        if (typeof terrainTile.sideFaces.destroy === 'function' && !terrainTile.sideFaces.destroyed) {
          terrainTile.sideFaces.destroy();
        }
        terrainTile.sideFaces = null;
      }

  const getH = (gx, gy) => this.terrainCoordinator.getTerrainHeight(gx, gy);
  const faceBase = this.getColorForHeight(height);
  this.facesRenderer.addOverlayFaces(this.terrainContainer, terrainTile, getH, x, y, height, faceBase);
    } catch (e) {
      logger.warn('Failed to add 3D faces', { coordinates: { x, y }, error: e.message }, LOG_CATEGORY.RENDERING);
    }
  }

  /**
   * DECOMPOSED METHOD: Finalize terrain tile and add to container
   * @private
   * @param {PIXI.Graphics} terrainTile - Terrain tile to finalize
   * @param {number} x - Grid X coordinate
   * @param {number} y - Grid Y coordinate
   * @param {string} tileKey - Tile key for storage
   */
  _finalizeTerrainTile(terrainTile, x, y, tileKey) {
    // Add to container with proper depth ordering
    this.addTileWithDepthSorting(terrainTile);
    this.terrainTiles.set(tileKey, terrainTile);
  }

  /**
   * Get color for terrain height
   * @param {number} height - Terrain height
   * @returns {number} Hex color value
   */
  getColorForHeight(height) {
    // Terrain mode should not be affected by biome selection
    try {
      if (!this.terrainCoordinator?.isTerrainModeActive && typeof window !== 'undefined' && window.selectedBiome) {
  const gx = (this._currentColorEvalX ?? 0);
  const gy = (this._currentColorEvalY ?? 0);
  const mapFreq = (typeof window !== 'undefined' && window.richShadingSettings?.mapFreq) || 0.05;
  const seed = (this._biomeSeed ?? 1337) >>> 0;
  return getBiomeColorHex(window.selectedBiome, height, gx, gy, { moisture: 0.5, slope: 0, aspectRad: 0, seed, mapFreq });
      }
    } catch (_) { /* fall back */ }
    const colorKey = height.toString();
    return TERRAIN_CONFIG.HEIGHT_COLOR_SCALE[colorKey] || TERRAIN_CONFIG.HEIGHT_COLOR_SCALE['0'];
  }

  /**
   * Biome pattern helpers
   */
  _rand(seed) {
    let s = (seed >>> 0) || 1;
    return () => {
      // xorshift32
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
      return (s & 0xffffffff) / 0x100000000;
    };
  }

  _drawDesertBands(container, baseColor, w, h, alpha, seed, density = 1.0, simplify = false) {
    const rnd = this._rand(seed);
    let bandCount = 3 + Math.floor(rnd() * 2); // 3-4
    bandCount = Math.max(1, Math.round(bandCount * density));
    if (simplify) bandCount = Math.min(2, bandCount);
    for (let i = 0; i < bandCount; i++) {
      const t = (i + 1) / (bandCount + 1);
      const y = h * (0.2 + 0.6 * t + (rnd() - 0.5) * 0.06);
      const thickness = h * (0.10 + rnd() * 0.05) * (simplify ? 0.8 : 1);
      const c = lightenColor(baseColor, 0.1 + 0.12 * (t - 0.5));
      const g = new PIXI.Graphics();
      g.beginFill(c, alpha * 0.85);
      // diagonal dune band (parallelogram-like across diamond)
      g.moveTo(0, y - thickness / 2);
      g.lineTo(w / 2, y - thickness);
      g.lineTo(w, y - thickness / 2);
      g.lineTo(w / 2, y + thickness);
      g.closePath();
      g.endFill();
      container.addChild(g);
    }
  }

  _drawForestDapples(container, baseColor, w, h, alpha, seed, density = 1.0, simplify = false) {
    const rnd = this._rand(seed);
    let spots = 5 + Math.floor(rnd() * 3); // 5-7
    spots = Math.max(2, Math.round(spots * density));
    if (simplify) spots = Math.min(4, spots);
    for (let i = 0; i < spots; i++) {
      const cx = w * (0.2 + rnd() * 0.6);
      const cy = h * (0.25 + rnd() * 0.5);
      const rx = w * (0.08 + rnd() * 0.06) * (simplify ? 0.9 : 1);
      const ry = h * (0.06 + rnd() * 0.05) * (simplify ? 0.9 : 1);
      const c = (i % 2 === 0) ? lightenColor(baseColor, 0.12) : darkenColor(baseColor, 0.12);
      const g = new PIXI.Graphics();
      g.beginFill(c, alpha * 0.9);
      g.drawEllipse(cx, cy, rx, ry);
      g.endFill();
      container.addChild(g);
    }
  }

  _drawSwampMottling(container, baseColor, w, h, alpha, seed, density = 1.0, simplify = false) {
    const rnd = this._rand(seed);
    let blobs = 4 + Math.floor(rnd() * 3);
    blobs = Math.max(2, Math.round(blobs * density));
    if (simplify) blobs = Math.min(3, blobs);
    for (let i = 0; i < blobs; i++) {
      const cx = w * (0.2 + rnd() * 0.6);
      const cy = h * (0.3 + rnd() * 0.4);
      const r = Math.min(w, h) * (0.08 + rnd() * 0.08) * (simplify ? 0.85 : 1);
      const g = new PIXI.Graphics();
      const shade = i % 2 === 0 ? darkenColor(baseColor, 0.18) : darkenColor(baseColor, 0.1);
      g.beginFill(shade, alpha * 0.8);
      g.drawCircle(cx, cy, r);
      g.endFill();
      container.addChild(g);
    }
  }

  _drawIcyFacets(container, baseColor, w, h, alpha, seed, density = 1.0, simplify = false) {
    const rnd = this._rand(seed);
    let facets = 3 + Math.floor(rnd() * 2);
    facets = Math.max(1, Math.round(facets * density));
    if (simplify) facets = Math.min(2, facets);
    const hi = lightenColor(baseColor, 0.18);
    const mid = lightenColor(baseColor, 0.06);
    const lo = darkenColor(baseColor, 0.1);
    const palette = [hi, mid, lo];
    for (let i = 0; i < facets; i++) {
      const g = new PIXI.Graphics();
      const c = palette[i % palette.length];
      g.beginFill(c, alpha);
      // Create an angular facet triangle somewhere within the diamond
      const x1 = w * (0.25 + rnd() * 0.5);
      const y1 = h * (0.15 + rnd() * 0.3);
      const x2 = w * (0.15 + rnd() * 0.7);
      const y2 = h * (0.5 + rnd() * 0.2);
      const x3 = w * (0.35 + rnd() * 0.4);
      const y3 = h * (0.7 + rnd() * 0.25);
      g.moveTo(x1, y1);
      g.lineTo(x2, y2);
      g.lineTo(x3, y3);
      g.closePath();
      g.endFill();
      container.addChild(g);
    }
  }

  _drawWaterWaves(container, baseColor, w, h, alpha, seed, coral = false, density = 1.0, simplify = false) {
    const rnd = this._rand(seed);
    let lanes = 3;
    lanes = Math.max(1, Math.round(lanes * density));
    if (simplify) lanes = Math.min(2, lanes);
    for (let i = 0; i < lanes; i++) {
      const t = (i + 1) / (lanes + 1);
      const y = h * (0.2 + 0.6 * t + (rnd() - 0.5) * 0.04);
      const thickness = h * (0.06 + rnd() * 0.04) * (simplify ? 0.85 : 1);
      const c = lightenColor(baseColor, 0.1 + 0.08 * (0.5 - Math.abs(0.5 - t)));
      const g = new PIXI.Graphics();
      g.beginFill(c, alpha * 0.85);
      // horizontal wave band as trapezoid
      g.moveTo(0, y - thickness / 2);
      g.lineTo(w / 2, y - thickness * 0.9);
      g.lineTo(w, y - thickness / 2);
      g.lineTo(w / 2, y + thickness * 0.9);
      g.closePath();
      g.endFill();
      container.addChild(g);
    }
    if (coral && !simplify) {
      let spots = 6 + Math.floor(rnd() * 4);
      spots = Math.max(2, Math.round(spots * density));
      for (let i = 0; i < spots; i++) {
        const cx = w * (0.2 + rnd() * 0.6);
        const cy = h * (0.25 + rnd() * 0.5);
        const r = Math.min(w, h) * (0.025 + rnd() * 0.02);
        const pink = lightenColor(0xff6fa3, 0.15 * (rnd() - 0.5));
        const g = new PIXI.Graphics();
        g.beginFill(pink, Math.min(1, alpha + 0.05));
        g.drawCircle(cx, cy, r);
        g.endFill();
        container.addChild(g);
      }
    }
  }

  _drawVolcanicVeins(container, baseColor, w, h, alpha, seed, density = 1.0, simplify = false) {
    const rnd = this._rand(seed);
    let veins = 2 + Math.floor(rnd() * 2);
    veins = Math.max(1, Math.round(veins * density));
    if (simplify) veins = Math.min(2, veins);
    for (let i = 0; i < veins; i++) {
      const g = new PIXI.Graphics();
      g.lineStyle(2, lightenColor(0xff6a00, 0.1), Math.min(1, alpha + 0.1));
      const x0 = w * (0.15 + rnd() * 0.7);
      const y0 = h * (0.2 + rnd() * 0.6);
      const x1 = x0 + w * (0.15 * (rnd() - 0.5));
      const y1 = y0 + h * (0.25 * (rnd() - 0.5));
      const x2 = x1 + w * (0.2 * (rnd() - 0.5));
      const y2 = y1 + h * (0.3 * (rnd() - 0.5));
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.lineTo(x2, y2);
      container.addChild(g);
    }
    // Darken base through extra overlay to sell cooled crust
    const crust = new PIXI.Graphics();
    crust.beginFill(darkenColor(baseColor, 0.15), alpha * 0.4);
    crust.moveTo(0, h / 2);
    crust.lineTo(w / 2, 0);
    crust.lineTo(w, h / 2);
    crust.lineTo(w / 2, h);
    crust.closePath();
    crust.endFill();
    container.addChild(crust);
  }

  _drawRuinGrid(container, baseColor, w, h, alpha, seed, density = 1.0, simplify = false) {
    const g = new PIXI.Graphics();
    const lineC = darkenColor(baseColor, 0.25);
    g.lineStyle(1, lineC, alpha * 0.8);
    // Subtle grid inside diamond
    let rows = 3, cols = 3;
    rows = Math.max(2, Math.round(rows * density));
    cols = Math.max(2, Math.round(cols * density));
    if (simplify) { rows = Math.min(rows, 3); cols = Math.min(cols, 3); }
    for (let i = 1; i < rows; i++) {
      const ty = h * (i / rows);
      g.moveTo(w * 0.2, ty);
      g.lineTo(w * 0.8, ty);
    }
    for (let j = 1; j < cols; j++) {
      const tx = w * (j / cols);
      g.moveTo(tx, h * 0.2);
      g.lineTo(tx, h * 0.8);
    }
    container.addChild(g);
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
      return lightenColor(baseColor, 0.3);
    } else if (height < 0) {
      return darkenColor(baseColor, 0.3);
    } else {
      return baseColor;
    }
  }

  // lightenColor/darkenColor moved to shared ColorUtils

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
      // Get all children and group by depth and type
      const allChildren = [...this.terrainContainer.children];
      const byDepth = new Map();
      const others = [];

      const addToDepth = (depth, type, obj) => {
        const key = Number.isFinite(depth) ? depth : 0;
        if (!byDepth.has(key)) byDepth.set(key, { shadows: [], faces: [], tiles: [] });
        byDepth.get(key)[type].push(obj);
      };

      for (const child of allChildren) {
        if (child.isShadowTile) {
          addToDepth(child.depthValue || 0, 'shadows', child);
        } else if (child.isTerrainTile) {
          addToDepth(child.depthValue || 0, 'tiles', child);
        } else if (child.isOverlayFace) {
          addToDepth(child.depthValue || 0, 'faces', child);
        } else {
          others.push(child);
        }
      }

      // Sort keys and buckets
      const depths = [...byDepth.keys()].sort((a, b) => a - b);

      // Clear container and re-add in correct order per depth:
      // shadows -> faces -> tiles, so faces render behind tiles
      this.terrainContainer.removeChildren();
      for (const d of depths) {
        const bucket = byDepth.get(d);
        bucket.shadows.sort((a, b) => (a.depthValue || 0) - (b.depthValue || 0));
        bucket.faces.sort((a, b) => (a.depthValue || 0) - (b.depthValue || 0));
        bucket.tiles.sort((a, b) => (a.depthValue || 0) - (b.depthValue || 0));
        bucket.shadows.forEach(ch => this.terrainContainer.addChild(ch));
        bucket.faces.forEach(ch => this.terrainContainer.addChild(ch));
        bucket.tiles.forEach(ch => this.terrainContainer.addChild(ch));
      }

      // Add any other children at the end unchanged
      others.forEach(child => this.terrainContainer.addChild(child));
      
      // Aggregate counts for logging (avoid referencing undefined locals)
      const aggregateCounts = [...byDepth.values()].reduce((acc, bucket) => {
        acc.tiles += bucket.tiles.length;
        acc.shadows += bucket.shadows.length;
        acc.faces += bucket.faces.length;
        return acc;
      }, { tiles: 0, shadows: 0, faces: 0 });

      logger.log(LOG_LEVEL.DEBUG, 'All terrain tiles re-sorted by depth', LOG_CATEGORY.RENDERING, {
        context: 'TerrainManager.sortAllTerrainTilesByDepth',
        tilesCount: aggregateCounts.tiles,
        shadowTilesCount: aggregateCounts.shadows,
        facesCount: aggregateCounts.faces,
        otherChildrenCount: others.length,
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
