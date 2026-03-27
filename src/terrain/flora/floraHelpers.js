// src/terrain/flora/floraHelpers.js - Runtime flora helper functions
// Extracted from config/terrain/FloraProfiles.js (Phase 7E).
// These functions contain domain logic (gameManager access, spatial queries)
// and belong in a domain module rather than config.

import { TERRAIN_PLACEABLES } from '../../config/terrain/TerrainPlaceables.js';

// ── Spectral Detection ───────────────────────────────────────
export function isSpectralPlaceable(id) {
  if (!id) return false;
  if (/-spectral$/i.test(id)) return true;
  const def = TERRAIN_PLACEABLES[id];
  if (!def) return false;
  if (def.tintVariant === 'spectral' || def.spectral === true) return true;
  if (def.type === 'plant-family' && Array.isArray(def.familyVariants)) {
    return def.familyVariants.some((variant) => isSpectralPlaceable(variant));
  }
  return false;
}

export function stripSpectralWeights(weightMap) {
  if (!weightMap) return weightMap;
  let removed = false;
  const filtered = {};
  for (const [id, weight] of Object.entries(weightMap)) {
    if (isSpectralPlaceable(id)) {
      removed = true;
      continue;
    }
    filtered[id] = weight;
  }
  return removed ? filtered : weightMap;
}

// ── Tropical Helpers ─────────────────────────────────────────
const TROPICAL_HEIGHT_VARIANCE = 1.5;
const TROPICAL_RELOCATION_RADIUS = 2;
const TROPICAL_DENSITY_THRESHOLDS = [
  { ratio: 0.7, modifier: 0.6 },
  { ratio: 0.5, modifier: 0.75 },
  { ratio: 0.35, modifier: 0.9 },
];

const RING_OFFSETS = (() => {
  const offsets = [];
  for (let r = 1; r <= TROPICAL_RELOCATION_RADIUS; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        offsets.push([dx, dy, r]);
      }
    }
  }
  return offsets;
})();

export function isTropicalCluster(id) {
  if (!id) return false;
  if (/^plant-tropical-/i.test(id)) return true;
  if (/tropical/i.test(id)) return true;
  const def = TERRAIN_PLACEABLES[id];
  if (!def) return false;
  const label = def.label || '';
  const model = def.modelKey || '';
  return /tropical/i.test(label) || /tropical/i.test(model);
}

export function getTropicalDensityModifier(weightMap) {
  if (!weightMap) return 1;
  let total = 0;
  let tropical = 0;
  for (const [id, weight] of Object.entries(weightMap)) {
    const w = Number(weight) || 0;
    if (w <= 0) continue;
    total += w;
    if (isTropicalCluster(id)) {
      tropical += w;
    }
  }
  if (!tropical || !total) return 1;
  const ratio = tropical / total;
  for (const { ratio: cutoff, modifier } of TROPICAL_DENSITY_THRESHOLDS) {
    if (ratio >= cutoff) return modifier;
  }
  return 1;
}

function _isFlatEnoughForTropical(c, x, y, baseHeight) {
  if (!c || typeof c.getTerrainHeight !== 'function') return true;
  const gm = c.gameManager;
  const rows = gm?.rows ?? 0;
  const cols = gm?.cols ?? 0;
  const reference = Number.isFinite(baseHeight) ? baseHeight : c.getTerrainHeight?.(x, y);
  if (!Number.isFinite(reference)) return true;
  const offsets = [
    [0, 0],
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ];
  for (const [dx, dy] of offsets) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
    const neighborHeight = c.getTerrainHeight?.(nx, ny);
    if (!Number.isFinite(neighborHeight)) continue;
    if (neighborHeight <= 0) continue;
    if (Math.abs(neighborHeight - reference) > TROPICAL_HEIGHT_VARIANCE) {
      return false;
    }
  }
  return true;
}

export function relocateTropicalCandidate(c, x, y, baseHeight) {
  if (!c || typeof c.getTerrainHeight !== 'function') return null;
  if (_isFlatEnoughForTropical(c, x, y, baseHeight)) {
    return { x, y, height: baseHeight };
  }
  const gm = c.gameManager;
  const rows = gm?.rows ?? 0;
  const cols = gm?.cols ?? 0;
  for (const [dx, dy] of RING_OFFSETS) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
    const nh = c.getTerrainHeight?.(nx, ny);
    if (!Number.isFinite(nh) || nh <= 0) continue;
    if (!_isFlatEnoughForTropical(c, nx, ny, nh)) continue;
    return { x: nx, y: ny, height: nh };
  }
  return null;
}

