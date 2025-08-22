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

        if (c.terrainManager) {
            c.terrainManager.refreshAllTerrainDisplay();
        }

        // Ensure UI height indicator reflects cleared state
        if (typeof c.resetHeightIndicator === 'function') {
            c.resetHeightIndicator();
        }

        logger.info('Terrain reset to default', {
            context: 'TerrainCoordinator.resetTerrain',
            gridDimensions: {
                cols: c.gameManager.cols,
                rows: c.gameManager.rows
            },
            defaultHeight: TERRAIN_CONFIG.DEFAULT_HEIGHT
        }, LOG_CATEGORY.USER);

        // Outside terrain mode, synchronize biome shading state after reset
        biomeInternals.handlePostResetShading?.(c);
    } catch (error) {
        GameErrors.operation(error, {
            stage: 'resetTerrain',
            gridDimensions: {
                cols: c.gameManager?.cols,
                rows: c.gameManager?.rows
            }
        });
        throw error;
    }
}
