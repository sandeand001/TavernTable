/**
 * BiomeElevationGenerator.js
 *
 * Purpose: When a biome is selected and the terrain hasn't been edited manually,
 * generate an evocative elevation field tailored to the biome.
 *
 * API:
 *  - generateBiomeElevationField(biomeKey, rows, cols, options?) -> number[][]
 *    options: {
 *      seed?: number,          // deterministic seed
 *      relief?: number,        // overall height magnitude multiplier (default varies by biome)
 *      roughness?: number,     // noise complexity multiplier (0.5..2 typical)
 *      waterBias?: number,     // pushes heights downward (negative) or upward (positive)
 *      orientation?: number,   // degrees for directional features (e.g., dunes)
 *    }
 *
 *  - isAllDefaultHeight(heightArray, defaultHeight?) -> boolean
 *  - applyBiomeElevationIfFlat(heightArray, biomeKey, options?) -> number[][]
 */

import { TERRAIN_CONFIG } from '../../config/terrain/TerrainConstants.js';
import { TerrainHeightUtils } from '../../utils/terrain/TerrainHeightUtils.js';
import { pickRecipe } from './internals/biomeShapeFunctions.js';

// ── Constants ───────────────────────────────────────────────

// Desired maximum absolute elevation (in levels) per biome for better thematic variety.
// Values represent the target |height| amplitude, subject to perception scaling and config bounds.
const BIOME_AMPLITUDE_BY_KEY = {
  // Plains/grass
  grassland: 5,
  hills: 7,
  mountain: 10,
  alpine: 10,
  // Deserts
  desertHot: 3,
  sandDunes: 8,
  desertCold: 2,
  oasis: 3,
  saltFlats: 1,
  thornscrub: 3,
  // Wet/flat
  wetlands: 3,
  swamp: 3,
  floodplain: 3,
  bloodMarsh: 3,
  mangrove: 3,
  riverLake: 4,
  // Cold
  tundra: 2,
  glacier: 6,
  frozenLake: 3,
  packIce: 3,
  // Coasts/oceanic
  coast: 5,
  ocean: 5,
  coralReef: 6,
  // Forests & variants
  forestTemperate: 5,
  forestConifer: 6,
  savanna: 4,
  steppe: 3,
  deadForest: 3,
  petrifiedForest: 6,
  bambooThicket: 4,
  orchard: 3,
  mysticGrove: 4,
  feywildBloom: 5,
  shadowfellForest: 4,
  // Underground/oddities
  cavern: 5,
  fungalGrove: 4,
  crystalFields: 7,
  crystalSpires: 9,
  eldritchRift: 8,
  // Volcanic/wastes
  volcanic: 9,
  obsidianPlain: 3,
  ashWastes: 4,
  lavaFields: 6,
  wasteland: 5,
  ruinedUrban: 4,
  graveyard: 2,
  // Exotic
  astralPlateau: 7,
  arcaneLeyNexus: 8,
};

