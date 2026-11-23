// NOTE: §4 violation — pickIds/makeWeights/withSpectralVariants build profile data at import time; tightly coupled. Extraction deferred.
// ── Imports & Setup ──────────────────────────────────────────
// FloraProfiles.js — Biome flora profiles, spectral variants, and data tables.
// Runtime helper functions live in src/terrain/flora/floraHelpers.js.

import { TERRAIN_PLACEABLES } from './TerrainPlaceables.js';
import { BLOOD_MARSH_MIN_PLANT_LEVEL } from '../biome/BiomeConstants.js';
import { PURE_POLY_ASSETS } from '../assets/PurePolyAssets.js';
import { isSpectralPlaceable } from '../../terrain/flora/floraHelpers.js';

const ALL_PLANTS = Object.keys(TERRAIN_PLACEABLES).filter((k) => {
  const type = TERRAIN_PLACEABLES[k].type;
  // Families are menu selectors, not renderable model assets.
  return type === 'plant';
});
const UNAVAILABLE_WEIGHTED_ASSETS = new Map();
const DISCARDED_PROFILE_WEIGHTS = new WeakMap();

// ── Weight Utilities ─────────────────────────────────────────
function pickIds(regex, { allowSpectral = false } = {}) {
  const list = ALL_PLANTS.filter(
    (id) =>
      !TERRAIN_PLACEABLES[id].protectedKeyId &&
      regex.test(id) &&
      (allowSpectral || !isSpectralPlaceable(id))
  );
  const w = {};
  list.forEach((id) => (w[id] = 1));
  return w;
}

