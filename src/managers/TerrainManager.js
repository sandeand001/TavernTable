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
import { traceDiamondPath } from '../utils/PixiShapeUtils.js';
import { getBiomeColorHex } from '../config/BiomePalettes.js';
import { TerrainFacesRenderer } from '../terrain/TerrainFacesRenderer.js';
import { TerrainHeightUtils } from '../utils/TerrainHeightUtils.js';
// elevation offset calculation is delegated into internals
import { CoordinateUtils } from '../utils/CoordinateUtils.js';
// shading pattern helpers are used within internals
import {
  validateContainerState as _validateContainerState,
  showAllTerrainTiles as _showAll,
  hideAllTerrainTiles as _hideAll,
  clearAllTerrainTiles as _clearAll,
} from './terrain-manager/internals/container.js';
import {
  validateTileCreationInputs as _validateTileInputs,
  cleanupExistingTile as _cleanupTile,
  createBaseTerrainGraphics as _createBase,
  applyTerrainStyling as _applyStyle,
  positionTerrainTile as _positionTile,
  finalizeTerrainTile as _finalizeTile,
  addVisualEffects as _addEffects,
} from './terrain-manager/internals/tiles.js';
import {
  addTileWithDepthSorting as _addWithSort,
  sortAllTerrainTilesByDepth as _sortAllDepth,
} from './terrain-manager/internals/sorting.js';
import {
  updateTerrainDisplay as _updateDisplay,
  processUpdateQueue as _processUpdates,
  flushUpdateQueue as _flushUpdates,
} from './terrain-manager/internals/updates.js';
import {
  placeItem as _placeItem,
  removeItem as _removeItem,
} from './terrain-manager/internals/placeables.js';