// Optional: per-biome post-process profiles to refine feel beyond amplitude alone.
// Fields:
// - minAmp, maxAmp: clamp the final target amplitude (levels)
// - smoothRadius, smoothIterations: small box blur before quantization
// - ridgePower: >1 sharpens relief (mountains); <1 softens (dunes/flats); 1 = no change
// - waterShift: constant level shift (negative for wetter biomes)
// - jumpPx: desired typical visual elevation jump between neighboring tiles in pixels; converted to a level step using current elevation unit
// - quantStep: fixed level step fallback if jumpPx not provided
const BIOME_ELEVATION_PROFILES = (() => {
  /** @type {Record<string, {minAmp?:number,maxAmp?:number,smoothRadius?:number,smoothIterations?:number,ridgePower?:number,waterShift?:number,quantStep?:number}>} */
  const p = {};

  // Helpers to assign multiple keys
  const set = (keys, cfg) => {
    keys.forEach((k) => {
      p[k] = { ...(p[k] || {}), ...cfg };
    });
  };

  // Very flat
  set(['saltFlats', 'frozenLake', 'obsidianPlain', 'ashWastes'], {
    minAmp: 1,
    maxAmp: 3,
    smoothRadius: 2,
    smoothIterations: 2,
    ridgePower: 0.95,
    jumpPx: 1.5,
  });

  // Rolling
  set(['grassland', 'savanna', 'steppe', 'orchard', 'tundra'], {
    minAmp: 3,
    maxAmp: 6,
    smoothRadius: 1,
    smoothIterations: 1,
    ridgePower: 1.0,
    jumpPx: 2.5,
  });
  // Dunes: extra smooth
  set(['sandDunes'], {
    minAmp: 4,
    maxAmp: 7,
    smoothRadius: 2,
    smoothIterations: 2,
    ridgePower: 0.95,
    jumpPx: 2.0,
  });

  // Undulating/rugged forests
  set(['forestTemperate', 'forestConifer', 'wasteland', 'deadForest', 'bambooThicket'], {
    minAmp: 4,
    maxAmp: 7,
    smoothRadius: 1,
    smoothIterations: 1,
    ridgePower: 1.05,
    jumpPx: 3.5,
  });

  // Hilly
  set(['hills', 'cedarHighlands', 'petrifiedForest'], {
    minAmp: 6,
    maxAmp: 9,
    ridgePower: 1.12,
    jumpPx: 5.0,
  });

  // Mountainous
  set(['mountain', 'alpine', 'screeSlope', 'crystalSpires', 'volcanic'], {
    minAmp: 8,
    maxAmp: 10,
    ridgePower: 1.25,
    jumpPx: 10.0,
  });

  // Wet/lowland
  set(['wetlands', 'swamp', 'floodplain', 'mangrove', 'riverLake', 'geyserBasin', 'bloodMarsh'], {
    minAmp: 3,
    maxAmp: 6,
    smoothRadius: 1,
    smoothIterations: 2,
    ridgePower: 0.98,
    waterShift: -1,
    jumpPx: 2.5,
  });

  // Aquatic
  set(['ocean'], {
    minAmp: 4,
    maxAmp: 6,
    smoothRadius: 1,
    smoothIterations: 2,
    ridgePower: 1.0,
    waterShift: -2,
    jumpPx: 3.5,
  });
  set(['coralReef'], {
    minAmp: 5,
    maxAmp: 7,
    smoothRadius: 1,
    smoothIterations: 1,
    ridgePower: 1.12,
    waterShift: -1,
    jumpPx: 4.5,
  });

  // Cold
  set(['glacier'], { minAmp: 5, maxAmp: 7, ridgePower: 1.12, jumpPx: 6.0 });
  set(['packIce'], { minAmp: 4, maxAmp: 6, smoothRadius: 1, smoothIterations: 1, jumpPx: 3.5 });

  // Underground/exotic
  set(['cavern'], {
    minAmp: 4,
    maxAmp: 6,
    smoothRadius: 1,
    smoothIterations: 1,
    waterShift: -1,
    jumpPx: 3.0,
  });
  set(['fungalGrove'], { minAmp: 3, maxAmp: 5, smoothRadius: 1, smoothIterations: 1, jumpPx: 2.5 });
  set(['crystalFields'], { minAmp: 6, maxAmp: 8, ridgePower: 1.18, jumpPx: 6.0 });
  set(['eldritchRift'], { minAmp: 7, maxAmp: 9, ridgePower: 1.2, jumpPx: 7.0 });
  set(['astralPlateau'], { minAmp: 6, maxAmp: 8, ridgePower: 1.05, waterShift: 1, jumpPx: 4.0 });
  set(['arcaneLeyNexus'], { minAmp: 7, maxAmp: 9, ridgePower: 1.15, jumpPx: 6.5 });

  // Coasts
  set(['coast'], {
    minAmp: 4,
    maxAmp: 6,
    smoothRadius: 2,
    smoothIterations: 1,
    ridgePower: 1.0,
    waterShift: -1,
    jumpPx: 3.0,
  });

  // Defaults are permissive; missing keys will fall back gracefully.
  return p;
})();

function getProfileForBiome(biomeKey) {
  return BIOME_ELEVATION_PROFILES[biomeKey] || {};
}

// ── Noise Helpers ───────────────────────────────────────────

// Small, separable-ish box blur for smoothing before quantization
function smoothHeightsInPlace(arr, rows, cols, radius = 1, iterations = 1) {
  if (!radius || radius <= 0 || !iterations || iterations <= 0) return;
  const tmp = TerrainHeightUtils.createHeightArray(rows, cols, 0);
  for (let it = 0; it < iterations; it++) {
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        let sum = 0,
          count = 0;
        const y0 = Math.max(0, y - radius),
          y1 = Math.min(rows - 1, y + radius);
        const x0 = Math.max(0, x - radius),
          x1 = Math.min(cols - 1, x + radius);
        for (let yy = y0; yy <= y1; yy++) {
          for (let xx = x0; xx <= x1; xx++) {
            sum += arr[yy][xx];
            count++;
          }
        }
        tmp[y][x] = count > 0 ? sum / count : arr[y][x];
      }
    }
    // copy back
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        arr[y][x] = tmp[y][x];
      }
    }
  }
}

