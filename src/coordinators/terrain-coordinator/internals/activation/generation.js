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
  try {
    const tm = c.terrainManager;
    if (tm && tm.placeables) {
      for (const [key, arr] of tm.placeables.entries()) {
        for (let i = arr.length - 1; i >= 0; i--) {
          const sprite = arr[i];
          if (sprite && sprite.placeableType === 'plant') {
            try {
              sprite.__clearedGeneration = c._generationRunId || 0;
            } catch (_) {
              /* ignore */
            }
            try {
              if (sprite.__instancedRef && c.gameManager?.placeableMeshPool) {
                c.gameManager.placeableMeshPool.removePlaceable(sprite.__instancedRef);
              }
            } catch (_) {
              /* ignore */
            }
            try {
              const model = sprite.__threeModel;
              if (model && c.gameManager?.threeSceneManager?.scene) {
                c.gameManager.threeSceneManager.scene.remove(model);
                try {
                  model.traverse?.((child) => {
                    if (child.isMesh) {
                      child.geometry?.dispose?.();
                      if (Array.isArray(child.material)) {
                        child.material.forEach((m) => m?.dispose?.());
                      } else {
                        child.material?.dispose?.();
                      }
                    }
                  });
                } catch (_) {
                  /* ignore disposal errors */
                }
              }
            } catch (_) {
              /* ignore model removal errors */
            }
            try {
              sprite.parent?.removeChild?.(sprite);
            } catch (_) {
              /* ignore */
            }
            arr.splice(i, 1);
          }
        }
        if (arr.length === 0) {
          try {
            tm.placeables.delete(key);
          } catch (_) {
            /* ignore */
          }
        }
      }
    }
  } catch (_) {
    /* ignore */
  }
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

function _tagPlants(c) {
  try {
    const tm = c.terrainManager;
    for (const arr of tm?.placeables?.values() || []) {
      for (const s of arr) {
        if (s?.placeableType === 'plant') s.__generationRunId = c._generationRunId;
      }
    }
  } catch (_) {
    /* ignore */
  }
}

// ── Public API ───────────────────────────────────────────────

export function generateBiomeElevationIfFlat(c, biomeKey, options = {}) {
  if (c.gameManager?.getViewMode && c.gameManager.getViewMode() === 'topdown') return false;
  try {
    if (c.isTerrainModeActive) return false;
    if (!c.gameManager?.gridContainer) {
      c.gameManager.gridContainer = {
        removeChildren() {},
        addChild() {},
      };
    }
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
    if (!c.gameManager?.gridContainer) {
      c.gameManager.gridContainer = {
        removeChildren() {},
        addChild() {},
      };
    }
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

    if (options.headless === true) {
      if (!c.terrainManager) {
        c.terrainManager = {
          gameManager: c.gameManager,
          placeables: new Map(),
          placeTerrainItem(x, y, id) {
            const key = `${x},${y}`;
            let arr = this.placeables.get(key);
            if (!arr) {
              arr = [];
              this.placeables.set(key, arr);
            }
            const sprite = { placeableType: 'plant', id, x, y, parent: null };
            arr.push(sprite);
            return true;
          },
        };
      }
      try {
        _autoPopulateBiomeFlora(c, activeBiome, seed);
      } catch (_) {
        /* ignore flora errors */
      }
      _tagPlants(c);
      return true;
    }

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
    _tagPlants(c);
    try {
      c.gameManager?.reinstanceExistingPlants?.();
    } catch (_) {
      /* ignore */
    }
    try {
      const tm = c.terrainManager;
      const hasPlants = (() => {
        if (!tm?.placeables) return false;
        for (const arr of tm.placeables.values()) {
          if (arr.some((s) => s.placeableType === 'plant')) return true;
        }
        return false;
      })();
      if (!hasPlants && c.gameManager?.features?.instancedPlaceables) {
        _autoPopulateBiomeFlora(c, activeBiome, (seed + 0x9e3779b1) >>> 0);
        c.gameManager?.reinstanceExistingPlants?.();
      }
    } catch (_) {
      /* ignore retry errors */
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
