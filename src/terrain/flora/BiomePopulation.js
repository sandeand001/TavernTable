/**
 * Biome-driven population planning. All randomness is derived from the biome
 * seed and key; the adapter applies the resulting placements separately.
 */
import { createSeededRNG, rngInt, makeWeightedPicker } from '../../utils/SeededRNG.js';
import {
  discardedProfileWeights,
  getBiomeFloraProfile,
} from '../../config/terrain/FloraProfiles.js';
import { SETTLEMENT_BIOME_KEYS } from '../../config/biome/BiomeConstants.js';
import { isAssetAllowedInBiome } from '../../config/assets/BiomeAssetMatrix.js';
import { getPurePolyAsset, isCaveFormationModel } from '../../config/assets/PurePolyAssets.js';
import { TERRAIN_PLACEABLES } from '../../config/terrain/TerrainPlaceables.js';
import { logger, LOG_CATEGORY } from '../../utils/logger/Logger.js';
import { structureBounds } from '../ConstructionBlueprints.js';
import {
  cavernEntranceCells,
  naturalCavernRoutes,
  CAVERN_FLOOR_LEVEL,
} from '../generation/CavernInteriors.js';
import { requiresCavernRouteClearance } from '../PlaceableCollision.js';
import {
  candidateFilters,
  isSpectralPlaceable,
  isTropicalCluster,
  getTropicalDensityModifier,
  hash32,
  stripSpectralWeights,
  relocateTropicalCandidate,
  isCoastlineTile,
} from './floraHelpers.js';

function manhattan(a, b) {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
}

function getBiomeRNG(baseSeed, biomeKey, salt) {
  const mix = (baseSeed >>> 0) ^ hash32(String(biomeKey || '')) ^ (salt * 0x9e3779b1);
  return createSeededRNG(mix >>> 0, salt >>> 0);
}

function formationLimit(density) {
  return Math.min(800, Math.max(1, Math.floor(400 * density)));
}

function addFormationClusters({ placements, placePlant, biomeKey, seed, density, cols, rows }) {
  const anchors = placements.filter(({ modelKey }) => isCaveFormationModel(modelKey));
  const limit = formationLimit(density);
  let remaining = Math.max(0, limit - anchors.length);
  if (!remaining) return;
  const occupied = new Set(placements.map(({ gridX, gridY }) => `${gridX}:${gridY}`));
  const random = getBiomeRNG(seed, biomeKey, 913);
  const offsets = [];
  for (let dz = -2; dz <= 2; dz++)
    for (let dx = -2; dx <= 2; dx++)
      if (dx * dx + dz * dz > 0 && dx * dx + dz * dz <= 4) offsets.push([dx, dz]);
  const clusters = anchors.map((anchor) => {
    const candidates = [...offsets];
    for (let index = candidates.length - 1; index > 0; index--) {
      const other = Math.floor(random() * (index + 1));
      [candidates[index], candidates[other]] = [candidates[other], candidates[index]];
    }
    return {
      anchor,
      candidates,
      next: 0,
      placed: 0,
      target: Math.floor(3 + 3.5 * density + random() * 2),
    };
  });
  let progress = true;
  while (remaining > 0 && progress) {
    progress = false;
    for (const cluster of clusters) {
      if (!remaining || cluster.placed >= cluster.target) continue;
      while (cluster.next < cluster.candidates.length) {
        const [dx, dz] = cluster.candidates[cluster.next++];
        const gridX = cluster.anchor.gridX + dx;
        const gridY = cluster.anchor.gridY + dz;
        const key = `${gridX}:${gridY}`;
        if (gridX < 0 || gridX >= cols || gridY < 0 || gridY >= rows || occupied.has(key)) continue;
        const before = placements.length;
        placePlant({ ...cluster.anchor, gridX, gridY });
        if (placements.length === before) continue;
        occupied.add(key);
        cluster.placed++;
        remaining--;
        progress = true;
        break;
      }
    }
  }
}

// ── Main Population Entry Point ───────────────────────────────────

