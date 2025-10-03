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
    // Preview (hover) single-mesh indicator state (experimental)
    this._previewMesh = null;
    this._previewCoords = { gx: null, gy: null };
    // Epoch (generation counter) to invalidate late async addPlaceable resolutions from a prior map.
    // Each clearAll() increments this so promises that started before the clear but resolve after
    // will harmlessly no-op instead of re-adding stale trees.
    this._clearEpoch = 0;
    try {
      this.gameManager?.threeSceneManager?.registerPlaceablePool?.(this);
    } catch (_) {
      /* ignore registration failure */
    }
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
    let key =
      placeable?.variantKey || placeable?.type || placeable?.sprite?.__variantKey || 'default';
    const isPlant = placeable?.type === 'plant';
    if (typeof key === 'string') {
      // Strip query/hash
      try {
        const q = key.indexOf('?');
        if (q >= 0) key = key.slice(0, q);
      } catch (_) {
        /* ignore */
      }
      try {
        const h = key.indexOf('#');
        if (h >= 0) key = key.slice(0, h);
      } catch (_) {
        /* ignore */
      }
      if (/^blob:/.test(key) || /^data:/.test(key)) key = placeable?.type || 'generic';
      if (isPlant) {
        // Canonicalize: reduce to lowercase filename (with extension) for grouping stability across runs
        try {
          const parts = key.split(/[\\/]/);
          if (parts.length) key = parts[parts.length - 1];
          key = key.toLowerCase();
        } catch (_) {
          /* ignore */
        }
      } else {
        // Non-plant: also reduce to filename
        try {
          const parts = key.split(/[\\/]/);
          if (parts.length) key = parts[parts.length - 1];
        } catch (_) {
          /* ignore */
        }
      }
    }
    return key || 'default';
  }

  _resolveWorldScale(placeable, profile = 'ground') {
    try {
      const gm = this.gameManager;
      const tileWorld = gm?.spatial?.tileWorldSize ?? 1;
      const tileWidthPx = gm?.tileWidth ?? 64;
      const tileHeightPx = gm?.tileHeight ?? 32;
      const nominalWidthPx = placeable?.__nominalSize?.widthPx ?? tileWidthPx;
      const nominalHeightPx = placeable?.__nominalSize?.heightPx ?? tileHeightPx;

      if (profile === 'ground') {
        return {
          x: tileWorld * (placeable?.tileSpanX ?? 1),
          y: 1,
          z: tileWorld * (placeable?.tileSpanZ ?? 1),
        };
      }

      if (profile === 'billboard') {
        const widthRatio = tileWidthPx ? nominalWidthPx / tileWidthPx : 1;
        const heightRatio = tileHeightPx ? nominalHeightPx / tileHeightPx : 1;
        return {
          x: tileWorld * (widthRatio || 1) || tileWorld,
          y: tileWorld * (heightRatio || 1) || tileWorld,
          z: 1,
        };
      }

      return { x: tileWorld, y: tileWorld, z: tileWorld };
    } catch (_) {
      return { x: 1, y: 1, z: 1 };
    }
  }

  /** Public: add a placeable instance; returns handle with group key + index (or null). */
  async addPlaceable(placeable) {
    const gm = this.gameManager;
    if (!gm || !gm.is3DModeActive?.()) {
      return null;
    }
    // Capture epoch so we can detect if a clear happened while awaiting dynamic imports.
    const epochAtStart = this._clearEpoch;
    const three = await this._ensureThree();
    if (!three) {
      return null;
    }
    if (!gm.threeSceneManager?.scene) {
      return null;
    }
    // Abort if a clearAll occurred during the await window.
    if (epochAtStart !== this._clearEpoch) {
      return null;
    }
    const rawVariant = placeable?.variantKey;
    const key = this._deriveKey(placeable);
    // Preserve original texture path separately for material creation
    try {
      if (placeable && rawVariant) placeable.__rawVariantKey = rawVariant;
    } catch (_) {
      /* ignore */
    }
    // Debug aggregation of key mapping
    try {
      if (typeof window !== 'undefined') {
        const dbg = (window.__TT_PLACEABLE_KEYS__ = window.__TT_PLACEABLE_KEYS__ || {
          mappings: {},
          counts: {},
        });
        if (rawVariant) dbg.mappings[rawVariant] = key;
        dbg.counts[key] = (dbg.counts[key] || 0) + 1;
      }
    } catch (_) {
      /* ignore */
    }
    try {
      if (typeof window !== 'undefined') {
        // eslint-disable-next-line no-console
        console.debug('[PlaceableMeshPool] addPlaceable start', { key, epochAtStart });
      }
    } catch (_) {
      /* ignore */
    }
    let group = this._groups.get(key);
    if (!group || !group.instancedMesh) {
      group = await this._createGroup(key, three, placeable?.type || 'generic', placeable);
      if (!group) return null;
      this._groups.set(key, group);
      this._metadata.set(key, new Map());
      this._updateMetrics();
      try {
        const profile = this.gameManager?.threeSceneManager?.getTimeOfDayProfile?.();
        if (profile && profile.placeables) {
          this.applyLightingProfile(profile.placeables);
        }
      } catch (_) {
        /* ignore tint bootstrap */
      }
    }
    // Re-check epoch after potential async _createGroup work (defensive double-guard)
    if (epochAtStart !== this._clearEpoch) {
      return null;
    }
    const { instancedMesh } = group;
    const profile =
      group.profile ||
      placeable?.renderProfile ||
      (placeable?.type === 'plant' ? 'billboard' : 'ground');
    group.profile = profile;
    const scale = this._resolveWorldScale(placeable, profile);
    placeable.__worldScale = scale;
    const heightOffset = Number.isFinite(placeable?.heightOffset)
      ? placeable.heightOffset
      : profile === 'ground'
        ? 0.005
        : 0;
    // If this placeable is metrics-only (no visual), ensure group stays hidden
    try {
      if (placeable.metricsOnly) {
        instancedMesh.visible = false;
        if (instancedMesh.material) {
          instancedMesh.material.transparent = true;
          instancedMesh.material.opacity = 0.0;
          instancedMesh.material.depthWrite = false;
        }
      }
    } catch (_) {
      /* ignore visibility adjustments */
    }
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
      dummy.position.set(world.x, worldY + heightOffset, world.z);
      dummy.scale.set(scale.x ?? 1, scale.y ?? 1, scale.z ?? 1);
      dummy.updateMatrix();
      instancedMesh.setMatrixAt(index, dummy.matrix);
      instancedMesh.instanceMatrix.needsUpdate = true;
      // Ensure draw range covers this new instance (three renders 0..count-1)
      try {
        if (typeof instancedMesh.count === 'number' && instancedMesh.count < index + 1) {
          instancedMesh.count = index + 1;
        }
      } catch (_) {
        /* ignore */
      }
    } catch (_) {
      /* ignore positioning errors */
    }
    placeable.__meshPoolHandle = { key, index };
    // Record metadata for reverse mapping
    try {
      const metaGroup = this._metadata.get(key) || new Map();
      metaGroup.set(index, {
        gx: placeable.gridX ?? 0,
        gy: placeable.gridY ?? 0,
        scale,
        profile,
        heightOffset,
      });
      this._metadata.set(key, metaGroup);
    } catch (_) {
      /* ignore metadata errors */
    }
    // Update metrics to reflect new live instance
    this._updateMetrics();
    try {
      if (typeof window !== 'undefined') {
        const live = group.count - group.freeIndices.length;
        // eslint-disable-next-line no-console
        console.debug('[PlaceableMeshPool] addPlaceable done', { key, index, live });
      }
    } catch (_) {
      /* ignore */
    }
    return placeable.__meshPoolHandle;
  }

  /** Remove a placeable instance by its stored handle */
  removePlaceable(placeable) {
    const handle = placeable?.__meshPoolHandle;
    if (!handle) return;
    const group = this._groups.get(handle.key);
    if (!group) return;
    // If the pool was cleared after this handle was created, group.count may be 0 while
    // the handle.index refers to a prior generation. Do not record it as a free index or
    // we risk resurrecting stale matrices when allocation later bumps instancedMesh.count.
    if (handle.index >= group.count) {
      delete placeable.__meshPoolHandle;
      return;
    }
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
  async _createGroup(key, three, type = 'generic', placeable = null) {
    try {
      const capacity = this._initialCapacity; // initial; grow strategy implemented
      const profile = placeable?.renderProfile || (type === 'plant' ? 'billboard' : 'ground');

      // Geometry selection driven by render profile (billboard vs ground overlay)
      let geo;
      if (profile === 'ground') {
        geo = new three.PlaneGeometry(1, 1);
        geo.rotateX(-Math.PI / 2); // lie flat on ground plane
      } else {
        geo = new three.PlaneGeometry(1, 1);
        // Shift geometry upward so origin sits at the base center (avoids sinking below ground)
        geo.translate(0, 0.5, 0);
      }

      // Material strategy: allow external override; fallback to texture + simple basic material.
      let mat;
      try {
        if (this._materialStrategy && typeof this._materialStrategy === 'function') {
          mat = this._materialStrategy({ key, type, profile, three, capacity });
        }
      } catch (_) {
        /* ignore strategy errors */
      }

      if (!mat) {
        let texture = null;
        const texturePath =
          (typeof window !== 'undefined' && window.__TT_FORCE_PLACEABLE_TEXTURE) ||
          placeable?.texturePath ||
          placeable?.__rawVariantKey ||
          key;
        try {
          if (texturePath && typeof texturePath === 'string' && /\//.test(texturePath)) {
            texture = new three.TextureLoader().load(texturePath, () => {
              try {
                texture.needsUpdate = true;
              } catch (_) {
                /* ignore */
              }
            });
          }
        } catch (e) {
          texture = null;
          try {
            console.debug('[PlaceableMeshPool] texture load error', {
              key,
              texturePath,
              err: e?.message,
            });
          } catch (_) {
            /* ignore */
          }
        }

        if (texture) {
          try {
            if ('colorSpace' in texture && three.SRGBColorSpace) {
              texture.colorSpace = three.SRGBColorSpace;
            } else if ('encoding' in texture && three.sRGBEncoding != null) {
              texture.encoding = three.sRGBEncoding;
            }
          } catch (_) {
            /* ignore color space alignment */
          }
          mat = new three.MeshBasicMaterial({
            map: texture,
            transparent: true,
            alphaTest: 0.01,
            depthWrite: false,
            side: three.DoubleSide,
            toneMapped: false,
          });
          try {
            console.debug('[PlaceableMeshPool] created textured material', { key, texturePath });
          } catch (_) {
            /* ignore */
          }
        } else {
          const typeColors = {
            plant: 0x2d8f28,
            path: 0x8b5a2b,
            structure: 0x666666,
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
      }

      const instanced = new three.InstancedMesh(geo, mat, capacity);
      instanced.name = `Placeables:${key}`;
      // Allow instanced meshes to cast shadows (terrain receives). Keep receiveShadow off to avoid dark cards.
      try {
        instanced.castShadow = true;
      } catch (_) {
        /* ignore */
      }
      // Start with zero active draw instances; we raise .count as we allocate
      try {
        instanced.count = 0;
      } catch (_) {
        /* ignore */
      }
      // Add to scene (graceful degraded mode handling: scene may be stub/missing .add)
      try {
        const scene = this.gameManager.threeSceneManager?.scene;
        if (scene && typeof scene.add === 'function') scene.add(instanced);
      } catch (_) {
        /* ignore scene add failure */
      }
      // Register billboard updater for upright quads so they keep facing the camera.
      if (profile === 'billboard' && this.gameManager?.threeSceneManager?.addAnimationCallback) {
        if (!this._billboardUpdater) {
          this._lastBillboardYaw = null;
          this._lastBillboardPitch = null;
          this._lastCamPos = { x: null, z: null };
          this._billboardUpdater = () => {
            try {
              const gm = this.gameManager;
              const cam = gm.threeSceneManager.camera;
              if (!cam) return;
              const yaw = cam.rotation?.y || 0;
              const pitch = cam.rotation?.x || 0;
              const camPos = cam.position;
              const moved =
                this._lastCamPos.x == null ||
                Math.abs(this._lastCamPos.x - camPos.x) > 0.01 ||
                Math.abs(this._lastCamPos.z - camPos.z) > 0.01;
              const yawChanged =
                this._lastBillboardYaw == null || Math.abs(this._lastBillboardYaw - yaw) >= 0.001;
              const pitchChanged =
                this._lastBillboardPitch == null ||
                Math.abs(this._lastBillboardPitch - pitch) >= 0.002;
              if (!moved && !yawChanged && !pitchChanged) return;
              this._lastBillboardYaw = yaw;
              this._lastBillboardPitch = pitch;
              this._lastCamPos.x = camPos.x;
              this._lastCamPos.z = camPos.z;
              const threeNS = this._three;
              if (!threeNS) return;
              const dummy = new threeNS.Object3D();
              const worldCamPos = camPos.clone
                ? camPos.clone()
                : { x: camPos.x, y: camPos.y, z: camPos.z };
              // Threshold (radians) above which we start introducing pitch-based billboard (camera more top-down)
              // (Removed previous pitch gating; always yaw-only billboard to keep trees upright)
              // Recompute matrices for billboard groups
              for (const [gKey, g] of this._groups.entries()) {
                if (g.profile !== 'billboard') continue;
                const inst = g.instancedMesh;
                if (!inst) continue;
                const metaMap = this._metadata.get(gKey);
                if (!metaMap) continue;
                for (const [index, coords] of metaMap.entries()) {
                  if (g.freeIndices.includes(index)) continue;
                  const { gx, gy, scale, heightOffset } = coords || {
                    gx: 0,
                    gy: 0,
                    scale: { x: 1, y: 1, z: 1 },
                    heightOffset: 0,
                  };
                  let h = 0;
                  try {
                    h = gm.getTerrainHeight?.(gx, gy) || 0;
                  } catch (_) {
                    h = 0;
                  }
                  const world = gm.spatial.gridToWorld(gx + 0.5, gy + 0.5, 0);
                  const worldY = gm.spatial?.elevationUnit ? h * gm.spatial.elevationUnit : 0;
                  dummy.position.set(world.x, worldY + (heightOffset || 0), world.z);
                  // Full spherical billboard: always face the camera at any pitch & yaw
                  // so the tree quad never collapses into a line from overhead or oblique angles.
                  // NOTE: This introduces pitch tilt (the sprite leans toward the camera) which
                  // gives a pseudo-3D look. If we later want an upright-only variant that never
                  // edge-on collapses, we can implement multi-quad (cross) impostors instead.
                  if (dummy.lookAt) {
                    dummy.lookAt(worldCamPos.x, worldCamPos.y, worldCamPos.z);
                  } else {
                    // Fallback: manually compute facing yaw (rare path if lookAt unavailable)
                    const dx = worldCamPos.x - world.x;
                    const dz = worldCamPos.z - world.z;
                    const faceYaw = Math.atan2(dx, dz);
                    dummy.rotation.set(0, faceYaw, 0);
                  }
                  const useScale = scale || { x: 1, y: 1, z: 1 };
                  dummy.scale.set(useScale.x ?? 1, useScale.y ?? 1, useScale.z ?? 1);
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
              /* ignore billboard errors */
            }
          };
          this.gameManager.threeSceneManager.addAnimationCallback(this._billboardUpdater);
        }
      }
      const tintCategory = placeable?.type || type || 'generic';
      const baseColorRef = mat?.color ? { r: mat.color.r, g: mat.color.g, b: mat.color.b } : null;
      return {
        key,
        type,
        profile,
        tintCategory,
        instancedMesh: instanced,
        capacity,
        freeIndices: [],
        count: 0,
        baseColor: baseColorRef,
      };
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
        return {
          key,
          type,
          profile: placeable?.renderProfile || 'ground',
          instancedMesh: instanced,
          capacity,
          freeIndices: [],
          count: 0,
        };
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

  applyLightingProfile(profile = {}) {
    const clamp = (value, min = 0, max = 1) => {
      if (!Number.isFinite(value)) return min;
      if (value < min) return min;
      if (value > max) return max;
      return value;
    };
    for (const group of this._groups.values()) {
      const inst = group?.instancedMesh;
      if (!inst || !inst.material || !inst.material.color) continue;
      const mat = inst.material;
      if (!group.__baseColor) {
        if (group.baseColor) {
          group.__baseColor = { ...group.baseColor };
        } else {
          group.__baseColor = { r: mat.color.r, g: mat.color.g, b: mat.color.b };
        }
      }
      const entry =
        profile[group.tintCategory] || profile[group.profile] || profile.generic || profile.default;
      if (!entry) {
        mat.color.setRGB(group.__baseColor.r, group.__baseColor.g, group.__baseColor.b);
        mat.needsUpdate = true;
        continue;
      }
      const saturation = clamp(entry.saturation ?? 1, 0, 3);
      const brightness = clamp(entry.brightness ?? 1, 0, 3);
      const warmMix = clamp(entry.warmMix ?? 0, 0, 1);
      const coolMix = clamp(entry.coolMix ?? 0, 0, 1);
      const warm = entry.warmColor;
      const cool = entry.coolColor;
      let r = group.__baseColor.r;
      let g = group.__baseColor.g;
      let b = group.__baseColor.b;
      const avg = (r + g + b) / 3;
      r = avg + (r - avg) * saturation;
      g = avg + (g - avg) * saturation;
      b = avg + (b - avg) * saturation;
      if (warm && warmMix > 0) {
        const inv = 1 - warmMix;
        r = r * inv + warm.r * warmMix;
        g = g * inv + warm.g * warmMix;
        b = b * inv + warm.b * warmMix;
      }
      if (cool && coolMix > 0) {
        const inv = 1 - coolMix;
        r = r * inv + cool.r * coolMix;
        g = g * inv + cool.g * coolMix;
        b = b * inv + cool.b * coolMix;
      }
      r *= brightness;
      g *= brightness;
      b *= brightness;
      mat.color.setRGB(clamp(r, 0, 1), clamp(g, 0, 1), clamp(b, 0, 1));
      mat.needsUpdate = true;
    }
  }

  /** Recompute Y positions for all live instances (call after terrain height changes). */
  async resyncHeights() {
    const start = (typeof performance !== 'undefined' && performance.now()) || Date.now();
    try {
      const gm = this.gameManager;
      if (!gm || !gm.is3DModeActive?.()) return;
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
          const { gx, gy, scale, heightOffset } = coords || {
            gx: 0,
            gy: 0,
            scale: { x: 1, y: 1, z: 1 },
            heightOffset: 0,
          };
          let h = 0;
          try {
            h = gm.getTerrainHeight?.(gx, gy) || 0;
          } catch (_) {
            h = 0;
          }
          const world = gm.spatial.gridToWorld(gx + 0.5, gy + 0.5, 0);
          const worldY = gm.spatial?.elevationUnit ? h * gm.spatial.elevationUnit : 0;
          dummy.position.set(world.x, worldY + (heightOffset || 0), world.z);
          const useScale = scale || { x: 1, y: 1, z: 1 };
          dummy.scale.set(useScale.x ?? 1, useScale.y ?? 1, useScale.z ?? 1);
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

  /**
   * Experimental: show/update a single preview mesh at grid coords (gx, gy).
   * Lazy-creates a THREE.Mesh the first time it's invoked. Safe to call frequently.
   */
  async setPreview(gx, gy) {
    try {
      const gm = this.gameManager;
      if (!gm || !gm.is3DModeActive?.()) return;
      const three = await this._ensureThree();
      if (!three) return;
      if (gx == null || gy == null || !Number.isFinite(gx) || !Number.isFinite(gy)) return;
      if (this._previewCoords.gx === gx && this._previewCoords.gy === gy) return;
      this._previewCoords = { gx, gy };
      if (!this._previewMesh) {
        const geo = new three.PlaneGeometry(1, 1);
        geo.rotateX(-Math.PI / 2);
        const mat = new three.MeshBasicMaterial({
          color: 0xffff55,
          transparent: true,
          opacity: 0.35,
          depthWrite: false,
        });
        this._previewMesh = new three.Mesh(geo, mat);
        this._previewMesh.name = 'PlaceablePreview';
        try {
          gm.threeSceneManager?.scene?.add(this._previewMesh);
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
      this._previewMesh.position.set(world.x, worldY + 0.01, world.z);
      this._previewMesh.visible = true;
    } catch (_) {
      /* ignore preview errors */
    }
  }

  /** Hide the preview indicator if present */
  hidePreview() {
    try {
      if (this._previewMesh) this._previewMesh.visible = false;
      this._previewCoords = { gx: null, gy: null };
    } catch (_) {
      /* ignore */
    }
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
    try {
      if (this._previewMesh) {
        this.gameManager?.threeSceneManager?.scene?.remove(this._previewMesh);
        this._previewMesh.geometry?.dispose?.();
        this._previewMesh.material?.dispose?.();
      }
    } catch (_) {
      /* ignore preview dispose */
    }
    try {
      this.gameManager?.threeSceneManager?.registerPlaceablePool?.(null);
    } catch (_) {
      /* ignore unregister errors */
    }
    this._updateMetrics();
  }

  /**
   * Clear all live instances WITHOUT disposing underlying geometries/materials.
   * Used when regenerating an entire map so stale trees do not persist.
   */
  clearAll() {
    try {
      // Increment epoch so any in-flight async addPlaceable operations originating from the
      // previous generation abort on resume, preventing stale tree reappearance.
      this._clearEpoch += 1;
      try {
        if (typeof window !== 'undefined') {
          // eslint-disable-next-line no-console
          console.debug('[PlaceableMeshPool] clearAll begin', {
            epoch: this._clearEpoch,
            groups: Array.from(this._groups.keys()),
          });
        }
      } catch (_) {
        /* ignore */
      }
      for (const [key, group] of this._groups.entries()) {
        group.freeIndices = [];
        group.count = 0;
        this._metadata.set(key, new Map());
        // Scrub matrices so any future extension of draw count cannot resurrect stale visuals.
        try {
          const inst = group.instancedMesh;
          if (inst && inst.setMatrixAt) {
            const threeNS = this._three;
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
      this._updateMetrics();
      // Force a one-time billboard refresh next frame by invalidating last cached yaw/pitch
      this._lastBillboardYaw = null;
      this._lastBillboardPitch = null;
      try {
        if (typeof window !== 'undefined') {
          // eslint-disable-next-line no-console
          console.debug('[PlaceableMeshPool] clearAll end', {
            epoch: this._clearEpoch,
            metrics: this.getStats?.(),
          });
        }
      } catch (_) {
        /* ignore */
      }
    } catch (_) {
      /* ignore clear errors */
    }
  }

  /** Destroy and recreate all instanced groups (heavier than clearAll). */
  async fullReset() {
    try {
      const three = await this._ensureThree();
      if (!three) return;
      const old = Array.from(this._groups.entries());
      // Remove & dispose
      for (const [, g] of old) {
        try {
          this.gameManager?.threeSceneManager?.scene?.remove(g.instancedMesh);
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
      this._groups.clear();
      this._metadata.clear();
      this._clearEpoch += 1;
      this._updateMetrics();
    } catch (_) {
      /* ignore */
    }
  }

  /** Dev helper: validate there are no visible stale matrices beyond active counts */
  validateHidden() {
    const issues = [];
    try {
      const three = this._three;
      if (!three) return { ok: true, issues: [], scanned: 0 };
      const tmp = new three.Matrix4();
      for (const [key, g] of this._groups.entries()) {
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

  /** Fully remove all groups (disposes instanced meshes) without touching preview. */
  purgeAll() {
    try {
      for (const g of this._groups.values()) {
        try {
          this.gameManager?.threeSceneManager?.scene?.remove(g.instancedMesh);
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
      this._groups.clear();
      this._metadata.clear();
      this._updateMetrics();
      this._clearEpoch += 1; // invalidate any in-flight add promises
      // Sweep scene for any orphaned instanced meshes we previously created (defensive)
      try {
        const scene = this.gameManager?.threeSceneManager?.scene;
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
            // eslint-disable-next-line no-console
            console.debug('[PlaceableMeshPool] purgeAll removed stray meshes', { leftovers });
          }
        }
      } catch (_) {
        /* ignore sweep errors */
      }
    } catch (_) {
      /* ignore purge errors */
    }
  }

  /** Diagnostic helper: returns a snapshot of current instancing state for console inspection */
  debugSnapshot() {
    const groups = [];
    for (const [key, g] of this._groups.entries()) {
      const live = g.count - g.freeIndices.length;
      groups.push({ key, capacity: g.capacity, count: g.count, free: g.freeIndices.length, live });
    }
    let straySceneMeshes = 0;
    try {
      const scene = this.gameManager?.threeSceneManager?.scene;
      if (scene?.children) {
        straySceneMeshes = scene.children.filter((c) => {
          return (
            c?.isInstancedMesh &&
            /^Placeables:/.test(c.name) &&
            !this._groups.has(c.name.split(':')[1])
          );
        }).length;
      }
    } catch (_) {
      /* ignore */
    }
    return {
      epoch: this._clearEpoch,
      totalGroups: groups.length,
      totalLive: groups.reduce((a, b) => a + b.live, 0),
      straySceneMeshes,
      groups,
    };
  }
}
