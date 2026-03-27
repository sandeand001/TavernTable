// Lifecycle, preview, and diagnostics for PlaceableMeshPool.
// Extracted from PlaceableMeshPool.js (Phase 8).

import logger, { LOG_CATEGORY } from '../../utils/Logger.js';

const PLACEABLE_POOL_LOG_CATEGORY = LOG_CATEGORY.RENDERING;

export function logMeshPoolDebug(message, data = {}) {
  if (logger.isDebugEnabled()) {
    logger.debug(message, data, PLACEABLE_POOL_LOG_CATEGORY);
  }
}

// ── Preview ──────────────────────────────────────────────────────────────────

export async function setPreview(pool, gx, gy) {
  try {
    const gm = pool.gameManager;
    if (!gm || !gm.is3DModeActive?.()) return;
    const three = await pool._ensureThree();
    if (!three) return;
    if (gx == null || gy == null || !Number.isFinite(gx) || !Number.isFinite(gy)) return;
    if (pool._previewCoords.gx === gx && pool._previewCoords.gy === gy) return;
    pool._previewCoords = { gx, gy };
    if (!pool._previewMesh) {
      const geo = new three.PlaneGeometry(1, 1);
      geo.rotateX(-Math.PI / 2);
      const mat = new three.MeshBasicMaterial({
        color: 0xffff55,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      });
      pool._previewMesh = new three.Mesh(geo, mat);
      pool._previewMesh.name = 'PlaceablePreview';
      try {
        gm.threeSceneManager?.scene?.add(pool._previewMesh);
      } catch (_) {
        /* ignore */
      }
    }
    const world = gm.spatial.gridToWorld(gx + 0.5, gy + 0.5, 0);
    let h = 0;
    try {
      h = gm.getTerrainHeight?.(gx, gy) || 0;
    } catch (_) {
      h = 0;
    }
    const worldY = gm.spatial?.elevationUnit ? h * gm.spatial.elevationUnit : 0;
    pool._previewMesh.position.set(world.x, worldY + 0.01, world.z);
    pool._previewMesh.visible = true;
  } catch (_) {
    /* ignore preview errors */
  }
}

