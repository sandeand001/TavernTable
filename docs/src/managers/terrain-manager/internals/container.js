import { logger, LOG_LEVEL, LOG_CATEGORY } from '../../../utils/Logger.js';
import { GameErrors } from '../../../utils/ErrorHandler.js';
import { TerrainPixiUtils } from '../../../utils/TerrainPixiUtils.js';

/** Validate terrain container state before operations. */
export function validateContainerState(m) {
  try {
    if (
      !TerrainPixiUtils.validatePixiContainer(
        m.terrainContainer,
        'terrainContainer',
        'TerrainManager.validateContainerState'
      )
    ) {
      throw new Error('Terrain container validation failed');
    }
    if (
      !TerrainPixiUtils.validatePixiContainer(
        m.gameManager?.gridContainer,
        'gridContainer',
        'TerrainManager.validateContainerState'
      )
    ) {
      throw new Error('Game grid container validation failed');
    }
    if (!m.terrainTiles) {
      throw new Error('Terrain tiles map is not initialized');
    }
    logger.log(LOG_LEVEL.DEBUG, 'Terrain container state validation passed', LOG_CATEGORY.SYSTEM, {
      context: 'TerrainManager.validateContainerState',
      terrainContainerExists: !!m.terrainContainer,
      gridContainerExists: !!m.gameManager?.gridContainer,
      tilesMapSize: m.terrainTiles.size,
      containerChildrenCount: m.terrainContainer.children.length,
    });
    return true;
  } catch (error) {
    logger.error('Terrain container state validation failed', {
      context: 'TerrainManager.validateContainerState',
      error: error.message,
      terrainContainerExists: !!m.terrainContainer,
      terrainContainerDestroyed: m.terrainContainer?.destroyed,
      gridContainerExists: !!m.gameManager?.gridContainer,
      gridContainerDestroyed: m.gameManager?.gridContainer?.destroyed,
    });
    throw error;
  }
}

/** Show all terrain tiles (when terrain mode is enabled). */
export function showAllTerrainTiles(m) {
  try {
    validateContainerState(m);
    m.terrainContainer.visible = true;
    for (let y = 0; y < m.gameManager.rows; y++) {
      for (let x = 0; x < m.gameManager.cols; x++) {
        const tileKey = `${x},${y}`;
        if (!m.terrainTiles.has(tileKey)) {
          m.createTerrainTile(x, y);
        }
      }
    }
    m.sortAllTerrainTilesByDepth();
    logger.log(LOG_LEVEL.DEBUG, 'All terrain tiles shown with depth sorting', LOG_CATEGORY.SYSTEM, {
      context: 'TerrainManager.showAllTerrainTiles',
      totalTiles: m.terrainTiles.size,
    });
  } catch (error) {
    GameErrors.rendering(error, { stage: 'showAllTerrainTiles' });
  }
}

/** Hide all terrain tiles (when terrain mode is disabled). */
export function hideAllTerrainTiles(m) {
  try {
    try {
      const children = [...m.terrainContainer.children];
      children.forEach((child) => {
        if (child && child.isTerrainTile) {
          if (child.sideFaces) {
            if (child.sideFaces.parent) child.sideFaces.parent.removeChild(child.sideFaces);
            if (typeof child.sideFaces.destroy === 'function' && !child.sideFaces.destroyed)
              child.sideFaces.destroy();
            child.sideFaces = null;
          }
          if (child.shadowTile) {
            if (child.shadowTile.parent) child.shadowTile.parent.removeChild(child.shadowTile);
            if (typeof child.shadowTile.destroy === 'function' && !child.shadowTile.destroyed)
              child.shadowTile.destroy();
            child.shadowTile = null;
          }
          if (child.depressionOverlay) {
            try {
              child.removeChild(child.depressionOverlay);
            } catch {
              /* ignore */
            }
            if (
              typeof child.depressionOverlay.destroy === 'function' &&
              !child.depressionOverlay.destroyed
            )
              child.depressionOverlay.destroy();
            child.depressionOverlay = null;
          }
        }
      });
    } catch (_) {
      /* best-effort cleanup */
    }
    m.terrainContainer.visible = false;
    logger.log(LOG_LEVEL.DEBUG, 'All terrain tiles hidden', LOG_CATEGORY.SYSTEM, {
      context: 'TerrainManager.hideAllTerrainTiles',
    });
  } catch (error) {
    GameErrors.rendering(error, { stage: 'hideAllTerrainTiles' });
  }
}

/** Clear all terrain tiles completely (for terrain mode transitions). */
export function clearAllTerrainTiles(m) {
  try {
    if (!m.terrainTiles || m.terrainTiles.size === 0) {
      logger.log(LOG_LEVEL.DEBUG, 'No terrain tiles to clear', LOG_CATEGORY.SYSTEM, {
        context: 'TerrainManager.clearAllTerrainTiles',
      });
      if (m.terrainContainer) m.terrainContainer.visible = false;
      return;
    }

    const tileCount = m.terrainTiles.size;

    try {
      m.terrainTiles.forEach((tile) => {
        if (tile && tile.sideFaces) {
          if (tile.sideFaces.parent) tile.sideFaces.parent.removeChild(tile.sideFaces);
          if (typeof tile.sideFaces.destroy === 'function' && !tile.sideFaces.destroyed)
            tile.sideFaces.destroy();
          tile.sideFaces = null;
        }
        if (tile && tile.shadowTile) {
          if (tile.shadowTile.parent) tile.shadowTile.parent.removeChild(tile.shadowTile);
          if (typeof tile.shadowTile.destroy === 'function' && !tile.shadowTile.destroyed)
            tile.shadowTile.destroy();
          tile.shadowTile = null;
        }
        if (tile && tile.depressionOverlay) {
          try {
            tile.removeChild(tile.depressionOverlay);
          } catch {
            /* ignore */
          }
          if (
            typeof tile.depressionOverlay.destroy === 'function' &&
            !tile.depressionOverlay.destroyed
          )
            tile.depressionOverlay.destroy();
          tile.depressionOverlay = null;
        }
      });
    } catch (_) {
      /* ignore */
    }

    const cleanupResults = TerrainPixiUtils.batchCleanupTerrainTiles(
      m.terrainTiles,
      m.terrainContainer,
      'TerrainManager.clearAllTerrainTiles'
    );

    m.terrainTiles.clear();
    if (m.terrainContainer) m.terrainContainer.visible = false;

    logger.log(LOG_LEVEL.INFO, 'All terrain tiles cleared completely', LOG_CATEGORY.SYSTEM, {
      context: 'TerrainManager.clearAllTerrainTiles',
      clearedTileCount: tileCount,
      cleanupResults,
    });
  } catch (error) {
    if (m.terrainTiles) m.terrainTiles.clear();
    if (m.terrainContainer) m.terrainContainer.visible = false;

    GameErrors.rendering(error, {
      stage: 'clearAllTerrainTiles',
      context: 'TerrainManager.clearAllTerrainTiles',
    });

    logger.log(LOG_LEVEL.WARN, 'Terrain tiles cleared with errors', LOG_CATEGORY.SYSTEM, {
      context: 'TerrainManager.clearAllTerrainTiles',
      error: error.message,
    });
  }
}