function applyRidgePowerInPlace(arr, rows, cols, power = 1.0) {
  if (!power || power === 1) return;
  const p = Math.max(0.5, Math.min(2.0, power));
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const v = arr[y][x];
      const s = v >= 0 ? 1 : -1;
      const a = Math.abs(v);
      arr[y][x] = s * Math.pow(a, p);
    }
  }
}

// ── Generation API ─────────────────────────────────────────

export function isAllDefaultHeight(heightArray, defaultHeight = TERRAIN_CONFIG.DEFAULT_HEIGHT) {
  if (!Array.isArray(heightArray) || heightArray.length === 0 || !Array.isArray(heightArray[0]))
    return false;
  for (let y = 0; y < heightArray.length; y++) {
    const row = heightArray[y];
    for (let x = 0; x < row.length; x++) {
      if (row[x] !== defaultHeight) return false;
    }
  }
  return true;
}

export function generateBiomeElevationField(biomeKey, rows, cols, options = {}) {
  const seed = Number.isFinite(options.seed)
    ? options.seed
    : Math.floor((options.seed || Date.now()) % 2147483647);
  const reliefMul = Number.isFinite(options.relief) ? options.relief : undefined;
  const roughness = Number.isFinite(options.roughness) ? options.roughness : undefined;
  const waterBias = Number.isFinite(options.waterBias) ? options.waterBias : undefined;
  const orientation = Number.isFinite(options.orientation) ? options.orientation : undefined;

  const recipe = pickRecipe(biomeKey);
  const profile = getProfileForBiome(biomeKey);

  // First pass: compute raw heights from the biome recipe (floating)
  const raw = TerrainHeightUtils.createHeightArray(rows, cols, 0);
  let minH = Infinity,
    maxH = -Infinity;

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const nx = cols > 1 ? x / (cols - 1) : 0.5;
      const ny = rows > 1 ? y / (rows - 1) : 0.5;
      const h = recipe(x, y, nx, ny, seed, {
        relief: reliefMul,
        roughness,
        waterBias,
        orientation,
      });
      raw[y][x] = h;
      if (h < minH) minH = h;
      if (h > maxH) maxH = h;
    }
  }

  // Determine scaling that preserves water bias (scale relative to 0, do NOT recenter on mean)
  const maxAbsRaw = Math.max(Math.abs(minH), Math.abs(maxH));

  const maxAbsLevel = Math.max(
    Math.abs(TERRAIN_CONFIG.MIN_HEIGHT),
    Math.abs(TERRAIN_CONFIG.MAX_HEIGHT)
  );
  // Biome-themed amplitude (in levels), only scaled by optional relief; perception affects quantization, not amplitude
  const biomeBase = BIOME_AMPLITUDE_BY_KEY[biomeKey] ?? Math.round(maxAbsLevel * 0.6);
  const reliefFactor = Number.isFinite(reliefMul) ? reliefMul : 1;
  let targetAmplitude = Math.max(1, Math.min(maxAbsLevel, Math.round(biomeBase * reliefFactor)));
  // Clamp by biome profile range if provided
  if (Number.isFinite(profile.minAmp)) targetAmplitude = Math.max(profile.minAmp, targetAmplitude);
  if (Number.isFinite(profile.maxAmp)) targetAmplitude = Math.min(profile.maxAmp, targetAmplitude);

  // Determine quantization step by desired visual jump size and current elevation unit
  const baseUnit = TERRAIN_CONFIG.ELEVATION_SHADOW_OFFSET || 8;
  const currentUnit = TerrainHeightUtils.getElevationUnit();
  const unitPx = currentUnit > 0 ? currentUnit : baseUnit;
  let step = TERRAIN_CONFIG.HEIGHT_STEP || 1;
  if (typeof profile.jumpPx === 'number' && profile.jumpPx > 0 && unitPx > 0) {
    const levelsPerJump = profile.jumpPx / unitPx; // levels that produce desired px jump
    // Round to at least 1 step and prefer multiples of base step
    const raw = Math.max(levelsPerJump, step);
    // Snap to nearest multiple of base step
    const mult = Math.max(1, Math.round(raw / step));
    step = mult * step;
  } else if (typeof profile.quantStep === 'number' && profile.quantStep > 0) {
    step = profile.quantStep;
  }
  const out = TerrainHeightUtils.createHeightArray(rows, cols, TERRAIN_CONFIG.DEFAULT_HEIGHT);

  if (!(maxAbsRaw > 1e-6)) {
    // Degenerate case: flat field from recipe; just return zeros (default height)
    return out;
  }

  // Work buffer for scaled floats prior to quantization
  const work = TerrainHeightUtils.createHeightArray(rows, cols, 0);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      // Scale relative to 0 to preserve net waterBias and absolute offsets from recipes
      work[y][x] = (raw[y][x] / maxAbsRaw) * targetAmplitude;
    }
  }

  // Optional smoothing for specific biomes to ensure rolling/flat feel
  if (
    profile.smoothRadius &&
    profile.smoothRadius > 0 &&
    profile.smoothIterations &&
    profile.smoothIterations > 0
  ) {
    smoothHeightsInPlace(work, rows, cols, profile.smoothRadius, profile.smoothIterations);
  }

  // Optional ridge/soften power curve
  if (profile.ridgePower && profile.ridgePower !== 1) {
    applyRidgePowerInPlace(work, rows, cols, profile.ridgePower);
  }

  // Optional water shift to bias below or above sea level (0)
  const shift = Number.isFinite(profile.waterShift) ? profile.waterShift : 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const v = work[y][x] + shift;
      const quantized = Math.round(v / step) * step;
      out[y][x] = TerrainHeightUtils.clampHeight(quantized);
    }
  }

  return out;
}

