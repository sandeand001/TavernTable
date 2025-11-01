/**
 * flora.js - biome-driven automatic tree (plant) population (deterministic).
 * Determinism: All randomness is derived from a provided biome seed + biome key.
 * Non-invasive: only adds/removes placeables of type 'plant'.
 * Heuristics are intentionally coarse and can be tuned later.
 */
import { TERRAIN_PLACEABLES } from '../../../config/TerrainPlaceables.js';
import { createSeededRNG, rngInt, makeWeightedPicker } from '../../../utils/SeededRNG.js';

const ALL_PLANTS = Object.keys(TERRAIN_PLACEABLES).filter(
  (k) => TERRAIN_PLACEABLES[k].type === 'plant'
);

// Simple deterministic 32-bit hash (Jenkins-like mix) used for seed salting
function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

// Utility weight helpers ----------------------------------------------------
function pickIds(regex) {
  const list = ALL_PLANTS.filter((id) => regex.test(id));
  const w = {};
  list.forEach((id) => (w[id] = 1));
  return w;
}

function makeWeights(map) {
  const out = {};
  for (const [id, w] of Object.entries(map)) if (ALL_PLANTS.includes(id)) out[id] = w;
  return out;
}

// Candidate filters / strategies --------------------------------------------
const candidateFilters = {
  adjacentWater(c, x, y) {
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
      if (nh <= 0) return true; // neighbor water
    }
    return false;
  },
  coastlineOnly(c, x, y) {
    return isCoastlineTile(c, x, y);
  },
  // Swamp edge: allow tiles slightly above or even just below waterline if they border at least one dry or wet tile respectively.
  // Intention: pack willows and dead trees along shifting water margins to avoid overly open green fields.
  swampEdge(c, x, y, h) {
    // Accept mild negative (soft flooded) up to -0.6 and positive up to +2 for low swamp hummocks
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
    // Encourage band where water meets land OR slightly submerged adjacent to dry land
    if (h <= 0 && hasDry) return true;
    if (h > 0 && hasWet) return true;
    return false;
  },
  // New depth-aware swamp filter allowing deeper flooded placements.
  swampDeep(c, x, y, h, rng) {
    // Tier cutoffs
    const MIN = -3.2; // absolute lower bound
    const EDGE_BAND_MIN = -0.8;
    const SHALLOW_MIN = -2.0;
    if (h < MIN || h > 2.5) return false;
    // Collect neighbor stats
    let hasWet = false;
    let hasDry = false;
    let nearShallow = false; // neighbor above shallow min
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
      if (nh > SHALLOW_MIN) nearShallow = true; // includes any tile shallower than -2
      if (hasWet && hasDry && nearShallow) break;
    }
    // Band 1: edge & low hummocks - dense
    if (h >= EDGE_BAND_MIN && h <= 0.8) {
      if ((h <= 0 && hasDry) || (h > 0 && hasWet)) return true;
    }
    // Band 2: shallow flooded (-2.0 .. -0.8)
    if (h >= SHALLOW_MIN && h < EDGE_BAND_MIN) {
      if (nearShallow || hasDry) return true; // adjacency to emergent or mixed area
    }
    // Band 3: moderately flooded (-3.2 .. -2.0)
    if (h >= MIN && h < SHALLOW_MIN) {
      if (!nearShallow) return false; // need connection to shallower zone
      // Probabilistic sparse acceptance (30%) using deterministic hash via rng
      const r = rng ? rng() : Math.random();
      return r < 0.3;
    }
    return false;
  },
};

