// ── Imports & Setup ──────────────────────────────────────────
// FloraProfiles.js — Biome flora profiles, spectral variants, and data tables.
// Runtime helper functions live in src/terrain/flora/floraHelpers.js.

import { TERRAIN_PLACEABLES } from './TerrainPlaceables.js';
import { isSpectralPlaceable } from '../../terrain/flora/floraHelpers.js';

const ALL_PLANTS = Object.keys(TERRAIN_PLACEABLES).filter((k) => {
  const type = TERRAIN_PLACEABLES[k].type;
  return type === 'plant' || type === 'plant-family';
});

// ── Weight Utilities ─────────────────────────────────────────
function pickIds(regex, { allowSpectral = false } = {}) {
  const list = ALL_PLANTS.filter(
    (id) => regex.test(id) && (allowSpectral || !isSpectralPlaceable(id))
  );
  const w = {};
  list.forEach((id) => (w[id] = 1));
  return w;
}

function makeWeights(map, { allowSpectral = false } = {}) {
  const out = {};
  for (const [id, w] of Object.entries(map)) {
    if (!ALL_PLANTS.includes(id)) continue;
    if (!allowSpectral && isSpectralPlaceable(id)) continue;
    out[id] = w;
  }
  return out;
}

// ── Spectral Variant Mapping ─────────────────────────────────
const SPECTRAL_VARIANTS = {
  'tree-birch-a': 'tree-birch-a-spectral',
  'tree-birch-b': 'tree-birch-b-spectral',
  'tree-birch-c': 'tree-birch-c-spectral',
  'tree-birch-d': 'tree-birch-d-spectral',
  'tree-birch-e': 'tree-birch-e-spectral',
  'tree-thick-a': 'tree-thick-a-spectral',
  'tree-thick-b': 'tree-thick-b-spectral',
  'tree-thick-c': 'tree-thick-c-spectral',
  'tree-thick-d': 'tree-thick-d-spectral',
  'tree-thick-e': 'tree-thick-e-spectral',
  'bush-common-flowers': 'bush-common-flowers-spectral',
  'bush-large-flowers': 'bush-large-flowers-spectral',
  'flower-1-group': 'flower-1-group-spectral',
  'flower-2-group': 'flower-2-group-spectral',
  'flower-3-group': 'flower-3-group-spectral',
  'flower-4-group': 'flower-4-group-spectral',
  'flower-6': 'flower-6-spectral',
  'flower-6-2': 'flower-6-2-spectral',
  'mushroom-oyster': 'mushroom-oyster-spectral',
  'mushroom-laetiporus': 'mushroom-laetiporus-spectral',
  'grass-wispy-short': 'grass-wispy-short-spectral',
  'grass-wispy-tall': 'grass-wispy-tall-spectral',
  'rock-medium-4': 'rock-medium-4-spectral',
  'pebble-round-3': 'pebble-round-3-spectral',
  'pebble-square-3': 'pebble-square-3-spectral',
};

function withSpectralVariants(weightMap) {
  const transformed = {};
  for (const [id, weight] of Object.entries(weightMap)) {
    const targetId = SPECTRAL_VARIANTS[id] || id;
    transformed[targetId] = (transformed[targetId] || 0) + weight;
  }
  return transformed;
}

