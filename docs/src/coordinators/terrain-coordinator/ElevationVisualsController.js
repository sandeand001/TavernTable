import { logger, LOG_CATEGORY } from '../../utils/Logger.js';
import { TERRAIN_CONFIG } from '../../config/TerrainConstants.js';
import { TerrainHeightUtils } from '../../utils/TerrainHeightUtils.js';
import { traceDiamondPath } from '../../utils/PixiShapeUtils.js';

/**
 * ElevationVisualsController - Encapsulates height-based visual effects on tiles.
 * Delegated by TerrainCoordinator.addVisualElevationEffect to keep behavior identical.
 */
export class ElevationVisualsController {
  constructor(coordinator) {
    this.c = coordinator;
  }

  /**
   * Add visual elevation effect to a tile based on height
   * @param {PIXI.Graphics} tile - The tile graphics object
   * @param {number} height - The terrain height
   */
  addVisualElevationEffect(tile, height) {
    try {
      if (typeof tile.baseIsoY === 'number') {
        tile.y = tile.baseIsoY;
      }
      const elevationOffset = TerrainHeightUtils.calculateElevationOffset(height);
      tile.y += elevationOffset;

      if (height > TERRAIN_CONFIG.DEFAULT_HEIGHT) {
        tile.lineStyle(TERRAIN_CONFIG.HEIGHT_BORDER_WIDTH, 0xffffff, 0.3);
      } else if (height < TERRAIN_CONFIG.DEFAULT_HEIGHT) {
        tile.lineStyle(TERRAIN_CONFIG.HEIGHT_BORDER_WIDTH, 0x000000, 0.3);
      }

      if (tile.shadowTile && tile.parent?.children?.includes(tile.shadowTile)) {
        tile.parent.removeChild(tile.shadowTile);
        if (typeof tile.shadowTile.destroy === 'function' && !tile.shadowTile.destroyed) {
          tile.shadowTile.destroy();
        }
        tile.shadowTile = null;
      }

      if (tile.sideFaces && tile.parent?.children?.includes(tile.sideFaces)) {
        tile.parent.removeChild(tile.sideFaces);
        if (typeof tile.sideFaces.destroy === 'function' && !tile.sideFaces.destroyed) {
          tile.sideFaces.destroy();
        }
        tile.sideFaces = null;
      }

      if (Math.abs(height) > 1) {
        const shadowAlpha = Math.min(Math.abs(height) * 0.1, 0.4);
        const shadowColor = height > 0 ? 0x000000 : 0x444444;
        const shadow = new PIXI.Graphics();
        shadow.beginFill(shadowColor, shadowAlpha);
        const tileWidth = this.c.gameManager.tileWidth;
        const tileHeight = this.c.gameManager.tileHeight;
        traceDiamondPath(shadow, tileWidth, tileHeight);
        shadow.endFill();
        shadow.x = tile.x + 2;
        shadow.y = tile.y + 2;
        if (tile.parent) {
          try {
            const hasGetChildIndex = typeof tile.parent.getChildIndex === 'function';
            const hasAddChildAt = typeof tile.parent.addChildAt === 'function';
            if (hasGetChildIndex && hasAddChildAt) {
              const tileIndex = tile.parent.getChildIndex(tile);
              tile.parent.addChildAt(shadow, Math.max(0, tileIndex));
              tile.shadowTile = shadow;
            }
          } catch (_) {
            /* best-effort: skip shadow insertion if container API unavailable */
          }
        }
      }
    } catch (error) {
      logger.debug(
        'Error adding visual elevation effect',
        {
          context: 'TerrainCoordinator.addVisualElevationEffect',
          height,
          error: error.message,
        },
        LOG_CATEGORY.RENDERING
      );
    }
  }
}
