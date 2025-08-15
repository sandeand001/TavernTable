/**
 * BiomePalettes.js
 * ------------------------------------------------------
 * Generates and exports per-height color palettes covering the
 * configured terrain height range (TERRAIN_CONFIG.MIN_HEIGHT .. TERRAIN_CONFIG.MAX_HEIGHT)
 * for every biome defined in BiomeConstants.
 *
 * Design Goals:
 *  - Lightweight: no external deps, fast generation at load.
 *  - Thematic: each biome gets a low→mid→high triad describing
 *    subterranean/low, nominal, elevated peaks.
 *  - Consistent API: getBiomeHeightColor(biomeKey, height)
 *  - Future-ready: easy to swap in artist-authored ramps later.
 *
 * Implementation Notes:
 *  - We interpolate in RGB space for simplicity (adequate for UI tinting).
 *  - Height range anchored to TERRAIN_CONFIG MIN/MAX (currently -10..10 after expansion).
 *  - Each palette is an object: { '-10': 0xRRGGBB, ..., '0': 0xRRGGBB, ..., '10': 0xRRGGBB }
 */

import { BIOME_GROUPS, ALL_BIOMES } from './BiomeConstants.js';
import { TERRAIN_CONFIG } from './TerrainConstants.js';

const MIN_H = TERRAIN_CONFIG.MIN_HEIGHT ?? -5;
const MAX_H = TERRAIN_CONFIG.MAX_HEIGHT ?? 5;
const ZERO = 0;

// Utility: clamp height into allowed range
function clampHeight(h) { return Math.max(MIN_H, Math.min(MAX_H, h)); }

// Convert 0xRRGGBB → {r,g,b}
function hexToRgb(hex) {
  return { r: (hex >> 16) & 0xff, g: (hex >> 8) & 0xff, b: hex & 0xff };
}

// Convert {r,g,b} (0-255) → 0xRRGGBB
function rgbToHex({ r, g, b }) {
  return (r << 16) | (g << 8) | b;
}

// Linear interpolate two ints
function lerp(a, b, t) { return a + (b - a) * t; }

// Interpolate two colors (hex) at t [0,1]
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

function desaturate(hex, factor = 0.4) {
  const { r, g, b } = hexToRgb(hex);
  const avg = (r + g + b) / 3;
  return rgbToHex({
    r: Math.round(r + (avg - r) * factor),
    g: Math.round(g + (avg - g) * factor),
    b: Math.round(b + (avg - b) * factor)
  });
}

// Basic triad gradient fallback
function generateHeightGradient(lowHex, midHex, highHex) {
  const palette = {};
  for (let h = MIN_H; h <= MAX_H; h++) {
    let hex;
    if (h === ZERO) hex = midHex;
    else if (h < ZERO) {
      const t = (h - MIN_H) / (ZERO - MIN_H || 1);
      hex = lerpColor(lowHex, midHex, t);
    } else {
      const t = (h - ZERO) / (MAX_H - ZERO || 1);
      hex = lerpColor(midHex, highHex, t);
    }
    palette[h] = hex;
  }
  return palette;
}

// Multi-stop expressive gradient
function generateFromStops(stops) {
  const palette = {};
  const sorted = [...stops].map(s => ({ h: clampHeight(s.h), color: s.color })).sort((a, b) => a.h - b.h);
  for (let h = MIN_H; h <= MAX_H; h++) {
    const exact = sorted.find(s => s.h === h);
    if (exact) { palette[h] = exact.color; continue; }
    let lower = sorted[0];
    let upper = sorted[sorted.length - 1];
    for (let i = 0; i < sorted.length - 1; i++) {
      if (h >= sorted[i].h && h <= sorted[i + 1].h) { lower = sorted[i]; upper = sorted[i + 1]; break; }
    }
    if (lower.h === upper.h) palette[h] = lower.color;
    else {
      const t = (h - lower.h) / (upper.h - lower.h);
      palette[h] = lerpColor(lower.color, upper.color, t);
    }
  }
  return palette;
}

/**
 * Base triads keyed by biome key OR fallback categories. Each triad is
 * [lowHex, midHex, highHex]. Choose evocative tones while maintaining
 * cross-biome readability.
 */
