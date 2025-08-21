/**
 * BiomePalettes.js  — painterly revision
 * ------------------------------------------------------
 * Adds perceptual OKLCH adjustments, macro color flow, shoreline sand bands,
 * aspect-aware lighting, and curated multi-hue ramps per biome.
 *
 * New API:
 *    getBiomeColor(biomeKey, height, x, y, opts) -> { color, fx }
 *    getBiomeColorHex(biomeKey, height, x, y, opts) -> hex
 */

import { ALL_BIOMES } from './BiomeConstants.js';
import { TERRAIN_CONFIG } from './TerrainConstants.js';

const MIN_H = TERRAIN_CONFIG.MIN_HEIGHT ?? -5;
const MAX_H = TERRAIN_CONFIG.MAX_HEIGHT ?? 5;
const ZERO = 0;

function clampHeight(h) { return Math.max(MIN_H, Math.min(MAX_H, h)); }
function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }
function mix(a, b, t) { return a + (b - a) * t; }
function hexToRgb(hex) {
  return { r: (hex >> 16) & 0xff, g: (hex >> 8) & 0xff, b: hex & 0xff };
}
function rgbToHex({ r, g, b }) {
  return (r << 16) | (g << 8) | b;
}
function lerp(a, b, t) { return a + (b - a) * t; }
function lerpColor(aHex, bHex, t) {
  const a = hexToRgb(aHex);
  const b = hexToRgb(bHex);
  return rgbToHex({
    r: Math.round(lerp(a.r, b.r, t)),
    g: Math.round(lerp(a.g, b.g, t)),
    b: Math.round(lerp(a.b, b.b, t))
  });
}
function lighten(hex, amount = 0.25) {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex({
    r: Math.min(255, Math.round(r + (255 - r) * amount)),
    g: Math.min(255, Math.round(g + (255 - g) * amount)),
    b: Math.min(255, Math.round(b + (255 - b) * amount))
  });
}
// ...existing code...