export class TerrainManager {
  constructor(gameManager, terrainCoordinator) {
    this.gameManager = gameManager;
    this.terrainCoordinator = terrainCoordinator;
    this.facesRenderer = new TerrainFacesRenderer(gameManager);

    // PIXI containers for terrain rendering
    this.terrainContainer = null;
    this.terrainTiles = new Map(); // Map of "x,y" -> PIXI.Graphics terrain tile
    // Preview overlay for brush footprint highlighting (non-destructive)
    this.previewContainer = null;
    this.previewCache = new Map(); // Map of "x,y" -> PIXI.Graphics preview diamond
    // Per-tile placeable items (paths, structures)
    this.placeables = new Map(); // Map of "x,y" -> Array<PIXI.Sprite>

    // Performance optimization
    this.updateQueue = new Set(); // Cells that need visual updates
    this.isUpdating = false;
    this.lastUpdateTime = 0;

    logger.log(LOG_LEVEL.DEBUG, 'TerrainManager initialized', LOG_CATEGORY.SYSTEM, {
      context: 'TerrainManager.constructor',
      stage: 'initialization',
      hasGameManager: !!gameManager,
      hasTerrainCoordinator: !!terrainCoordinator,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Public wrapper for placing a terrain placeable (path/plant/structure) at grid coords.
   * Exposed to allow biome flora population without reaching into internals directly.
   * @param {string} id placeable id (must exist in TERRAIN_PLACEABLES)
   * @param {number} x grid column
   * @param {number} y grid row
   * @returns {boolean} true if placed
   */
  placeItem(id, x, y) {
    try {
      return _placeItem(this, id, x, y);
    } catch (_) {
      return false;
    }
  }

  /**
   * Public wrapper for removing a terrain placeable by id at grid coords.
   * Mirrors placeItem for symmetry in tests and external callers.
   * @param {string} id placeable id
   * @param {number} x grid column
   * @param {number} y grid row
   * @returns {boolean} true if removed
   */
  removeItem(id, x, y) {
    try {
      return _removeItem(this, x, y, id);
    } catch (_) {
      return false;
    }
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
      if (
        this.gameManager.gridContainer.sortableChildren &&
        typeof this.gameManager.gridContainer.sortChildren === 'function'
      ) {
        this.gameManager.gridContainer.sortChildren();
      }

      // Initialize preview container in the main gridContainer so we can depth-sort
      // previews BETWEEN base tiles (depth*100) and tokens (depth*100 + 1) and always on top
      // of the terrain overlay. Parent zIndex must be higher than terrainContainer because the
      // parent gridContainer is frequently resorted by zIndex elsewhere (tokens/placeables).
      this.previewContainer = new PIXI.Container();
      this.previewContainer.sortableChildren = true;
      // Ensure the preview container renders above terrain overlay regardless of parent sorting
      this.previewContainer.zIndex = (this.terrainContainer?.zIndex || 100000) + 10;
      this.gameManager.gridContainer.addChild(this.previewContainer);

      // Initialize terrain tiles for the current grid
      this.createInitialTerrainTiles();
      // Ensure preview layer sits on top of terrain tiles
      this.ensurePreviewLayerOnTop();

      logger.log(LOG_LEVEL.INFO, 'Terrain rendering system initialized', LOG_CATEGORY.SYSTEM, {
        context: 'TerrainManager.initialize',
        stage: 'rendering_initialization',
        terrainContainerReady: !!this.terrainContainer,
        gridDimensions: {
          cols: this.gameManager.cols,
          rows: this.gameManager.rows,
        },
        initialTilesCreated: this.terrainTiles.size,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      GameErrors.initialization(error, {
        stage: 'TerrainManager.initialize',
        hasGridContainer: !!this.gameManager?.gridContainer,
        gridDimensions: {
          cols: this.gameManager?.cols,
          rows: this.gameManager?.rows,
        },
      });
      throw error;
    }
  }
  /** Ensure the preview container is present and visible in gridContainer.
   *  Note: We no longer force preview to be the absolute top zIndex; tokens and
   *  placeables may be raised above preview during terrain mode per UX request.
   */
  ensurePreviewLayerOnTop() {
    try {
      if (!this.gameManager?.gridContainer || !this.previewContainer) return;
      const parent = this.gameManager.gridContainer;
      // Keep zIndex higher than terrain overlay so resorting doesn't bury the preview.
      // Tokens/placeables may be raised above this value when editing.
      const desired = (this.terrainContainer?.zIndex || 100000) + 10;
      if (this.previewContainer.zIndex !== desired) {
        this.previewContainer.zIndex = desired;
      }
      // Keep container alive and visible; order among siblings is handled by child zIndex
      // Also nudge to the end as a safety net for environments not using zIndex sorting
      if (typeof parent.setChildIndex === 'function') {
        parent.setChildIndex(this.previewContainer, Math.max(0, parent.children.length - 1));
      } else {
        // Fallback: remove and re-add
        try {
          parent.removeChild(this.previewContainer);
        } catch {
          /* ignore */
        }
        parent.addChild(this.previewContainer);
      }
      // If the parent sorts by zIndex, apply ordering now
      try {
        if (parent.sortableChildren && typeof parent.sortChildren === 'function') {
          parent.sortChildren();
        }
      } catch {
        /* ignore */
      }
      this.previewContainer.visible = true;
      // Parent container uses children zIndex to interleave; parent zIndex is not forced here.
    } catch (_) {
      /* best-effort */
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
        expectedTiles: this.gameManager.cols * this.gameManager.rows,
      });
    } catch (error) {
      GameErrors.rendering(error, {
        stage: 'createInitialTerrainTiles',
        gridDimensions: {
          cols: this.gameManager?.cols,
          rows: this.gameManager?.rows,
        },
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
        height: this.terrainCoordinator?.getTerrainHeight(x, y),
      });
      throw error;
    }
  }

  /**
   * Place a placeable terrain item at grid coords.
   * Returns true if placement succeeded, false if rejected (occupied/exclusive rules).
   */
  placeTerrainItem(x, y, placeableId) {
    try {
      const result = _placeItem(this, placeableId, x, y);
      logger.log(LOG_LEVEL.DEBUG, 'placeTerrainItem attempt', LOG_CATEGORY.RENDERING, {
        x,
        y,
        placeableId,
        success: !!result,
      });
      // If a plant/structure was placed via biome auto-population BEFORE the mesh pool
      // existed (late flag enable), attempt a one-time instancing registration now.
      if (result) {
        try {
          const gm = this.gameManager;
          // Create mesh pool if feature just got enabled late
          gm?.ensureInstancing?.();
          if (
            gm?.features?.instancedPlaceables &&
            gm.renderMode === '3d-hybrid' &&
            gm.placeableMeshPool
          ) {
            const key = `${x},${y}`;
            const list = this.placeables?.get(key);
            const latest = list && list[list.length - 1];
            if (latest && !latest.__instancedRef) {
              const placeableRecord = {
                gridX: x,
                gridY: y,
                type: latest.placeableType || 'generic',
              };
              latest.__instancedRef = placeableRecord;
              const p = gm.placeableMeshPool.addPlaceable(placeableRecord);
              if (p && typeof p.then === 'function') {
                p.catch(() => {});
              }
            }
          }
        } catch (_) {
          /* best-effort instancing retro-fit */
        }
      }
      if (!result) {
        // Lightweight diagnostics for common rejection reasons so UI traces are useful
        let reason = 'rejected_by_rules';
        try {
          const key = `${x},${y}`;
          if (
            this.placeables &&
            this.placeables.has(key) &&
            this.placeables.get(key).some((p) => p.placeableType === 'structure')
          ) {
            reason = 'occupied_by_structure';
          } else if (this.gameManager?.tokenManager?.findExistingTokenAt?.(x, y)) {
            reason = 'tokens_present';
          }
        } catch (_) {
          /* best-effort */
        }
        logger.log(LOG_LEVEL.INFO, 'placeTerrainItem rejected', LOG_CATEGORY.RENDERING, {
          x,
          y,
          placeableId,
          reason,
        });
      }
      return result;
    } catch (e) {
      logger.warn(
        'placeTerrainItem failed',
        { x, y, placeableId, error: e.message },
        LOG_CATEGORY.RENDERING
      );
      return false;
    }
  }

  /** Thin wrapper exposing variant cycling for UI consumers. */
  async cyclePlaceableVariant(x, y, placeableId, index = null) {
    try {
      // Delegate to internals implementation
      const mod = await import('./terrain-manager/internals/placeables.js');
      const fn = mod.cyclePlaceableVariant;
      if (typeof fn === 'function') return fn(this, x, y, placeableId, index);
      return false;
    } catch (e) {
      // Fallback: no-op
      return false;
    }
  }

  /** Remove a placeable item (optionally by id) from a tile. */
  removeTerrainItem(x, y, placeableId = null) {
    try {
      return _removeItem(this, x, y, placeableId);
    } catch (e) {
      logger.warn(
        'removeTerrainItem failed',
        { x, y, placeableId, error: e.message },
        LOG_CATEGORY.RENDERING
      );
      return false;
    }
  }

  /** Reposition all placeables (trees/paths/structures) to reflect current heights/scale. */
  repositionAllPlaceables() {
    try {
      // Import internals lazily to avoid circular load issues
      return import('./terrain-manager/internals/placeables.js').then((mod) => {
        try {
          return mod.repositionAllPlaceables?.(this);
        } catch (_) {
          return undefined;
        }
      });
    } catch (_) {
      return undefined;
    }
  }

  /**
   * DECOMPOSED METHOD: Validate tile creation inputs
   * @private
   * @param {number} x - Grid X coordinate
   * @param {number} y - Grid Y coordinate
   */
  _validateTileCreationInputs(x, y) {
    return _validateTileInputs(this, x, y);
  }

  /**
   * DECOMPOSED METHOD: Cleanup existing tile if present
   * @private
   * @param {string} tileKey - Tile key for cleanup
   */
  _cleanupExistingTile(tileKey) {
    return _cleanupTile(this, tileKey);
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
    return _createBase(this, x, y, height);
  }

  /**
   * DECOMPOSED METHOD: Apply styling to terrain tile
   * @private
   * @param {PIXI.Graphics} terrainTile - Terrain tile to style
   * @param {number} height - Terrain height
   */
  _applyTerrainStyling(terrainTile, height) {
    return _applyStyle(this, terrainTile, height);
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
    return _positionTile(this, terrainTile, x, y, height);
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
    return _addEffects(this, terrainTile, height, x, y);
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
    return _finalizeTile(this, terrainTile, x, y, tileKey);
  }

  /**
   * Get color for terrain height
   * @param {number} height - Terrain height
   * @returns {number} Hex color value
   */
  getColorForHeight(height) {
    // Terrain mode should not be affected by biome selection
    try {
      if (
        !this.terrainCoordinator?.isTerrainModeActive &&
        typeof window !== 'undefined' &&
        window.selectedBiome
      ) {
        const gx = 0; // Manager has no per-tile eval context outside coordinator; use 0 for stability
        const gy = 0;
        const mapFreq =
          (typeof window !== 'undefined' && window.richShadingSettings?.mapFreq) || 0.05;
        const seed = (this.terrainCoordinator?._biomeSeed ?? 1337) >>> 0;
        return getBiomeColorHex(window.selectedBiome, height, gx, gy, {
          moisture: 0.5,
          slope: 0,
          aspectRad: 0,
          seed,
          mapFreq,
        });
      }
    } catch (_) {
      /* fall back */
    }
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
      const shadowAlpha = (0.2 * height) / TERRAIN_CONFIG.MAX_HEIGHT; // Stronger shadow for higher terrain

      shadowTile.beginFill(shadowColor, shadowAlpha);

      // Draw same diamond shape as main tile (shared helper)
      traceDiamondPath(shadowTile, this.gameManager.tileWidth, this.gameManager.tileHeight);
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
        error: error.message,
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
      const overlayAlpha = (0.3 * Math.abs(height)) / TERRAIN_CONFIG.MAX_HEIGHT; // Darker for deeper depressions

      overlay.beginFill(0x000000, overlayAlpha); // Semi-transparent black

      // Draw same diamond shape as main tile (shared helper)
      traceDiamondPath(overlay, this.gameManager.tileWidth, this.gameManager.tileHeight);
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
        error: error.message,
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

  /** Immediately process all pending updates, bypassing throttle/batching. */
  flushUpdateQueue() {
    return _flushUpdates(this);
  }

  /**
   * Re-apply the current elevation scale to all overlay terrain tiles without
   * recreating them or changing their colors. This avoids flicker and ensures
   * terrain-mode colors persist while using the perception slider.
   */
  reapplyElevationScaleToOverlay() {
    try {
      if (!this.terrainContainer || !this.terrainTiles || this.terrainTiles.size === 0) return;

      const w = this.gameManager.tileWidth;
      const h = this.gameManager.tileHeight;

      for (const [key, tile] of this.terrainTiles) {
        if (!tile) continue;

        const [x, y] = key.split(',').map(Number);

        // Reset base iso position, then apply new elevation offset
        tile.x = (x - y) * (w / 2);
        tile.y = (x + y) * (h / 2);

        let height;
        if (Number.isFinite(tile.terrainHeight)) {
          height = tile.terrainHeight;
        } else {
          height = this.terrainCoordinator.getTerrainHeight(x, y);
        }
        const offset = TerrainHeightUtils.calculateElevationOffset(height);
        tile.y += offset;

        // Clear and rebuild side faces/shadows/depressions to match new scale
        try {
          if (tile.shadowTile && tile.parent?.children?.includes(tile.shadowTile)) {
            tile.parent.removeChild(tile.shadowTile);
            if (typeof tile.shadowTile.destroy === 'function' && !tile.shadowTile.destroyed) {
              tile.shadowTile.destroy();
            }
          }
        } catch {
          /* ignore */
        }
        tile.shadowTile = null;

        try {
          if (tile.depressionOverlay && tile.children?.includes(tile.depressionOverlay)) {
            tile.removeChild(tile.depressionOverlay);
            if (
              typeof tile.depressionOverlay.destroy === 'function' &&
              !tile.depressionOverlay.destroyed
            ) {
              tile.depressionOverlay.destroy();
            }
          }
        } catch {
          /* ignore */
        }
        tile.depressionOverlay = null;

        try {
          if (tile.sideFaces && tile.parent?.children?.includes(tile.sideFaces)) {
            tile.parent.removeChild(tile.sideFaces);
            if (typeof tile.sideFaces.destroy === 'function' && !tile.sideFaces.destroyed) {
              tile.sideFaces.destroy();
            }
          }
        } catch {
          /* ignore */
        }
        tile.sideFaces = null;

        this._addVisualEffects(tile, height, x, y);
      }

      try {
        this.terrainContainer.sortChildren?.();
      } catch {
        /* no-op */
      }

      this.ensurePreviewLayerOnTop();

      // After updating overlay positions, ensure tokens and placeables are visible above it
      try {
        const parent = this.gameManager?.gridContainer;
        const previewZ = this.previewContainer?.zIndex;
        const overlayZ = this.terrainContainer?.zIndex;
        const desired = Number.isFinite(previewZ)
          ? previewZ + 1
          : Number.isFinite(overlayZ)
            ? overlayZ + 11
            : null;
        if (Number.isFinite(desired) && parent?.children) {
          // Raise tokens
          if (Array.isArray(this.gameManager?.tokenManager?.placedTokens)) {
            for (const t of this.gameManager.tokenManager.placedTokens) {
              const s = t?.creature?.sprite;
              if (!s) continue;
              if (!Number.isFinite(s.zIndex) || s.zIndex < desired) s.zIndex = desired;
            }
          }
          // Raise placeables managed by TerrainManager
          if (this.placeables && this.placeables.size) {
            for (const [, list] of this.placeables) {
              if (!Array.isArray(list)) continue;
              for (const s of list) {
                if (!s) continue;
                if (!Number.isFinite(s.zIndex) || s.zIndex < desired) s.zIndex = desired;
              }
            }
          }
          try {
            parent.sortableChildren = true;
            parent.sortChildren?.();
          } catch (_) {
            /* ignore */
          }
        }
      } catch (_) {
        /* best-effort */
      }
    } catch (error) {
      GameErrors.rendering(error, {
        stage: 'TerrainManager.reapplyElevationScaleToOverlay',
        tiles: this.terrainTiles?.size,
      });
    }
  }

  /**
   * Render a non-destructive preview highlight for a set of grid cells.
   * Clears any previous preview before drawing the new one.
   * @param {Array<{x:number,y:number}>} cells
   */
  renderBrushPreview(cells, options = {}) {
    try {
      if (!this.previewContainer || !this.terrainCoordinator?.isTerrainModeActive) return;
      // Ensure the preview layer is on top and visible before drawing
      this.ensurePreviewLayerOnTop();
      // Clear previous preview before drawing new
      this.clearBrushPreview();
      try {
        if (this.previewContainer && this.previewContainer.visible === false) {
          this.previewContainer.visible = true;
        }
        const parent = this.gameManager?.gridContainer;
        if (parent && !parent.children?.includes(this.previewContainer)) {
          parent.addChild(this.previewContainer);
        }
      } catch {
        /* ignore */
      }
      if (!Array.isArray(cells) || cells.length === 0) return;

      const w = this.gameManager.tileWidth;
      const h = this.gameManager.tileHeight;
      const color = typeof options.color === 'number' ? options.color : 0xffff00;
      const lineWidth = typeof options.lineWidth === 'number' ? options.lineWidth : 2;
      const fillAlpha = typeof options.fillAlpha === 'number' ? options.fillAlpha : 0.12;
      const lineAlpha = typeof options.lineAlpha === 'number' ? options.lineAlpha : 0.9;

      for (const { x, y } of cells) {
        const g = new PIXI.Graphics();
        // Semi-transparent outline to avoid altering underlying colors
        g.lineStyle(lineWidth, color, lineAlpha);
        g.beginFill(color, fillAlpha);
        g.moveTo(0, h / 2);
        g.lineTo(w / 2, 0);
        g.lineTo(w, h / 2);
        g.lineTo(w / 2, h);
        g.closePath();
        g.endFill();

        // Position in iso space, reusing the same transform logic as tiles
        g.x = (x - y) * (w / 2);
        g.y = (x + y) * (h / 2);

        // Elevation offset so outline sits on the tile using the same scale util
        try {
          const height = this.terrainCoordinator.getTerrainHeight(x, y);
          const offset =
            typeof TerrainHeightUtils?.calculateElevationOffset === 'function'
              ? TerrainHeightUtils.calculateElevationOffset(height)
              : (height || 0) * (this.gameManager.tileHeight * 0.1);
          g.y += offset;
        } catch {
          /* best-effort */
        }

        // Depth-sort preview strictly BETWEEN tile top (depth*100) and tokens (depth*100 + 1)
        // and ensure it isn't hidden by overlay container resorting.
        g.zIndex = (x + y) * 100 + 0.5;

        this.previewContainer.addChild(g);
        this.previewCache.set(`${x},${y}`, g);
      }
      try {
        this.previewContainer.sortChildren?.();
      } catch {
        /* no-op */
      }
    } catch (error) {
      logger.warn(
        'Failed to render brush preview',
        {
          error: error.message,
          cellsCount: Array.isArray(cells) ? cells.length : 0,
        },
        LOG_CATEGORY.RENDERING
      );
    }
  }

  /** Clear any existing brush preview graphics. */
  clearBrushPreview() {
    try {
      if (!this.previewContainer) return;
      for (const [, g] of this.previewCache) {
        try {
          if (g.parent) g.parent.removeChild(g);
        } catch {
          /* ignore */
        }
        try {
          if (typeof g.destroy === 'function' && !g.destroyed) g.destroy({ children: true });
        } catch {
          /* ignore */
        }
      }
      this.previewCache.clear();
      // Also remove any stray children just in case
      if (typeof this.previewContainer.removeChildren === 'function') {
        this.previewContainer.removeChildren();
      }
    } catch (error) {
      logger.warn(
        'Failed to clear brush preview',
        { error: error.message },
        LOG_CATEGORY.RENDERING
      );
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
          rows: this.gameManager.rows,
        },
        tilesCreated: this.terrainTiles.size,
      });
    } catch (error) {
      GameErrors.rendering(error, {
        stage: 'refreshAllTerrainDisplay',
        gridDimensions: {
          cols: this.gameManager?.cols,
          rows: this.gameManager?.rows,
        },
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
        tilesCreated: this.terrainTiles.size,
      });
    } catch (error) {
      GameErrors.rendering(error, {
        stage: 'handleGridResize',
        newDimensions: { cols: newCols, rows: newRows },
        existingTiles: this.terrainTiles.size,
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
        rows: this.gameManager.rows,
      },
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
        const t = setTimeout(() => {
          if (this.terrainTiles.has(tileKey)) {
            tile.tint = originalTint;
          }
        }, 1000);
        if (typeof t?.unref === 'function') t.unref();
      }
    } catch (error) {
      logger.warn(
        'Failed to highlight terrain tile',
        {
          coordinates: { x, y },
          error: error.message,
        },
        LOG_CATEGORY.RENDERING
      );
    }
  }
}