const BIOME_BASE_TRIADS = {
  // Common / Temperate
  grassland:        [0x1d3b0e, 0x3d7f2b, 0x9adf6a],
  hills:            [0x2a3418, 0x5d7a34, 0xc2d96e],
  forestTemperate:  [0x0d2814, 0x206b32, 0x6dcf7c],
  forestConifer:    [0x0b1f15, 0x1b5a3a, 0x57a680],
  savanna:          [0x3a2c05, 0x8a6d1e, 0xf3d26b],
  steppe:           [0x2b2f14, 0x6b7b37, 0xd4d78c],

  // Desert & Arid
  desertHot:        [0x5b2302, 0xde8a34, 0xfff2b0],
  desertCold:       [0x1d1e24, 0x5b5e6b, 0xd9dbe3],
  sandDunes:        [0x402a09, 0xa97438, 0xffe2b3],
  oasis:            [0x062b27, 0x159f93, 0x6ef2e3],
  saltFlats:        [0x222427, 0x9fa8af, 0xffffff],
  thornscrub:       [0x20180d, 0x745529, 0xd3b36d],

  // Arctic / Frozen
  tundra:           [0x0c1d24, 0x447282, 0xe1f6ff],
  glacier:          [0x0a1422, 0x2f6f9c, 0xe6faff],
  frozenLake:       [0x0b1820, 0x297a9e, 0x9ae9ff],
  packIce:          [0x0a1016, 0x3c5970, 0xc9e8ff],

  // Mountain / Alpine
  mountain:         [0x1b1f24, 0x4a545d, 0xe0e6ec],
  alpine:           [0x12171c, 0x37505e, 0xc2e2f0],
  screeSlope:       [0x1d1d1d, 0x555555, 0xd3d3d3],
  cedarHighlands:   [0x16261b, 0x2f6b45, 0x90d1a5],
  geyserBasin:      [0x1c2624, 0x3d8277, 0xf2e2a1],

  // Wetlands
  swamp:            [0x04140a, 0x1e6030, 0x9ac076],
  wetlands:         [0x0a1c11, 0x2f5e3a, 0x8cc89c],
  floodplain:       [0x112010, 0x3f6b35, 0xb6d67d],
  bloodMarsh:       [0x25060a, 0x6a1d24, 0xf25a6b],
  mangrove:         [0x041c19, 0x1d5a4f, 0x79c2ae],

  // Aquatic / Coastal
  coast:            [0x051b2a, 0x15709d, 0x92d8f9],
  riverLake:        [0x041622, 0x14608c, 0x7ec9f0],
  ocean:            [0x02101b, 0x0d4a72, 0x4fb2e5],
  coralReef:        [0x021a2c, 0x0186c4, 0xffb9d1],

  // Forest Variants
  deadForest:       [0x1a0f07, 0x4a3a2e, 0xa28d7e],
  petrifiedForest:  [0x16100d, 0x5b463c, 0xd4b6a5],
  bambooThicket:    [0x061d0a, 0x157a34, 0x6ee28f],
  orchard:          [0x13220b, 0x3f8c2e, 0xa8e86d],
  mysticGrove:      [0x150b26, 0x5d2f8a, 0xcfa8ff],
  feywildBloom:     [0x1d0033, 0x7b1fa6, 0xffd1ff],
  shadowfellForest: [0x06070a, 0x272a33, 0x8a93a3],

  // Underground / Subterranean
  cavern:           [0x0a0f14, 0x303d49, 0x8a9aa8],
  fungalGrove:      [0x120a19, 0x5b2d7a, 0xc59ce8],
  crystalFields:    [0x0c1122, 0x2c4f9b, 0xa4d0ff],
  crystalSpires:    [0x050a18, 0x324b9e, 0xbcd6ff],
  eldritchRift:     [0x02030a, 0x3a0d6a, 0xc455ff],

  // Volcanic
  volcanic:         [0x1a0500, 0x912d07, 0xffa55a],
  obsidianPlain:    [0x050505, 0x302d32, 0x8d8893],
  ashWastes:        [0x141212, 0x4a4545, 0xc8c2c0],
  lavaFields:       [0x270600, 0x8a1d04, 0xffb347],

  // Wasteland / Ruin
  wasteland:        [0x120a12, 0x5a2d5a, 0xd59ad5],
  ruinedUrban:      [0x111214, 0x474c55, 0xb1bac6],
  graveyard:        [0x141617, 0x3f4a4f, 0x9babb2],

  // Exotic / Arcane / Astral
  astralPlateau:    [0x060a20, 0x2d39a6, 0xa6d5ff],
  arcaneLeyNexus:   [0x110033, 0x6d00d6, 0xe3a6ff]
};

