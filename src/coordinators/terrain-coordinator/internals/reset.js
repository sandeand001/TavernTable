import { logger, LOG_CATEGORY } from '../../../utils/Logger.js';
import { GameErrors } from '../../../utils/ErrorHandler.js';
import { TERRAIN_CONFIG } from '../../../config/TerrainConstants.js';
import * as biomeInternals from './biome.js';

/**
 * Reset all terrain heights to default and refresh visuals.
 * Extracted from TerrainCoordinator for better compartmentalization.
 * @param {import('../../TerrainCoordinator.js').TerrainCoordinator} c
 */
export function resetTerrain(c) {
  try {
    c.initializeTerrainData();
    if (c.dataStore?.resetAll) {
      c.dataStore.resetAll(TERRAIN_CONFIG.DEFAULT_HEIGHT);
    }

    // Repaint base grid tiles so any elevation artifacts are cleared immediately.
    const rows = Number.isInteger(c.gameManager?.rows) ? c.gameManager.rows : 0;
    const cols = Number.isInteger(c.gameManager?.cols) ? c.gameManager.cols : 0;
    if (rows > 0 && cols > 0 && typeof c.updateBaseGridTileInPlace === 'function') {
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          try {
            const updated = c.updateBaseGridTileInPlace(x, y, TERRAIN_CONFIG.DEFAULT_HEIGHT);
            if (!updated && typeof c.replaceBaseGridTile === 'function') {
              c.replaceBaseGridTile(x, y, TERRAIN_CONFIG.DEFAULT_HEIGHT);
            }
          } catch (tileError) {
            logger.debug(
              'Failed to reset base grid tile during terrain reset',
              {
                context: 'TerrainCoordinator.resetTerrain',
                coordinates: { x, y },
                error: tileError.message,
              },
              LOG_CATEGORY.RENDERING
            );
          }
        }
      }
    }

    if (c.terrainManager) {
      c.terrainManager.refreshAllTerrainDisplay();
    }

    // Ensure the 3D mesh queues a rebuild if hybrid mode is active.
    c.gameManager?.notifyTerrainHeightsChanged?.();

    // Ensure UI height indicator reflects cleared state
    if (typeof c.resetHeightIndicator === 'function') {
      c.resetHeightIndicator();
    }

    logger.info(
      'Terrain reset to default',
      {
        context: 'TerrainCoordinator.resetTerrain',
        gridDimensions: {
          cols: c.gameManager.cols,
          rows: c.gameManager.rows,
        },
        defaultHeight: TERRAIN_CONFIG.DEFAULT_HEIGHT,
      },
      LOG_CATEGORY.USER
    );

    // Outside terrain mode, synchronize biome shading state after reset
    biomeInternals.handlePostResetShading?.(c);
  } catch (error) {
    GameErrors.operation(error, {
      stage: 'resetTerrain',
      gridDimensions: {
        cols: c.gameManager?.cols,
        rows: c.gameManager?.rows,
      },
    });
    throw error;
  }
}
