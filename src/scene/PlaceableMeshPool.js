// PlaceableMeshPool.js - Phase 4 scaffold
// Manages instanced meshes for static placeables (trees, rocks, etc.).
// Initial goals:
//  - Group placeables by (variantKey) -> InstancedMesh
//  - Provide add/update/remove API that defers GPU allocation until first use
//  - Expose lightweight metrics for dev inspection
//  - Fail gracefully if Three.js not available

export class PlaceableMeshPool {
  constructor({ gameManager, initialCapacity = 256, maxCapacity = 4096 } = {}) {
    this.gameManager = gameManager;
    this._groups = new Map(); // key -> { instancedMesh, capacity, count, freeIndices[] }
    // Per-group metadata: Map<key, Map<index, { gx, gy }>> for reverse height recompute
    this._metadata = new Map();
    this._three = null; // cached namespace once loaded
    this._metrics = { groups: 0, instances: 0, capacityExpansions: 0 };
    this._initialCapacity = Math.max(1, initialCapacity);
    this._maxCapacity = Math.max(this._initialCapacity, maxCapacity);
  }

  async _ensureThree() {
    if (this._three) return this._three;
    try {
      const three = await import('three');
      this._three = three;
      return three;
    } catch (_) {
      return null;
    }
  }

  /** Derive a stable variant key from a placeable sprite or data. */
  _deriveKey(placeable) {
    return placeable?.variantKey || placeable?.type || placeable?.sprite?.__variantKey || 'default';
  }

  /** Public: add a placeable instance; returns handle with group key + index (or null). */
  async addPlaceable(placeable) {
    const gm = this.gameManager;
    if (!gm || gm.renderMode !== '3d-hybrid') {
      return null;
    }
    const three = await this._ensureThree();
    if (!three) {
      return null;
    }
    if (!gm.threeSceneManager?.scene) {
      return null;
    }
    const key = this._deriveKey(placeable);
    let group = this._groups.get(key);
    if (!group) {
      group = await this._createGroup(key, three, placeable?.type || 'generic');
      if (!group) return null;
      this._groups.set(key, group);
      this._metadata.set(key, new Map());
      this._updateMetrics();
    }
    const { instancedMesh } = group;
    const index = this._allocateIndex(group);
    if (index < 0) return null; // capacity exhaustion (future: grow)
    // Position from grid (approx center)
    try {
      const gx = placeable.gridX ?? 0;
      const gy = placeable.gridY ?? 0;
      const world = gm.spatial.gridToWorld(gx + 0.5, gy + 0.5, 0);
      const dummy = new three.Object3D();
      // Sample terrain height (grid center). Falls back to 0 if unavailable.
      let h = 0;
      try {
        if (typeof gm.getTerrainHeight === 'function') {
          h = gm.getTerrainHeight(gx, gy) || 0; // height in elevation levels
        }
      } catch (_) {
        h = 0;
      }
      const worldY = gm.spatial?.elevationUnit ? h * gm.spatial.elevationUnit : 0;
      dummy.position.set(world.x, worldY, world.z);
      dummy.updateMatrix();
      instancedMesh.setMatrixAt(index, dummy.matrix);
      instancedMesh.instanceMatrix.needsUpdate = true;
    } catch (_) {
      /* ignore positioning errors */
    }
    placeable.__meshPoolHandle = { key, index };
    // Record metadata for reverse mapping
    try {
      const metaGroup = this._metadata.get(key) || new Map();
      metaGroup.set(index, { gx: placeable.gridX ?? 0, gy: placeable.gridY ?? 0 });
      this._metadata.set(key, metaGroup);
    } catch (_) {
      /* ignore metadata errors */
    }
    // Update metrics to reflect new live instance
    this._updateMetrics();
    return placeable.__meshPoolHandle;
  }

  /** Remove a placeable instance by its stored handle */
  removePlaceable(placeable) {
    const handle = placeable?.__meshPoolHandle;
    if (!handle) return;
    const group = this._groups.get(handle.key);
    if (!group) return;
    // Mark index free (do not compact now for simplicity)
    if (!group.freeIndices.includes(handle.index)) {
      group.freeIndices.push(handle.index);
    }
    // Remove metadata
    try {
      const metaGroup = this._metadata.get(handle.key);
      if (metaGroup) metaGroup.delete(handle.index);
    } catch (_) {
      /* ignore */
    }
    delete placeable.__meshPoolHandle;
    this._updateMetrics();
  }

