import { GameErrors } from '../../../utils/ErrorHandler.js';
import { LOG_CATEGORY, LOG_LEVEL, logger } from '../../../utils/Logger.js';
import { TERRAIN_CONFIG } from '../../../config/TerrainConstants.js';

/** Enqueue affected cells and trigger processing. */
export function updateTerrainDisplay(m, centerX, centerY, brushSize) {
  try {
    for (let dy = -Math.floor(brushSize / 2); dy <= Math.floor(brushSize / 2); dy++) {
      for (let dx = -Math.floor(brushSize / 2); dx <= Math.floor(brushSize / 2); dx++) {
        const x = centerX + dx;
        const y = centerY + dy;
        if (m.isValidGridPosition(x, y)) m.updateQueue.add(`${x},${y}`);
      }
    }
    processUpdateQueue(m);
  } catch (error) {
    GameErrors.rendering(error, {
      stage: 'updateTerrainDisplay',
      centerCoordinates: { x: centerX, y: centerY },
      brushSize
    });
  }
}

/** Process queued updates with throttling to maintain frame rate. */
export function processUpdateQueue(m) {
  const now = Date.now();
  if (m.isUpdating || (now - m.lastUpdateTime) < TERRAIN_CONFIG.UPDATE_THROTTLE_MS) {
    return;
  }
  m.isUpdating = true;
  m.lastUpdateTime = now;

  try {
    let updatesProcessed = 0;
    const maxUpdatesPerFrame = TERRAIN_CONFIG.BATCH_UPDATE_SIZE;
    for (const tileKey of m.updateQueue) {
      if (updatesProcessed >= maxUpdatesPerFrame) break;
      const [x, y] = tileKey.split(',').map(Number);
      m.createTerrainTile(x, y);
      m.updateQueue.delete(tileKey);
      updatesProcessed++;
    }

    if (m.updateQueue.size > 0) {
      requestAnimationFrame(() => {
        m.isUpdating = false;
        processUpdateQueue(m);
      });
    } else {
      m.isUpdating = false;
    }

    logger.log(LOG_LEVEL.TRACE, 'Terrain display update processed', LOG_CATEGORY.RENDERING, {
      context: 'TerrainManager.processUpdateQueue',
      updatesProcessed,
      remainingUpdates: m.updateQueue.size,
      processingTime: Date.now() - now
    });
  } catch (error) {
    m.isUpdating = false;
    GameErrors.rendering(error, {
      stage: 'processUpdateQueue',
      queueSize: m.updateQueue.size
    });
  }
}
