import {
  logMeshPoolDebug,
  setPreview as _setPreview,
  hidePreview as _hidePreview,
  dispose as _dispose,
  clearAll as _clearAll,
  fullReset as _fullReset,
  purgeAll as _purgeAll,
  validateHidden as _validateHidden,
  debugSnapshot as _debugSnapshot,
  disposePlaceableDepthPrepass,
  invalidatePlaceableBounds,
} from './PlaceablePoolLifecycle.js';
import { logger, LOG_CATEGORY } from '../../utils/logger/Logger.js';
import { createPlaceableModelGeometry } from './placeableModelGeometry.js';
import { fitTreeScale } from './treeSupport.js';
import { readPlaceablePlacements } from '../SceneSnapshotReaders.js';
import { isSightPlaceable } from '../../campaigns/CreatureVisibility.js';
import { hash32 } from '../../utils/SeededRNG.js';
import { getPurePolyAsset, isCaveFormationModel } from '../../config/assets/PurePolyAssets.js';
import {
  disposePlaceableMaterials,
  preparePlaceableMaterials,
  resolvePlaceableAppearance,
} from './materials/placeable-appearance.js';

// PlaceableMeshPool.js - Phase 4 scaffold
// Manages instanced meshes for static placeables (trees, rocks, etc.).
// Lifecycle, preview, and diagnostics extracted to PlaceablePoolLifecycle.js.

export class PlaceableMeshPool {
  // ── Constructor ───────────────────────────────────────────────────

