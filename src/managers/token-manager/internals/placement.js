import { CoordinateUtils } from '../../../utils/CoordinateUtils.js';
import { TerrainHeightUtils } from '../../../utils/TerrainHeightUtils.js';
import { logger, LOG_CATEGORY } from '../../../utils/Logger.js';
// Depth utils no longer used for rendering order; we align to tile depth bands.
import { ErrorHandler, ERROR_SEVERITY, ERROR_CATEGORY } from '../../../utils/ErrorHandler.js';

export function placeNewToken(c, gridX, gridY, gridContainer) {
  try {
    const hasBlockingPlaceable = (gx, gy) => {
      try {
        const tm = c?.gameManager?.terrainManager;
        const map = tm?.placeables;
        if (!map || !map.size) return false;
        const key = `${gx},${gy}`;
        if (!map.has(key)) return false;
        const list = map.get(key);
        if (!Array.isArray(list)) return false;
        return list.some(
          (p) => p && (p.placeableType === 'plant' || p.placeableType === 'structure')
        );
      } catch (_) {
        return false;
      }
    };
    // Prevent placing a new token on a cell that's already occupied
    try {
      const existing =
        typeof c.findExistingTokenAt === 'function' ? c.findExistingTokenAt(gridX, gridY) : null;
      if (existing || hasBlockingPlaceable(gridX, gridY)) {
        logger.debug(
          'Attempted to place token on occupied/blocked tile; aborting placement',
          { gridX, gridY },
          LOG_CATEGORY.USER
        );
        return; // do not place when occupied
      }

      // Also prevent placing tokens on tiles that contain blocking placeables (trees/plants or structures)
      const placeables = c.gameManager?.terrainManager?.placeables;
      if (placeables && placeables.has(`${gridX},${gridY}`)) {
        const list = placeables.get(`${gridX},${gridY}`) || [];
        const blocked = list.some(
          (p) => p && (p.placeableType === 'plant' || p.placeableType === 'structure')
        );
        if (blocked) {
          logger.debug(
            'Attempted to place token on tile with a blocking placeable; aborting placement',
            { gridX, gridY },
            LOG_CATEGORY.USER
          );
          return; // disallow overlapping trees/structures
        }
      }
    } catch (_) {
      /* ignore selection errors and proceed */
    }

    const creature = c.createCreatureByType(c.selectedTokenType);
    if (!creature) {
      return;
    }

    const iso = CoordinateUtils.gridToIsometric(
      gridX,
      gridY,
      c.gameManager.tileWidth,
      c.gameManager.tileHeight
    );

    let elevationOffset = 0;
    try {
      const height = c.gameManager?.terrainCoordinator?.dataStore?.get(gridX, gridY) ?? 0;
      elevationOffset = TerrainHeightUtils.calculateElevationOffset(height);
    } catch (_) {
      /* ignore */
    }

    if (creature.sprite) {
      creature.sprite.x = iso.x;
      creature.sprite.y = iso.y + elevationOffset;
      // Attach token to terrainContainer so elevated front tiles can occlude it properly.
      const tContainer = c.gameManager?.terrainManager?.terrainContainer || gridContainer;
      if (tContainer) {
        try {
          if (creature.sprite.parent && creature.sprite.parent !== tContainer) {
            creature.sprite.parent.removeChild(creature.sprite);
          }
          tContainer.addChild(creature.sprite);
        } catch (_) {
          /* ignore */
        }
        // depthValue pattern from tiles: depth*100 + offset (tiles use +20, faces +5, placeables 32-45)
        const depth = gridX + gridY;
        creature.sprite.depthValue = depth;
        creature.sprite.zIndex = depth * 100 + 70; // token band
        try {
          tContainer.sortableChildren = true;
          tContainer.sortChildren?.();
        } catch (_) {
          /* ignore */
        }
      }
    }

    c.addTokenToCollection(creature, gridX, gridY);
  } catch (error) {
    const errorHandler = new ErrorHandler();
    errorHandler.handle(error, ERROR_SEVERITY.ERROR, ERROR_CATEGORY.TOKEN, {
      stage: 'placeNewToken',
      coordinates: { gridX, gridY },
    });
  }
}
