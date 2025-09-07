import { logger, LOG_CATEGORY } from '../../../utils/Logger.js';
import { GameErrors } from '../../../utils/ErrorHandler.js';

/**
 * Handle grid resize - reinitialize terrain data and attempt to preserve overlap.
 * Mirrors TerrainCoordinator.handleGridResize behavior.
 */
export function handleGridResize(c, newCols, newRows) {
  try {
    // Capture old terrain data and dimensions from the data store (pre-resize)
    const oldHeights = c.dataStore?.working;
    const oldCols = c.dataStore?.cols;
    const oldRows = c.dataStore?.rows;

    // Reinitialize terrain data arrays to the new dimensions
    c.initializeTerrainData();

    // Copy over existing height data where possible (within overlap bounds)
    if (
      oldHeights &&
      Number.isInteger(oldCols) &&
      Number.isInteger(oldRows) &&
      oldCols > 0 &&
      oldRows > 0
    ) {
      const copyRows = Math.min(oldRows, newRows);
      const copyCols = Math.min(oldCols, newCols);

      for (let y = 0; y < copyRows; y++) {
        const oldRow = oldHeights[y];
        if (!Array.isArray(oldRow)) continue;
        for (let x = 0; x < copyCols; x++) {
          const val = oldRow[x];
          if (typeof val === 'number') {
            c.dataStore.working[y][x] = val;
          }
        }
      }
    }

    // If terrain mode is active, refresh the terrain overlay tiles to cover the new grid size
    if (c.terrainManager && c.isTerrainModeActive) {
      try {
        if (typeof c.terrainManager.handleGridResize === 'function') {
          c.terrainManager.handleGridResize(newCols, newRows);
        } else {
          // Fallback: refresh full terrain display
          c.terrainManager.refreshAllTerrainDisplay();
        }
      } catch (e) {
        logger.warn('Terrain display refresh after resize encountered issues', {
          context: 'TerrainCoordinator.handleGridResize',
          error: e.message,
        });
      }
    }

    logger.info(
      'Terrain data resized',
      {
        context: 'TerrainCoordinator.handleGridResize',
        oldDimensions: { cols: oldCols, rows: oldRows },
        newDimensions: { cols: newCols, rows: newRows },
        dataPreserved: !!(oldHeights && oldCols > 0 && oldRows > 0),
      },
      LOG_CATEGORY.SYSTEM
    );
  } catch (error) {
    GameErrors.operation(error, {
      stage: 'handleGridResize',
      oldDimensions: { cols: c.dataStore?.cols, rows: c.dataStore?.rows },
      newDimensions: { cols: newCols, rows: newRows },
    });
    throw error;
  }
}