// applyBiomeElevationIfFlat removed (unused): previously generated biome elevation only if
// existing height array was entirely default. No references remained after cleanup.
// Re-exported for unit test that asserts behavior; keeping implementation small.
export function applyBiomeElevationIfFlat(heightArray, biomeKey, options = {}) {
  if (!TerrainHeightUtils.isValidHeightArray(heightArray)) return heightArray;
  const rows = heightArray.length;
  const cols = heightArray[0].length;
  if (isAllDefaultHeight(heightArray, TERRAIN_CONFIG.DEFAULT_HEIGHT)) {
    return generateBiomeElevationField(biomeKey, rows, cols, options);
  }
  return TerrainHeightUtils.copyHeightArray(heightArray);
}

// ── Constants (Elevation Hints) ─────────────────────────────

// Biome-specific default elevation perception (pixels per level) for UI slider.
// This does not force generation outcome by itself; it sets the runtime unit so
// visuals and quantization (which uses getElevationUnit) align with the biome.
const BIOME_UNIT_BY_KEY = {
  // Mountainous
  mountain: 12,
  alpine: 12,
  screeSlope: 12,
  crystalSpires: 12,
  volcanic: 12,
  // Hilly
  hills: 10,
  cedarHighlands: 10,
  petrifiedForest: 10,
  // Forest/rugged
  forestTemperate: 8,
  forestConifer: 8,
  wasteland: 8,
  deadForest: 8,
  bambooThicket: 8,
  // Rolling plains
  grassland: 6,
  savanna: 6,
  steppe: 6,
  orchard: 6,
  tundra: 6,
  // Dunes
  sandDunes: 6,
  // Very flat
  saltFlats: 5,
  frozenLake: 5,
  ashWastes: 5,
  obsidianPlain: 5,
  // Wet/coastal/riverine
  wetlands: 6,
  swamp: 6,
  floodplain: 6,
  mangrove: 6,
  riverLake: 6,
  geyserBasin: 6,
  bloodMarsh: 6,
  coast: 7,
  // Aquatic
  ocean: 7,
  coralReef: 8,
  // Arctic
  glacier: 9,
  packIce: 7,
  // Underground/exotic
  cavern: 7,
  fungalGrove: 6,
  crystalFields: 9,
  eldritchRift: 10,
  astralPlateau: 8,
  arcaneLeyNexus: 9,
};

export function getBiomeElevationScaleHint(biomeKey) {
  return BIOME_UNIT_BY_KEY[biomeKey] || TERRAIN_CONFIG.ELEVATION_SHADOW_OFFSET || 8;
}