function makeWeights(map, { allowSpectral = false } = {}) {
  const out = {};
  const discarded = [];
  const discard = (id, w, reason) => {
    UNAVAILABLE_WEIGHTED_ASSETS.set(id, reason);
    discarded.push({ id, weight: w, reason });
  };
  const add = (id, w) => {
    if (!Number.isFinite(w) || w <= 0) {
      discard(id, w, 'invalid-weight');
      return;
    }
    if (!ALL_PLANTS.includes(id) || !TERRAIN_PLACEABLES[id].modelKey) {
      discard(
        id,
        w,
        Object.hasOwn(TERRAIN_PLACEABLES, id) ? 'not-renderable-plant' : 'missing-placeable'
      );
      return;
    }
    if (!allowSpectral && isSpectralPlaceable(id)) {
      discard(id, w, 'spectral-not-allowed');
      return;
    }
    out[id] = (out[id] || 0) + w;
  };
  for (const [id, w] of Object.entries(map)) {
    const definition = TERRAIN_PLACEABLES[id];
    if (
      definition?.type === 'plant-family' &&
      Array.isArray(definition.familyVariants) &&
      definition.familyVariants.length
    ) {
      for (const variant of definition.familyVariants)
        add(variant, w / definition.familyVariants.length);
    } else {
      add(id, w);
    }
  }
  DISCARDED_PROFILE_WEIGHTS.set(out, discarded);
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
  {
    re: /^(cliffsideCastle|mountainCastle)$/i,
    density: 0.003,
    spacing: 5,
    elevationFilter: (c, h) => Number.isFinite(h) && h >= 0,
    weights: pickIds(/birch|conifer|bare/),
  },
  {
    re: /^town$/i,
    density: 0.01,
    spacing: 4,
    elevationFilter: (c, h) => Number.isFinite(h) && h >= 0,
    weights: pickIds(/birch|bush|oval|willow/),
  },
  {
    re: /^city$/i,
    density: 0.006,
    spacing: 5,
    elevationFilter: (c, h) => Number.isFinite(h) && h >= 0,
    weights: pickIds(/birch|bush|oval/),
  },
  {
    re: /^castle$/i,
    density: 0.003,
    spacing: 5,
    elevationFilter: (c, h) => Number.isFinite(h) && h >= 0,
    weights: pickIds(/birch|oval/),
  },
  { re: /(sandDunes|saltFlats|desertHot|desertCold)/i, density: 0, spacing: 0 },
  { re: /^dungeon$/i, density: 0, spacing: 0 },
  { re: /(glacier|frozenLake|packIce|ocean|coralReef)/i, density: 0, spacing: 0 },
  { re: /(crystalFields|obsidianPlain)/i, density: 0, spacing: 0 },
  {
    re: /(crystalSpires)/i,
    density: 0.03,
    spacing: 5,
    weights: makeWeights({
      'source-cave-stalagmite': 5,
    }),
  },
  {
    re: /(eldritchRift)/i,
    density: 0.1,
    spacing: 2,
    // The rift's solid floor can be below zero; it is not ordinary water.
    elevationFilter: (c, h) => Number.isFinite(h),
    weights: makeWeights({
      'tree-dead-a': 2,
      'tree-dead-b': 1.8,
      'tree-dead-c': 1.2,
      'mushroom-common': 3,
      'mushroom-oyster': 2,
      'mushroom-redcap': 1.5,
      'rock-medium-4': 1.5,
      'pebble-square-3': 0.8,
    }),
  },
  {
    re: /(lavaFields)/i,
    density: 0.045,
    spacing: 3,
    weights: makeWeights({
      'rock-big-1': 0.8,
      'rock-big-2': 0.6,
      'rock-medium-4': 5,
      'pebble-round-1': 2,
      'pebble-square-3': 1.5,
    }),
  },
  {
    re: /^(ruinedTown|ruinedUrban|ruinedCastle)$/i,
    density: 0.02,
    spacing: 4,
    elevationFilter: (c, h) => Number.isFinite(h) && h >= 0,
    weights: pickIds(/bare|yellow|small/),
  },
  {
    re: /(ashWastes|wasteland|graveyard)/i,
    density: 0.02,
    spacing: 4,
    elevationFilter: (c, h) => Number.isFinite(h) && h >= 0,
    weights: pickIds(/bare|yellow|small/),
  },
  {
    re: /geyserBasin/i,
    density: 0.03,
    spacing: 3,
    elevationFilter: (c, h) => Number.isFinite(h) && h >= 0,
    weights: pickIds(/bare|small|columnar/),
  },
  {
    re: /screeSlope/i,
    density: 0.015,
    spacing: 4,
    // Negative heights in a scree slope are exposed rock, not water.
    elevationFilter: (c, h) => Number.isFinite(h),
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
    elevationFilter: (c, h) => Number.isFinite(h) && h >= 0,
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
  // Dead / petrified refinements; Shadowfell has its own profile below.
  {
    re: /(deadForest)/i,
    density: 0.18,
    spacing: 1,
    weights: makeWeights({
      'tree-dead-a': 45,
      'tree-dead-b': 42,
      'tree-dead-c': 38,
      'tree-dead-d': 34,
      'tree-green-columnar': 0.5,
      'tree-green-conifer': 0.4,
      'tree-green-small': 0.35,
    }),
  },
  {
    re: /(petrifiedForest)/i,
    density: 0.07,
    spacing: 2,
    elevationFilter: (c, h) => Number.isFinite(h) && h >= 0,
    weights: makeWeights({
      'tree-dead-a': 3,
      'tree-dead-b': 2.5,
      'tree-dead-c': 2,
      'tree-dead-d': 2.5,
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
    elevationFilter: (c, h) => Number.isFinite(h) && h >= 0,
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
  // Cavern biome: formations, scattered rocks and sparse mushrooms.
  {
    re: /(cavern)/i,
    density: 0.1,
    spacing: 3,
    weights: makeWeights({
      'source-cave-stalagmite': 7,
      'source-cave-column': 3,
      'rock-medium-4': 1,
      'rock-medium-3': 0.5,
      'rock-medium-2': 0.5,
      'pebble-round-1': 1,
      'pebble-round-2': 1,
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
      'rock-medium-4': 0.3,
      'pebble-round-2': 0.2,
    }),
  },
  // Shadowfell Forest: dark, sparse dead + bare trees with a faint presence of withered conifers.
  {
    re: /(shadowfellForest)/i,
    density: 0.2,
    spacing: 2,
    elevationFilter: (c, h) => Number.isFinite(h),
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
    // Marsh vegetation can root in shallow wet ground, but not the deep basin.
    elevationFilter: (c, h) => h >= BLOOD_MARSH_MIN_PLANT_LEVEL,
    weights: makeWeights({
      'tree-bare-deciduous': 6,
      'tree-green-willow': 1,
      'tree-yellow-willow': 1,
      'grass-common-tall': 0.8,
      'mushroom-redcap': 0.4,
      'rock-medium-4': 0.4,
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
    elevationFilter: (_context, height) => Number.isFinite(height) && height >= 0,
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

const baseProfile = (biomeKey) =>
  BIOME_FLORA_PROFILES.find((profile) => profile.re.test(biomeKey)) || DEFAULT_PROFILE;

function purePolyWeights(biomeKey, kind, total, predicate = () => true) {
  const assets = PURE_POLY_ASSETS.filter(
    (asset) => asset.kind === kind && asset.generatedBiomes.includes(biomeKey) && predicate(asset)
  );
  if (!assets.length) throw new Error(`Pure Poly ${kind} models are unavailable for ${biomeKey}`);
  return Object.fromEntries(assets.map(({ id }) => [id, total / assets.length]));
}

function purePolyProfile(biomeKey) {
  const base = baseProfile(biomeKey);
  const weights = { ...base.weights };
  const add = (kind, total, predicate) =>
    Object.assign(weights, purePolyWeights(biomeKey, kind, total, predicate));
  let density = base.density;
  let spacing = base.spacing;
  let elevationFilter = base.elevationFilter;
  if (biomeKey === 'cavern') {
    delete weights['source-cave-stalagmite'];
    delete weights['source-cave-column'];
    delete weights['rock-medium-2'];
    delete weights['rock-medium-3'];
    delete weights['rock-medium-4'];
    add('formation', 7, ({ id }) => id.includes('stalagmite'));
    add('formation', 3, ({ id }) => id.includes('column'));
    add('rock', 2);
    add('pebble', 2);
    add('fungus', 0.8);
  } else if (biomeKey === 'crystalSpires' || biomeKey === 'crystalFields') {
    delete weights['source-cave-stalagmite'];
    add('crystal', 5);
    if (biomeKey === 'crystalFields') {
      density = 0.03;
      spacing = 5;
    }
  } else if (biomeKey === 'desertHot' || biomeKey === 'sandDunes') {
    add('cactus', 4);
    add('rock', 1);
    density = 0.035;
    spacing = 4;
    elevationFilter = (_context, height) => Number.isFinite(height) && height >= 0;
  } else if (biomeKey === 'thornscrub' || biomeKey === 'oasis') {
    add('cactus', biomeKey === 'oasis' ? 3 : 6);
    if (biomeKey === 'thornscrub') add('rock', 1);
  } else if (biomeKey === 'grassland') {
    add('grass', 8);
    add('pebble', 1);
  } else if (biomeKey === 'screeSlope') {
    for (const id of Object.keys(weights)) delete weights[id];
    add('pebble', 5);
  } else if (biomeKey === 'fungalGrove' || biomeKey === 'forestTemperate') {
    add('fungus', biomeKey === 'fungalGrove' ? 5 : 2);
    if (biomeKey === 'forestTemperate') {
      add('tree', 12);
      add('grass', 3);
      add('pebble', 2);
      add('rock', 1.5);
    }
  } else if (
    [
      'forestConifer',
      'mountain',
      'alpine',
      'cedarHighlands',
      'hills',
      'deadForest',
      'wasteland',
      'graveyard',
      'ashWastes',
    ].includes(biomeKey)
  ) {
    const purchasedWeight = ['wasteland', 'graveyard', 'ashWastes'].includes(biomeKey) ? 3 : 10;
    if (biomeKey === 'deadForest') {
      const legacyWeight = Object.values(weights).reduce((total, weight) => total + weight, 0);
      for (const id of Object.keys(weights)) weights[id] *= purchasedWeight / legacyWeight;
    }
    add('tree', purchasedWeight);
    if (biomeKey === 'forestConifer' || biomeKey === 'hills') add('grass', 3);
    if (['forestConifer', 'hills', 'mountain', 'alpine'].includes(biomeKey)) add('pebble', 2);
    if (['forestConifer', 'hills', 'mountain'].includes(biomeKey)) add('rock', 1.5);
  } else {
    throw new Error(`Pure Poly scenery is not available for ${biomeKey}`);
  }
  return { ...base, density, spacing, elevationFilter, weights: makeWeights(weights) };
}

const PURE_POLY_PROFILES = Object.fromEntries(
  [...new Set(PURE_POLY_ASSETS.flatMap((asset) => asset.generatedBiomes))].map((biomeKey) => [
    biomeKey,
    purePolyProfile(biomeKey),
  ])
);

export function getBiomeFloraProfile(biomeKey, assetPack = 'standard') {
  if (!['standard', 'pure-poly'].includes(assetPack))
    throw new Error('Choose a valid biome scenery source');
  if (assetPack === 'pure-poly') {
    if (!Object.hasOwn(PURE_POLY_PROFILES, biomeKey))
      throw new Error(`Pure Poly scenery is not available for ${biomeKey}`);
    return PURE_POLY_PROFILES[biomeKey];
  }
  return biomeKey ? baseProfile(biomeKey) : DEFAULT_PROFILE;
}

export function unavailableWeightedAssets() {
  return [...UNAVAILABLE_WEIGHTED_ASSETS]
    .map(([id, reason]) => ({ id, reason }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function discardedProfileWeights(weights) {
  return (DISCARDED_PROFILE_WEIGHTS.get(weights) || []).map((entry) => ({ ...entry }));
}

export { BIOME_FLORA_PROFILES, DEFAULT_PROFILE, SPECTRAL_VARIANTS };
