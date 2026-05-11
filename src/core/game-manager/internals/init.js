/**
 * init.js — Extracted initialisation helpers for GameManager
 *
 * Each function receives the GameManager instance (gm) as its first parameter.
 */

import { ThreeSceneManager } from '../../../scene/ThreeSceneManager.js';
import { CameraRig } from '../../../scene/camera/CameraRig.js';
import { TerrainMeshBuilder } from '../../../scene/terrain/TerrainMeshBuilder.js';
import { TerrainRebuilder } from '../../../scene/terrain/TerrainRebuilder.js';
import { TerrainEngineSceneAdapter } from '../../../scene/terrain/TerrainEngineSceneAdapter.js';
import { PlaceableMeshPool } from '../../../scene/terrain/PlaceableMeshPool.js';
import ModelAssetCache from '../../ModelAssetCache.js';
import { PickingService } from '../../../scene/picking/PickingService.js';
import { logger, LOG_CATEGORY, LOG_LEVEL } from '../../../utils/logger/Logger.js';

// ── Public API ──────────────────────────────────────────────────
/**
 * Enable hybrid 2D + 3D rendering. Idempotent.
 * Initializes ThreeSceneManager and switches renderMode.
 */
export async function enableHybridRender(gm) {
  if (gm.is3DModeActive()) return;

  if (!gm.threeSceneManager) {
    gm.threeSceneManager = new ThreeSceneManager(gm);
    await gm.threeSceneManager.initialize();
  }

  let degraded = !!gm.threeSceneManager?.degraded;

  if (degraded) {
    const recovered = ensureTestThreeSceneFallback(gm);
    degraded = !!gm.threeSceneManager?.degraded;
    if (degraded && !recovered) {
      const reason = gm.threeSceneManager.degradeReason || 'Three.js renderer unavailable';
      logger.log(
        LOG_LEVEL.WARN,
        'Hybrid 3D renderer unavailable; staying in 2D mode',
        LOG_CATEGORY.SYSTEM,
        {
          context: 'GameManager.enableHybridRender',
          reason,
        }
      );
      gm.threeSceneManager.ensureFallbackSurface?.();
      return false;
    }
  }

  if (!degraded) {
    // Hide the legacy 2D tile grid once 3D mode is active; keep the Three grid visible by default.
    try {
      gm.threeSceneManager.setLegacyGridVisible?.(false);
    } catch (_) {
      /* ignore */
    }

    // Flush any deferred plant models queued before scene was ready
    try {
      if (Array.isArray(gm._deferredPlantModels) && gm._deferredPlantModels.length) {
        const sceneRef = gm.threeSceneManager?.scene;
        if (sceneRef) {
          for (const { model, record } of gm._deferredPlantModels) {
            try {
              sceneRef.add(model);
              if (record && record.__threeModelPending) delete record.__threeModelPending;
            } catch (_) {
              /* ignore add failure */
            }
          }
        }
        gm._deferredPlantModels.length = 0;
      }
    } catch (_) {
      /* ignore deferred flush */
    }

    // If we are fully replacing tree sprites with 3D models, proactively clear any pre-created
    // instanced plant quads so no green rectangles linger from earlier sessions.
    try {
      if (gm.placeableMeshPool) {
        gm.placeableMeshPool._groups?.forEach((grp, key) => {
          try {
            if (
              /plant/i.test(key) ||
              key.includes('tree') ||
              key.includes('oak') ||
              key.includes('pine') ||
              key.includes('birch') ||
              key.includes('fir')
            ) {
              if (grp.instancedMesh?.parent) grp.instancedMesh.parent.remove(grp.instancedMesh);
              gm.placeableMeshPool._groups.delete(key);
              gm.placeableMeshPool._metadata.delete(key);
            }
          } catch (_) {
            /* ignore per-group */
          }
        });
        gm.placeableMeshPool._updateMetrics?.();
      }
    } catch (_) {
      /* ignore cleanup issues */
    }

    // Attach camera rig abstraction (Phase 1)
    try {
      if (gm.threeSceneManager.camera) {
        const gridCenter = gm.spatial.gridToWorld(gm.cols / 2, gm.rows / 2, 0);
        gm.cameraRig = new CameraRig({
          target: { x: gridCenter.x, z: gridCenter.z },
        });
        gm.cameraRig.attach(gm.threeSceneManager.camera);
      }
    } catch (_) {
      /* ignore */
    }
  }

  // Initialize centralized picking service once Three scene & camera exist (degraded-safe)
  try {
    if (!gm.pickingService) {
      gm.pickingService = new PickingService({ gameManager: gm });
    }
  } catch (_) {
    /* non-fatal picking service init failure */
  }

  if (!degraded) {
    // Phase 2: initialize terrain mesh pipeline
    try {
      if (!gm.terrainRebuilder) {
        const builder = new TerrainMeshBuilder({
          tileWorldSize: gm.spatial.tileWorldSize,
          elevationUnit: gm.spatial.elevationUnit,
          enableBiomeVertexColors: true,
          hardEdges: true,
        });
        gm.terrainRebuilder = new TerrainRebuilder({ gameManager: gm, builder });
        const threeNS = (await import('three')).default || (await import('three'));
        gm.terrainRebuilder.rebuild({ three: threeNS });
        try {
          const updated = gm.sync3DElevationScaling?.({ rebuild: false, hardSet: true });
          if (updated) {
            gm.terrainRebuilder.rebuild({ three: threeNS });
          }
        } catch (_) {
          /* ignore first parity sync */
        }

        if (typeof window !== 'undefined') {
          window.requestTerrain3DRebuild = (reason = 'manual') => {
            try {
              const threeRef = gm.threeSceneManager?.three || threeNS;
              gm.terrainRebuilder?.rebuild({ three: threeRef });
              if (reason === '__noop__') {
                /* no-op */
              }
              return true;
            } catch (_) {
              return false;
            }
          };
          if (!window.terrainRebuild) {
            window.terrainRebuild = () => window.requestTerrain3DRebuild('alias');
          }
        }
      }
    } catch (e) {
      /* non-fatal terrain mesh init failure */
    }

    // Wire TerrainEngineSceneAdapter (ADR-0001) — after rebuilder is available
    try {
      if (gm.terrainEngine && !gm.terrainEngineSceneAdapter) {
        gm.terrainEngineSceneAdapter = new TerrainEngineSceneAdapter({
          engine: gm.terrainEngine,
          threeSceneManager: gm.threeSceneManager,
          rebuilder: gm.terrainRebuilder || null,
        });
        gm.terrainEngineSceneAdapter.attach();
      }
    } catch (_) {
      /* non-fatal */
    }

    // Phase 3 (initial scaffold): attach Token3DAdapter for existing tokens
    try {
      const { Token3DAdapter } = await import('../../../scene/Token3DAdapter.js');
      if (!gm.token3DAdapter) {
        gm.token3DAdapter = new Token3DAdapter(gm);
        gm.token3DAdapter.attach();

        // Attach token hover + selection listeners (3D interaction groundwork)
        try {
          if (typeof window !== 'undefined' && !gm._tokenHoverListener) {
            const canvas = gm.threeSceneManager?.canvas;
            const targetEl = canvas || document.body;

            gm._tokenHoverListener = async (evt) => {
              try {
                if (!gm.is3DModeActive() || !gm.pickingService) return;
                const t0 = (typeof performance !== 'undefined' && performance.now()) || Date.now();
                const ground = await gm.pickingService.pickGround(
                  evt.clientX,
                  evt.clientY,
                  targetEl
                );
                let hoverToken = null;
                if (ground?.grid) {
                  const gx = Math.round(ground.grid.gx);
                  const gy = Math.round(ground.grid.gy);
                  if (Number.isFinite(gx) && Number.isFinite(gy) && gm.findExistingTokenAt) {
                    hoverToken = gm.findExistingTokenAt(gx, gy) || null;
                  }
                }
                gm.token3DAdapter.setHoverToken(hoverToken);
                try {
                  const t1 =
                    (typeof performance !== 'undefined' && performance.now()) || Date.now();
                  window.__TT_METRICS__ = window.__TT_METRICS__ || {};
                  window.__TT_METRICS__.interaction = {
                    ...(window.__TT_METRICS__.interaction || {}),
                    lastPickMs: t1 - t0,
                    hoverTokenId: hoverToken?.id || null,
                  };
                } catch (_) {
                  /* ignore metrics */
                }
              } catch (_) {
                /* ignore hover errors */
              }
            };
            targetEl.addEventListener('pointermove', gm._tokenHoverListener);

            gm._tokenSelectListener = async (evt) => {
              try {
                if (!gm.is3DModeActive() || !gm.pickingService) return;
                const ground = await gm.pickingService.pickGround(
                  evt.clientX,
                  evt.clientY,
                  targetEl
                );
                let token = null;
                if (ground?.grid) {
                  const gx = Math.round(ground.grid.gx);
                  const gy = Math.round(ground.grid.gy);
                  if (Number.isFinite(gx) && Number.isFinite(gy) && gm.findExistingTokenAt) {
                    token = gm.findExistingTokenAt(gx, gy) || null;
                  }
                }
                // Only update selection when a token is found; clicking empty
                // space must NOT clear the selection here because
                // InteractionManager.handleLeftClick (mousedown) uses the
                // existing selection for click-to-navigate.
                if (token) {
                  gm.token3DAdapter.setSelectedToken(token);
                }
                try {
                  if (evt.button === 0 && token) {
                    gm.startTokenDragByGrid(token.gridX, token.gridY);
                  }
                } catch (_) {
                  /* ignore drag start issues */
                }
                try {
                  window.__TT_METRICS__ = window.__TT_METRICS__ || {};
                  window.__TT_METRICS__.interaction = {
                    ...(window.__TT_METRICS__.interaction || {}),
                    lastSelectedTokenId: token?.id || null,
                  };
                } catch (_) {
                  /* ignore metrics */
                }
              } catch (_) {
                /* ignore select errors */
              }
            };
            targetEl.addEventListener('pointerdown', gm._tokenSelectListener);

            gm._tokenPointerUpListener = (evt) => {
              try {
                if (evt.button !== 0) return;
                if (gm._draggingToken) {
                  gm.commitTokenDrag();
                }
              } catch (_) {
                /* ignore */
              }
            };
            targetEl.addEventListener('pointerup', gm._tokenPointerUpListener);

            const originalHover = gm._tokenHoverListener;
            gm._tokenHoverListener = async (evt) => {
              await originalHover(evt);
              if (gm._draggingToken && gm.pickingService) {
                try {
                  const ground = await gm.pickingService.pickGround(
                    evt.clientX,
                    evt.clientY,
                    targetEl
                  );
                  if (ground?.grid) {
                    const gx = Math.round(ground.grid.gx);
                    const gy = Math.round(ground.grid.gy);
                    gm.updateTokenDragToGrid(gx, gy);
                  }
                } catch (_) {
                  /* ignore */
                }
              }
            };

            try {
              targetEl.removeEventListener('pointermove', originalHover);
            } catch (_) {
              /* ignore old listener removal failure */
            }
            targetEl.addEventListener('pointermove', gm._tokenHoverListener);
          }
        } catch (_) {
          /* ignore listener attach */
        }
      }
    } catch (_) {
      /* ignore Token3DAdapter init */
    }

    // Phase 4 scaffold: initialize placeable instancing pool (no migration yet unless flag enabled)
    try {
      if (gm.features.instancedPlaceables && !gm.placeableMeshPool) {
        if (!gm.modelAssetCache) {
          gm.modelAssetCache = new ModelAssetCache();
        }
        gm.placeableMeshPool = new PlaceableMeshPool({ gameManager: gm });
      }
    } catch (_) {
      /* non-fatal instancing scaffold failure */
    }
  }
  gm.renderMode = '3d';
  // Dev convenience: expose on window during early phases
  try {
    if (typeof window !== 'undefined') {
      window.__TT_HYBRID_ACTIVE__ = true;
      window.__TT_3D_ACTIVE__ = true;
      // Convenience runtime hook for toggling isometric camera once hybrid active
      if (!window.__TT_SET_ISO_MODE__) {
        window.__TT_SET_ISO_MODE__ = (v) => {
          try {
            return gm.setIsometricCamera(!!v);
          } catch (e) {
            return false;
          }
        };
      }
    }
  } catch (_) {
    /* ignore */
  }
  return gm.threeSceneManager;
}

