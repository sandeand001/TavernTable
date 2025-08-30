import { CoordinateUtils } from '../../../utils/CoordinateUtils.js';
import { TerrainHeightUtils } from '../../../utils/TerrainHeightUtils.js';
import { logger, LOG_CATEGORY } from '../../../utils/Logger.js';
import { ErrorHandler, ERROR_SEVERITY, ERROR_CATEGORY } from '../../../utils/ErrorHandler.js';

export function placeNewToken(c, gridX, gridY, gridContainer) {
  try {
    // Prevent placing a new token on a cell that's already occupied
    try {
      const existing =
        typeof c.findExistingTokenAt === 'function' ? c.findExistingTokenAt(gridX, gridY) : null;
      if (existing) {
        logger.debug(
          'Attempted to place token on occupied tile; aborting placement',
          { gridX, gridY },
          LOG_CATEGORY.USER
        );
        return; // do not place when occupied
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
      creature.sprite.zIndex = (gridX + gridY) * 100 + 1;

      if (gridContainer) {
        gridContainer.addChild(creature.sprite);
        try {
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
