import { TERRAIN_CONFIG } from '../../../config/TerrainConstants.js';
import { GameErrors } from '../../../utils/ErrorHandler.js';
import { logger, LOG_CATEGORY } from '../../../utils/Logger.js';

export function initializeTerrainData(c) {
    try {
        const cols = c.gameManager.cols;
        const rows = c.gameManager.rows;

        if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols <= 0 || rows <= 0) {
            throw new Error(`Invalid grid dimensions: ${cols}x${rows}`);
        }

        c.dataStore.resize(cols, rows);

        logger.debug('Terrain data initialized', {
            context: 'TerrainCoordinator.initializeTerrainData',
            stage: 'data_initialization',
            gridDimensions: { cols, rows },
            totalCells: cols * rows,
            defaultHeight: TERRAIN_CONFIG.DEFAULT_HEIGHT,
            dataStructure: 'complete'
        }, LOG_CATEGORY.SYSTEM);
    } catch (error) {
        GameErrors.initialization(error, {
            stage: 'initializeTerrainData',
            gridDimensions: {
                cols: c.gameManager?.cols,
                rows: c.gameManager?.rows
            }
        });
        throw error;
    }
}