const BIOME_FLORA_PROFILES = [
  { re: /(sandDunes|saltFlats|desertHot|desertCold)/i, density: 0, spacing: 0 },
  { re: /(glacier|frozenLake|packIce|ocean|coralReef)/i, density: 0, spacing: 0 },
  // Override earlier blanket zero-density for underground/exotic so we can add targeted placements.
  { re: /(crystalFields|crystalSpires|eldritchRift)/i, density: 0, spacing: 0 },
  { re: /(obsidianPlain|lavaFields)/i, density: 0, spacing: 0 },
  {
    re: /(ashWastes|wasteland|graveyard|ruinedUrban)/i,
    density: 0.02,
    spacing: 4,
    weights: pickIds(/bare|yellow|small/),
  },
  {
    re: /(screeSlope|geyserBasin)/i,
    density: 0.015,
    spacing: 4,
    weights: pickIds(/bare|small|columnar/),
  },
  {
    re: /(volcanic)/i,
    density: 0.02,
    spacing: 4,
    weights: pickIds(/bare|yellow|small/),
  },
  {
    re: /(tundra)/i,
    density: 0.04,
    spacing: 3,
    weights: pickIds(/bare|conifer|yellow/),
  },
  {
    re: /(alpine)/i,
    density: 0.06,
    spacing: 3,
    elevationFilter: (c, h) => h >= 2,
    // Introduce giant pines for high elevation grandeur + sparse thick trunks
    weights: makeWeights({
      'tree-giant-pine-a': 6,
      'tree-giant-pine-b': 5,
      'tree-giant-pine-c': 4,
      'tree-giant-pine-d': 3,
      'tree-giant-pine-e': 2,
      'tree-thick-a': 1.5,
      'tree-thick-b': 1.2,
      'tree-bare-deciduous': 0.8,
      'tree-green-columnar': 1.2,
      'tree-green-conifer': 1.5,
    }),
  },
  {
    re: /(mountain|cedarHighlands)/i,
    density: 0.12,
    spacing: 2,
    elevationFilter: (c, h) => h >= 1,
    weights: makeWeights({
      'tree-giant-pine-a': 5,
      'tree-giant-pine-b': 4,
      'tree-giant-pine-c': 3,
      'tree-giant-pine-d': 2,
      'tree-giant-pine-e': 1,
      'tree-thick-a': 2.5,
      'tree-thick-b': 2,
      'tree-green-conifer': 2.5,
      'tree-green-columnar': 2,
      'tree-green-tall-columnar': 1.5,
      'tree-green-small': 0.8,
      'tree-bare-deciduous': 0.6,
    }),
  },
  {
    re: /(forestConifer)/i,
    // Reduced density to mitigate visual overcrowding in conifer forests.
    density: 0.28,
    spacing: 1,
    weights: makeWeights({
      'tree-green-conifer': 6,
      'tree-green-columnar': 4,
      'tree-green-tall-columnar': 3,
      'tree-giant-pine-a': 2,
      'tree-giant-pine-b': 1.5,
      'tree-giant-pine-c': 1,
      'tree-green-small': 1,
      'tree-thick-a': 0.6,
    }),
  },
  {
    re: /(forestTemperate)/i,
    // Slightly reduced density for better readability between trunks.
    density: 0.26,
    spacing: 1,
    weights: makeWeights({
      'tree-green-deciduous': 5,
      'tree-green-oval': 4,
      'tree-green-small': 3,
      'tree-green-columnar': 2.5,
      'tree-green-willow': 2,
      // birch family
      'tree-birch-a': 3,
      'tree-birch-b': 2.5,
      'tree-birch-c': 2,
      'tree-birch-d': 1.5,
      'tree-birch-e': 1,
      // occasional flowers / bushes
      'bush-common': 0.8,
      'bush-common-flowers': 0.6,
      'flower-1-group': 0.4,
      'flower-2-group': 0.3,
      'rock-medium-4': 0.2,
      'pebble-round-1': 0.2,
    }),
  },
  // Dead / shadow / petrified refinements
  {
    re: /(deadForest|shadowfellForest)/i,
    // Burnt / Dead forest: emphasize charred, lifeless canopy.
    // Tweaks:
    // - Slightly reduced density so gaps feel scorched/open.
    // - Heavily weight bare trunks; retain tiny hint of living survivors.
    // - Columnar silhouettes kept minimal for vertical contrast.
    density: 0.18, // slightly lower to accentuate emptiness and increase bare ratio
    spacing: 1,
    weights: makeWeights({
      // Bare trunks dominate overwhelmingly
      'tree-bare-deciduous': 150,
      // Reintroduced dead variants (visual variety) with small relative weights so they appear occasionally
      'tree-dead-a': 2.5,
      'tree-dead-b': 2.3,
      'tree-dead-c': 2.1,
      'tree-dead-d': 1.9,
      // Tiny survivor presence (still allow at least one across sampled seeds)
      'tree-green-columnar': 0.5,
      'tree-green-conifer': 0.4,
      'tree-green-small': 0.35,
    }),
  },
  {
    re: /(petrifiedForest)/i,
    density: 0.07,
    spacing: 2,
    // petrified: strictly bare trunks (no partial dead foliage) + sparse rocks/pebbles
    // Adjusted to satisfy deterministic test expecting exclusively bare trees.
    weights: makeWeights({
      'tree-bare-deciduous': 10,
    }),
  },
  {
    re: /(bambooThicket)/i,
    // Tone down extreme bamboo density.
    density: 0.3,
    spacing: 1,
    weights: pickIds(/tall|columnar|small/),
  },
  {
    re: /(mysticGrove|feywildBloom)/i,
    density: 0.38,
    spacing: 1,
    // emphasize non-green colors & cherry blossoms (fantastical purple/pink/orange tones)
    weights: makeWeights({
      'tree-cherry-a': 6,
      'tree-cherry-b': 5,
      'tree-cherry-c': 4,
      'tree-cherry-d': 3,
      'tree-cherry-e': 2,
      'tree-dead-e': 0.8,
      'tree-orange-deciduous': 4,
      'tree-yellow-willow': 3,
      'tree-yellow-conifer': 2.5,
      'tree-green-willow': 1.5,
      'tree-bare-deciduous': 1,
      'tree-green-small': 0.5,
      'flower-1-group': 1.2,
      'flower-2-group': 1,
      'flower-3-group': 0.9,
      'flower-4-group': 0.8,
      'mushroom-laetiporus': 0.4,
      'bush-common-flowers': 0.6,
      'bush-large-flowers': 0.4,
      'pebble-round-3': 0.2,
    }),
  },
  {
    re: /(orchard)/i,
    // Orchard: perfectly regular rows of a single cultivar; no mixed species.
    // Variation added: alternating row spacing and per-row density factors for subtle agricultural pattern variation.
    density: 0.34,
    spacing: 1,
    strategy: 'grid',
    // x: column spacing; rowSpacings: sequence of vertical gaps cycling; rowDensity: probability factor per planted row.
    // fixedOrigin keeps alignment stable.
    grid: {
      x: 4,
      y: 3,
      fixedOrigin: true,
      rowSpacings: [3, 5],
      rowDensity: [1.0, 0.6],
      // New uniform row parameters:
      uniformRowCounts: true, // enforce near-equal trees per row when using generate map
      rowSpacingRange: [3, 6], // inclusive min/max vertical spacing jitter
      jitterX: 1, // small horizontal jitter to soften rigidity
    },
    weights: makeWeights({ 'tree-green-deciduous': 1 }),
  },
  {
    re: /(hills)/i,
    density: 0.16,
    spacing: 2,
    weights: pickIds(/deciduous|conifer|oval|columnar/),
  },
  {
    re: /(grassland)/i,
    density: 0.08,
    spacing: 2,
    weights: pickIds(/deciduous|small|oval|columnar/),
  },
  {
    re: /(savanna)/i,
    density: 0.05,
    spacing: 3,
    weights: pickIds(/small|oval|columnar|bare/),
  },
  {
    re: /(steppe|prairie)/i,
    density: 0.02,
    spacing: 3,
    weights: pickIds(/small|bare|oval/),
  },
  {
    re: /(thornscrub|chaparral)/i,
    density: 0.05,
    spacing: 3,
    weights: pickIds(/small|bare|oval|columnar/),
  },
  {
    re: /(oasis)/i,
    density: 0.24,
    spacing: 2,
    candidateFilter: 'adjacentWater', // palms hug the pool edge
    // Palm-only composition for thematic clarity.
    weights: makeWeights({
      'tree-single-palm': 8,
      'tree-double-palm': 5,
    }),
  },
  // Cavern biome: introduce sparse rocks & a few dead stumps for subterranean feel.
  {
    re: /(cavern)/i,
    density: 0.06,
    spacing: 3,
    weights: makeWeights({
      'rock-medium-4': 5,
      'rock-medium-3': 4,
      'rock-medium-2': 3,
      'pebble-round-1': 2,
      'pebble-round-2': 2,
      'tree-dead-a': 0.8,
      'tree-dead-b': 0.6,
      'mushroom-common': 0.5,
      'mushroom-oyster': 0.3,
    }),
  },
  // Fungal Grove: dominated by mushroom species; very low traditional trees.
  {
    re: /(fungalGrove)/i,
    density: 0.32,
    spacing: 1,
    weights: makeWeights({
      'mushroom-common': 6,
      'mushroom-redcap': 5,
      'mushroom-oyster': 4,
      'mushroom-laetiporus': 3,
      'mushroom-glow': 2.5,
      'mushroom-giant-cap': 2,
      'tree-bare-deciduous': 0.5,
      'tree-dead-a': 0.4,
      'rock-medium-4': 0.3,
      'pebble-round-2': 0.2,
    }),
  },
  // Shadowfell Forest: dark, sparse dead + bare trees with a faint presence of withered conifers.
  {
    re: /(shadowfellForest)/i,
    density: 0.2,
    spacing: 2,
    weights: makeWeights({
      'tree-dead-a': 6,
      'tree-dead-b': 5,
      'tree-dead-c': 4,
      'tree-dead-d': 3,
      'tree-bare-deciduous': 3,
      'tree-green-conifer': 0.6,
      'tree-green-columnar': 0.4,
      'mushroom-common': 0.6,
      'mushroom-redcap': 0.4,
      'rock-medium-4': 0.5,
      'pebble-square-3': 0.3,
    }),
  },
  {
    re: /(bloodMarsh)/i,
    density: 0.2,
    spacing: 2,
    elevationFilter: (c, h) => h > 0,
    weights: makeWeights({
      'tree-bare-deciduous': 6,
      'tree-green-willow': 1,
      'tree-yellow-willow': 1,
    }),
  },
  {
    re: /(swamp|wetlands|bog)/i,
    density: 0.42,
    spacing: 1,
    candidateFilter: 'swampDeep',
    weights: makeWeights({
      'tree-green-willow': 9,
      'tree-yellow-willow': 5,
      'tree-bare-deciduous': 4,
      'tree-dead-a': 2.5,
      'tree-dead-b': 2,
      'tree-green-small': 2,
      'tree-green-oval': 1.5,
      'mushroom-common': 2,
      'mushroom-oyster': 1.2,
      'mushroom-redcap': 0.8,
      'mushroom-laetiporus': 0.6,
      'bush-common': 1.4,
      'bush-long-1': 1,
      'bush-long-2': 0.8,
      'grass-common-tall': 0.6,
    }),
  },
  {
    re: /(floodplain)/i,
    density: 0.18,
    spacing: 2,
    weights: pickIds(/deciduous|willow|small|oval/),
  },
  {
    re: /(mangrove)/i,
    density: 0.28,
    spacing: 2,
    candidateFilter: 'adjacentWater', // cluster along tidal water edges
    weights: makeWeights({
      'tree-green-willow': 4,
      'tree-yellow-willow': 2,
      'tree-bare-deciduous': 1,
      'tree-green-small': 1,
    }),
  },
  {
    re: /(riverLake)/i,
    density: 0.14,
    spacing: 2,
    weights: pickIds(/willow|deciduous|oval|small/),
  },
  {
    re: /(coast|shore|beach)/i,
    density: 0.12,
    spacing: 2,
    candidateFilter: 'coastlineOnly',
    // Coastline: strong palm bias only.
    weights: makeWeights({
      'tree-single-palm': 7,
      'tree-double-palm': 4,
    }),
    coastlinePalms: true,
  },
  {
    re: /(astralPlateau)/i,
    density: 0.06,
    spacing: 3,
    weights: pickIds(/columnar|tall|conifer/),
  },
  {
    re: /(arcaneLeyNexus)/i,
    density: 0.12,
    spacing: 2,
    weights: makeWeights({
      'tree-cherry-a': 5,
      'tree-cherry-b': 4,
      'tree-cherry-c': 3,
      'tree-yellow-conifer': 3,
      'tree-orange-deciduous': 3,
      'tree-yellow-willow': 2.5,
      'tree-green-willow': 1.5,
      'tree-green-columnar': 1.2,
      'tree-dead-e': 1,
      'tree-birch-a': 1,
      'flower-1-group': 1.2,
      'flower-2-group': 1,
      'flower-6': 0.9,
      'flower-6-2': 0.8,
      'mushroom-laetiporus': 0.5,
      'bush-common-flowers': 0.6,
      'bush-large-flowers': 0.4,
    }),
  },
];

