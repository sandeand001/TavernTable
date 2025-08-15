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

function darken(hex, amount = 0.2) {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex({
    r: Math.max(0, Math.round(r * (1 - amount))),
    g: Math.max(0, Math.round(g * (1 - amount))),
    b: Math.max(0, Math.round(b * (1 - amount)))
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
  // Common / Temperate (lush lows, vibrant mids, airy highs)
  grassland:        [0x1e2f0f, 0x3f7f2b, 0xa4e274],
  hills:            [0x273117, 0x5f7c36, 0xcce27a],
  forestTemperate:  [0x0e2414, 0x1f6a32, 0x79da84],
  forestConifer:    [0x0a1a12, 0x1a5737, 0x5eb491],
  savanna:          [0x3e2d06, 0x916f21, 0xf6d873],
  steppe:           [0x2a2e14, 0x6e7f39, 0xdadd95],

  // Desert & Arid (ochres, sands, cool shadows)
  desertHot:        [0x5e2604, 0xe08f38, 0xfff4bf],
  desertCold:       [0x1f2228, 0x636a79, 0xdee2ea],
  sandDunes:        [0x442d0b, 0xaf7c3e, 0xffe8bf],
  oasis:            [0x07322e, 0x17a99b, 0x79f4e7],
  saltFlats:        [0x24262a, 0xa9b2b9, 0xffffff],
  thornscrub:       [0x221a0f, 0x795c2e, 0xdab875],

  // Arctic / Frozen (steel blues to white)
  tundra:           [0x0c1d24, 0x477786, 0xe8fbff],
  glacier:          [0x0a1422, 0x3174a4, 0xedfbff],
  frozenLake:       [0x0b1820, 0x2a80a6, 0xaef1ff],
  packIce:          [0x0a1016, 0x3f5f77, 0xd2ecff],

  // Mountain / Alpine (granite to snow)
  mountain:         [0x1b1f24, 0x4f5963, 0xe6ecf2],
  alpine:           [0x13181d, 0x3a5665, 0xc9e7f4],
  screeSlope:       [0x1d1d1d, 0x595959, 0xdadada],
  cedarHighlands:   [0x152418, 0x2f6d46, 0x97d7ab],
  geyserBasin:      [0x1a2422, 0x3d877c, 0xf5e7a9],

  // Wetlands (peaty lows, olive mids, reed highs)
  swamp:            [0x04130a, 0x226a36, 0xa0c87b],
  wetlands:         [0x081a10, 0x336d44, 0x93d2a4],
  floodplain:       [0x0f1e0f, 0x416f3a, 0xbfe088],
  bloodMarsh:       [0x28070b, 0x6f2027, 0xf76877],
  mangrove:         [0x061f1a, 0x1e6053, 0x7ec8b4],

  // Aquatic / Coastal (depth-coded blues)
  coast:            [0x062034, 0x1878a8, 0x9ee3fb],
  riverLake:        [0x051a2a, 0x176b9a, 0x87d2f4],
  ocean:            [0x03121f, 0x0f4e7a, 0x58b8ea],
  coralReef:        [0x041d31, 0x0191cf, 0xffbed6],

  // Forest Variants
  deadForest:       [0x1a0f07, 0x4a3a2e, 0xa28d7e],
  petrifiedForest:  [0x18110e, 0x614b40, 0xd9bea9],
  bambooThicket:    [0x071e0b, 0x148236, 0x72eb96],
  orchard:          [0x13220b, 0x449636, 0xb2f074],
  mysticGrove:      [0x170c29, 0x643099, 0xd6b0ff],
  feywildBloom:     [0x1f0038, 0x8520b0, 0xffd5ff],
  shadowfellForest: [0x07080b, 0x2a2e37, 0x95a0b0],

  // Underground / Subterranean
  cavern:           [0x0a0f14, 0x2f3b47, 0x8da0ae],
  fungalGrove:      [0x120a19, 0x5b2d7a, 0xc59ce8],
  crystalFields:    [0x0b1022, 0x2e55a5, 0xaad6ff],
  crystalSpires:    [0x050a18, 0x324b9e, 0xbcd6ff],
  eldritchRift:     [0x02030a, 0x3a0d6a, 0xc455ff],

  // Volcanic
  volcanic:         [0x1b0600, 0x962f08, 0xffad62],
  obsidianPlain:    [0x070707, 0x343138, 0x99939d],
  ashWastes:        [0x141212, 0x4c4646, 0xccc7c4],
  lavaFields:       [0x290700, 0x8f2105, 0xffb952],

  // Wasteland / Ruin
  wasteland:        [0x130a13, 0x5e2f5e, 0xda9fda],
  ruinedUrban:      [0x121317, 0x4b525d, 0xb8c1cd],
  graveyard:        [0x151719, 0x415057, 0xa2b4bc],

  // Exotic / Arcane / Astral
  astralPlateau:    [0x070a22, 0x2f3ba9, 0xaedaff],
  arcaneLeyNexus:   [0x14003a, 0x7600de, 0xe6b2ff]
};

// Extended multi-stop expressive palettes for selected biomes.
const BIOME_STOP_MAP = {
  // Arid
  desertHot: [
    { h: -10, color: 0x321002 },
    { h:  -6, color: 0x6f2f07 },
    { h:  -2, color: 0xb85f1e },
    { h:   0, color: 0xeaa24a },
    { h:   4, color: 0xf9df98 },
    { h:   8, color: 0xfff8db }
  ],
  desertCold: [
    { h: -10, color: 0x1b1d23 },
    { h:  -5, color: 0x3a3f4a },
    { h:   0, color: 0x6f7786 },
    { h:   5, color: 0xbac1cd },
    { h:  10, color: 0xf2f4f7 }
  ],
  sandDunes: [
    { h: -10, color: 0x3a2708 },
    { h:  -4, color: 0x986a2f },
    { h:   0, color: 0xdba96b },
    { h:   5, color: 0xffe1b0 },
    { h:  10, color: 0xfff2d6 }
  ],
  thornscrub: [
    { h: -10, color: 0x23190f },
    { h:  -3, color: 0x6f5430 },
    { h:   0, color: 0x9b7c47 },
    { h:   5, color: 0xdaba86 }
  ],
  saltFlats: [
    { h: -10, color: 0x232528 },
    { h:  -2, color: 0x8b959e },
    { h:   0, color: 0xcfd6dd },
    { h:   6, color: 0xf7fafc },
    { h:  10, color: 0xffffff }
  ],
  oasis: [
    { h: -10, color: 0x062823 },
    { h:  -4, color: 0x0d6d63 },
    { h:   0, color: 0x16a99b },
    { h:   4, color: 0x5fe3d6 },
    { h:  10, color: 0xbffaf4 }
  ],

  // Temperate & Grass
  grassland: [
    { h: -10, color: 0x12200a },
    { h:  -4, color: 0x245c1b },
    { h:   0, color: 0x3f8c2f },
    { h:   6, color: 0x95d56e },
    { h:  10, color: 0xcff4a6 }
  ],
  hills: [
    { h: -10, color: 0x1a220f },
    { h:  -2, color: 0x49682d },
    { h:   0, color: 0x5f7c36 },
    { h:   5, color: 0xaed37b },
    { h:  10, color: 0xddecac }
  ],
  steppe: [
    { h: -10, color: 0x1f2211 },
    { h:  -2, color: 0x526132 },
    { h:   0, color: 0x6d7f3b },
    { h:   6, color: 0xc4d48a },
    { h:  10, color: 0xe7efc5 }
  ],
  savanna: [
    { h: -10, color: 0x2f2306 },
    { h:  -2, color: 0x6e5717 },
    { h:   0, color: 0x916f21 },
    { h:   6, color: 0xeed17a },
    { h:  10, color: 0xf9e9b8 }
  ],
  forestTemperate: [
    { h: -10, color: 0x0b1b10 },
    { h:  -4, color: 0x18502a },
    { h:   0, color: 0x1f6a32 },
    { h:   6, color: 0x6ecf80 },
    { h:  10, color: 0xa8f0ba }
  ],
  forestConifer: [
    { h: -10, color: 0x08150f },
    { h:  -4, color: 0x14482e },
    { h:   0, color: 0x1a5737 },
    { h:   6, color: 0x5fb793 },
    { h:  10, color: 0x9be2c7 }
  ],

  // Wetlands
  swamp: [
    { h: -10, color: 0x020c07 },
    { h:  -6, color: 0x0d2e1b },
    { h:  -2, color: 0x18532e },
    { h:   0, color: 0x226a36 },
    { h:   5, color: 0x6aa55a },
    { h:  10, color: 0xa8d38f }
  ],
  wetlands: [
    { h: -10, color: 0x07170e },
    { h:  -4, color: 0x25573a },
    { h:   0, color: 0x336d44 },
    { h:   5, color: 0x7fc595 },
    { h:  10, color: 0xbce6c8 }
  ],
  floodplain: [
    { h: -10, color: 0x0e1b0e },
    { h:  -2, color: 0x345f2f },
    { h:   0, color: 0x416f3a },
    { h:   6, color: 0xa9d97d },
    { h:  10, color: 0xdaf1ad }
  ],
  mangrove: [
    { h: -10, color: 0x051a16 },
    { h:  -4, color: 0x154a40 },
    { h:   0, color: 0x1e6053 },
    { h:   6, color: 0x64b7a3 },
    { h:  10, color: 0xa6e3d3 }
  ],
  bloodMarsh: [
    { h: -10, color: 0x22060a },
    { h:  -2, color: 0x57161c },
    { h:   0, color: 0x6f2027 },
    { h:   5, color: 0xcd4c59 },
    { h:  10, color: 0xf58b98 }
  ],

  // Arctic
  glacier: [
    { h: -10, color: 0x06101c },
    { h:  -5, color: 0x103a5c },
    { h:  -1, color: 0x1e6f9e },
    { h:   0, color: 0x42a8d8 },
    { h:   5, color: 0xa9e8f8 },
    { h:  10, color: 0xffffff }
  ],
  tundra: [
    { h: -10, color: 0x0c1d24 },
    { h:  -4, color: 0x1f4f5d },
    { h:   0, color: 0x3f6f7c },
    { h:   4, color: 0xb5dbe5 },
    { h:  10, color: 0xffffff }
  ],
  frozenLake: [
    { h: -10, color: 0x0b1820 },
    { h:  -4, color: 0x1d5672 },
    { h:   0, color: 0x2a80a6 },
    { h:   6, color: 0x83d3eb },
    { h:  10, color: 0xbef1ff }
  ],
  packIce: [
    { h: -10, color: 0x0a1016 },
    { h:  -3, color: 0x2f4a5e },
    { h:   0, color: 0x3f5f77 },
    { h:   6, color: 0xbfe6fb },
    { h:  10, color: 0xe9f6ff }
  ],

  // Mountain
  mountain: [
    { h: -10, color: 0x1b1f24 },
    { h:  -4, color: 0x3e4750 },
    { h:   0, color: 0x4f5963 },
    { h:   6, color: 0xb8c2cc },
    { h:  10, color: 0xecf1f6 }
  ],
  alpine: [
    { h: -10, color: 0x13181d },
    { h:  -3, color: 0x2d4856 },
    { h:   0, color: 0x3a5665 },
    { h:   6, color: 0xaed3e6 },
    { h:  10, color: 0xe0f1fa }
  ],
  cedarHighlands: [
    { h: -10, color: 0x132016 },
    { h:  -4, color: 0x235838 },
    { h:   0, color: 0x2f6d46 },
    { h:   6, color: 0x78c89d },
    { h:  10, color: 0xb5e6cb }
  ],
  screeSlope: [
    { h: -10, color: 0x1b1b1b },
    { h:  -2, color: 0x454545 },
    { h:   0, color: 0x595959 },
    { h:   6, color: 0xb9b9b9 },
    { h:  10, color: 0xe3e3e3 }
  ],

  // Aquatic / Coastal
  coast: [
    { h: -10, color: 0x031528 },
    { h:  -6, color: 0x093a5a },
    { h:  -2, color: 0x126b94 },
    { h:   0, color: 0x1878a8 },
    { h:   5, color: 0x80cdea },
    { h:  10, color: 0xc8ecfb }
  ],
  riverLake: [
    { h: -10, color: 0x041628 },
    { h:  -6, color: 0x0b3553 },
    { h:  -2, color: 0x145f8a },
    { h:   0, color: 0x176b9a },
    { h:   6, color: 0x77c7f0 },
    { h:  10, color: 0xb3e5fb }
  ],
  ocean: [
    { h: -10, color: 0x02101b },
    { h:  -6, color: 0x07355c },
    { h:  -2, color: 0x0d4a72 },
    { h:   0, color: 0x136192 },
    { h:   5, color: 0x54b0e2 },
    { h:  10, color: 0x8ed2f2 }
  ],
  coralReef: [
    { h: -10, color: 0x001728 },
    { h:  -6, color: 0x003e5c },
    { h:  -2, color: 0x0a7fb0 },
    { h:   0, color: 0x13b7dc },
    { h:   4, color: 0xff8bb0 },
    { h:  10, color: 0xffddeb }
  ],

  // Exotic / Arcane
  eldritchRift: [
    { h: -10, color: 0x03040c },
    { h:  -6, color: 0x140a2a },
    { h:  -2, color: 0x33115d },
    { h:   0, color: 0x5a1990 },
    { h:   4, color: 0x8d3ad1 },
    { h:  10, color: 0xe0b3ff }
  ],
  mysticGrove: [
    { h: -10, color: 0x120826 },
    { h:  -4, color: 0x311157 },
    { h:   0, color: 0x5d2f8a },
    { h:   4, color: 0x9c63d8 },
    { h:  10, color: 0xf4e6ff }
  ],

  // Volcanic
  volcanic: [
    { h: -10, color: 0x120303 },
    { h:  -6, color: 0x2a0d0d },
    { h:  -2, color: 0x5a1a08 },
    { h:   0, color: 0xca3c07 },
    { h:   4, color: 0xf88436 },
    { h:  10, color: 0xffe7c8 }
  ],
  lavaFields: [
    { h: -10, color: 0x200400 },
    { h:  -4, color: 0x5c1404 },
    { h:   0, color: 0x982606 },
    { h:   4, color: 0xff7a38 },
    { h:  10, color: 0xffd3a3 }
  ],
  obsidianPlain: [
    { h: -10, color: 0x050505 },
    { h:  -2, color: 0x242124 },
    { h:   0, color: 0x343138 },
    { h:   6, color: 0x867f8a },
    { h:  10, color: 0xbdb7c1 }
  ],
  ashWastes: [
    { h: -10, color: 0x131111 },
    { h:  -4, color: 0x3a3636 },
    { h:   0, color: 0x4c4646 },
    { h:   6, color: 0xbbb6b3 },
    { h:  10, color: 0xe0dcd9 }
  ],

  // Others (brief but expressive)
  deadForest: [
    { h: -10, color: 0x1a0f07 },
    { h:  -4, color: 0x3a2d24 },
    { h:   0, color: 0x4a3a2e },
    { h:   6, color: 0x958575 },
    { h:  10, color: 0xb9ab9c }
  ],
  petrifiedForest: [
    { h: -10, color: 0x18110e },
    { h:  -4, color: 0x4b3b33 },
    { h:   0, color: 0x614b40 },
    { h:   6, color: 0xbba08d },
    { h:  10, color: 0xe2cdbd }
  ],
  bambooThicket: [
    { h: -10, color: 0x071e0b },
    { h:  -3, color: 0x0f6328 },
    { h:   0, color: 0x148236 },
    { h:   5, color: 0x5fda8a },
    { h:  10, color: 0x98f5b6 }
  ],
  orchard: [
    { h: -10, color: 0x14250c },
    { h:  -4, color: 0x2a6b25 },
    { h:   0, color: 0x449636 },
    { h:   6, color: 0x9fe879 },
    { h:  10, color: 0xd6f9b1 }
  ],
  shadowfellForest: [
    { h: -10, color: 0x07080b },
    { h:  -4, color: 0x1b1f27 },
    { h:   0, color: 0x2a2e37 },
    { h:   6, color: 0x6d7887 },
    { h:  10, color: 0x9da7b6 }
  ],
  cavern: [
    { h: -10, color: 0x090e12 },
    { h:  -4, color: 0x23303b },
    { h:   0, color: 0x2f3b47 },
    { h:   6, color: 0x718596 },
    { h:  10, color: 0xa7b8c5 }
  ],
  crystalFields: [
    { h: -10, color: 0x0b1022 },
    { h:  -4, color: 0x1e3b86 },
    { h:   0, color: 0x2e55a5 },
    { h:   6, color: 0x8cbaf0 },
    { h:  10, color: 0xcfe4ff }
  ],
  crystalSpires: [
    { h: -10, color: 0x050a18 },
    { h:  -4, color: 0x243e8e },
    { h:   0, color: 0x324b9e },
    { h:   6, color: 0x8eace4 },
    { h:  10, color: 0xcbe0ff }
  ],
  wasteland: [
    { h: -10, color: 0x130a13 },
    { h:  -4, color: 0x4a254a },
    { h:   0, color: 0x5e2f5e },
    { h:   6, color: 0xb07eb0 },
    { h:  10, color: 0xdab0da }
  ],
  ruinedUrban: [
    { h: -10, color: 0x121317 },
    { h:  -4, color: 0x333a45 },
    { h:   0, color: 0x4b525d },
    { h:   6, color: 0x96a0ad },
    { h:  10, color: 0xcdd5df }
  ],
  graveyard: [
    { h: -10, color: 0x151719 },
    { h:  -4, color: 0x2f3a40 },
    { h:   0, color: 0x415057 },
    { h:   6, color: 0x8ea0a9 },
    { h:  10, color: 0xbfced4 }
  ],
  astralPlateau: [
    { h: -10, color: 0x070a22 },
    { h:  -4, color: 0x24309b },
    { h:   0, color: 0x2f3ba9 },
    { h:   6, color: 0x88b8ff },
    { h:  10, color: 0xcfe6ff }
  ],
  arcaneLeyNexus: [
    { h: -10, color: 0x14003a },
    { h:  -4, color: 0x5100b4 },
    { h:   0, color: 0x7600de },
    { h:   6, color: 0xc59af1 },
    { h:  10, color: 0xf0dbff }
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
  // Thematic fine-tuning
  // Ash wastes lowlands extra desaturation
  if (biomeKey === 'ashWastes' && h <= -2) color = desaturate(color, 0.55);
  // Volcanic deep negative = slight desaturation (ash/soot)
  if (biomeKey === 'volcanic' && h <= -3) color = desaturate(color, 0.2);
  // Wetlands depressions: mute and darken a touch
  if ((biomeKey === 'swamp' || biomeKey === 'wetlands' || biomeKey === 'mangrove' || biomeKey === 'floodplain') && h < 0) {
    color = desaturate(color, 0.25);
    color = darken(color, Math.min(0.1, Math.abs(h) / (MAX_H || 10) * 0.15));
  }
  // Desert highs: sun-bleach brightening
  if ((biomeKey === 'desertHot' || biomeKey === 'sandDunes' || biomeKey === 'saltFlats') && h > 0) {
    color = lighten(color, Math.min(0.12, h / (MAX_H || 10) * 0.18));
  }
  // Gentle global height accent: darker valleys, lighter peaks
  if (h !== 0) {
    const t = h / (MAX_H || 10);
    color = h > 0 ? lighten(color, 0.04 * t) : darken(color, 0.05 * Math.abs(t));
  }
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
