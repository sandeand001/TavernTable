/**
 * flora.js - biome-driven automatic tree (plant) population (deterministic).
 * Determinism: All randomness is derived from a provided biome seed + biome key.
 * Non-invasive: only adds/removes placeables of type 'plant'.
 * Heuristics are intentionally coarse and can be tuned later.
 */
import { createSeededRNG, rngInt, makeWeightedPicker } from '../../../utils/SeededRNG.js';
import {
  BIOME_FLORA_PROFILES,
  DEFAULT_PROFILE,
  candidateFilters,
  isSpectralPlaceable,
  isTropicalCluster,
  getTropicalDensityModifier,
  hash32,
  stripSpectralWeights,
  relocateTropicalCandidate,
  isCoastlineTile,
} from './FloraProfiles.js';

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
      density: profileDensity,
      spacing,
      weights: profileWeights,
      elevationFilter,
      coastlinePalms,
      candidateFilter,
      strategy,
      grid,
    } = profile;

    const allowSpectral = profile.allowSpectral === true;
    const weights = allowSpectral ? profileWeights : stripSpectralWeights(profileWeights);

    let densityMultiplier = 1;
    try {
      if (c && typeof c.getTreeDensityMultiplier === 'function') {
        const val = c.getTreeDensityMultiplier();
        if (Number.isFinite(val) && val >= 0) densityMultiplier = val;
      } else if (Number.isFinite(c?.treeDensityMultiplier) && c.treeDensityMultiplier >= 0) {
        densityMultiplier = c.treeDensityMultiplier;
      } else if (
        typeof window !== 'undefined' &&
        Number.isFinite(window.treeDensityMultiplier) &&
        window.treeDensityMultiplier >= 0
      ) {
        densityMultiplier = window.treeDensityMultiplier;
      }
    } catch (_) {
      /* ignore multiplier resolution failure */
    }
    if (!Number.isFinite(densityMultiplier) || densityMultiplier < 0) {
      densityMultiplier = 1;
    }

    const baseDensity = Number.isFinite(profileDensity) ? profileDensity : 0;
    const effectiveDensity = Math.max(0, baseDensity * densityMultiplier);
    if (!effectiveDensity) return;
    const rows = c.gameManager.rows;
    const cols = c.gameManager.cols;
    const densityScale = densityMultiplier;
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
              if (densityScale < 1) {
                const sliderRand = rowRng();
                if (sliderRand > densityScale) continue;
              }
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
              if (!allowSpectral && isSpectralPlaceable(id)) continue;
              let placeX = x;
              let placeY = y;
              let placeHeight = h;
              if (isTropicalCluster(id)) {
                const relocated = relocateTropicalCandidate(c, x, y, h);
                if (!relocated) continue;
                placeX = relocated.x;
                placeY = relocated.y;
                placeHeight = relocated.height;
                if (placeHeight <= 0) continue;
                if (elevationFilter && !elevationFilter(c, placeHeight)) continue;
              }
              tm.placeTerrainItem(placeX, placeY, id);
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
            if (densityScale < 1) {
              const sliderRand = plantRng();
              if (sliderRand > densityScale) continue;
            }
            if (densityFactor < 1 && plantRng() > densityFactor) continue; // thin within row
            const h = c.getTerrainHeight?.(x, y) ?? 0;
            if (h <= 0) continue;
            if (elevationFilter && !elevationFilter(c, h)) continue;
            const id = pick();
            if (!allowSpectral && isSpectralPlaceable(id)) continue;
            let placeX = x;
            let placeY = y;
            let placeHeight = h;
            if (isTropicalCluster(id)) {
              const relocated = relocateTropicalCandidate(c, x, y, h);
              if (!relocated) continue;
              placeX = relocated.x;
              placeY = relocated.y;
              placeHeight = relocated.height;
              if (placeHeight <= 0) continue;
              if (elevationFilter && !elevationFilter(c, placeHeight)) continue;
            }
            tm.placeTerrainItem(placeX, placeY, id);
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
    const baseTargetRaw = candidates.length * effectiveDensity;
    const tropicalModifier = getTropicalDensityModifier(weights);
    const adjustedTargetRaw =
      tropicalModifier === 1 ? baseTargetRaw : baseTargetRaw * tropicalModifier;
    let target = Math.floor(adjustedTargetRaw);
    if (tropicalModifier === 1 && baseTargetRaw > 0 && target === 0) {
      target = 1;
    }
    if (target <= 0) return;
    const placed = [];
    let attempts = 0;
    const maxAttempts = target * 20;
    const rng = getBiomeRNG(seed || c._biomeSeed || 0, biomeKey, 201);
    const pick = makeWeightedPicker(weights, getBiomeRNG(seed || c._biomeSeed || 0, biomeKey, 202));
    while (placed.length < target && attempts < maxAttempts) {
      attempts++;
      const cand = candidates[rngInt(rng, candidates.length)];
      if (!cand) continue;
      const [baseX, baseY, baseHeight] = cand;
      let placeX = baseX;
      let placeY = baseY;
      let placeHeight = baseHeight;
      let chosenWeights = weights;
      if (coastlinePalms) {
        const onCoast = isCoastlineTile(c, baseX, baseY);
        chosenWeights = boostPalmWeights(weights, onCoast ? 3 : 0.4);
      }
      // If coastline palm boost applied we need a new picker for that variation (deterministic via coordinate salt)
      let id;
      if (chosenWeights !== weights) {
        const coordSalt = (baseX * 73856093) ^ (baseY * 19349663);
        const localPick = makeWeightedPicker(
          chosenWeights,
          getBiomeRNG(seed || c._biomeSeed || 0, biomeKey, 300 + (coordSalt & 0xff))
        );
        id = localPick();
      } else {
        id = pick();
      }
      if (!id) continue;
      if (!allowSpectral && isSpectralPlaceable(id)) continue;
      if (isTropicalCluster(id)) {
        const relocated = relocateTropicalCandidate(c, placeX, placeY, placeHeight);
        if (!relocated) continue;
        placeX = relocated.x;
        placeY = relocated.y;
        placeHeight = relocated.height;
        if (placeHeight <= 0) continue;
        if (elevationFilter && !elevationFilter(c, placeHeight)) continue;
      }
      if (spacing > 0 && placed.some((p) => manhattan(p, [placeX, placeY]) < spacing)) continue;
      const ok = tm.placeTerrainItem(placeX, placeY, id);
      if (ok) placed.push([placeX, placeY]);
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