const DEFAULT_PROFILE = {
  density: 0.07,
  spacing: 2,
  weights: makeWeights({
    'tree-green-deciduous': 4,
    'tree-green-oval': 3,
    'tree-green-small': 2,
    'tree-green-conifer': 2,
    'tree-birch-a': 1.2,
    'bush-common': 0.5,
    'grass-common-short': 0.4,
    'rock-medium-4': 0.2,
  }),
};

// (pickIds moved earlier)

function clearExistingPlants(c) {
  const tm = c.terrainManager;
  if (!tm?.placeables) return;
  for (const [key, list] of tm.placeables) {
    if (!Array.isArray(list) || list.length === 0) continue;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      if (p?.placeableType === 'plant') {
        try {
          p.parent?.removeChild?.(p);
        } catch (_) {
          // ignore placeable removal errors
        }
        list.splice(i, 1);
      }
    }
    if (list.length === 0) tm.placeables.delete(key);
  }
}

function resolveProfile(biomeKey) {
  if (!biomeKey) return DEFAULT_PROFILE;
  const found = BIOME_FLORA_PROFILES.find((p) => p.re.test(biomeKey));
  return found || DEFAULT_PROFILE;
}

function isCoastlineTile(c, x, y) {
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

function manhattan(a, b) {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
}

function getBiomeRNG(baseSeed, biomeKey, salt) {
  const mix = (baseSeed >>> 0) ^ hash32(String(biomeKey || '')) ^ (salt * 0x9e3779b1);
  return createSeededRNG(mix >>> 0, salt >>> 0);
}

export function autoPopulateBiomeFlora(c, biomeKey, seed) {
  try {
    if (!c?.terrainManager?.gameManager?.gridContainer) return true; // headless mode: allow logic proceed as success
    const tm = c.terrainManager;
    clearExistingPlants(c);
    const profile = resolveProfile(biomeKey);
    const {
      density,
      spacing,
      weights,
      elevationFilter,
      coastlinePalms,
      candidateFilter,
      strategy,
      grid,
    } = profile;
    if (!density || density <= 0) return;
    const rows = c.gameManager.rows;
    const cols = c.gameManager.cols;
    // Strategy: grid (orchard deterministic rows)
    if (strategy === 'grid' && grid) {
      const gx = Math.max(2, grid.x | 0);
      const baseGy = Math.max(2, grid.y | 0);
      const rowSpacings =
        Array.isArray(grid.rowSpacings) && grid.rowSpacings.length > 0
          ? grid.rowSpacings.map((v) => Math.max(1, v | 0))
          : [baseGy];
      const rowDensity =
        Array.isArray(grid.rowDensity) && grid.rowDensity.length > 0 ? grid.rowDensity : [1];
      // Deterministic offset unless fixedOrigin directive present
      let offX = 0;
      let offY = 0;
      if (!grid.fixedOrigin) {
        const offRng = getBiomeRNG(seed || c._biomeSeed || 0, biomeKey, 101);
        offX = Math.floor(offRng() * gx);
        offY = Math.floor(offRng() * baseGy);
      }
      const plantRng = getBiomeRNG(seed || c._biomeSeed || 0, biomeKey, 103);
      const pick = makeWeightedPicker(
        weights,
        getBiomeRNG(seed || c._biomeSeed || 0, biomeKey, 102)
      );
      if (grid.uniformRowCounts) {
        // Uniform row mode: every planted row attempts to use identical column positions;
        // perceived density differences arise from horizontal jitter scaled by rowDensity factors.
        const colsAvailable = Math.floor((cols - offX) / gx);
        const jitterX = Math.max(0, grid.jitterX | 0);
        if (colsAvailable > 0) {
          let y = offY;
          let rowIndex = 0;
          const [minSpace, maxSpace] =
            Array.isArray(grid.rowSpacingRange) && grid.rowSpacingRange.length === 2
              ? [Math.max(1, grid.rowSpacingRange[0] | 0), Math.max(1, grid.rowSpacingRange[1] | 0)]
              : [baseGy, baseGy];
          while (y < rows) {
            const densityFactor = rowDensity[rowIndex % rowDensity.length];
            const rowRng = getBiomeRNG(seed || c._biomeSeed || 0, biomeKey, 400 + rowIndex);
            for (let ci = 0; ci < colsAvailable; ci++) {
              let x = offX + ci * gx;
              if (x >= cols) break;
              if (jitterX > 0) {
                // Jitter scaled inversely by densityFactor so sparser rows look more irregular.
                const scale = densityFactor < 1 ? 1 + (1 - densityFactor) : 1;
                const j = Math.round((rowRng() - 0.5) * 2 * jitterX * scale);
                x = Math.min(cols - 1, Math.max(0, x + j));
              }
              const h = c.getTerrainHeight?.(x, y) ?? 0;
              if (h <= 0) continue;
              if (elevationFilter && !elevationFilter(c, h)) continue;
              const id = pick();
              tm.placeTerrainItem(x, y, id);
            }
            const span = Math.abs(maxSpace - minSpace);
            const jitter = span > 0 ? Math.floor(rowRng() * (span + 1)) : 0;
            y += Math.min(minSpace, maxSpace) + jitter;
            rowIndex++;
          }
        }
      } else {
        let y = offY;
        let rowIndex = 0;
        while (y < rows) {
          const densityFactor = rowDensity[rowIndex % rowDensity.length];
          for (let x = offX; x < cols; x += gx) {
            if (densityFactor < 1 && plantRng() > densityFactor) continue; // thin within row
            const h = c.getTerrainHeight?.(x, y) ?? 0;
            if (h <= 0) continue;
            if (elevationFilter && !elevationFilter(c, h)) continue;
            const id = pick();
            tm.placeTerrainItem(x, y, id);
          }
          const spacing = rowSpacings[rowIndex % rowSpacings.length];
          y += spacing;
          rowIndex++;
        }
      }
      return;
    }

    // Generic candidate collection (with optional filters)
    const filterFn =
      typeof candidateFilter === 'string' ? candidateFilters[candidateFilter] : candidateFilter;
    const candidates = [];
    const coordRng = getBiomeRNG(seed || c._biomeSeed || 0, biomeKey, 555);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const h = c.getTerrainHeight?.(x, y) ?? 0;
        // Depth gating rules:
        if (candidateFilter === 'swampDeep') {
          // Accept depths down to -3.2 via filter itself; no pre-skip except hard floor
          if (h < -3.2 || h > 2.6) continue;
        } else if (candidateFilter === 'swampEdge') {
          if (h <= 0 && !(h >= -1.0)) continue; // legacy edge allowance
        } else {
          if (h <= 0) continue; // generic rule: stay above waterline
        }
        if (elevationFilter && !elevationFilter(c, h)) continue;
        if (filterFn && !filterFn(c, x, y, h, coordRng)) continue;
        candidates.push([x, y, h]);
      }
    }
    if (!candidates.length) return;
    const target = Math.max(1, Math.floor(candidates.length * density));
    const placed = [];
    let attempts = 0;
    const maxAttempts = target * 20;
    const rng = getBiomeRNG(seed || c._biomeSeed || 0, biomeKey, 201);
    const pick = makeWeightedPicker(weights, getBiomeRNG(seed || c._biomeSeed || 0, biomeKey, 202));
    while (placed.length < target && attempts < maxAttempts) {
      attempts++;
      const cand = candidates[rngInt(rng, candidates.length)];
      if (!cand) continue;
      const [x, y] = cand;
      if (spacing > 0 && placed.some((p) => manhattan(p, cand) < spacing)) continue;
      let chosenWeights = weights;
      if (coastlinePalms) {
        const onCoast = isCoastlineTile(c, x, y);
        chosenWeights = boostPalmWeights(weights, onCoast ? 3 : 0.4);
      }
      // If coastline palm boost applied we need a new picker for that variation (deterministic via coordinate salt)
      let id;
      if (chosenWeights !== weights) {
        const coordSalt = (x * 73856093) ^ (y * 19349663);
        const localPick = makeWeightedPicker(
          chosenWeights,
          getBiomeRNG(seed || c._biomeSeed || 0, biomeKey, 300 + (coordSalt & 0xff))
        );
        id = localPick();
      } else {
        id = pick();
      }
      if (!id) continue;
      const ok = tm.placeTerrainItem(x, y, id);
      if (ok) placed.push([x, y]);
    }
  } catch (_) {
    /* best effort */
  }
}

function boostPalmWeights(weights, factor) {
  const out = {};
  for (const [id, w] of Object.entries(weights)) {
    out[id] = /palm/i.test(id) ? w * factor : w;
  }
  return out;
}
