/**
 * flora.js - biome-driven automatic tree (plant) population.
 * Non-invasive: only adds/removes placeables of type 'plant'.
 * Heuristics are intentionally coarse and can be tuned later.
 */
// NOTE: Correct relative path into src/config (previous path overshot to a non-existent root-level config/ causing 404 in browser)
import { TERRAIN_PLACEABLES } from '../../../config/TerrainPlaceables.js';

// Build a catalog of plant (tree) placeable ids grouped by rough archetype keywords
const ALL_PLANTS = Object.keys(TERRAIN_PLACEABLES).filter(
  (k) => TERRAIN_PLACEABLES[k].type === 'plant'
);

// Helper: pick weighted random id
function weightedPick(weights) {
  const entries = Object.entries(weights);
  const total = entries.reduce((a, [, w]) => a + w, 0) || 1;
  let r = Math.random() * total;
  for (const [id, w] of entries) {
    r -= w;
    if (r <= 0) return id;
  }
  return entries[entries.length - 1][0];
}

// Biome-aware flora profiles (ordered: most specific first).
// density: Fraction (0..1) of eligible land tiles to attempt to plant (uniform heuristic)
// spacing: Minimum Manhattan distance between placements (avoid tight clutter)
// weights: Species weight selection using id substring regex.
// coastlinePalms: if true, bias palms on coastline fringe.
// elevationFilter: optional predicate to constrain altitude.
// NOTE: Many biomes intentionally have density 0 (no trees) per user request.
const BIOME_FLORA_PROFILES = [
  // --- ZERO / BARREN BIOMES ---
  { re: /(sandDunes|saltFlats|desertHot|desertCold)/i, density: 0, spacing: 0 },
  { re: /(glacier|frozenLake|packIce|ocean|coralReef)/i, density: 0, spacing: 0 },
  { re: /(cavern|fungalGrove|crystalFields|crystalSpires|eldritchRift)/i, density: 0, spacing: 0 },
  { re: /(obsidianPlain|lavaFields)/i, density: 0, spacing: 0 },

  // --- VERY SPARSE / WASTED / HARSH ---
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

  // --- ARCTIC & TUNDRA (dwarf / sparse) ---
  {
    re: /(tundra)/i,
    density: 0.04,
    spacing: 3,
    weights: pickIds(/bare|conifer|yellow/),
  },

  // --- MOUNTAIN / ALPINE / HIGHLANDS ---
  {
    re: /(alpine)/i,
    density: 0.06,
    spacing: 3,
    elevationFilter: (c, h) => h >= 2,
    weights: pickIds(/conifer|columnar|bare/),
  },
  {
    re: /(mountain|cedarHighlands)/i,
    density: 0.12,
    spacing: 2,
    elevationFilter: (c, h) => h >= 1,
    weights: pickIds(/conifer|tall|columnar/),
  },

  // --- FORESTS ---
  {
    re: /(forestConifer)/i,
    density: 0.38,
    spacing: 1,
    weights: pickIds(/conifer|columnar|tall/),
  },
  {
    re: /(forestTemperate)/i,
    density: 0.34,
    spacing: 1,
    weights: pickIds(/deciduous|oval|small|columnar|willow/),
  },
  {
    re: /(deadForest|shadowfellForest)/i,
    density: 0.28,
    spacing: 1,
    weights: pickIds(/bare|conifer|columnar/),
  },
  {
    re: /(petrifiedForest)/i,
    density: 0.1,
    spacing: 2,
    weights: pickIds(/bare|columnar/),
  },
  {
    re: /(bambooThicket)/i,
    density: 0.42,
    spacing: 1,
    weights: pickIds(/tall|columnar|small/),
  },
  {
    re: /(mysticGrove|feywildBloom)/i,
    density: 0.4,
    spacing: 1,
    weights: pickIds(/deciduous|orange|yellow|willow|oval|columnar/),
  },
  {
    re: /(orchard)/i,
    density: 0.3,
    spacing: 1,
    weights: pickIds(/deciduous|small|oval|orange/),
  },

  // --- GRASS / OPEN LAND ---
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

  // --- DESERT PATCHES WITH VEGETATION ---
  {
    re: /(thornscrub|chaparral)/i,
    density: 0.05,
    spacing: 3,
    weights: pickIds(/small|bare|oval|columnar/),
  },
  {
    re: /(oasis)/i,
    density: 0.2,
    spacing: 2,
    weights: pickIds(/palm|willow|small/),
  },

  // --- WETLANDS / COAST / RIVER ---
  {
    re: /(swamp|wetlands|bloodMarsh)/i,
    density: 0.22,
    spacing: 2,
    elevationFilter: (c, h) => h > 0,
    weights: pickIds(/willow|bare|deciduous|small/),
  },
  {
    re: /(floodplain)/i,
    density: 0.18,
    spacing: 2,
    weights: pickIds(/deciduous|willow|small|oval/),
  },
  {
    re: /(mangrove)/i,
    density: 0.26,
    spacing: 2,
    weights: pickIds(/willow|small|bare/),
  },
  {
    re: /(riverLake)/i,
    density: 0.14,
    spacing: 2,
    weights: pickIds(/willow|deciduous|oval|small/),
  },
  {
    re: /(coast|shore|beach)/i,
    density: 0.1,
    spacing: 2,
    weights: pickIds(/palm|small|oval/),
    coastlinePalms: true,
  },

  // --- ARCANE / EXOTIC ---
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
    weights: pickIds(/yellow|orange|columnar|willow|deciduous/),
  },
];

