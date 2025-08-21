import { logger, LOG_CATEGORY } from '../../../utils/Logger.js';
import { GRID_CONFIG } from '../../../config/GameConstants.js';
import { TERRAIN_CONFIG } from '../../../config/TerrainConstants.js';
import { traceDiamondPath } from '../../../utils/PixiShapeUtils.js';

/**
 * Update base grid tile in-place without destruction (safer), extracted from TerrainCoordinator.
 * @returns {boolean} True if updated successfully, false if replacement needed
 */
export function updateBaseGridTileInPlace(c, x, y, height) {
  try {
    // Find existing base grid tile at this position
    let existingTile = null;
    const children = c.gameManager.gridContainer?.children || [];
    children.forEach(child => {
      if (child?.isGridTile && child.gridX === x && child.gridY === y) {
        existingTile = child;
      }
    });

    if (!existingTile) {
      return false; // No existing tile to update, need replacement
    }

    // Always reset to baseline before redrawing/applying effects to avoid cumulative offsets
    if (typeof existingTile.baseIsoY === 'number') {
      existingTile.y = existingTile.baseIsoY;
    }

    // If there is an existing shadow from a previous non-default height, remove it
    if (existingTile.shadowTile && existingTile.parent?.children?.includes(existingTile.shadowTile)) {
      existingTile.parent.removeChild(existingTile.shadowTile);
      if (typeof existingTile.shadowTile.destroy === 'function' && !existingTile.shadowTile.destroyed) {
        existingTile.shadowTile.destroy();
      }
      existingTile.shadowTile = null;
    }
    // Remove any existing base 3D faces
    if (existingTile.baseSideFaces && existingTile.parent?.children?.includes(existingTile.baseSideFaces)) {
      existingTile.parent.removeChild(existingTile.baseSideFaces);
      if (typeof existingTile.baseSideFaces.destroy === 'function' && !existingTile.baseSideFaces.destroyed) {
        existingTile.baseSideFaces.destroy();
      }
      existingTile.baseSideFaces = null;
    }

    // Decide styling based on whether terrain mode is active
    const isEditing = !!c.isTerrainModeActive;
    const fillColor = isEditing ? c.getColorForHeight(height) : c._getBiomeOrBaseColor(height);
    const borderColor = GRID_CONFIG.TILE_BORDER_COLOR;
    const borderAlpha = GRID_CONFIG.TILE_BORDER_ALPHA;
    const fillAlpha = isEditing ? 0.8 : 1.0;

    // Clear and redraw the tile graphics content
    existingTile.clear();
    existingTile.lineStyle(1, borderColor, borderAlpha);
    existingTile.beginFill(fillColor, fillAlpha);
    // Redraw diamond shape
    traceDiamondPath(existingTile, c.gameManager.tileWidth, c.gameManager.tileHeight);
    existingTile.endFill();

    // Update tile properties
    existingTile.terrainHeight = height;

    // Apply elevation effect if needed (position only); visuals remain base color when not editing
    if (height !== TERRAIN_CONFIG.DEFAULT_HEIGHT) {
      c.addVisualElevationEffect(existingTile, height);
    } else if (typeof existingTile.baseIsoY === 'number') {
      // Ensure baseline when default height
      existingTile.y = existingTile.baseIsoY;
    }

    // Always attempt to add neighbor-aware base faces (3D walls)
    // Faces will only render when this tile is higher than a neighbor (including height 0 over negative)
    c._tileLifecycle.addBase3DFaces(existingTile, x, y, height);

    return true; // Successfully updated in-place
  } catch (error) {
    logger.debug('In-place tile update failed, will use replacement', {
      context: 'TerrainCoordinator.updateBaseGridTileInPlace',
      coordinates: { x, y },
      height,
      error: error.message
    }, LOG_CATEGORY.RENDERING);
    return false; // Update failed, caller should use replacement
  }
}

/** Replace a base grid tile with terrain-modified version (enhanced safety), extracted from TerrainCoordinator. */
export function replaceBaseGridTile(c, x, y, height) {
  try {
    const tilesToRemove = c._tileLifecycle.findGridTilesToRemove(x, y);
    c._tileLifecycle.removeGridTilesSafely(tilesToRemove, x, y);
    const newTile = c._tileLifecycle.createReplacementTile(x, y, height);
    c._tileLifecycle.applyTileEffectsAndData(newTile, height, x, y);
    c._tileLifecycle.logTileReplacementSuccess(x, y, height, tilesToRemove.length);
  } catch (error) {
    c._tileLifecycle.handleTileReplacementError(error, x, y, height);
  }
}