export function hidePreview(pool) {
  try {
    if (pool._previewMesh) pool._previewMesh.visible = false;
    pool._previewCoords = { gx: null, gy: null };
  } catch (_) {
    /* ignore */
  }
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

export function dispose(pool) {
  for (const g of pool._groups.values()) {
    try {
      g.instancedMesh.geometry?.dispose();
    } catch (_) {
      /* ignore */
    }
    try {
      g.instancedMesh.material?.dispose();
    } catch (_) {
      /* ignore */
    }
    try {
      pool.gameManager.threeSceneManager.scene.remove(g.instancedMesh);
    } catch (_) {
      /* ignore */
    }
  }
  pool._groups.clear();
  try {
    if (pool._previewMesh) {
      pool.gameManager?.threeSceneManager?.scene?.remove(pool._previewMesh);
      pool._previewMesh.geometry?.dispose?.();
      pool._previewMesh.material?.dispose?.();
    }
  } catch (_) {
    /* ignore preview dispose */
  }
  try {
    pool.gameManager?.threeSceneManager?.registerPlaceablePool?.(null);
  } catch (_) {
    /* ignore unregister errors */
  }
  pool._updateMetrics();
}

export function clearAll(pool) {
  try {
    // Increment epoch so any in-flight async addPlaceable operations originating from the
    // previous generation abort on resume, preventing stale tree reappearance.
    pool._clearEpoch += 1;
    logMeshPoolDebug('[PlaceableMeshPool] clearAll begin', {
      epoch: pool._clearEpoch,
      groups: Array.from(pool._groups.keys()),
    });
    for (const [key, group] of pool._groups.entries()) {
      group.freeIndices = [];
      group.count = 0;
      pool._metadata.set(key, new Map());
      // Scrub matrices so any future extension of draw count cannot resurrect stale visuals.
      try {
        const inst = group.instancedMesh;
        if (inst && inst.setMatrixAt) {
          const threeNS = pool._three;
          if (threeNS) {
            const dummy = new threeNS.Object3D();
            // Off-screen sink position (far below ground)
            dummy.position.set(0, -9999, 0);
            dummy.scale.set(0.0001, 0.0001, 0.0001); // virtually invisible even if shown
            dummy.updateMatrix();
            // Always scrub full capacity to eliminate ANY residual matrices.
            const limit = group.capacity;
            for (let i = 0; i < limit; i++) {
              try {
                inst.setMatrixAt(i, dummy.matrix);
              } catch (_) {
                /* ignore */
              }
            }
            try {
              inst.instanceMatrix.needsUpdate = true;
            } catch (_) {
              /* ignore */
            }
          }
          try {
            inst.count = 0;
          } catch (_) {
            /* ignore */
          }
        }
      } catch (_) {
        /* ignore scrub errors */
      }
    }
    pool._updateMetrics();
    // Force a one-time billboard refresh next frame by invalidating last cached yaw/pitch
    pool._lastBillboardYaw = null;
    pool._lastBillboardPitch = null;
    logMeshPoolDebug('[PlaceableMeshPool] clearAll end', {
      epoch: pool._clearEpoch,
      metrics: pool.getStats?.(),
    });
  } catch (_) {
    /* ignore clear errors */
  }
}

export async function fullReset(pool) {
  try {
    const three = await pool._ensureThree();
    if (!three) return;
    const old = Array.from(pool._groups.entries());
    // Remove & dispose
    for (const [, g] of old) {
      try {
        pool.gameManager?.threeSceneManager?.scene?.remove(g.instancedMesh);
      } catch (_) {
        /* ignore */
      }
      try {
        g.instancedMesh.geometry?.dispose?.();
      } catch (_) {
        /* ignore */
      }
      try {
        g.instancedMesh.material?.dispose?.();
      } catch (_) {
        /* ignore */
      }
    }
    pool._groups.clear();
    pool._metadata.clear();
    pool._clearEpoch += 1;
    pool._updateMetrics();
  } catch (_) {
    /* ignore */
  }
}

export function purgeAll(pool) {
  try {
    for (const g of pool._groups.values()) {
      try {
        pool.gameManager?.threeSceneManager?.scene?.remove(g.instancedMesh);
      } catch (_) {
        /* ignore */
      }
      try {
        g.instancedMesh.geometry?.dispose?.();
      } catch (_) {
        /* ignore */
      }
      try {
        g.instancedMesh.material?.dispose?.();
      } catch (_) {
        /* ignore */
      }
    }
    pool._groups.clear();
    pool._metadata.clear();
    pool._updateMetrics();
    pool._clearEpoch += 1; // invalidate any in-flight add promises
    // Sweep scene for any orphaned instanced meshes we previously created (defensive)
    try {
      const scene = pool.gameManager?.threeSceneManager?.scene;
      if (scene && Array.isArray(scene.children)) {
        const leftovers = [];
        for (let i = scene.children.length - 1; i >= 0; i--) {
          const ch = scene.children[i];
          if (ch && ch.isInstancedMesh && /^Placeables:/.test(ch.name)) {
            leftovers.push(ch.name);
            try {
              scene.remove(ch);
            } catch (_) {
              /* ignore */
            }
            try {
              ch.geometry?.dispose?.();
            } catch (_) {
              /* ignore */
            }
            try {
              ch.material?.dispose?.();
            } catch (_) {
              /* ignore */
            }
          }
        }
        if (leftovers.length && typeof window !== 'undefined') {
          logMeshPoolDebug('[PlaceableMeshPool] purgeAll removed stray meshes', { leftovers });
        }
      }
    } catch (_) {
      /* ignore sweep errors */
    }
  } catch (_) {
    /* ignore purge errors */
  }
}

// ── Diagnostics ──────────────────────────────────────────────────────────────

export function validateHidden(pool) {
  const issues = [];
  try {
    const three = pool._three;
    if (!three) return { ok: true, issues: [], scanned: 0 };
    const tmp = new three.Matrix4();
    for (const [key, g] of pool._groups.entries()) {
      const inst = g.instancedMesh;
      if (!inst || typeof inst.getMatrixAt !== 'function') continue;
      const active = g.count;
      const maxScan = g.capacity; // scan entire capacity now that we heavy-scrub
      let flagged = false;
      for (let i = active; i < maxScan; i++) {
        try {
          inst.getMatrixAt(i, tmp);
          const y = tmp.elements[13];
          if (Number.isFinite(y) && y > -1000) {
            issues.push({ key, index: i, y, active, capacity: g.capacity });
            flagged = true;
            break;
          }
        } catch (_) {
          break;
        }
      }
      if (!flagged && active === 0 && g.capacity > 0) {
        // Optional secondary check: ensure first matrix is scrubbed
        try {
          inst.getMatrixAt(0, tmp);
          const y0 = tmp.elements[13];
          if (Number.isFinite(y0) && y0 > -1000) {
            issues.push({ key, index: 0, y: y0, note: 'firstIndexVisibleDespiteZeroCount' });
          }
        } catch (_) {
          /* ignore */
        }
      }
    }
  } catch (_) {
    /* ignore */
  }
  return { ok: issues.length === 0, issues };
}

export function debugSnapshot(pool) {
  const groups = [];
  for (const [key, g] of pool._groups.entries()) {
    const live = g.count - g.freeIndices.length;
    groups.push({ key, capacity: g.capacity, count: g.count, free: g.freeIndices.length, live });
  }
  let straySceneMeshes = 0;
  try {
    const scene = pool.gameManager?.threeSceneManager?.scene;
    if (scene && Array.isArray(scene.children)) {
      straySceneMeshes = scene.children.filter((c) => {
        return (
          c?.isInstancedMesh &&
          /^Placeables:/.test(c.name) &&
          !pool._groups.has(c.name.split(':')[1])
        );
      }).length;
    }
  } catch (_) {
    /* ignore */
  }
  return {
    epoch: pool._clearEpoch,
    totalGroups: groups.length,
    totalLive: groups.reduce((a, b) => a + b.live, 0),
    straySceneMeshes,
    groups,
  };
}
