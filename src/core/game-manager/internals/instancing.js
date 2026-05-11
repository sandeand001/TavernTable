/**
 * instancing.js — Instanced placeables helpers extracted from GameManager
 *
 * Each function receives the GameManager instance (gm) as its first parameter.
 */

import { PlaceableMeshPool } from '../../../scene/terrain/PlaceableMeshPool.js';
import ModelAssetCache from '../../ModelAssetCache.js';
import { logger, LOG_CATEGORY } from '../../../utils/logger/Logger.js';

/**
 * Ensure the instanced placeables mesh pool exists if the feature flag is enabled.
 * Safe to call repeatedly (idempotent). Returns the pool instance or null if not created.
 */
export function ensureInstancing(gm) {
  try {
    if (!gm.features.instancedPlaceables) return null; // feature still disabled
    if (!gm.is3DModeActive()) return null; // wait until 3D active
    if (!gm.placeableMeshPool) {
      if (!gm.modelAssetCache) {
        gm.modelAssetCache = new ModelAssetCache();
      }
      gm.placeableMeshPool = new PlaceableMeshPool({ gameManager: gm });
      try {
        if (typeof window !== 'undefined') {
          (window.__TT_METRICS__ = window.__TT_METRICS__ || {}).placeables = {
            groups: 0,
            liveInstances: 0,
            capacityExpansions: 0,
          };
          // Dev aid so console explorers discover the helper
          window.__TT_ENSURE_INSTANCING__ = () => gm.ensureInstancing();
          if (!window.__TT_VALIDATE_INSTANCING__) {
            window.__TT_VALIDATE_INSTANCING__ = () => {
              try {
                const pool = gm.placeableMeshPool;
                if (!pool) return { ok: false, reason: 'no_pool' };
                const snapshot = pool.debugSnapshot ? pool.debugSnapshot() : {};
                const hidden = pool.validateHidden ? pool.validateHidden() : { ok: true };
                // Count 2D plant sprites
                let spritePlants = 0;
                try {
                  const tm = gm.terrainCoordinator?.terrainManager;
                  for (const arr of tm?.placeables?.values() || []) {
                    for (const s of arr) if (s?.placeableType === 'plant') spritePlants += 1;
                  }
                } catch (_) {
                  /* ignore */
                }
                return { snapshot, hidden, spritePlants };
              } catch (e) {
                return { ok: false, error: e?.message };
              }
            };
          }
        }
      } catch (_) {
        /* ignore metrics priming errors */
      }
      logger.debug(
        'Instanced placeables pool created (late ensure)',
        { context: 'GameManager.ensureInstancing', renderMode: gm.renderMode },
        LOG_CATEGORY.SYSTEM
      );
    }
    return gm.placeableMeshPool;
  } catch (_) {
    return null;
  }
}

/**
 * Public helper to enable instanced placeables feature at runtime.
 * If hybrid mode already active, the mesh pool is created immediately.
 */
export function enableInstancedPlaceables(gm) {
  gm.features.instancedPlaceables = true;
  const pool = gm.ensureInstancing();
  // Retro-fit any already placed plant sprites into the pool so they become visible in 3D
  try {
    const tm = gm.terrainCoordinator?.terrainManager;
    if (tm?.placeables && pool) {
      for (const [key, list] of tm.placeables.entries()) {
        for (const sprite of list) {
          try {
            if (!sprite || sprite.__instancedRef) continue;
            if (sprite.__is3DPlaceable) continue;
            // Only plants
            if (sprite.placeableType && sprite.placeableType !== 'plant') continue;
            const [gxStr, gyStr] = key.split(',');
            const gx = Number(gxStr);
            const gy = Number(gyStr);
            if (!Number.isFinite(gx) || !Number.isFinite(gy)) continue;
            const rec = {
              gridX: gx,
              gridY: gy,
              type: 'plant',
              variantKey: sprite.variantKey || sprite.placeableId || 'plant',
            };
            sprite.__instancedRef = rec;
            const p = pool.addPlaceable(rec);
            if (p && typeof p.then === 'function') p.catch(() => {});
          } catch (_) {
            /* ignore per-sprite retrofit issue */
          }
        }
      }
    }
  } catch (_) {
    /* ignore retrofit failures */
  }
  // Attach a lightweight pointer hover listener (once) to drive preview highlighting in 3D
  try {
    if (!gm._instancingPreviewListener && typeof window !== 'undefined') {
      const canvas = gm.threeSceneManager?.canvas;
      const targetEl = canvas || document.body;
      gm._instancingPreviewListener = async (evt) => {
        try {
          if (!gm.features.instancedPlaceables || !gm.is3DModeActive()) return;
          if (!gm.threeSceneManager || !gm.placeableMeshPool) return;
          // Use centralized picking service (ground plane) for hover
          if (!gm.pickingService) return;
          const ground = await gm.pickingService.pickGround(evt.clientX, evt.clientY, targetEl);
          if (ground && ground.grid) {
            const gx = Math.floor(ground.grid.gx);
            const gy = Math.floor(ground.grid.gy);
            if (Number.isFinite(gx) && Number.isFinite(gy)) {
              gm.placeableMeshPool.setPreview(gx, gy);
            }
          }
        } catch (_) {
          /* ignore */
        }
      };
      targetEl.addEventListener('pointermove', gm._instancingPreviewListener);
    }
  } catch (_) {
    /* ignore listener attach issues */
  }
  return pool;
}

/** Idempotently push all current plant sprites into instancing pool (used after biome repopulation). */
export function reinstanceExistingPlants(gm) {
  try {
    if (!gm.features.instancedPlaceables) return;
    // 2025-09 refactor: plant sprites are no longer pushed into the instancing pool because
    // they are fully superseded by 3D models. Any previous retrofit logic has been removed.
    return;
  } catch (_) {
    /* ignore */
  }
}

/** Experimental: disable instanced placeables (tears down pool). */
export function disableInstancedPlaceables(gm) {
  try {
    gm.features.instancedPlaceables = false;
    // Do NOT remove 2D sprites; only tear down 3D representation
    if (gm.placeableMeshPool) {
      try {
        gm.placeableMeshPool.dispose?.();
      } catch (_) {
        /* ignore */
      }
      gm.placeableMeshPool = null;
    }
    if (typeof window !== 'undefined') {
      try {
        if (window.__TT_METRICS__) delete window.__TT_METRICS__.placeables;
      } catch (_) {
        /* ignore */
      }
    }
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Await all pending asynchronous instancing operations (test/dev utility).
 * Safe to call when instancing disabled; resolves immediately.
 */
export async function flushInstancing(gm) {
  if (!gm._pendingInstancingPromises || gm._pendingInstancingPromises.length === 0) return;
  const pending = [...gm._pendingInstancingPromises];
  gm._pendingInstancingPromises.length = 0;
  try {
    await Promise.allSettled(pending);
  } catch (_) {
    /* ignore */
  }
}
