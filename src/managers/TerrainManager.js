/**
 * TerrainManager.js - Handles terrain rendering and visual management
 *
 * Extracted following single responsibility principle
 * Manages terrain tile rendering, height visualization, and display updates
 * Works in coordination with TerrainCoordinator for complete terrain system
 */

import { Container } from '../core/PixiStub.js';
import { logger, LOG_LEVEL, LOG_CATEGORY } from '../utils/logger/Logger.js';
import { GameErrors } from '../utils/error/ErrorHandler.js';
// import { GRID_CONFIG } from '../config/GameConstants.js';
import { TerrainFacesRenderer } from '../terrain/TerrainFacesRenderer.js';
import { TERRAIN_PLACEABLES } from '../config/terrain/TerrainPlaceables.js';
import { CoordinateUtils } from '../utils/coordinates/CoordinateUtils.js';
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
import {
  getColorForHeight as _getColorForHeight,
  getBorderColorForHeight as _getBorderColorForHeight,
  addElevationShadow as _addElevationShadow,
  addDepressionEffect as _addDepressionEffect,
  reapplyElevationScaleToOverlay as _reapplyElevationScale,
} from './terrain-manager/internals/elevation.js';
import {
  ensurePreviewLayerOnTop as _ensurePreview,
  renderBrushPreview as _renderBrushPreview,
  clearBrushPreview as _clearBrushPreview,
} from './terrain-manager/internals/preview.js';

export class TerrainManager {
  // ── Constructor ─────────────────────────────────────────────