  constructor({
    gameManager,
    initialCapacity = 256,
    maxCapacity = 4096,
    publishMetrics = true,
  } = {}) {
    this.gameManager = gameManager;
    this._publishMetrics = publishMetrics;
    this._groups = new Map(); // key -> { instancedMesh, capacity, count, freeIndices[] }
    this._pendingGroups = new Map();
    this._pendingPlacements = new Set();
    // Per-group metadata: live instance coordinates and cached world transforms.
    this._metadata = new Map();
    this._three = null; // cached namespace once loaded
    this._metrics = { groups: 0, instances: 0, capacityExpansions: 0 };
    this._revision = 0;
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

  // ── Three.js Initialization ──────────────────────────────────────

  targetingCoverBounds() {
    if (!this._groups.size) return [];
    const three = this._three;
    if (!three) throw new Error('Wait for building cover geometry to finish loading');
    const matrix = new three.Matrix4();
    const bounds = new three.Box3();
    const result = [];
    for (const [key, metadata] of this._metadata) {
      const mesh = this._groups.get(key)?.instancedMesh;
      if (!mesh) throw new Error('A building cover group is missing');
      mesh.updateMatrixWorld(true);
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      for (const [index, entry] of metadata) {
        if (!['structure', 'building'].includes(entry.source?.type)) continue;
        mesh.getMatrixAt(index, matrix);
        matrix.premultiply(mesh.matrixWorld);
        bounds.copy(mesh.geometry.boundingBox).applyMatrix4(matrix);
        result.push({
          min: { x: bounds.min.x, y: bounds.min.y, z: bounds.min.z },
          max: { x: bounds.max.x, y: bounds.max.y, z: bounds.max.z },
        });
      }
    }
    return result;
  }

  sightBlockingBounds() {
    if (!this._groups.size) return [];
    if (!this._three) throw new Error('Wait for physical sight geometry to finish loading');
    const matrix = new this._three.Matrix4();
    const bounds = new this._three.Box3();
    const result = [];
    for (const [key, metadata] of this._metadata) {
      const group = this._groups.get(key);
      if (!group) throw new Error('A physical sight group is missing');
      if (!group.sightBounds) continue;
      group.instancedMesh.updateMatrixWorld(true);
      for (const [index, entry] of metadata) {
        if (!isSightPlaceable(entry.source)) continue;
        group.instancedMesh.getMatrixAt(index, matrix);
        matrix.premultiply(group.instancedMesh.matrixWorld);
        bounds.copy(group.sightBounds).applyMatrix4(matrix);
        result.push({
          min: { x: bounds.min.x, y: bounds.min.y, z: bounds.min.z },
          max: { x: bounds.max.x, y: bounds.max.y, z: bounds.max.z },
        });
      }
    }
    return result;
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

  // ── Key Derivation & Scale ───────────────────────────────────────

  /** Derive a stable variant key from a placeable sprite or data. */
  _deriveKey(placeable) {
    // Prefer modelKey for grouping (so instances sharing a 3D model share one InstancedMesh)
    if (placeable?.modelKey && typeof placeable.modelKey === 'string') {
      return placeable.modelKey;
    }
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

      if (profile === 'model') {
        // TODO: tune per-species scale once assets are calibrated
        // OBJ models are auto-scaled by ModelPostProcessing; use identity to avoid double-scaling
        return { x: 1, y: 1, z: 1 };
      }

      return { x: tileWorld, y: tileWorld, z: tileWorld };
    } catch (_) {
      return { x: 1, y: 1, z: 1 };
    }
  }

  // ── Public API: Add / Remove ─────────────────────────────────────

  /** Public: add a placeable instance; returns handle with group key + index (or null). */
  addPlaceable(placeable, { strict = false, fitManualTree = false } = {}) {
    const pending = this._addPlaceable(placeable, { strict, fitManualTree });
    this._pendingPlacements.add(pending);
    pending.then(
      () => this._pendingPlacements.delete(pending),
      () => this._pendingPlacements.delete(pending)
    );
    return pending;
  }

  async whenSettled() {
    while (this._pendingPlacements.size) await Promise.all([...this._pendingPlacements]);
  }

  async snapshotPlacements() {
    await this.whenSettled();
    return readPlaceablePlacements(this);
  }

  async restorePlacements(placements) {
    this.clearAll();
    const handles = await Promise.all(
      placements.map((placement) => this.addPlaceable({ ...placement }))
    );
    if (handles.some((handle) => !handle))
      throw new Error(
        'A saved terrain placeable could not be restored; the saved board was not reset'
      );
  }

  async _addPlaceable(placeable, { strict = false, fitManualTree = false } = {}) {
    const unavailable = (message) => {
      if (strict) throw new Error(message);
      return null;
    };
    const gm = this.gameManager;
    if (!gm || !gm.is3DModeActive?.()) {
      return unavailable('The terrain placement renderer is unavailable');
    }
    // Capture epoch so we can detect if a clear happened while awaiting dynamic imports.
    const epochAtStart = this._clearEpoch;
    const biomeKey = placeable?.biomeKey ?? gm.terrainEngine?.biomeKey;
    const biomeSeed = placeable?.biomeSeed ?? gm.terrainEngine?.biomeSeed;
    const appearance =
      placeable?.modelKey === 'source-dungeon-torch'
        ? null
        : resolvePlaceableAppearance(biomeKey, {
            modelKey: placeable?.modelKey,
            variantKey: placeable?.variantKey,
            gridX: placeable?.gridX,
            gridY: placeable?.gridY,
            biomeSeed,
          });
    const three = await this._ensureThree();
    if (!three) {
      return unavailable('The terrain placement renderer could not be loaded');
    }
    if (!gm.threeSceneManager?.scene) {
      return unavailable('The terrain placement scene is unavailable');
    }
    // Abort if a clearAll occurred during the await window.
    if (epochAtStart !== this._clearEpoch) {
      return unavailable('Terrain placement was interrupted by a map change');
    }
    const rawVariant = placeable?.variantKey;
    const modelKey = this._deriveKey(placeable);
    const key = appearance ? `${modelKey}|${appearance.key}` : modelKey;
    // Preserve original texture path separately for material creation
    try {
      if (placeable && rawVariant) placeable.__rawVariantKey = rawVariant;
    } catch (_) {
      /* ignore */
    }
    // Debug aggregation of key mapping
    try {
      if (this._publishMetrics && typeof window !== 'undefined') {
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
    logMeshPoolDebug('[PlaceableMeshPool] addPlaceable start', { key, epochAtStart });
    const group = await this._getOrCreateGroup(
      key,
      three,
      placeable?.type || 'generic',
      placeable,
      appearance
    );
    if (!group)
      return unavailable(
        `Terrain asset "${placeable?.modelKey || modelKey}" could not be prepared`
      );
    // Re-check epoch after potential async _createGroup work (defensive double-guard)
    if (epochAtStart !== this._clearEpoch) {
      return unavailable('Terrain placement was interrupted by a map change');
    }
    const profile =
      group.profile ||
      placeable?.renderProfile ||
      (placeable?.type === 'plant' ? 'billboard' : 'ground');
    group.profile = profile;
    if (
      placeable.persistedScale &&
      !['x', 'y', 'z'].every(
        (axis) =>
          Number.isFinite(placeable.persistedScale[axis]) && placeable.persistedScale[axis] > 0
      )
    ) {
      throw new Error('Saved terrain placeable scale is invalid');
    }
    const scale = placeable.persistedScale
      ? { ...placeable.persistedScale }
      : this._resolveWorldScale(placeable, profile);
    if (
      profile === 'model' &&
      !placeable.persistedScale &&
      /^mushroom-(glow|giant-cap)$/.test(modelKey)
    ) {
      const tileSize = gm.spatial?.tileWorldSize;
      if (!Number.isFinite(tileSize) || tileSize <= 0)
        throw new Error('Fungal models require a valid tile size');
      scale.x = scale.y = scale.z = tileSize;
    }
    let placementAngle = null;
    let offsetX = 0;
    let offsetZ = 0;
    let hasFormationOffset = false;
    if (profile === 'model' && isCaveFormationModel(modelKey)) {
      if (placeable.angleRadians !== undefined && !Number.isFinite(placeable.angleRadians))
        throw new Error('Saved cave formation orientation is invalid');
      const hasX = placeable.gridOffsetX !== undefined;
      const hasZ = placeable.gridOffsetY !== undefined;
      if (
        hasX !== hasZ ||
        (hasX &&
          (![placeable.gridOffsetX, placeable.gridOffsetY].every(Number.isFinite) ||
            Math.abs(placeable.gridOffsetX) > 0.5 ||
            Math.abs(placeable.gridOffsetY) > 0.5))
      )
        throw new Error('Saved cave formation offsets are invalid');
      const identity = `${modelKey}:${biomeKey}:${biomeSeed}:${placeable.gridX}:${placeable.gridY}`;
      placementAngle =
        placeable.angleRadians ?? ((hash32(`${identity}:rotation`) % 4) * Math.PI) / 2;
      if (hasX) {
        offsetX = placeable.gridOffsetX;
        offsetZ = placeable.gridOffsetY;
        hasFormationOffset = true;
      }
      if (!placeable.persistedScale) {
        const tileSize = gm.spatial?.tileWorldSize;
        if (!Number.isFinite(tileSize) || tileSize <= 0)
          throw new Error('Cave formations require a valid tile size');
        const variation = hash32(`${identity}:height`) / 0x100000000;
        const width = 0.34 + 0.3 * Math.sqrt(variation);
        scale.x = scale.z = tileSize * width;
        scale.y =
          tileSize *
          (biomeKey === 'crystalSpires' ? 0.65 + variation * 1.7 : 0.35 + variation * 1.5);
        if (!hasFormationOffset) {
          const margin = Math.min(0.18, Math.max(0, 0.48 - width * 0.74));
          offsetX = (2 * (hash32(`${identity}:offsetX`) / 0x100000000) - 1) * margin;
          offsetZ = (2 * (hash32(`${identity}:offsetZ`) / 0x100000000) - 1) * margin;
          hasFormationOffset = true;
        }
      }
    } else if (profile === 'model' && getPurePolyAsset(modelKey)?.kind === 'tree') {
      if (placeable.angleRadians !== undefined && !Number.isFinite(placeable.angleRadians))
        throw new Error('Saved tree orientation is invalid');
      if (placeable.generatedBiome || placeable.angleRadians !== undefined) {
        const identity = `${modelKey}:${biomeKey}:${biomeSeed}:${placeable.gridX}:${placeable.gridY}`;
        placementAngle =
          placeable.angleRadians ?? (hash32(`${identity}:rotation`) / 0x100000000) * Math.PI * 2;
      }
    }
    if (
      profile === 'model' &&
      !placeable.persistedScale &&
      (placeable.generatedBiome === true || fitManualTree) &&
      (/^tree-/.test(placeable.placeableId || '') ||
        ['cactus', 'rock', 'prop', 'ore', 'light', 'tree'].includes(
          getPurePolyAsset(placeable.placeableId)?.kind
        ))
    ) {
      let fit;
      try {
        const support =
          getPurePolyAsset(modelKey)?.kind === 'tree' && placementAngle !== null
            ? group.supportBounds
                .clone()
                .applyMatrix4(new three.Matrix4().makeRotationY(placementAngle))
            : group.supportBounds;
        fit = fitTreeScale(gm, placeable, support);
      } catch (error) {
        logger.error(
          '[PlaceableMeshPool] tree support failed',
          { modelKey, gridX: placeable.gridX, gridY: placeable.gridY, error: error.message },
          LOG_CATEGORY.RENDERING
        );
        if (strict)
          throw new Error(`Terrain asset "${modelKey}" could not be grounded`, { cause: error });
        return null;
      }
      if (fit === null) {
        if (fitManualTree && !placeable.generatedBiome) {
          const error = Object.assign(
            new Error(
              ['cactus', 'rock', 'prop', 'ore', 'light'].includes(
                getPurePolyAsset(placeable.placeableId)?.kind
              )
                ? 'This scenery needs more supported, level ground'
                : 'The tree trunk needs more supported, level ground'
            ),
            {
              code: 'tree-support-unavailable',
            }
          );
          if (strict) throw error;
          logger.warn(error.message, { modelKey, gridX: placeable.gridX, gridY: placeable.gridY });
          return null;
        }
        logMeshPoolDebug('[PlaceableMeshPool] unsupported generated tree site skipped', {
          modelKey,
          gridX: placeable.gridX,
          gridY: placeable.gridY,
        });
        return null;
      }
      scale.x *= fit;
      scale.y *= fit;
      scale.z *= fit;
    }
    placeable.__worldScale = scale;
    const heightOffset = Number.isFinite(placeable?.heightOffset)
      ? placeable.heightOffset
      : profile === 'ground'
        ? 0.005
        : 0;
    const supportOffset =
      profile === 'model' && group.supportBounds ? group.supportBounds.min.y * (scale.y ?? 1) : 0;
    const index = this._allocateIndex(group);
    if (index < 0) return unavailable(`Terrain asset "${modelKey}" exceeds its instance capacity`);
    const { instancedMesh } = group;
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
    let position = null;
    // Position from grid (approx center)
    try {
      const gx = placeable.gridX ?? 0;
      const gy = placeable.gridY ?? 0;
      const world = gm.spatial.gridToWorld(gx + 0.5 + offsetX, gy + 0.5 + offsetZ, 0);
      if (strict && (!Number.isFinite(world.x) || !Number.isFinite(world.z)))
        throw new Error('The terrain position is not finite');
      const dummy = new three.Object3D();
      // Sample terrain height (grid center). Falls back to 0 if unavailable.
      let h = 0;
      try {
        if (typeof gm.getTerrainHeight === 'function') {
          const height = gm.getTerrainHeight(gx, gy);
          if (strict && !Number.isFinite(height))
            throw new Error('The terrain height is not finite');
          h = height || 0; // height in elevation levels
        }
      } catch (error) {
        if (strict) throw error;
        h = 0;
      }
      const worldY = gm.spatial?.elevationUnit ? h * gm.spatial.elevationUnit : 0;
      position = { x: world.x, y: worldY + heightOffset - supportOffset, z: world.z };
      dummy.position.set(position.x, position.y, position.z);
      if (placementAngle !== null) dummy.rotation.y = placementAngle;
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
      invalidatePlaceableBounds(group);
    } catch (error) {
      if (strict)
        throw new Error(`Terrain asset "${modelKey}" could not be positioned`, { cause: error });
    }
    placeable.__meshPoolHandle = { key, index };
    const source = {
      type: placeable.type || 'generic',
      gridX: placeable.gridX ?? 0,
      gridY: placeable.gridY ?? 0,
      heightOffset,
      renderProfile: profile,
    };
    for (const property of [
      'modelKey',
      'variantKey',
      'placeableId',
      'generatedBiome',
      'metricsOnly',
    ]) {
      if (placeable[property] !== undefined) source[property] = placeable[property];
    }
    if (biomeKey !== undefined) source.biomeKey = biomeKey;
    if (biomeSeed !== undefined) source.biomeSeed = biomeSeed;
    if (placementAngle !== null) source.angleRadians = placementAngle;
    if (hasFormationOffset) {
      source.gridOffsetX = offsetX;
      source.gridOffsetY = offsetZ;
    }
    const metaGroup = this._metadata.get(key) || new Map();
    metaGroup.set(index, {
      gx: source.gridX,
      gy: source.gridY,
      scale,
      profile,
      heightOffset,
      supportOffset,
      source,
      position,
    });
    this._metadata.set(key, metaGroup);
    this._revision += 1;
    // Update metrics to reflect new live instance
    this._updateMetrics();
    gm.sceneAutosave?.changed('terrain placement');
    const live = group.count - group.freeIndices.length;
    logMeshPoolDebug('[PlaceableMeshPool] addPlaceable done', { key, index, live });
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
    const metaGroup = this._metadata.get(handle.key);
    if (!metaGroup?.has(handle.index)) {
      delete placeable.__meshPoolHandle;
      return;
    }
    group.freeIndices.push(handle.index);
    metaGroup.delete(handle.index);
    this._revision += 1;
    const hidden = new this._three.Object3D();
    hidden.scale.set(0, 0, 0);
    hidden.updateMatrix();
    group.instancedMesh.setMatrixAt(handle.index, hidden.matrix);
    group.instancedMesh.instanceMatrix.needsUpdate = true;
    invalidatePlaceableBounds(group);
    delete placeable.__meshPoolHandle;
    this._updateMetrics();
    this.gameManager.sceneAutosave?.changed('terrain placement removed');
  }

  removePlantsAt(gridX, gridY) {
    if (!Number.isInteger(gridX) || !Number.isInteger(gridY) || gridX < 0 || gridY < 0) {
      throw new RangeError('Terrain plant removal requires a valid grid position');
    }
    let removed = 0;
    for (const [key, metadata] of this._metadata) {
      for (const [index, entry] of [...metadata]) {
        if (entry.gx === gridX && entry.gy === gridY && entry.source?.type === 'plant') {
          this.removePlaceable({ __meshPoolHandle: { key, index } });
          removed++;
        }
      }
    }
    return removed;
  }

  // ── Group Creation & Capacity ────────────────────────────────────

  async _getOrCreateGroup(key, three, type, placeable, appearance = null) {
    const existing = this._groups.get(key);
    if (existing?.instancedMesh) return existing;
    const pending = this._pendingGroups.get(key);
    if (pending) return pending;

    const epoch = this._clearEpoch;
    const creation = this._createGroup(key, three, type, placeable, appearance)
      .then((group) => {
        if (!group) return null;
        if (epoch !== this._clearEpoch) {
          disposePlaceableDepthPrepass(group);
          group.instancedMesh.geometry.dispose();
          disposePlaceableMaterials(group.instancedMesh.material);
          group.instancedMesh.dispose?.();
          return null;
        }
        this.gameManager.threeSceneManager?.scene?.add?.(group.instancedMesh);
        this._groups.set(key, group);
        this._metadata.set(key, new Map());
        this._updateMetrics();
        try {
          const scene = this.gameManager.threeSceneManager;
          const profile = scene?.getSceneLightingProfile?.() || scene?.getTimeOfDayProfile?.();
          if (profile?.placeables) this.applyLightingProfile(profile.placeables);
        } catch (error) {
          logger.warn(
            'Placeable group lighting initialization failed',
            { key, error: error.message },
            LOG_CATEGORY.RENDERING
          );
        }
        return group;
      })
      .finally(() => {
        if (this._pendingGroups.get(key) === creation) this._pendingGroups.delete(key);
      });
    this._pendingGroups.set(key, creation);
    return creation;
  }

  /** Create a new instanced mesh group for a variant key. */
  async _createGroup(key, three, type = 'generic', placeable = null, appearance = null) {
    try {
      const capacity = this._initialCapacity; // initial; grow strategy implemented
      const profile = placeable?.renderProfile || (type === 'plant' ? 'billboard' : 'ground');

      // ── Model asset path (OBJ/FBX) ─────────────────────────────────
      const modelKey = placeable?.modelKey;
      if (modelKey && this.gameManager?.modelAssetCache?.getModel) {
        let modelGeom = null;
        let modelMat = null;
        try {
          const modelRoot = await this.gameManager.modelAssetCache.getModel(modelKey);
          if (!modelRoot) {
            logger.warn(
              '[PlaceableMeshPool] requested model is unavailable',
              { key, modelKey },
              LOG_CATEGORY.RENDERING
            );
            return null;
          }
          const prepared = createPlaceableModelGeometry(three, modelRoot);
          modelGeom = prepared.geometry;
          if (modelGeom && prepared.material) {
            modelMat = preparePlaceableMaterials(three, prepared.material, appearance);
            if (modelKey === 'mushroom-glow') {
              for (const material of Array.isArray(modelMat) ? modelMat : [modelMat]) {
                if (!material.emissive)
                  throw new Error('Glowing mushrooms require an emissive model material');
                material.emissive.setHex(0x9b69db);
                material.emissiveMap = material.map;
                material.emissiveIntensity = 0.3;
                material.needsUpdate = true;
              }
            }
            if (
              /^source-cave-(stalagmite|column)$/.test(modelKey) &&
              (placeable?.biomeKey ?? this.gameManager.terrainEngine?.biomeKey) === 'cavern'
            ) {
              const materials = Array.isArray(modelMat) ? modelMat : [modelMat];
              for (const material of materials) {
                if (!material?.color) throw new Error('A cave formation has no stone color');
                if (!material.map) material.color.multiplyScalar(4);
              }
            }
            if (
              ['formation', 'rock', 'pebble'].includes(getPurePolyAsset(modelKey)?.kind) &&
              (placeable?.biomeKey ?? this.gameManager.terrainEngine?.biomeKey) === 'cavern'
            ) {
              const gray = new three.Color().setRGB(
                187 / 255,
                187 / 255,
                187 / 255,
                three.SRGBColorSpace
              );
              const dark = new three.Color().setRGB(
                115 / 255,
                115 / 255,
                115 / 255,
                three.SRGBColorSpace
              );
              for (const material of Array.isArray(modelMat) ? modelMat : [modelMat]) {
                if (!material?.color) throw new Error('A cave formation has no stone color');
                material.color.multiplyScalar(dark.r / gray.r);
              }
            }
            if (modelKey === 'source-dungeon-torch') {
              const materials = Array.isArray(modelMat) ? modelMat : [modelMat];
              const flame = materials.find((material) => material?.name === 'Fire');
              if (!flame?.emissive) throw new Error('The dungeon torch has no flame material');
              flame.emissive.setHex(0xff6a16);
              flame.emissiveIntensity = 0.85;
            }
            const instanced = new three.InstancedMesh(modelGeom, modelMat, capacity);
            instanced.name = `Placeables:${key}`;
            try {
              instanced.castShadow = !appearance;
            } catch (_) {
              /* ignore */
            }
            try {
              instanced.count = 0;
            } catch (_) {
              /* ignore */
            }
            const tintCategory = placeable?.type || type || 'generic';
            const baseColorRef = modelMat?.color
              ? { r: modelMat.color.r, g: modelMat.color.g, b: modelMat.color.b }
              : null;
            let depthPrepass = null;
            if (appearance?.biomeKey === 'crystalSpires' && isCaveFormationModel(modelKey)) {
              // Resolve the nearest surface because transparent instances cannot be sorted.
              for (const material of Array.isArray(modelMat) ? modelMat : [modelMat]) {
                if (material.side === three.DoubleSide && !material.forceSinglePass) {
                  // Preserve the combined opacity of the former front/back surface passes.
                  material.opacity = 1 - (1 - material.opacity) ** 2;
                }
              }
              const depthMaterial = new three.MeshBasicMaterial({
                transparent: true,
                colorWrite: false,
                depthWrite: true,
                side: three.DoubleSide,
              });
              depthMaterial.name = 'CrystalSpiresDepth';
              depthMaterial.forceSinglePass = true;
              depthPrepass = new three.InstancedMesh(modelGeom, depthMaterial, capacity);
              depthPrepass.name = 'CrystalSpiresDepth';
              depthPrepass.instanceMatrix = instanced.instanceMatrix;
              depthPrepass.count = 0;
              // Keep the grid visible beneath the translucent nearest surface.
              depthPrepass.renderOrder = -1;
              depthPrepass.raycast = () => {};
              instanced.add(depthPrepass);
            }
            return {
              key,
              type,
              profile: 'model', // upright 3D model; no billboard rotation needed
              appearance,
              tintCategory,
              instancedMesh: instanced,
              depthPrepass,
              capacity,
              freeIndices: [],
              count: 0,
              baseColor: baseColorRef,
              supportBounds: prepared.supportBounds,
              sightBounds: prepared.sightBounds,
            };
          }
          throw new Error('Prepared static model has no geometry or material');
        } catch (modelErr) {
          modelGeom?.dispose();
          if (modelMat) disposePlaceableMaterials(modelMat);
          logger.warn(
            '[PlaceableMeshPool] model preparation failed',
            { key, modelKey, error: modelErr.message },
            LOG_CATEGORY.RENDERING
          );
          if (getPurePolyAsset(modelKey))
            throw new Error(`Protected terrain asset "${modelKey}" failed: ${modelErr.message}`, {
              cause: modelErr,
            });
          return null;
        }
      }

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
          logMeshPoolDebug('[PlaceableMeshPool] texture load error', {
            key,
            texturePath,
            err: e?.message,
          });
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
          logMeshPoolDebug('[PlaceableMeshPool] created textured material', { key, texturePath });
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

      if (appearance) mat = preparePlaceableMaterials(three, mat, appearance);
      const instanced = new three.InstancedMesh(geo, mat, capacity);
      instanced.name = `Placeables:${key}`;
      // Allow instanced meshes to cast shadows (terrain receives). Keep receiveShadow off to avoid dark cards.
      try {
        instanced.castShadow = !appearance;
      } catch (_) {
        /* ignore */
      }
      // Start with zero active draw instances; we raise .count as we allocate
      try {
        instanced.count = 0;
      } catch (_) {
        /* ignore */
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
                  const {
                    gx,
                    gy,
                    scale,
                    heightOffset,
                    supportOffset = 0,
                    position,
                  } = coords || {
                    gx: 0,
                    gy: 0,
                    scale: { x: 1, y: 1, z: 1 },
                    heightOffset: 0,
                    position: null,
                  };
                  let instancePosition = position;
                  if (!instancePosition) {
                    let h = 0;
                    try {
                      h = gm.getTerrainHeight?.(gx, gy) || 0;
                    } catch (_) {
                      h = 0;
                    }
                    const world = gm.spatial.gridToWorld(
                      gx + 0.5 + (coords.source?.gridOffsetX ?? 0),
                      gy + 0.5 + (coords.source?.gridOffsetY ?? 0),
                      0
                    );
                    const worldY = gm.spatial?.elevationUnit ? h * gm.spatial.elevationUnit : 0;
                    instancePosition = {
                      x: world.x,
                      y: worldY + (heightOffset || 0) - supportOffset,
                      z: world.z,
                    };
                    coords.position = instancePosition;
                  }
                  dummy.position.set(instancePosition.x, instancePosition.y, instancePosition.z);
                  // Full spherical billboard: always face the camera at any pitch & yaw
                  // so the tree quad never collapses into a line from overhead or oblique angles.
                  // NOTE: This introduces pitch tilt (the sprite leans toward the camera) which
                  // gives a pseudo-3D look. If we later want an upright-only variant that never
                  // edge-on collapses, we can implement multi-quad (cross) impostors instead.
                  if (dummy.lookAt) {
                    dummy.lookAt(worldCamPos.x, worldCamPos.y, worldCamPos.z);
                  } else {
                    // Fallback: manually compute facing yaw (rare path if lookAt unavailable)
                    const dx = worldCamPos.x - instancePosition.x;
                    const dz = worldCamPos.z - instancePosition.z;
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
                  inst.boundingSphere = null;
                  inst.boundingBox = null;
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
        appearance,
        tintCategory,
        instancedMesh: instanced,
        capacity,
        freeIndices: [],
        count: 0,
        baseColor: baseColorRef,
      };
    } catch (err) {
      logger.error(
        'Placeable group creation failed',
        { key, type, error: err.message },
        LOG_CATEGORY.RENDERING
      );
      if (getPurePolyAsset(placeable?.modelKey)) throw err;
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
      newInst.castShadow = old.castShadow;
      newInst.receiveShadow = old.receiveShadow;
      newInst.visible = old.visible;
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
        newInst.count = group.count;
        newInst.instanceMatrix.needsUpdate = true;
      } catch (_) {
        /* ignore copy failures */
      }
      if (group.depthPrepass) {
        group.depthPrepass.instanceMatrix = newInst.instanceMatrix;
        group.depthPrepass.count = newInst.count;
        newInst.add(group.depthPrepass);
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
      invalidatePlaceableBounds(group);
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

  // ── Metrics & Lighting ────────────────────────────────────────────

  _updateMetrics() {
    this.gameManager?.sceneAutosave?.changed('terrain placements');
    let totalInstances = 0;
    for (const g of this._groups.values()) {
      totalInstances += g.count - g.freeIndices.length;
      if (g.depthPrepass) g.depthPrepass.count = g.instancedMesh.count;
    }
    this._metrics.groups = this._groups.size;
    this._metrics.instances = totalInstances;
    if (this._publishMetrics && typeof window !== 'undefined') {
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

  // ── Height Resync ─────────────────────────────────────────────────

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
          const {
            gx,
            gy,
            scale,
            heightOffset,
            supportOffset = 0,
          } = coords || {
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
          const world = gm.spatial.gridToWorld(
            gx + 0.5 + (coords.source?.gridOffsetX ?? 0),
            gy + 0.5 + (coords.source?.gridOffsetY ?? 0),
            0
          );
          const worldY = gm.spatial?.elevationUnit ? h * gm.spatial.elevationUnit : 0;
          const position = {
            x: world.x,
            y: worldY + (heightOffset || 0) - supportOffset,
            z: world.z,
          };
          coords.position = position;
          dummy.position.set(position.x, position.y, position.z);
          dummy.rotation.set(0, coords.source?.angleRadians ?? 0, 0);
          if (group.profile === 'billboard' && gm.threeSceneManager?.camera) {
            const cameraPosition = gm.threeSceneManager.camera.position;
            dummy.lookAt?.(cameraPosition.x, cameraPosition.y, cameraPosition.z);
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
          invalidatePlaceableBounds(group);
        } catch (_) {
          /* ignore */
        }
      }
      this._revision += 1;
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

  // ── Delegated methods (extracted to PlaceablePoolLifecycle.js) ──────────────

  getStats() {
    return { ...this._metrics };
  }

  setMaterialStrategy(fn) {
    if (typeof fn === 'function') this._materialStrategy = fn;
  }

  async setPreview(gx, gy) {
    return _setPreview(this, gx, gy);
  }

  hidePreview() {
    return _hidePreview(this);
  }

  dispose() {
    return _dispose(this);
  }

  clearAll() {
    return _clearAll(this);
  }

  async fullReset() {
    return _fullReset(this);
  }

  validateHidden() {
    return _validateHidden(this);
  }

  purgeAll() {
    return _purgeAll(this);
  }

  debugSnapshot() {
    return _debugSnapshot(this);
  }
}
