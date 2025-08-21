import { CoordinateUtils } from '../../../utils/CoordinateUtils.js';
import { TerrainHeightUtils } from '../../../utils/TerrainHeightUtils.js';

/**
 * Hit test an isometric diamond at grid cell (gx, gy) against a local point (lx, ly),
 * accounting for elevation offset so the test matches the visually shifted tile.
 * Extracted from InteractionManager.
 */
export function isPointInCellDiamond(c, gx, gy, lx, ly) {
  const baseX = (gx - gy) * (c.gameManager.tileWidth / 2);
  const baseY = (gx + gy) * (c.gameManager.tileHeight / 2);

  let elevOffset = 0;
  try {
    const h = c.gameManager?.terrainCoordinator?.dataStore?.get(gx, gy) ?? 0;
    if (Number.isFinite(h)) {
      elevOffset = TerrainHeightUtils.calculateElevationOffset(h);
    }
  } catch (_) { /* ignore data lookup failure */ }

  const cx = baseX + (c.gameManager.tileWidth / 2);
  const cy = baseY + (c.gameManager.tileHeight / 2) + elevOffset;
  const dx = Math.abs(lx - cx);
  const dy = Math.abs(ly - cy);
  const halfW = c.gameManager.tileWidth / 2;
  const halfH = c.gameManager.tileHeight / 2;
  return (dx / halfW + dy / halfH) <= 1;
}

/**
 * Pick the topmost grid cell under local pointer, considering elevation and depth order.
 * Returns { gridX, gridY } or null. Extracted from InteractionManager.
 */
export function pickTopmostGridCellAt(c, localX, localY) {
  const gc = c.gameManager.gridContainer;
  if (!gc) return null;

  const hitTileTop = (tile) => {
    const isGridTop = tile.isGridTile === true;
    const isTerrainTop = tile.isTerrainTile === true;
    if (!isGridTop && !isTerrainTop) return false;
    const halfW = c.gameManager.tileWidth / 2;
    const halfH = c.gameManager.tileHeight / 2;
    const cx = tile.x + halfW;
    let baseY = isGridTop && typeof tile.baseIsoY === 'number' ? tile.baseIsoY : tile.y;
    if (isGridTop) {
      try {
        const h = c.gameManager?.terrainCoordinator?.dataStore?.get(tile.gridX, tile.gridY) ?? 0;
        if (Number.isFinite(h) && h !== 0) {
          baseY += TerrainHeightUtils.calculateElevationOffset(h);
        }
      } catch (_) { /* ignore elevation lookup */ }
    }
    const cy = baseY + halfH;
    const dx = Math.abs(localX - cx);
    const dy = Math.abs(localY - cy);
    return (dx / halfW + dy / halfH) <= 1;
  };

  const terrainContainer = c.gameManager?.terrainCoordinator?.terrainManager?.terrainContainer;
  if (terrainContainer && terrainContainer.visible && terrainContainer.children && terrainContainer.children.length) {
    const terrainTops = terrainContainer.children
      .filter(t => t && t.visible && t.isTerrainTile === true && t.isOverlayFace !== true && t.isShadowTile !== true)
      .sort((a, b) => (b.zIndex || 0) - (a.zIndex || 0));
    for (const t of terrainTops) {
      if (hitTileTop(t)) {
        return { gridX: t.gridX, gridY: t.gridY };
      }
    }
  }

  const gridTops = gc.children
    .filter(ch => ch && ch.visible && ch.isGridTile === true)
    .sort((a, b) => (b.zIndex || 0) - (a.zIndex || 0));
  for (const tile of gridTops) {
    if (hitTileTop(tile)) {
      return { gridX: tile.gridX, gridY: tile.gridY };
    }
  }

  const coarse = c.convertToGridCoordinates({ localX, localY });
  if (!c.isValidGridPosition(coarse)) return null;

  const candidates = [];
  const pushIfValid = (gx, gy) => {
    if (CoordinateUtils.isValidGridPosition(gx, gy, c.gameManager.cols, c.gameManager.rows)) {
      candidates.push({ gx, gy });
    }
  };
  pushIfValid(coarse.gridX, coarse.gridY);
  pushIfValid(coarse.gridX + 1, coarse.gridY);
  pushIfValid(coarse.gridX - 1, coarse.gridY);
  pushIfValid(coarse.gridX, coarse.gridY + 1);
  pushIfValid(coarse.gridX, coarse.gridY - 1);
  pushIfValid(coarse.gridX + 1, coarse.gridY + 1);
  pushIfValid(coarse.gridX - 1, coarse.gridY - 1);
  pushIfValid(coarse.gridX + 1, coarse.gridY - 1);
  pushIfValid(coarse.gridX - 1, coarse.gridY + 1);

  const halfW = c.gameManager.tileWidth / 2;
  const halfH = c.gameManager.tileHeight / 2;
  let best = null;
  let bestScore = Infinity;
  for (const can of candidates) {
    const baseX = (can.gx - can.gy) * halfW;
    const baseY = (can.gx + can.gy) * halfH;
    let elev = 0;
    try {
      const h = c.gameManager?.terrainCoordinator?.dataStore?.get(can.gx, can.gy) ?? 0;
      if (Number.isFinite(h)) elev = TerrainHeightUtils.calculateElevationOffset(h);
    } catch (_) { /* ignore elevation lookup */ }
    const cx = baseX + halfW;
    const cy = baseY + halfH + elev;
    const dx = Math.abs(localX - cx);
    const dy = Math.abs(localY - cy);
    const norm = (dx / halfW + dy / halfH);
    if (norm < bestScore) {
      bestScore = norm;
      best = can;
    }
  }

  if (best) {
    return { gridX: best.gx, gridY: best.gy };
  }
  return null;
}