// ── Hash Utility ─────────────────────────────────────────────
export function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

// ── Water Detection Helpers ──────────────────────────────────
function _isAdjacentToWater(c, x, y) {
  if (!c?.gameManager) return false;
  const cols = c.gameManager.cols || 0;
  const rows = c.gameManager.rows || 0;
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (const [dx, dy] of dirs) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
    const nh = c.getTerrainHeight?.(nx, ny) ?? 0;
    if (nh <= 0) return true;
  }
  return false;
}

function _hasWaterWithinRadius(c, x, y, radius) {
  if (!c || typeof c.getTerrainHeight !== 'function') return false;
  const gm = c.gameManager;
  const rows = gm?.rows ?? 0;
  const cols = gm?.cols ?? 0;
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      const dist = Math.abs(dx) + Math.abs(dy);
      if (dist === 0 || dist > radius) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const nh = c.getTerrainHeight?.(nx, ny) ?? 0;
      if (nh <= 0) return true;
    }
  }
  return false;
}

export function isCoastlineTile(c, x, y) {
  const h = c.getTerrainHeight?.(x, y) ?? 0;
  if (h <= 0) return false;
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (const [dx, dy] of dirs) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= c.gameManager.cols || ny >= c.gameManager.rows) continue;
    const nh = c.getTerrainHeight?.(nx, ny) ?? 0;
    if (nh <= 0) return true;
  }
  return false;
}

// ── Candidate Filters ────────────────────────────────────────
export const candidateFilters = {
  oasisSetback(c, x, y, h, rng) {
    const height = Number.isFinite(h) ? h : (c.getTerrainHeight?.(x, y) ?? 0);
    if (height <= 0.3) return false;
    const adjacent = _isAdjacentToWater(c, x, y);
    const nearWater = _hasWaterWithinRadius(c, x, y, 3);
    if (!adjacent && !nearWater) return false;
    if (!_isFlatEnoughForTropical(c, x, y, height)) return false;
    if (adjacent) {
      return true;
    }
    if (!_hasWaterWithinRadius(c, x, y, 2)) return false;
    const roll = typeof rng === 'function' ? rng() : Math.random();
    return roll < 0.15;
  },
  adjacentWater(c, x, y) {
    return _isAdjacentToWater(c, x, y);
  },
  coastlineOnly(c, x, y) {
    return isCoastlineTile(c, x, y);
  },
  swampEdge(c, x, y, h) {
    if (h < -0.6 || h > 2.2) return false;
    let hasWet = false;
    let hasDry = false;
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const [dx, dy] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= c.gameManager.cols || ny >= c.gameManager.rows) continue;
      const nh = c.getTerrainHeight?.(nx, ny) ?? 0;
      if (nh <= 0) hasWet = true;
      else hasDry = true;
      if (hasWet && hasDry) break;
    }
    if (h <= 0 && hasDry) return true;
    if (h > 0 && hasWet) return true;
    return false;
  },
  swampDeep(c, x, y, h, rng) {
    const MIN = -3.2;
    const EDGE_BAND_MIN = -0.8;
    const SHALLOW_MIN = -2.0;
    if (h < MIN || h > 2.5) return false;
    let hasWet = false;
    let hasDry = false;
    let nearShallow = false;
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const [dx, dy] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= c.gameManager.cols || ny >= c.gameManager.rows) continue;
      const nh = c.getTerrainHeight?.(nx, ny) ?? 0;
      if (nh <= 0) hasWet = true;
      else hasDry = true;
      if (nh > SHALLOW_MIN) nearShallow = true;
      if (hasWet && hasDry && nearShallow) break;
    }
    if (h >= EDGE_BAND_MIN && h <= 0.8) {
      if ((h <= 0 && hasDry) || (h > 0 && hasWet)) return true;
    }
    if (h >= SHALLOW_MIN && h < EDGE_BAND_MIN) {
      if (nearShallow || hasDry) return true;
    }
    if (h >= MIN && h < SHALLOW_MIN) {
      if (!nearShallow) return false;
      const r = rng ? rng() : Math.random();
      return r < 0.3;
    }
    return false;
  },
};