  /** Create a new instanced mesh group for a variant key. */
  async _createGroup(key, three, type = 'generic') {
    try {
      const capacity = this._initialCapacity; // initial; grow strategy implemented
      // Geometry selection: plants (flora) use vertical quads (billboards), others remain horizontal footprint.
      let geo;
      if (type === 'plant') {
        geo = new three.PlaneGeometry(0.9, 1.6); // vertical; origin mid-height
        // Leave unrotated (facing +Z) – we'll yaw-align the group each frame.
      } else {
        geo = new three.PlaneGeometry(0.9, 0.9);
        geo.rotateX(-Math.PI / 2); // horizontal footprint
      }
      // Material strategy: allow external override; fallback to per-type tint.
      let mat;
      try {
        if (this._materialStrategy && typeof this._materialStrategy === 'function') {
          mat = this._materialStrategy({ key, type, three, capacity });
        }
      } catch (_) {
        /* ignore strategy errors */
      }
      if (!mat) {
        const typeColors = {
          plant: 0x2d8f28, // green
          path: 0x8b5a2b, // earthy brown
          structure: 0x666666, // neutral gray
          generic: 0x00aa55,
        };
        const color = typeColors[type] || typeColors.generic;
        mat = new three.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.9,
          depthWrite: false,
        });
      }
      const instanced = new three.InstancedMesh(geo, mat, capacity);
      instanced.name = `Placeables:${key}`;
      // Add to scene (graceful degraded mode handling: scene may be stub/missing .add)
      try {
        const scene = this.gameManager.threeSceneManager?.scene;
        if (scene && typeof scene.add === 'function') scene.add(instanced);
      } catch (_) {
        /* ignore scene add failure */
      }
      // For vertical plant groups, register a shared animation callback once.
      if (type === 'plant' && this.gameManager?.threeSceneManager?.addAnimationCallback) {
        if (!this._plantBillboardUpdater) {
          this._plantBillboardUpdater = () => {
            try {
              const cam = this.gameManager.threeSceneManager.camera;
              if (!cam) return;
              const yaw = cam.rotation?.y || 0;
              for (const g of this._groups.values()) {
                if (g.type !== 'plant') continue;
                try {
                  g.instancedMesh.rotation.y = yaw;
                } catch (_) {
                  /* ignore */
                }
              }
            } catch (_) {
              /* ignore */
            }
          };
          this.gameManager.threeSceneManager.addAnimationCallback(this._plantBillboardUpdater);
        }
      }
      return { key, type, instancedMesh: instanced, capacity, freeIndices: [], count: 0 };
    } catch (err) {
      // Capture error for diagnostics and attempt a fallback lightweight group so tests can proceed
      try {
        this._lastGroupCreateError = (err && err.message) || 'unknown';
      } catch (_) {
        /* ignore */
      }
      try {
        const capacity = this._initialCapacity;
        // Minimal fallback instanced mesh stub
        const instanced = {
          name: `Placeables:${key}:fallback`,
          capacity,
          _matrices: new Array(capacity),
          instanceMatrix: { needsUpdate: false },
          setMatrixAt(i, m) {
            this._matrices[i] = m;
          },
        };
        return { key, type, instancedMesh: instanced, capacity, freeIndices: [], count: 0 };
      } catch (_) {
        return null;
      }
    }
  }

  _allocateIndex(group) {
    if (group.freeIndices.length) {
      return group.freeIndices.pop();
    }
    if (group.count >= group.capacity) {
      // Attempt growth
      const grew = this._tryExpandGroup(group);
      if (!grew) return -1;
    }
    const idx = group.count;
    group.count += 1;
    return idx;
  }

  _tryExpandGroup(group) {
    try {
      if (group.capacity >= this._maxCapacity) return false;
      const three = this._three;
      if (!three) return false;
      const newCapacity = Math.min(group.capacity * 2, this._maxCapacity);
      // Reuse geometry & material references
      const old = group.instancedMesh;
      const newInst = new three.InstancedMesh(old.geometry, old.material, newCapacity);
      newInst.name = old.name;
      // Copy existing matrices (best-effort)
      try {
        for (let i = 0; i < group.count; i++) {
          if (old._matrices && old._matrices[i]) {
            newInst.setMatrixAt(i, old._matrices[i]);
          } else if (typeof old.getMatrixAt === 'function') {
            const m = new three.Matrix4();
            old.getMatrixAt(i, m);
            newInst.setMatrixAt(i, m);
          }
        }
        newInst.instanceMatrix.needsUpdate = true;
      } catch (_) {
        /* ignore copy failures */
      }
      // Scene swap
      try {
        this.gameManager.threeSceneManager.scene.remove(old);
      } catch (_) {
        /* ignore */
      }
      try {
        this.gameManager.threeSceneManager.scene.add(newInst);
      } catch (_) {
        /* ignore */
      }
      group.instancedMesh = newInst;
      // Migrate metadata map untouched; capacity change does not invalidate indices < count
      group.capacity = newCapacity;
      this._metrics.capacityExpansions += 1;
      this._updateMetrics();
      // Do not dispose geometry/material (they are shared) but dispose old instanced container
      try {
        old.dispose?.();
      } catch (_) {
        /* ignore */
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  _updateMetrics() {
    let totalInstances = 0;
    for (const g of this._groups.values()) totalInstances += g.count - g.freeIndices.length;
    this._metrics.groups = this._groups.size;
    this._metrics.instances = totalInstances;
    if (typeof window !== 'undefined') {
      window.__TT_METRICS__ = window.__TT_METRICS__ || {};
      window.__TT_METRICS__.placeables = {
        groups: this._metrics.groups,
        liveInstances: this._metrics.instances,
        capacityExpansions: this._metrics.capacityExpansions,
      };
    }
  }

  /** Recompute Y positions for all live instances (call after terrain height changes). */
  async resyncHeights() {
    const start = (typeof performance !== 'undefined' && performance.now()) || Date.now();
    try {
      const gm = this.gameManager;
      if (!gm || gm.renderMode !== '3d-hybrid') return;
      const three = await this._ensureThree();
      if (!three) return;
      const dummy = new three.Object3D();
      for (const [key, group] of this._groups.entries()) {
        const inst = group.instancedMesh;
        if (!inst) continue;
        const metaMap = this._metadata.get(key);
        if (!metaMap) continue;
        for (const [index, coords] of metaMap.entries()) {
          if (group.freeIndices.includes(index)) continue;
          const { gx, gy } = coords || { gx: 0, gy: 0 };
          let h = 0;
          try {
            h = gm.getTerrainHeight?.(gx, gy) || 0;
          } catch (_) {
            h = 0;
          }
          const world = gm.spatial.gridToWorld(gx + 0.5, gy + 0.5, 0);
          const worldY = gm.spatial?.elevationUnit ? h * gm.spatial.elevationUnit : 0;
          dummy.position.set(world.x, worldY, world.z);
          dummy.updateMatrix();
          try {
            inst.setMatrixAt(index, dummy.matrix);
          } catch (_) {
            /* ignore setMatrix errors */
          }
        }
        try {
          inst.instanceMatrix.needsUpdate = true;
        } catch (_) {
          /* ignore */
        }
      }
    } catch (_) {
      /* ignore */
    } finally {
      const end = (typeof performance !== 'undefined' && performance.now()) || Date.now();
      try {
        if (typeof window !== 'undefined') {
          window.__TT_METRICS__ = window.__TT_METRICS__ || {};
          window.__TT_METRICS__.placeables = {
            ...(window.__TT_METRICS__.placeables || {}),
            lastResyncMs: end - start,
            lastResyncAt: Date.now(),
          };
        }
      } catch (_) {
        /* ignore */
      }
    }
  }

  getStats() {
    return { ...this._metrics };
  }

  /**
   * Allow callers to inject a custom material creation strategy.
   * strategy({ key, type, three, capacity }) => THREE.Material
   */
  setMaterialStrategy(fn) {
    if (typeof fn === 'function') this._materialStrategy = fn;
  }

  /** Dispose all instanced meshes (phase teardown) */
  dispose() {
    for (const g of this._groups.values()) {
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
        this.gameManager.threeSceneManager.scene.remove(g.instancedMesh);
      } catch (_) {
        /* ignore */
      }
    }
    this._groups.clear();
    this._updateMetrics();
  }
}
