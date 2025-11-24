import { TERRAIN_CONFIG } from '../../config/TerrainConstants.js';

export const BRUSH_LAYER_HINT = 'aboveFacesBelowTokens';
export const BRUSH_COLORS = Object.freeze({
  preview: 0x22d3ee,
});

const DEFAULT_HIGHLIGHT_STYLE = Object.freeze({
  color: BRUSH_COLORS.preview,
  fillAlpha: 0.12,
  lineAlpha: 0.9,
  lineWidth: 2,
});

/**
 * Clamp the incoming brush size so every consumer honors the same bounds.
 * @param {number} value
 * @param {{ MIN_BRUSH_SIZE?: number, MAX_BRUSH_SIZE?: number }} config
 * @returns {number}
 */
export function normalizeBrushSize(value, config = TERRAIN_CONFIG) {
  const minCandidate = Number.isFinite(config?.MIN_BRUSH_SIZE) ? config.MIN_BRUSH_SIZE : 1;
  const min = Math.max(1, minCandidate);
  const maxCandidate = Number.isFinite(config?.MAX_BRUSH_SIZE) ? config.MAX_BRUSH_SIZE : min;
  const max = Math.max(min, maxCandidate);
  if (!Number.isFinite(value)) {
    return min;
  }
  const rounded = Math.round(value);
  return Math.max(min, Math.min(max, rounded));
}

/**
 * Even brush sizes are represented as a lopsided box: e.g. size 4 => -1, +2 cell reach.
 * Returning both radii keeps footprint math identical across controller/highlighter/overlay.
 * @param {number} size
 */
export function computeBrushRadii(size) {
  const clamped = Math.max(1, Math.round(size));
  const negativeRadius = Math.floor((clamped - 1) / 2);
  const positiveRadius = clamped - negativeRadius - 1;
  return { negativeRadius, positiveRadius };
}

/**
 * Build the list of cells touched by the brush, honoring optional grid bounds.
 * @param {number} gridX
 * @param {number} gridY
 * @param {number} brushSize
 * @param {{ cols?: number, rows?: number, minX?: number, minY?: number }} bounds
 * @returns {Array<{x:number,y:number}>}
 */
export function computeBrushFootprint(gridX, gridY, brushSize, bounds = {}) {
  const size = normalizeBrushSize(brushSize);
  const { negativeRadius, positiveRadius } = computeBrushRadii(size);
  const minX = Number.isFinite(bounds.minX) ? bounds.minX : 0;
  const minY = Number.isFinite(bounds.minY) ? bounds.minY : 0;
  const hasMaxX = Number.isFinite(bounds.cols);
  const hasMaxY = Number.isFinite(bounds.rows);
  const maxX = hasMaxX ? bounds.cols - 1 : Number.POSITIVE_INFINITY;
  const maxY = hasMaxY ? bounds.rows - 1 : Number.POSITIVE_INFINITY;

  const cells = [];
  for (let dy = -negativeRadius; dy <= positiveRadius; dy += 1) {
    for (let dx = -negativeRadius; dx <= positiveRadius; dx += 1) {
      const x = gridX + dx;
      const y = gridY + dy;
      if (x < minX || y < minY) continue;
      if ((hasMaxX && x > maxX) || (hasMaxY && y > maxY)) continue;
      cells.push({ x, y });
    }
  }
  return cells;
}

export function getDefaultHighlightStyle() {
  return { ...DEFAULT_HIGHLIGHT_STYLE };
}

export function resolveHighlightStyle(overrides) {
  if (!overrides) {
    return getDefaultHighlightStyle();
  }
  const base = getDefaultHighlightStyle();
  for (const key of Object.keys(overrides)) {
    if (overrides[key] !== undefined) {
      base[key] = overrides[key];
    }
  }
  return base;
}
