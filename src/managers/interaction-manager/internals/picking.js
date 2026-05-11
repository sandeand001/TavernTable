import { CoordinateUtils } from '../../../utils/coordinates/CoordinateUtils.js';
import { TerrainHeightUtils } from '../../../utils/terrain/TerrainHeightUtils.js';

// ── Diamond Hit Testing ────────────────────────────────────────

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
  } catch (_) {
    /* ignore data lookup failure */
  }

  const cx = baseX + c.gameManager.tileWidth / 2;
  const cy = baseY + c.gameManager.tileHeight / 2 + elevOffset;
  const dx = Math.abs(lx - cx);
  const dy = Math.abs(ly - cy);
  const halfW = c.gameManager.tileWidth / 2;
  const halfH = c.gameManager.tileHeight / 2;
  return dx / halfW + dy / halfH <= 1;
}

// ── Topmost Cell Picking ───────────────────────────────────────

/**
 * Pick the topmost grid cell under local pointer, considering elevation and depth order.
 * Returns { gridX, gridY } or null. Extracted from InteractionManager.
 */
export function pickTopmostGridCellAt(c, localX, localY) {
  const hitTileTop = (tile) => {
    const isTerrainTop = tile.isTerrainTile === true;
    if (!isTerrainTop) return false;
    const halfW = c.gameManager.tileWidth / 2;
    const halfH = c.gameManager.tileHeight / 2;
    const cx = tile.x + halfW;
    const cy = tile.y + halfH;
    const dx = Math.abs(localX - cx);
    const dy = Math.abs(localY - cy);
    return dx / halfW + dy / halfH <= 1;
  };

  const terrainContainer = c.gameManager?.terrainCoordinator?.terrainManager?.terrainContainer;
  if (
    terrainContainer &&
    terrainContainer.visible &&
    terrainContainer.children &&
    terrainContainer.children.length
  ) {
    const terrainTops = terrainContainer.children
      .filter(
        (t) =>
          t &&
          t.visible &&
          t.isTerrainTile === true &&
          t.isOverlayFace !== true &&
          t.isShadowTile !== true
      )
      .sort((a, b) => (b.zIndex || 0) - (a.zIndex || 0));
    for (const t of terrainTops) {
      if (hitTileTop(t)) {
        return { gridX: t.gridX, gridY: t.gridY };
      }
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
    } catch (_) {
      /* ignore elevation lookup */
    }
    const cx = baseX + halfW;
    const cy = baseY + halfH + elev;
    const dx = Math.abs(localX - cx);
    const dy = Math.abs(localY - cy);
    const norm = dx / halfW + dy / halfH;
    // Only accept candidates where the pointer is inside the isometric diamond.
    // This prevents clicks on side faces, overlay tiles, or nearby sprites from
    // selecting an adjacent cell. If no candidate qualifies, the function
    // will return null which prevents accidental placement.
    if (norm <= 1 && norm < bestScore) {
      bestScore = norm;
      best = can;
    }
  }

  if (best) {
    return { gridX: best.gx, gridY: best.gy };
  }
  return null;
}
