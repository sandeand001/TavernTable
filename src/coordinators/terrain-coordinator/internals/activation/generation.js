// internals/activation/generation.js - Biome elevation generation helpers
// Extracted from TerrainCoordinator.js (Phase 9A).

import {
  generateBiomeElevationField,
  isAllDefaultHeight,
  getBiomeElevationScaleHint,
} from '../../../../terrain/generation/BiomeElevationGenerator.js';
import {
  validateApplicationRequirements as _validateApplyReqs,
  processAllGridTiles as _processAllTiles,
  logCompletion as _logApplyComplete,
} from './apply.js';
import { autoPopulateBiomeFlora as _autoPopulateBiomeFlora } from '../flora.js';

// ── Private Helpers ──────────────────────────────────────────

export function clearAllBiomeFlora(c) {
  // Clear 3D mesh pool (the only active placeable system after TerrainManager deletion)
  try {
    if (c.gameManager?.placeableMeshPool) {
      const pool = c.gameManager.placeableMeshPool;
      if (typeof pool.purgeAll === 'function') pool.purgeAll();
      else if (typeof pool.clearAll === 'function') pool.clearAll();
    }
  } catch (_) {
    /* ignore */
  }
}

export function logPlaceableInstancingState(c, stage = 'unknown') {
  try {
    const pool = c.gameManager?.placeableMeshPool;
    if (!pool) return;
    const stats = pool.getStats ? pool.getStats() : {};
    const groups = [];
    try {
      for (const [key, g] of pool._groups.entries()) {
        const live = g.count - g.freeIndices.length;
        groups.push({ key, live, capacity: g.capacity });
      }
    } catch (_) {
      /* ignore */
    }
    // eslint-disable-next-line no-console
    console.debug('[PlaceableInstancing]', stage, { stats, groups });
    if (typeof window !== 'undefined') {
      (window.__TT_DEBUG__ = window.__TT_DEBUG__ || {}).placeables = { stage, stats, groups };
    }
  } catch (_) {
    /* ignore */
  }
}

function _tagPlants(_c) {
  // No-op: terrainManager.placeables removed (ADR-0001)
}

// ── Public API ───────────────────────────────────────────────

export function generateBiomeElevationIfFlat(c, biomeKey, options = {}) {
  if (c.gameManager?.getViewMode && c.gameManager.getViewMode() === 'topdown') return false;
  try {
    if (c.isTerrainModeActive) return false;
    if (c._isGenerating) return false;
    c._isGenerating = true;
    const base = c.dataStore?.base;
    const working = c.dataStore?.working;
    if (!base || !working) return false;
    const flatBase = isAllDefaultHeight(base);
    const flatWorking = isAllDefaultHeight(working);
    if (!flatBase || !flatWorking) return false;

    const rows = c.gameManager.rows;
    const cols = c.gameManager.cols;
    const seed = Number.isFinite(options.seed) ? options.seed : c._biomeSeed >>> 0;
    c._generationRunId = (c._generationRunId || 0) + 1;
    const resolvedBiome =
      biomeKey || (typeof window !== 'undefined' && window.selectedBiome) || 'grassland';
    c._lastGeneratedBiomeKey = resolvedBiome;
    if (typeof window !== 'undefined' && !window.selectedBiome) {
      window.selectedBiome = resolvedBiome;
    }
    const field = generateBiomeElevationField(resolvedBiome, rows, cols, { ...options, seed });

    try {
      logPlaceableInstancingState(c, 'pre-clear:generateBiomeElevationIfFlat');
      clearAllBiomeFlora(c);
      logPlaceableInstancingState(c, 'post-clear:generateBiomeElevationIfFlat');
    } catch (_) {
      /* ignore */
    }

    c.dataStore.base = field.map((r) => [...r]);
    c.dataStore.working = field.map((r) => [...r]);

    _validateApplyReqs(c);
    const modified = _processAllTiles(c);
    _logApplyComplete(c, modified);
    try {
      c.applyBiomePaletteToBaseGrid();
    } catch (_) {
      /* non-fatal */
    }
    try {
      logPlaceableInstancingState(c, 'pre-populate:generateBiomeElevationIfFlat');
      _autoPopulateBiomeFlora(
        c,
        biomeKey || (typeof window !== 'undefined' && window.selectedBiome),
        seed
      );
      _tagPlants(c);
      logPlaceableInstancingState(c, 'post-populate:generateBiomeElevationIfFlat');
    } catch (_) {
      /* ignore flora errors */
    }
    try {
      if (c.gameManager?.is3DModeActive?.()) {
        c.gameManager.notifyTerrainHeightsChanged?.();
      }
    } catch (_) {
      /* ignore notify errors */
    }
    return true;
  } catch (_) {
    return false;
  } finally {
    c._isGenerating = false;
  }
}

export function generateBiomeElevation(c, biomeKey, options = {}) {
  if (c.gameManager?.getViewMode && c.gameManager.getViewMode() === 'topdown') return false;
  try {
    if (c.isTerrainModeActive) return false;
    if (c._isGenerating) return false;
    c._isGenerating = true;

    const rows = c.gameManager.rows;
    const cols = c.gameManager.cols;
    const seed = Number.isFinite(options.seed) ? options.seed : c._biomeSeed >>> 0;
    const activeBiome =
      biomeKey || (typeof window !== 'undefined' && window.selectedBiome) || 'grassland';
    c._lastGeneratedBiomeKey = activeBiome;
    if (typeof window !== 'undefined' && !window.selectedBiome) {
      window.selectedBiome = activeBiome;
    }
    c._generationRunId = (c._generationRunId || 0) + 1;
    try {
      const hintedUnit = getBiomeElevationScaleHint(activeBiome);
      if (Number.isFinite(hintedUnit) && c.setElevationScale) {
        c.setElevationScale(hintedUnit, { repaintBiome: false });
      }
    } catch (_) {
      /* non-fatal */
    }
    const field = generateBiomeElevationField(activeBiome, rows, cols, { ...options, seed });

    try {
      logPlaceableInstancingState(c, 'pre-clear:generateBiomeElevation');
      clearAllBiomeFlora(c);
      logPlaceableInstancingState(c, 'post-clear:generateBiomeElevation');
    } catch (_) {
      /* non-fatal */
    }

    c.dataStore.base = field.map((r) => [...r]);
    c.dataStore.working = field.map((r) => [...r]);

    _validateApplyReqs(c);
    const modified = _processAllTiles(c);
    _logApplyComplete(c, modified);
    try {
      c.applyBiomePaletteToBaseGrid();
    } catch (_) {
      /* non-fatal */
    }
    try {
      logPlaceableInstancingState(c, 'pre-populate:generateBiomeElevation');
      _autoPopulateBiomeFlora(c, activeBiome, seed);
      logPlaceableInstancingState(c, 'post-populate:generateBiomeElevation');
    } catch (_) {
      /* ignore flora errors */
    }
    try {
      c.gameManager?.reinstanceExistingPlants?.();
    } catch (_) {
      /* ignore */
    }
    try {
      if (c.gameManager?.is3DModeActive?.()) {
        c.gameManager.notifyTerrainHeightsChanged?.();
      }
    } catch (_) {
      /* ignore notify errors */
    }
    return true;
  } catch (_) {
    return false;
  } finally {
    c._isGenerating = false;
  }
}
