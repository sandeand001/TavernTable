import { logger, LOG_CATEGORY } from '../../../utils/Logger.js';
import { GameErrors } from '../../../utils/ErrorHandler.js';

export function loadBaseTerrainIntoWorkingState(c) {
  try {
    if (!c.dataStore.base) {
      logger.warn('No base terrain heights available, initializing default state', {
        context: 'TerrainCoordinator.loadBaseTerrainIntoWorkingState',
      });
      c.initializeTerrainData();
      return;
    }

    c.dataStore.loadBaseIntoWorking();

    logger.debug(
      'Base terrain loaded into working state',
      {
        context: 'TerrainCoordinator.loadBaseTerrainIntoWorkingState',
        gridDimensions: {
          cols: c.gameManager.cols,
          rows: c.gameManager.rows,
        },
      },
      LOG_CATEGORY.SYSTEM
    );
  } catch (error) {
    GameErrors.gameState(error, {
      stage: 'loadBaseTerrainIntoWorkingState',
      context: 'TerrainCoordinator.loadBaseTerrainIntoWorkingState',
    });
    throw error;
  }
}
