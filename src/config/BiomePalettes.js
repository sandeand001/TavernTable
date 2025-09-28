/**
 * BiomePalettes.js (Baseline Reset)
 * ---------------------------------
 * Stripped-down, deterministic, height-indexed color look.
 * All expressive / painterly experimentation removed per user request.
 * Keep only what callers need: getBiomeColor / getBiomeColorHex plus
 * legacy helpers. No noise, no perceptual color math, no sand/snow logic.
 */

import { ALL_BIOMES } from './BiomeConstants.js';
import { TERRAIN_CONFIG } from './TerrainConstants.js';

// Height bounds (defaults if not provided)
const MIN_H = TERRAIN_CONFIG.MIN_HEIGHT ?? -5;
const MAX_H = TERRAIN_CONFIG.MAX_HEIGHT ?? 5;

// Single unified palette mode (previous multi-mode removed)

// ------------------------
// Basic helpers
// ------------------------
function clampHeight(h) {
  return Math.max(MIN_H, Math.min(MAX_H, h));
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function hexToRgb(hex) {
  return { r: (hex >> 16) & 0xff, g: (hex >> 8) & 0xff, b: hex & 0xff };
}
function rgbToHex({ r, g, b }) {
  return (r << 16) | (g << 8) | b;
}
function lerpColor(aHex, bHex, t) {
  const a = hexToRgb(aHex);
  const b = hexToRgb(bHex);
  return rgbToHex({
    r: Math.round(lerp(a.r, b.r, t)),
    g: Math.round(lerp(a.g, b.g, t)),
    b: Math.round(lerp(a.b, b.b, t)),
  });
}

// ------------------------
// Palette construction (simple low/mid/high gradient per biome)
// ------------------------
function generateHeightGradient(lowHex, midHex, highHex) {
  const palette = {};
  for (let h = MIN_H; h <= MAX_H; h++) {
    let hex;
    if (h === 0) hex = midHex;
    else if (h < 0) {
      const t = (h - MIN_H) / (0 - MIN_H || 1); // 0 at MIN_H -> 1 at -1
      hex = lerpColor(lowHex, midHex, t);
    } else {
      const t = (h - 0) / (MAX_H - 0 || 1); // 0 at 0 -> 1 at MAX_H
      hex = lerpColor(midHex, highHex, t);
    }
    palette[h] = hex;
  }
  return palette;
}

// Core (legacy-like) biome triads (low, mid, high)
const BIOME_BASE_TRIADS = {
  grassland: [0x1d3a22, 0x3f8c2f, 0xd6c46b],
  forestTemperate: [0x0e2414, 0x2e7a3b, 0x95d56e],
  forestConifer: [0x0a1a12, 0x1f5a3a, 0x7bb0a0],
  hills: [0x2a371a, 0x5f7c36, 0xc8b67a],
  mountain: [0x2a2e34, 0x5b6068, 0xe9eef4],
  alpine: [0x1a2630, 0x3c6672, 0xe4f2f7],
  tundra: [0x23323a, 0x6f8259, 0xe6f3fb],
  desertHot: [0x5e2604, 0xb86f38, 0xf2e0b8],
  desertCold: [0x2b2f38, 0x7a8092, 0xe7e9f2],
  sandDunes: [0x4a3316, 0xc09358, 0xf5e6c8],
  coast: [0x0a2c4a, 0x1a7fa8, 0xf2e6c9],
  riverLake: [0x0e2d2f, 0x2b7f6d, 0xd8c6a3],
  ocean: [0x071a2f, 0x0d4e7a, 0x34b6d6],
  swamp: [0x10180f, 0x2f4a2e, 0x8aa26a],
  wetlands: [0x172317, 0x3a5f3a, 0x98c08f],
  floodplain: [0x2a2b1e, 0x587247, 0xc2d39b],
  mangrove: [0x1b2d29, 0x295b53, 0x7ec8b4],
  screeSlope: [0x1d1d1d, 0x595959, 0xdadada],
  glacier: [0x0a1422, 0x2f6e9d, 0xffffff],
  frozenLake: [0x0b1820, 0x2a80a6, 0xbef1ff],
  packIce: [0x0a1016, 0x3f5f77, 0xe9f6ff],
  beach: [0x6e5e49, 0xbba47b, 0xf2e6c9],
  coralReef: [0x0b3a44, 0x18b3cf, 0xffc1cf],
  oasis: [0x074339, 0x1aa28e, 0x7ff0e3],
  volcanic: [0x1b0600, 0x8a2a07, 0xffc27a],
  ashWastes: [0x141212, 0x4c4646, 0xccc7c4],
  obsidianPlain: [0x070707, 0x343138, 0x9aa1ad],
  lavaFields: [0x290700, 0x8f2105, 0xffb952],
};

const DEFAULT_TRIAD = [0x253035, 0x607078, 0xbfd3e1];

// Build static palettes & canonical mid-tone map for fidelity mode
export const BIOME_HEIGHT_PALETTES = {};
export const BIOME_CANONICAL_COLOR = {}; // biomeKey -> mid triad hex
for (const biome of ALL_BIOMES) {
  const triad = BIOME_BASE_TRIADS[biome.key] || DEFAULT_TRIAD;
  BIOME_HEIGHT_PALETTES[biome.key] = generateHeightGradient(triad[0], triad[1], triad[2]);
  BIOME_CANONICAL_COLOR[biome.key] = triad[1];
}

// Biome key normalization (minimal)
function normalizeBiomeKey(key) {
  const lc = String(key || '').toLowerCase();
  if (lc === 'desert') return 'desertHot';
  if (lc === 'colddesert') return 'desertCold';
  if (lc === 'shore') return 'coast';
  if (lc === 'bog') return 'wetlands';
  return key;
}

export function getBiomeHeightColor(biomeKey, height) {
  const k = normalizeBiomeKey(biomeKey);
  const h = clampHeight(Math.round(height));
  const pal = BIOME_HEIGHT_PALETTES[k];
  if (pal && pal[h] != null) return pal[h];
  // If unknown biome at runtime, lazily assign default palette once
  if (!pal) {
    BIOME_HEIGHT_PALETTES[k] = generateHeightGradient(...DEFAULT_TRIAD);
    BIOME_CANONICAL_COLOR[k] = DEFAULT_TRIAD[1];
    return BIOME_HEIGHT_PALETTES[k][h];
  }
  return 0x808080;
}

// Primary public API (baseline)
export function getBiomeColor(biomeKey, height) {
  return { color: getBiomeHeightColor(biomeKey, height), fx: {} };
}
export function getBiomeColorHex(biomeKey, height) {
  return getBiomeHeightColor(biomeKey, height);
}

// Legacy helper retained (simple blend)
export function blendWithBiome(baseHex, biomeKey, height, weight = 0.6) {
  const biomeHex = getBiomeHeightColor(biomeKey, height);
  const a = hexToRgb(baseHex);
  const b = hexToRgb(biomeHex);
  const mixed = {
    r: Math.round(lerp(a.r, b.r, weight)),
    g: Math.round(lerp(a.g, b.g, weight)),
    b: Math.round(lerp(a.b, b.b, weight)),
  };
  return rgbToHex(mixed);
}

export default BIOME_HEIGHT_PALETTES;
