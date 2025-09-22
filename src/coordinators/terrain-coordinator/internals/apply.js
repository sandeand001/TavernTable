import { logger, LOG_CATEGORY } from '../../../utils/Logger.js';
import { GameErrors } from '../../../utils/ErrorHandler.js';
import { TERRAIN_CONFIG } from '../../../config/TerrainConstants.js';

export function validateApplicationRequirements(c) {
  if (!c.dataStore?.working) {
    logger.debug('Cannot apply terrain - missing working height field', {
      context: 'apply.validateApplicationRequirements',
      hasGridContainer: !!c.gameManager.gridContainer,
      hasTerrainHeights: !!c.dataStore?.working,
    });
    throw new Error('Missing requirements for terrain application');
  }
  if (!c.gameManager.gridContainer) {
    // Headless/test mode allowance: create a noop container so downstream tile update
    // calls still succeed without rendering.
    c.gameManager.gridContainer = {
      removeChildren() {},
      addChild() {},
    };
  }
}

export function initializeBaseHeights(c) {
  c.dataStore.applyWorkingToBase();
}

export function processAllGridTiles(c) {
  let modifiedTiles = 0;
  for (let y = 0; y < c.gameManager.rows; y++) {
    for (let x = 0; x < c.gameManager.cols; x++) {
      const height = c.dataStore.base[y][x];
      try {
        const updated = c.updateBaseGridTileInPlace(x, y, height);
        if (!updated) {
          c.replaceBaseGridTile(x, y, height);
        }
        if (height !== TERRAIN_CONFIG.DEFAULT_HEIGHT) {
          modifiedTiles++;
        }
      } catch (tileError) {
        logger.warn('Failed to update tile, skipping', {
          context: 'apply.processAllGridTiles',
          coordinates: { x, y },
          height,
          error: tileError.message,
        });
      }
    }
  }
  return modifiedTiles;
}

export function logCompletion(c, modifiedTiles) {
  logger.info(
    'Terrain applied permanently to base grid with safer approach',
    {
      context: 'apply.logCompletion',
      modifiedTiles,
      totalTiles: c.gameManager.rows * c.gameManager.cols,
      approach: 'safer_in_place_updates',
    },
    LOG_CATEGORY.SYSTEM
  );
}

export function handleApplicationError(error) {
  GameErrors.gameState(error, {
    stage: 'applyTerrainToBaseGrid',
    context: 'apply.handleApplicationError',
  });
  throw error;
}
