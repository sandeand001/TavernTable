// Placeable positioning helpers extracted from placeables.js (Phase 8).
// Handles isometric coordinate mapping, elevation offsets, and z-index assignment.

import { TERRAIN_PLACEABLES } from '../../../config/terrain/TerrainPlaceables.js';
import { CoordinateUtils } from '../../../utils/coordinates/CoordinateUtils.js';
import { TerrainHeightUtils } from '../../../utils/terrain/TerrainHeightUtils.js';

// ── Coordinate Helpers ──────────────────────────────────────────

/**
 * Compute isometric center for a grid cell using current tile dimensions.
 * @private
 */
function _isoCenterForCell(m, gx, gy) {
  return CoordinateUtils.gridToIsometric(gx, gy, m.gameManager.tileWidth, m.gameManager.tileHeight);
}

// ── Single Sprite Repositioning ───────────────────────────────

/**
 * Reposition a single placeable sprite using current grid position and terrain height.
 * Ensures bottom-center anchoring, elevation offset, per-asset baseline offset, and z-index.
 */
export function repositionPlaceableSprite(m, sprite) {
  if (!sprite) return;
  if (sprite.__is3DPlaceable && !sprite.__threeModel) {
    // Instanced billboard/ground cards are managed by the mesh pool; height resync handled centrally.
    return;
  }
  // PURE 3D MODEL RECORD (no sprite texture data)
  if (sprite.__threeModel && !sprite.texture) {
    try {
      const gm = m.gameManager;
      const model = sprite.__threeModel;
      const gx = Number(sprite.gridX);
      const gy = Number(sprite.gridY);
      let terrainH = 0;
      try {
        terrainH = (gm.getTerrainHeight?.(gx, gy) || 0) * gm.spatial.elevationUnit;
      } catch (_) {
        /* ignore */
      }
      const offset = Number.isFinite(sprite.__groundOffset) ? sprite.__groundOffset : 0;
      model.position.y = terrainH + offset;
    } catch (_) {
      /* ignore model reposition */
    }
    return;
  }
  // Ensure parent is the terrainContainer so elevated tile faces can occlude sprites behind them
  try {
    const tContainer = m.terrainContainer;
    if (tContainer && sprite.parent !== tContainer) {
      if (sprite.parent) sprite.parent.removeChild(sprite);
      tContainer.addChild(sprite);
    }
  } catch (_) {
    /* ignore */
  }
  const gx = Number(sprite.gridX);
  const gy = Number(sprite.gridY);
  // Use the same baseline point as tokens/selection so placement matches the
  // highlighted cell exactly.
  const iso = _isoCenterForCell(m, gx, gy);
  // Ensure bottom-center anchor
  try {
    sprite.anchor?.set?.(0.5, 1.0);
    sprite.pivot?.set?.(0, 0);
  } catch (_) {
    /* ignore */
  }
  // Baseline position
  // Round to whole pixels to avoid 0.5px artifacts that can land on tile edges
  sprite.x = Math.round(iso.x);
  sprite.y = Math.round(iso.y);
  // Elevation offset from current terrain height
  try {
    const h = m.terrainCoordinator?.getTerrainHeight?.(gx, gy) ?? 0;
    const elev = TerrainHeightUtils.calculateElevationOffset(h);
    sprite.y += elev;
  } catch (_) {
    /* ignore */
  }
  // Per-asset tuning
  try {
    const def = TERRAIN_PLACEABLES[sprite.placeableId] || {};
    const assetOffset = Number.isFinite(def.baselineOffsetPx) ? def.baselineOffsetPx : 0;
    sprite.y += assetOffset;
  } catch (_) {
    /* ignore */
  }
  // Assign depthValue (same metric tiles use) and a zIndex band that sits ABOVE the tile surface
  // but BELOW elevation side faces (faces typically added later with higher offsets).
  try {
    sprite.depthValue = gx + gy;
    // Base tile zIndex pattern: depth*100 + 20 (see createBaseTerrainGraphics)
    // Reserve 30-49 for placeables, 50+ for faces/overlays.
    const base = sprite.depthValue * 100;
    const type = sprite.placeableType || (TERRAIN_PLACEABLES[sprite.placeableId]?.type ?? 'path');
    const typeOffset = type === 'structure' ? 45 : type === 'plant' ? 38 : 32; // path/default
    sprite.zIndex = base + typeOffset;
  } catch (_) {
    /* ignore */
  }
  // Ensure sorting applies within terrainContainer
  try {
    if (sprite.parent) {
      sprite.parent.sortableChildren = true;
      sprite.parent.sortChildren?.();
    }
  } catch (_) {
    /* ignore */
  }
}

// ── Batch Repositioning ────────────────────────────────────────

/**
 * Reposition all placeables located on a specific cell (gx, gy).
 */
export function updatePlaceablesForCell(m, gx, gy) {
  if (!m.placeables) return;
  const key = `${gx},${gy}`;
  const list = m.placeables.get(key);
  if (!list || !list.length) return;
  for (const sprite of list) {
    try {
      repositionPlaceableSprite(m, sprite);
    } catch (_) {
      /* ignore */
    }
  }
}

/**
 * Reposition every placeable across the map (used when elevation scale changes).
 */
export function repositionAllPlaceables(m) {
  const gm = m?.gameManager;
  if (gm?.is3DModeActive?.() && gm.placeableMeshPool) {
    try {
      gm.placeableMeshPool.resyncHeights?.();
    } catch (_) {
      /* ignore */
    }
  }
  if (!m.placeables || m.placeables.size === 0) return;
  for (const [, list] of m.placeables) {
    if (!Array.isArray(list)) continue;
    for (const sprite of list) {
      try {
        repositionPlaceableSprite(m, sprite);
      } catch (_) {
        /* ignore */
      }
    }
  }
  try {
    m.gameManager?.gridContainer?.sortChildren?.();
  } catch (_) {
    /* ignore */
  }
}
