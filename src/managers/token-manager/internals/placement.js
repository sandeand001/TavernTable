import { CoordinateUtils } from '../../../utils/CoordinateUtils.js';
import { TerrainHeightUtils } from '../../../utils/TerrainHeightUtils.js';
import { logger, LOG_CATEGORY } from '../../../utils/Logger.js';
import { computeDepthKey, TYPE_BIAS, withOverlayRaise } from '../../../utils/DepthUtils.js';
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
      const depthKey = computeDepthKey(gridX, gridY, TYPE_BIAS.token);
      creature.sprite.zIndex = withOverlayRaise(c.gameManager?.terrainManager, depthKey);

      if (gridContainer) {
        gridContainer.addChild(creature.sprite);
        try {
          gridContainer.sortableChildren = true;
          gridContainer.sortChildren?.();
        } catch (_) {
          /* ignore sort errors */
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
