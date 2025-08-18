/**
 * TileLifecycleController.js - Façade for grid tile lifecycle operations
 *
 * Non-functional extraction: delegates to TerrainCoordinator's existing
 * private methods for now. Later, logic can be migrated here safely.
 */
import { logger, LOG_CATEGORY } from '../../utils/Logger.js';
import { TERRAIN_CONFIG } from '../../config/TerrainConstants.js';

export class TileLifecycleController {
  /**
   * @param {import('../TerrainCoordinator.js').TerrainCoordinator} coordinator
   */
  constructor(coordinator) {
    this.coordinator = coordinator;
  }

  /**
   * Find grid tiles to remove around a position.
   * @param {number} x
   * @param {number} y
   */
  findGridTilesToRemove(x, y) {
    const tilesToRemove = [];
    const gridChildren = this.coordinator.gameManager.gridContainer.children || [];

    gridChildren.forEach(child => {
      if (child && child.isGridTile && child.gridX === x && child.gridY === y) {
        if (!child.destroyed) {
          tilesToRemove.push(child);
        }
      }
    });

    return tilesToRemove;
  }

  /**
   * Remove a list of tiles safely.
   * @param {any[]} tilesToRemove
   * @param {number} x
   * @param {number} y
   */
  removeGridTilesSafely(tilesToRemove, x, y) {
    tilesToRemove.forEach(tile => {
      try {
        if (this.coordinator.gameManager.gridContainer.children.includes(tile)) {
          this.coordinator.gameManager.gridContainer.removeChild(tile);
        }

        if (tile.destroy && !tile.destroyed) {
          tile.destroy();
        }
      } catch (tileRemovalError) {
        logger.warn('Error removing individual tile during replacement', {
          context: 'TileLifecycleController.removeGridTilesSafely',
          coordinates: { x, y },
          error: tileRemovalError.message
        });
      }
    });
  }

  /**
   * Create a replacement tile for given position/height.
   * @param {number} x
   * @param {number} y
   * @param {number} height
   */
  createReplacementTile(x, y, height) {
    const isEditing = !!this.coordinator.isTerrainModeActive;
    const color = isEditing
      ? this.coordinator.getColorForHeight(height)
      : this.coordinator._getBiomeOrBaseColor(height);
    const newTile = this.coordinator.gameManager.gridRenderer.drawIsometricTile(x, y, color);

    if (!newTile || newTile.destroyed) {
      throw new Error('Failed to create replacement tile');
    }

    return newTile;
  }

  /**
   * Apply visual/effect data to a new tile.
   * @param {PIXI.DisplayObject} newTile
   * @param {number} height
   * @param {number} x
   * @param {number} y
   */
  applyTileEffectsAndData(newTile, height, x, y) {
    if (height !== TERRAIN_CONFIG.DEFAULT_HEIGHT) {
      try {
        this.coordinator.addVisualElevationEffect(newTile, height);
      } catch (effectError) {
        logger.warn('Failed to add elevation effect, continuing without it', {
          context: 'TileLifecycleController.applyTileEffectsAndData',
          coordinates: { x, y },
          height,
          error: effectError.message
        });
      }
    }

    this.addBase3DFaces(newTile, x, y, height);
    newTile.terrainHeight = height;
  }

  /**
   * Log a successful tile replacement (moved from coordinator)
   */
  logTileReplacementSuccess(x, y, height, removedTileCount) {
    logger.trace('Base grid tile replaced safely', {
      context: 'TerrainCoordinator.replaceBaseGridTile',
      coordinates: { x, y },
      height,
      removedTiles: removedTileCount,
      newTileCreated: true
    }, LOG_CATEGORY.RENDERING);
  }

  /**
   * Handle tile replacement errors gracefully (moved from coordinator)
   */
  handleTileReplacementError(error, x, y, height) {
    logger.error('Error replacing base grid tile', {
      context: 'TerrainCoordinator.replaceBaseGridTile',
      coordinates: { x, y },
      height,
      error: error.message
    });
    // no-throw on purpose
  }

  /**
   * Add base 3D faces to a tile when appropriate.
   * @param {PIXI.DisplayObject} tile
   * @param {number} x
   * @param {number} y
   * @param {number} height
   */
  addBase3DFaces(tile, x, y, height) {
    try {
      if (tile.baseSideFaces && tile.parent?.children?.includes(tile.baseSideFaces)) {
        tile.parent.removeChild(tile.baseSideFaces);
        if (typeof tile.baseSideFaces.destroy === 'function' && !tile.baseSideFaces.destroyed) {
          tile.baseSideFaces.destroy();
        }
        tile.baseSideFaces = null;
      }

      if (!this.coordinator.dataStore?.base) return;

      const rows = this.coordinator.dataStore.base.length;
      const cols = this.coordinator.dataStore.base[0]?.length || 0;
      const getBase = (gx, gy) => (gx >= 0 && gy >= 0 && gy < rows && gx < cols)
        ? this.coordinator.dataStore.base[gy][gx]
        : TERRAIN_CONFIG.DEFAULT_HEIGHT;

      this.coordinator.faces.addBaseFaces(tile, x, y, height, getBase);
    } catch (e) {
      logger.warn('Failed to add base 3D faces', { coordinates: { x, y }, error: e.message }, LOG_CATEGORY.RENDERING);
    }
  }

  /**
   * Clear elevation-related artifacts from a tile (shadow, faces, overlays) and optionally reset visuals.
   * @param {any} tile - The grid tile display object
   * @param {{ resetAlpha?: boolean, resetY?: boolean }} [options]
   */
  clearTileArtifacts(tile, options = {}) {
    const { resetAlpha = false, resetY = false } = options;
    try {
      if (!tile) return;

      // Reset alpha if requested
      if (resetAlpha) {
        try { tile.alpha = 1.0; } catch (_) { /* ignore */ }
      }

      // Reset Y position to baseline if requested
      if (resetY && typeof tile.baseIsoY === 'number') {
        try { tile.y = tile.baseIsoY; } catch (_) { /* ignore */ }
      }

      // Remove shadow tile from parent and destroy
      if (tile.shadowTile && tile.parent?.children?.includes(tile.shadowTile)) {
        try {
          tile.parent.removeChild(tile.shadowTile);
          if (typeof tile.shadowTile.destroy === 'function' && !tile.shadowTile.destroyed) {
            tile.shadowTile.destroy();
          }
        } catch (_) { /* ignore */ }
        tile.shadowTile = null;
      }

      // Remove depression overlay from tile children and destroy
      if (tile.depressionOverlay) {
        try {
          if (tile.children?.includes(tile.depressionOverlay)) tile.removeChild(tile.depressionOverlay);
          if (typeof tile.depressionOverlay.destroy === 'function' && !tile.depressionOverlay.destroyed) {
            tile.depressionOverlay.destroy();
          }
        } catch (_) { /* ignore */ }
        tile.depressionOverlay = null;
      }

      // Remove base side faces from parent and destroy
      if (tile.baseSideFaces && tile.parent?.children?.includes(tile.baseSideFaces)) {
        try {
          tile.parent.removeChild(tile.baseSideFaces);
          if (typeof tile.baseSideFaces.destroy === 'function' && !tile.baseSideFaces.destroyed) {
            tile.baseSideFaces.destroy();
          }
        } catch (_) { /* ignore */ }
        tile.baseSideFaces = null;
      }
    } catch (e) {
      logger.warn('Failed to clear tile artifacts', { error: e.message }, LOG_CATEGORY.RENDERING);
    }
  }
}