export function isTestEnvironment(/* gm */) {
  try {
    const env =
      typeof globalThis !== 'undefined' && globalThis.process ? globalThis.process.env : undefined;
    if (env?.JEST_WORKER_ID != null) {
      return true;
    }
    if (typeof window !== 'undefined' && window.__TT_TEST_MODE__) {
      return true;
    }
  } catch (_) {
    /* ignore */
  }
  return false;
}

export function ensureTestThreeSceneFallback(gm) {
  if (!isTestEnvironment(gm)) return false;
  if (!gm.threeSceneManager) return false;
  const tsm = gm.threeSceneManager;
  if (!tsm.scene) {
    tsm.scene = {
      children: [],
      add: () => {},
      remove: () => {},
    };
  }
  if (!tsm.camera) {
    tsm.camera = {};
  }
  if (!tsm.canvas) {
    tsm.canvas = { getContext: () => null };
  }
  if (!tsm.renderer) {
    tsm.renderer = { render: () => {} };
  }
  if (typeof tsm.isReady !== 'function') {
    tsm.isReady = () => true;
  }
  if (!tsm.registerPlaceablePool) {
    tsm.registerPlaceablePool = () => {};
  }
  tsm.ensureFallbackSurface = tsm.ensureFallbackSurface || (() => {});
  tsm.degraded = false;
  tsm.degradeReason = null;
  return true;
}