  constructor(gameManager, terrainCoordinator) {
    this.gameManager = gameManager;
    this.terrainCoordinator = terrainCoordinator;
    this.facesRenderer = new TerrainFacesRenderer(gameManager);

    // Containers for terrain rendering
    this.terrainContainer = null;
    this.terrainTiles = new Map(); // Map of "x,y" -> Graphics terrain tile
    // Preview overlay for brush footprint highlighting (non-destructive)
    this.previewContainer = null;
    this.previewCache = new Map(); // Map of "x,y" -> Graphics preview diamond
    // Per-tile placeable items (paths, structures)
    this.placeables = new Map(); // Map of "x,y" -> Array<Sprite>

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

  // ── Public API ──────────────────────────────────────────────

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

  // ── Lifecycle ───────────────────────────────────────────────

  /**
   * Initialize terrain rendering system
   */
  initialize() {
    try {
      // Create terrain container - positioned above grid tiles
      this.terrainContainer = new Container();
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
      this.previewContainer = new Container();
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
    return _ensurePreview(this);
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
      const requestedId = placeableId;
      const tileKey = `${x},${y}`;
      const getTileEntries = () => {
        const map = this.placeables;
        if (!map || typeof map.get !== 'function') return null;
        return map.get(tileKey) || null;
      };
      const beforeList = getTileEntries();
      const beforeCount = Array.isArray(beforeList) ? beforeList.length : 0;
      // Family indirection: if a virtual plant-family id is selected, choose a random concrete variant each click.
      if (typeof placeableId === 'string') {
        const famDef = TERRAIN_PLACEABLES[placeableId];
        if (famDef?.type === 'plant-family' && Array.isArray(famDef.familyVariants)) {
          const variants = famDef.familyVariants.filter(Boolean);
          if (variants.length) {
            placeableId = variants[Math.floor(Math.random() * variants.length)];
          }
        }
      }
      const preResolvedId = placeableId;
      const result = _placeItem(this, placeableId, x, y);
      const success = !!result;
      const afterList = getTileEntries();
      let resolvedId = preResolvedId;
      let placedRecord = null;
      let treePlacement = false;
      if (success && Array.isArray(afterList) && afterList.length) {
        const candidate = afterList[afterList.length - 1];
        if (candidate) {
          resolvedId =
            (typeof candidate.placeableId === 'string' && candidate.placeableId) ||
            (typeof candidate.id === 'string' && candidate.id) ||
            resolvedId;
          const candidateType =
            typeof candidate.placeableType === 'string'
              ? candidate.placeableType
              : typeof resolvedId === 'string'
                ? TERRAIN_PLACEABLES[resolvedId]?.type
                : null;
          treePlacement = candidateType === 'plant';
          placedRecord = candidate;
          if (treePlacement && typeof candidate === 'object') {
            try {
              candidate.__debugTreePlacement = true;
              candidate.__debugTreeId = resolvedId;
              candidate.__debugRequestedId = requestedId;
              candidate.__debugPlacedAt = Date.now();
            } catch (_) {
              /* ignore debug flag failures */
            }
          }
        }
      } else {
        const fallbackType =
          typeof resolvedId === 'string' ? TERRAIN_PLACEABLES[resolvedId]?.type : null;
        treePlacement = fallbackType === 'plant';
      }
      logger.log(LOG_LEVEL.DEBUG, 'placeTerrainItem attempt', LOG_CATEGORY.RENDERING, {
        x,
        y,
        requestedId,
        placeableId: resolvedId,
        resolvedId,
        success,
        treePlacement,
        beforeCount,
        afterCount: Array.isArray(afterList) ? afterList.length : null,
      });
      // Retrofit instancing path disabled (duplicate risk). If ever needed again, guard behind feature flag.
      // if (result && this.gameManager?.features?.retrofitInstancing) { /* legacy disabled code */ }
      if (!success) {
        // Lightweight diagnostics for common rejection reasons so UI traces are useful
        let reason = 'rejected_by_rules';
        try {
          if (
            this.placeables &&
            this.placeables.has(tileKey) &&
            this.placeables.get(tileKey).some((p) => p.placeableType === 'structure')
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
          requestedId,
          placeableId: resolvedId,
          reason,
        });
        return false;
      }
      return {
        success: true,
        requestedId,
        resolvedId,
        treePlacement,
        record: placedRecord,
      };
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

  // ── Private Helpers ─────────────────────────────────────────

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
   * @returns {Graphics} Created terrain tile graphics
   */
  _createBaseTerrainGraphics(x, y, height) {
    return _createBase(this, x, y, height);
  }

  /**
   * DECOMPOSED METHOD: Apply styling to terrain tile
   * @private
   * @param {Graphics} terrainTile - Terrain tile to style
   * @param {number} height - Terrain height
   */
  _applyTerrainStyling(terrainTile, height) {
    return _applyStyle(this, terrainTile, height);
  }

  /**
   * DECOMPOSED METHOD: Position terrain tile in isometric space
   * @private
   * @param {Graphics} terrainTile - Terrain tile to position
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
   * @param {Graphics} terrainTile - Terrain tile for effects
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
   * @param {Graphics} terrainTile - Terrain tile to finalize
   * @param {number} x - Grid X coordinate
   * @param {number} y - Grid Y coordinate
   * @param {string} tileKey - Tile key for storage
   */
  _finalizeTerrainTile(terrainTile, x, y, tileKey) {
    return _finalizeTile(this, terrainTile, x, y, tileKey);
  }

  // ── Public API (Rendering) ─────────────────────────────────

  /**
   * Get color for terrain height
   * @param {number} height - Terrain height
   * @returns {number} Hex color value
   */
  getColorForHeight(height) {
    return _getColorForHeight(this, height);
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
    return _getBorderColorForHeight(this, height);
  }

  //

  /**
   * Add shadow effect for elevated terrain
   * @param {Graphics} terrainTile - The terrain tile graphics
   * @param {number} height - Height level (positive)
   * @param {number} x - Grid X coordinate
   * @param {number} y - Grid Y coordinate
   */
  addElevationShadow(terrainTile, height, x, y) {
    return _addElevationShadow(this, terrainTile, height, x, y);
  }

  /**
   * Add darkening effect for depressed terrain
   * @param {Graphics} terrainTile - The terrain tile graphics
   * @param {number} height - Height level (negative)
   */
  addDepressionEffect(terrainTile, height) {
    return _addDepressionEffect(this, terrainTile, height);
  }

  /**
   * Add terrain tile to container with proper depth sorting for isometric rendering
   * Ensures tiles further from viewer (higher x+y values) appear behind closer tiles
   * @param {Graphics} terrainTile - The terrain tile to add
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
    return _reapplyElevationScale(this);
  }

  /**
   * Render a non-destructive preview highlight for a set of grid cells.
   * Clears any previous preview before drawing the new one.
   * @param {Array<{x:number,y:number}>} cells
   */
  renderBrushPreview(cells, options = {}) {
    return _renderBrushPreview(this, cells, options);
  }

  /** Clear any existing brush preview graphics. */
  clearBrushPreview(options = {}) {
    return _clearBrushPreview(this, options);
  }

  // ── Cleanup ────────────────────────────────────────────────

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

// NFC NOTE (2025-09-19): TerrainManager marked orphan by heuristic export/import scan.
// It is instantiated indirectly by coordinators / global setup sequences. Keep as-is until
// a constructor injection refactor normalizes manager lifecycles.
