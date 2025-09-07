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
      brushSize,
    });
  }
}

/** Process queued updates with throttling to maintain frame rate. */
export function processUpdateQueue(m) {
  const now = Date.now();
  // If an update cycle is ongoing, let it continue; it will schedule itself.
  if (m.isUpdating) return;

  const elapsed = now - m.lastUpdateTime;
  const throttleMs = TERRAIN_CONFIG.UPDATE_THROTTLE_MS;
  if (elapsed < throttleMs) {
    // We're throttled: schedule a single deferred attempt instead of returning silently.
    const remaining = throttleMs - elapsed;
    if (!m._throttleTimer) {
      m._throttleTimer = setTimeout(
        () => {
          m._throttleTimer = null;
          processUpdateQueue(m);
        },
        Math.max(0, remaining)
      );
      if (typeof m._throttleTimer.unref === 'function') m._throttleTimer.unref();
    }
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
      processingTime: Date.now() - now,
    });
  } catch (error) {
    m.isUpdating = false;
    GameErrors.rendering(error, {
      stage: 'processUpdateQueue',
      queueSize: m.updateQueue.size,
    });
  }
}

/**
 * Flush all pending terrain updates immediately, bypassing throttle and batching.
 * Useful to complete any remaining visual updates at the end of a drag so
 * there is no perceived lingering.
 */
export function flushUpdateQueue(m) {
  try {
    // Cancel any scheduled throttled attempt
    if (m._throttleTimer) {
      try {
        clearTimeout(m._throttleTimer);
      } catch {
        /* ignore */
      }
      m._throttleTimer = null;
    }
    // If another cycle is running, let it finish; otherwise drain now
    if (m.isUpdating) return;
    m.isUpdating = true;
    const started = Date.now();
    for (const tileKey of Array.from(m.updateQueue)) {
      const [x, y] = tileKey.split(',').map(Number);
      m.createTerrainTile(x, y);
      m.updateQueue.delete(tileKey);
    }
    m.isUpdating = false;
    m.lastUpdateTime = Date.now();
    logger.log(LOG_LEVEL.TRACE, 'Terrain display flush complete', LOG_CATEGORY.RENDERING, {
      context: 'TerrainManager.flushUpdateQueue',
      remainingUpdates: m.updateQueue.size,
      processingTime: Date.now() - started,
    });
  } catch (error) {
    m.isUpdating = false;
    GameErrors.rendering(error, {
      stage: 'flushUpdateQueue',
      queueSize: m.updateQueue?.size ?? -1,
    });
  }
}