// Fallback profile for anything unmatched
const DEFAULT_PROFILE = {
  density: 0.07,
  spacing: 2,
  weights: pickIds(/deciduous|oval|small|conifer/),
};

function pickIds(regex) {
  const list = ALL_PLANTS.filter((id) => regex.test(id));
  // assign equal weights
  const w = {};
  list.forEach((id) => (w[id] = 1));
  return w;
}

/** Remove existing plant placeables (trees) before repopulating */
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
          /* ignore */
        }
        list.splice(i, 1);
      }
    }
    if (list.length === 0) tm.placeables.delete(key);
  }
}

/** Identify a profile matching a biome key */
function resolveProfile(biomeKey) {
  if (!biomeKey) return DEFAULT_PROFILE;
  const found = BIOME_FLORA_PROFILES.find((p) => p.re.test(biomeKey));
  return found || DEFAULT_PROFILE;
}

/** Determine if tile is coastline (height >0 but adjacent to a water (0) tile) */
function isCoastlineTile(c, x, y) {
  const h = c.getTerrainHeight?.(x, y) ?? 0;
  if (h <= 0) return false; // treat sea level as water
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

/** Manhattan distance */
function manhattan(a, b) {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
}

/** Main entry: populate biome flora (trees) */
export function autoPopulateBiomeFlora(c, biomeKey) {
  try {
    if (!c?.terrainManager?.gameManager?.gridContainer) return;
    const tm = c.terrainManager;

    // Remove previous trees to avoid accumulation
    clearExistingPlants(c);

    const profile = resolveProfile(biomeKey);
    const { density, spacing, weights, elevationFilter, coastlinePalms } = profile;
    if (!density || density <= 0) return; // explicitly barren biome
    const rows = c.gameManager.rows;
    const cols = c.gameManager.cols;

    // Collect candidate tiles
    const candidates = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const h = c.getTerrainHeight?.(x, y) ?? 0;
        if (h <= 0) continue; // treat height 0 as water / exclude
        if (elevationFilter && !elevationFilter(c, h)) continue;
        candidates.push([x, y, h]);
      }
    }
    if (!candidates.length) return;

    const target = Math.max(1, Math.floor(candidates.length * density));
    const placed = [];
    let attempts = 0;
    const maxAttempts = target * 15; // generous for spacing rejections

    while (placed.length < target && attempts < maxAttempts) {
      attempts++;
      const cand = candidates[Math.floor(Math.random() * candidates.length)];
      if (!cand) continue;
      const [x, y] = cand;
      // Enforce spacing
      if (spacing > 0 && placed.some((p) => manhattan(p, cand) < spacing)) continue;

      // Coastline palm preference: if profile.coastlinePalms then bias species by coastline test
      let chosenWeights = weights;
      if (coastlinePalms) {
        const onCoast = isCoastlineTile(c, x, y);
        if (onCoast) {
          // Emphasize palms near coast by boosting their weight
          chosenWeights = boostPalmWeights(weights, 3);
        } else {
          // Slightly de-emphasize palms inland
          chosenWeights = boostPalmWeights(weights, 0.5);
        }
      }

      const id = weightedPick(chosenWeights);
      if (!id) continue;
      const ok = tm.placeTerrainItem(x, y, id);
      if (ok) placed.push([x, y]);
    }
  } catch (_) {
    // swallow; flora population best-effort
  }
}

function boostPalmWeights(weights, factor) {
  const out = {};
  for (const [id, w] of Object.entries(weights)) {
    if (/palm/i.test(id)) out[id] = w * factor;
    else out[id] = w;
  }
  return out;
}