export function planBiomePopulation(c, biomeKey, seed) {
  if (!c?.gameManager) throw new Error('Biome population planning requires a terrain context');
  const placements = [];
  const cavernEngine =
    c.gameManager.terrainEngine?.cavern?.version >= 2 ? c.gameManager.terrainEngine : null;
  const settlementScenery = biomeKey !== 'town' && SETTLEMENT_BIOME_KEYS.includes(biomeKey);
  const cavernRoutes = new Set(
    cavernEngine
      ? naturalCavernRoutes({
          cols: cavernEngine.cols,
          rows: cavernEngine.rows,
          getHeight: (x, z) => cavernEngine.getHeightAt(x, z),
          exits: cavernEngine.cavern.exits,
          seed: cavernEngine.cavern.seed ?? seed,
        }).flatMap(({ cells }) => cells.map(({ x, z }) => `${x}:${z}`))
      : []
  );
  const cavernEntrances = new Set(
    cavernEngine?.cavern.exits.flatMap((side) =>
      cavernEntranceCells(side, cavernEngine.cols, cavernEngine.rows).map(({ x, z }) => `${x}:${z}`)
    ) || []
  );
  if (cavernEngine)
    c = {
      ...c,
      getTerrainHeight: (x, z) => cavernEngine.getHeightAt(x, z) - CAVERN_FLOOR_LEVEL + 2,
    };
  const structures =
    c.gameManager.terrainEngine?.geometry.getStructures().map(structureBounds) || [];
  const reserved =
    c.gameManager.terrainEngine?.geometry
      .save()
      .volumes.filter(
        (volume) =>
          volume.source === 'generated' &&
          [
            'street',
            'plaza',
            'market',
            'landmark',
            'garden-fence',
            'mountain',
            'excavation',
            'approach',
          ].includes(volume.layerId)
      )
      .map((volume) => volume.bounds) ?? [];
  const excluded = [...structures, ...reserved];
  const isExcluded = (gridX, gridY, footprint = 2.5) => {
    const x = (gridX + 0.5) * 5,
      z = (gridY + 0.5) * 5;
    return excluded.some(
      (bounds) =>
        x >= bounds.min.x - footprint &&
        x <= bounds.max.x + footprint &&
        z >= bounds.min.z - footprint &&
        z <= bounds.max.z + footprint
    );
  };
  const isCavernFloor = (gridX, gridY) =>
    cavernEngine.getHeightAt(gridX, gridY) <= -5 && !cavernEntrances.has(`${gridX}:${gridY}`);
  const placePlant = (placement) => {
    if (!isAssetAllowedInBiome(placement.placeableId, biomeKey))
      throw new Error(
        `Terrain asset "${placement.placeableId}" is not allowed in biome "${biomeKey}"`
      );
    if (cavernEngine) {
      if (!isCavernFloor(placement.gridX, placement.gridY)) return false;
      if (
        requiresCavernRouteClearance(placement) &&
        cavernRoutes.has(`${placement.gridX}:${placement.gridY}`)
      )
        return false;
    }
    const footprint =
      getPurePolyAsset(placement.modelKey)?.kind === 'rock'
        ? 7.5
        : placement.modelKey === 'mushroom-giant-cap'
          ? 5
          : 2.5;
    if (isExcluded(placement.gridX, placement.gridY, footprint)) return false;
    if (cavernEngine && isCaveFormationModel(placement.modelKey)) {
      const identity = `${biomeKey}:${seed}:${placement.modelKey}:${placement.gridX}:${placement.gridY}`;
      placement.gridOffsetX = (2 * (hash32(`${identity}:x`) / 0x100000000) - 1) * 0.32;
      placement.gridOffsetY = (2 * (hash32(`${identity}:z`) / 0x100000000) - 1) * 0.32;
    }
    placements.push(placement);
    return true;
  };
  const profile = getBiomeFloraProfile(biomeKey, c.assetPack);
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
  if (!effectiveDensity) return placements;
  const discarded = discardedProfileWeights(profileWeights);
  if (discarded.length)
    logger.warn(
      'Biome generation omitted unavailable weighted assets',
      { biomeKey, discarded },
      LOG_CATEGORY.RENDERING
    );
  const rows = c.gameManager.rows;
  const cols = c.gameManager.cols;
  const densityScale = densityMultiplier;
  // ── Grid Strategy ─────────────────────────────────────────────────
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
    const pick = makeWeightedPicker(weights, getBiomeRNG(seed || c._biomeSeed || 0, biomeKey, 102));
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
            const _def0 = TERRAIN_PLACEABLES[id] || {};
            placePlant({
              generatedBiome: true,
              biomeKey,
              biomeSeed: seed ?? c._biomeSeed,
              type: 'plant',
              variantKey: id,
              modelKey: _def0.modelKey,
              placeableId: id,
              gridX: placeX,
              gridY: placeY,
            });
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
          placePlant({
            generatedBiome: true,
            biomeKey,
            biomeSeed: seed ?? c._biomeSeed,
            type: 'plant',
            variantKey: id,
            modelKey: (TERRAIN_PLACEABLES[id] || {}).modelKey,
            placeableId: id,
            gridX: placeX,
            gridY: placeY,
          });
        }
        const spacing = rowSpacings[rowIndex % rowSpacings.length];
        y += spacing;
        rowIndex++;
      }
    }
    return placements;
  }

  // ── Generic Candidate Collection & Placement ───────────────────

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
        if (h <= 0 && !elevationFilter) continue;
      }
      if (elevationFilter && !elevationFilter(c, h)) continue;
      if (filterFn && !filterFn(c, x, y, h, coordRng)) continue;
      if (cavernEngine && (!isCavernFloor(x, y) || isExcluded(x, y))) continue;
      candidates.push([x, y, h]);
    }
  }
  if (!candidates.length) return placements;
  const baseTargetRaw = candidates.length * effectiveDensity;
  const tropicalModifier = getTropicalDensityModifier(weights);
  const adjustedTargetRaw =
    tropicalModifier === 1 ? baseTargetRaw : baseTargetRaw * tropicalModifier;
  let target = Math.floor(adjustedTargetRaw);
  if (tropicalModifier === 1 && baseTargetRaw > 0 && target === 0) {
    target = 1;
  }
  // A small positive target otherwise makes sparse and dense scenery indistinguishable.
  if (
    !cavernEngine &&
    biomeKey !== 'town' &&
    tropicalModifier === 1 &&
    densityMultiplier > 1 &&
    candidates.length > 1
  )
    target = Math.max(target, 2);
  if (cavernEngine && ['cavern', 'crystalFields', 'crystalSpires'].includes(biomeKey)) {
    target = Math.max(1, Math.floor(target * 0.55));
    target = Math.min(target, formationLimit(densityMultiplier));
  }
  if (target <= 0) return placements;
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
    const accepted = placePlant({
      generatedBiome: true,
      biomeKey,
      biomeSeed: seed ?? c._biomeSeed,
      type: 'plant',
      variantKey: id,
      modelKey: (TERRAIN_PLACEABLES[id] || {}).modelKey,
      placeableId: id,
      gridX: placeX,
      gridY: placeY,
    });
    // Keep other established surface-biome distributions until they are recalibrated.
    if (accepted || (!cavernEngine && !settlementScenery)) placed.push([placeX, placeY]);
  }
  if (cavernEngine && ['cavern', 'crystalFields', 'crystalSpires'].includes(biomeKey))
    addFormationClusters({
      placements,
      placePlant,
      biomeKey,
      seed: seed ?? c._biomeSeed ?? 0,
      density: densityMultiplier,
      cols,
      rows,
    });
  return placements;
}

export function autoPopulateBiomeFlora(c, biomeKey, seed) {
  const pool = c?.gameManager?.placeableMeshPool;
  if (!pool) return;
  for (const placement of planBiomePopulation(c, biomeKey, seed)) pool.addPlaceable(placement);
}

function boostPalmWeights(weights, factor) {
  const out = {};
  for (const [id, w] of Object.entries(weights)) {
    out[id] = /palm/i.test(id) ? w * factor : w;
  }
  return out;
}