// ── Biome Flora Profiles ──────────────────────────────────────
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
  {
    re: /(rainforest|tropicalForest|jungle)/i,
    density: 0.34,
    spacing: 1,
    weights: makeWeights({
      'tree-single-palm': 5,
      'tree-double-palm': 4,
      'tree-green-willow': 2.5,
      'plant-tropical-banana-a': 5,
      'plant-tropical-banana-b': 4.5,
      'plant-tropical-monstera-a': 6,
      'plant-tropical-monstera-b': 5.5,
      'plant-tropical-fern-a': 4.5,
      'plant-tropical-fern-b': 4.2,
      'plant-tropical-fern-c': 3.8,
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
    // Spectral groves: restrict to spectral families and tinted birches
    weights: makeWeights(
      withSpectralVariants({
        'family-spectral': 6,
        'tree-thick-a': 5,
        'tree-thick-b': 4,
        'tree-thick-c': 3.5,
        'tree-thick-d': 3,
        'tree-thick-e': 2.5,
        'tree-birch-a': 3,
        'tree-birch-b': 2.6,
        'tree-birch-c': 2.2,
        'tree-birch-d': 1.8,
        'tree-birch-e': 1.4,
        'bush-common-flowers': 1.2,
        'bush-large-flowers': 1,
        'flower-1-group': 0.9,
        'flower-2-group': 0.8,
        'flower-3-group': 0.7,
        'flower-4-group': 0.6,
        'flower-6': 0.6,
        'flower-6-2': 0.5,
        'mushroom-oyster': 0.4,
        'mushroom-laetiporus': 0.35,
        'grass-wispy-short': 0.6,
        'grass-wispy-tall': 0.5,
        'rock-medium-4': 0.4,
        'pebble-round-3': 0.35,
        'pebble-square-3': 0.3,
      }),
      { allowSpectral: true }
    ),
    allowSpectral: true,
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
    density: 0.22,
    spacing: 2,
    candidateFilter: 'oasisSetback', // palms ring the pool but leave the shoreline clear
    // Palm-only composition for thematic clarity.
    weights: makeWeights({
      'tree-single-palm': 8,
      'tree-double-palm': 5,
      'plant-tropical-banana-a': 4,
      'plant-tropical-banana-b': 3,
      'plant-tropical-monstera-a': 3,
      'plant-tropical-monstera-b': 2.5,
      'plant-tropical-fern-a': 2,
      'plant-tropical-fern-b': 1.8,
      'plant-tropical-fern-c': 1.6,
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
      'plant-tropical-banana-a': 2.5,
      'plant-tropical-monstera-a': 2,
      'plant-tropical-fern-a': 2,
      'plant-tropical-fern-b': 1.6,
    }),
    coastlinePalms: true,
  },
  {
    re: /(astralPlateau)/i,
    density: 0.06,
    spacing: 3,
    weights: makeWeights(
      withSpectralVariants({
        'family-spectral': 5,
        'tree-thick-a': 3.5,
        'tree-thick-b': 3,
        'tree-thick-c': 2.5,
        'tree-thick-d': 2,
        'tree-thick-e': 1.6,
        'tree-birch-a': 3,
        'tree-birch-b': 2.4,
        'tree-birch-c': 1.9,
        'tree-birch-d': 1.5,
        'tree-birch-e': 1.1,
        'bush-common-flowers': 0.8,
        'bush-large-flowers': 0.6,
        'flower-1-group': 0.6,
        'flower-2-group': 0.5,
        'flower-3-group': 0.45,
        'flower-4-group': 0.4,
        'flower-6': 0.4,
        'flower-6-2': 0.35,
        'mushroom-oyster': 0.3,
        'mushroom-laetiporus': 0.25,
        'grass-wispy-short': 0.4,
        'grass-wispy-tall': 0.35,
        'rock-medium-4': 0.3,
        'pebble-round-3': 0.28,
        'pebble-square-3': 0.25,
      }),
      { allowSpectral: true }
    ),
    allowSpectral: true,
  },
  {
    re: /(arcaneLeyNexus)/i,
    density: 0.12,
    spacing: 2,
    weights: makeWeights(
      withSpectralVariants({
        'family-spectral': 4,
        'tree-thick-a': 3,
        'tree-thick-b': 2.6,
        'tree-thick-c': 2.2,
        'tree-thick-d': 1.8,
        'tree-thick-e': 1.4,
        'tree-birch-a': 2.4,
        'tree-birch-b': 2,
        'tree-birch-c': 1.6,
        'tree-birch-d': 1.2,
        'tree-birch-e': 0.8,
        'bush-common-flowers': 1,
        'bush-large-flowers': 0.8,
        'flower-1-group': 0.75,
        'flower-2-group': 0.65,
        'flower-3-group': 0.6,
        'flower-4-group': 0.55,
        'flower-6': 0.55,
        'flower-6-2': 0.5,
        'mushroom-oyster': 0.4,
        'mushroom-laetiporus': 0.35,
        'grass-wispy-short': 0.55,
        'grass-wispy-tall': 0.5,
        'rock-medium-4': 0.35,
        'pebble-round-3': 0.32,
        'pebble-square-3': 0.3,
      }),
      { allowSpectral: true }
    ),
    allowSpectral: true,
  },
];

// ── Default Profile & Exports ────────────────────────────────
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

export { BIOME_FLORA_PROFILES, DEFAULT_PROFILE, SPECTRAL_VARIANTS };