// Extended multi-stop expressive palettes for selected biomes.
const BIOME_STOP_MAP = {
  desertHot: [
    { h: -5, color: 0x3d1402 },
    { h: -2, color: 0x8c3d05 },
    { h:  0, color: 0xe89d3a },
    { h:  3, color: 0xf8d77d },
    { h:  5, color: 0xfff4cc }
  ],
  volcanic: [
    { h: -5, color: 0x120303 },
    { h: -3, color: 0x301010 },
    { h: -1, color: 0x5a1a08 },
    { h:  0, color: 0xc53a05 },
    { h:  2, color: 0xf26a21 },
    { h:  4, color: 0xfcb469 },
    { h:  5, color: 0xffe5c2 }
  ],
  coralReef: [
    { h: -5, color: 0x001728 },
    { h: -3, color: 0x003e5c },
    { h: -1, color: 0x007fa8 },
    { h:  0, color: 0x00b7d8 },
    { h:  2, color: 0xff82a8 },
    { h:  5, color: 0xffd7e4 }
  ],
  glacier: [
    { h: -5, color: 0x06101c },
    { h: -3, color: 0x103a5c },
    { h: -1, color: 0x1e6f9e },
    { h:  0, color: 0x42a8d8 },
    { h:  3, color: 0xa9e8f8 },
    { h:  5, color: 0xffffff }
  ],
  swamp: [
    { h: -5, color: 0x020d08 },
    { h: -2, color: 0x0f3821 },
    { h:  0, color: 0x2b6d35 },
    { h:  2, color: 0x558b46 },
    { h:  5, color: 0xa6d48b }
  ],
  tundra: [
    { h: -5, color: 0x0c1d24 },
    { h: -2, color: 0x1e4550 },
    { h:  0, color: 0x3e6976 },
    { h:  2, color: 0x8db7c2 },
    { h:  4, color: 0xd3ecf3 },
    { h:  5, color: 0xffffff }
  ],
  eldritchRift: [
    { h: -5, color: 0x03040c },
    { h: -3, color: 0x140a2a },
    { h: -1, color: 0x33115d },
    { h:  0, color: 0x5a1990 },
    { h:  2, color: 0x8d3ad1 },
    { h:  4, color: 0xb96dff },
    { h:  5, color: 0xe0b3ff }
  ],
  mysticGrove: [
    { h: -5, color: 0x120826 },
    { h: -2, color: 0x311157 },
    { h:  0, color: 0x5d2f8a },
    { h:  2, color: 0x8d54c0 },
    { h:  4, color: 0xcaa4f5 },
    { h:  5, color: 0xf2e1ff }
  ]
};

export const BIOME_HEIGHT_PALETTES = {};
const DEFAULT_TRIAD = [0x253035, 0x607078, 0xbfd3e1];

for (const biome of ALL_BIOMES) {
  let palette;
  if (BIOME_STOP_MAP[biome.key]) palette = generateFromStops(BIOME_STOP_MAP[biome.key]);
  else {
    const triad = BIOME_BASE_TRIADS[biome.key] || DEFAULT_TRIAD;
    palette = generateHeightGradient(triad[0], triad[1], triad[2]);
  }
  BIOME_HEIGHT_PALETTES[biome.key] = palette;
}

// Snow/light overlays for cold high elevations
const SNOWCAP_BIOMES = new Set(['mountain', 'alpine', 'glacier', 'tundra']);
const SNOW_START = Math.min(3, MAX_H - 1);
for (const key of SNOWCAP_BIOMES) {
  const pal = BIOME_HEIGHT_PALETTES[key];
  if (!pal) continue;
  for (let h = SNOW_START; h <= MAX_H; h++) {
    const t = (h - SNOW_START) / (MAX_H - SNOW_START || 1);
    pal[h] = lighten(pal[h], 0.4 + 0.35 * t);
  }
}

/**
 * Retrieve color (hex number) for given biome & height.
 * Falls back to neutral terrain scale if biome missing.
 */
export function getBiomeHeightColor(biomeKey, height) {
  const h = clampHeight(Math.round(height));
  let palette = BIOME_HEIGHT_PALETTES[biomeKey];
  if (!palette) {
    const triad = DEFAULT_TRIAD;
    palette = generateHeightGradient(triad[0], triad[1], triad[2]);
  }
  let color = palette[h];
  // Ash wastes lowlands extra desaturation
  if (biomeKey === 'ashWastes' && h <= -2) color = desaturate(color, 0.55);
  // Volcanic deep negative = darken slightly
  if (biomeKey === 'volcanic' && h <= -3) color = desaturate(color, 0.2);
  return color;
}

/**
 * Optional helper: blend existing terrain height base color with biome tint.
 * weight: 0..1 where 1 = fully biome color.
 */
export function blendWithBiome(baseHex, biomeKey, height, weight = 0.6) {
  const biomeHex = getBiomeHeightColor(biomeKey, height);
  const a = hexToRgb(baseHex);
  const b = hexToRgb(biomeHex);
  const mixed = {
    r: Math.round(lerp(a.r, b.r, weight)),
    g: Math.round(lerp(a.g, b.g, weight)),
    b: Math.round(lerp(a.b, b.b, weight))
  };
  return rgbToHex(mixed);
}

// Debug / development hook (can be removed or gated later)
export function dumpBiomePaletteSample(biomeKey) {
  const palette = BIOME_HEIGHT_PALETTES[biomeKey];
  if (!palette) return console.warn('[BiomePalettes] Unknown biome', biomeKey);
  const entries = Object.keys(palette).sort((a,b)=>a-b).map(h => `${h}:${palette[h].toString(16)}`);
  // eslint-disable-next-line no-console
  console.log(`[BiomePalettes] ${biomeKey} -> ${entries.join(', ')}`);
}

export default BIOME_HEIGHT_PALETTES;
