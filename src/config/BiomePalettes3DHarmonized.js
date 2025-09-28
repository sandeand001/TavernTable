/**
 * BiomePalettes3DHarmonized.js
 * ------------------------------------------------------
 * Generates a 3D-friendly biome palette derived directly from the 2D painterly
 * biome system so tone / hue / brightness alignment is much closer while still
 * allowing lightweight per-vertex lookup (no OKLab math at render time).
 *
 * Strategy:
 *  - Sample 2D painterly colors at representative heights: low (MIN_H), mid (0), high (MAX_H)
 *  - Build an interpolated per-integer-height palette (like existing 3D triads)
 *  - Apply simple atmospheric lift for > 0 elevation and depth shaping for < 0 using
 *    the same light-weight math as the stylized 3D palette so we preserve prior cues.
 *  - Cache results per biome so runtime cost is tiny (one hash lookup + a couple branches).
 *
 * Optional globals to tune harmonization (set via DevTools):
 *   window.threeBiomeHarmonyHighlight = 0.0..0.4 extra highlight lift (default 0.12)
 *   window.threeBiomeHarmonyDepthBoost = 0.0..1.0 strength multiplier for depth darkening (default 1)
 *   window.threeBiomeHarmonyLowSaturationBoost = 0..1 pushes low elevations slightly more chroma (default 0.15)
 */

import { TERRAIN_CONFIG } from './TerrainConstants.js';
import { getBiomeColorHex } from './BiomePalettes.js';

const MIN_H = TERRAIN_CONFIG.MIN_HEIGHT ?? -5;
const MAX_H = TERRAIN_CONFIG.MAX_HEIGHT ?? 5;
const ZERO = 0;

// Small helpers ------------------------------------------------------------
function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function hex(r, g, b) {
  return ((r & 255) << 16) | ((g & 255) << 8) | (b & 255);
}
function hexToRgb(h) {
  return { r: (h >> 16) & 255, g: (h >> 8) & 255, b: h & 255 };
}
function lerpColor(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return hex(
    Math.round(lerp(A.r, B.r, t)),
    Math.round(lerp(A.g, B.g, t)),
    Math.round(lerp(A.b, B.b, t))
  );
}

// Atmospheric lift & depth shaping (copied/adapted from stylized palette) ---
function applyAtmosphere(baseHex, normHeight, highlightExtra) {
  const { r, g, b } = hexToRgb(baseHex);
  const t = Math.pow(clamp(normHeight, 0, 1), 1.05);
  const liftBase = 14 * t + highlightExtra * 40 * t * t;
  const cool = 10 * t;
  return hex(
    clamp(Math.round(r + liftBase * 0.85), 0, 255),
    clamp(Math.round(g + liftBase + cool * 0.25), 0, 255),
    clamp(Math.round(b + liftBase + cool), 0, 255)
  );
}
function applyDepth(baseHex, depth01, strength = 1) {
  const { r, g, b } = hexToRgb(baseHex);
  const d = Math.pow(depth01, 0.9) * strength;
  return hex(
    clamp(Math.round(r * (0.78 - 0.22 * d)), 0, 255),
    clamp(Math.round(g * (0.8 - 0.18 * d)), 0, 255),
    clamp(Math.round(b * (0.92 + 0.1 * d)), 0, 255)
  );
}

// Slight saturation push toward extremes so lows not muddy & highs not chalky.
function adjustSaturation(hexVal, satBoost) {
  if (!satBoost) return hexVal;
  const { r, g, b } = hexToRgb(hexVal);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  const sr = lum + (r - lum) * (1 + satBoost);
  const sg = lum + (g - lum) * (1 + satBoost);
  const sb = lum + (b - lum) * (1 + satBoost);
  return hex(
    clamp(Math.round(sr), 0, 255),
    clamp(Math.round(sg), 0, 255),
    clamp(Math.round(sb), 0, 255)
  );
}

const HARMONY_CACHE = {}; // biomeKey -> { palette: {h:hex}, meta }

function buildHarmonizedPalette(biomeKey) {
  // Stable sampling: x=y=0, mapFreq=0 eliminates macro drift & noise for base triad
  const sampleOpts = { mapFreq: 0.0, seed: 777 }; // deterministic
  const lowHex = getBiomeColorHex(biomeKey, MIN_H, 0, 0, sampleOpts);
  const midHex = getBiomeColorHex(biomeKey, 0, 0, 0, sampleOpts);
  // For high we bias slightly below MAX_H if snow/white risk, then optionally lighten with highlight
  const highBase = getBiomeColorHex(biomeKey, MAX_H, 0, 0, sampleOpts);

  const palette = {};
  for (let h = MIN_H; h <= MAX_H; h++) {
    if (h === ZERO) {
      palette[h] = midHex;
      continue;
    }
    if (h < ZERO) {
      const t = (h - MIN_H) / (ZERO - MIN_H || 1);
      palette[h] = lerpColor(lowHex, midHex, t);
    } else {
      const t = h / (MAX_H || 1);
      palette[h] = lerpColor(midHex, highBase, t);
    }
  }
  HARMONY_CACHE[biomeKey] = { palette, sampled: { lowHex, midHex, highBase } };
  return palette;
}

function ensureHarmonyPalette(biomeKey) {
  if (!HARMONY_CACHE[biomeKey]) return buildHarmonizedPalette(biomeKey);
  return HARMONY_CACHE[biomeKey].palette;
}

export function getHarmonized3DColorHex(biomeKey, height) {
  const pal = ensureHarmonyPalette(biomeKey);
  const hClamped = Math.max(MIN_H, Math.min(MAX_H, Math.round(height)));
  let base = pal[hClamped] || pal[0];

  // Global tuning knobs
  const highlightExtra =
    typeof window !== 'undefined' && typeof window.threeBiomeHarmonyHighlight === 'number'
      ? clamp(window.threeBiomeHarmonyHighlight, 0, 0.6)
      : 0.12;
  const depthStrength =
    typeof window !== 'undefined' && typeof window.threeBiomeHarmonyDepthBoost === 'number'
      ? clamp(window.threeBiomeHarmonyDepthBoost, 0, 2)
      : 1.0;
  const lowSatBoost =
    typeof window !== 'undefined' && typeof window.threeBiomeHarmonyLowSaturationBoost === 'number'
      ? clamp(window.threeBiomeHarmonyLowSaturationBoost, 0, 1)
      : 0.15;

  if (height < 0) {
    const depth01 = Math.min(1, Math.abs(height) / (Math.abs(MIN_H) || 10));
    base = applyDepth(base, depth01, depthStrength);
    // Low elevation saturation lift (mild) to avoid sludge greens/browns underwater / wet soils.
    base = adjustSaturation(base, lowSatBoost * depth01 * 0.6);
  } else if (height > 0) {
    const t = height / (MAX_H || 1);
    base = applyAtmosphere(base, t, highlightExtra);
    base = adjustSaturation(base, lowSatBoost * (1 - Math.abs(t - 0.5)) * 0.4); // subtle mid preservation
  }

  return base;
}

export function rebuildHarmonizedBiomeCache(biomeKey) {
  if (biomeKey) delete HARMONY_CACHE[biomeKey];
  else Object.keys(HARMONY_CACHE).forEach((k) => delete HARMONY_CACHE[k]);
}

export default getHarmonized3DColorHex;
