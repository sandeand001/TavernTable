/**
 * MeshFactory.js — Mesh creation, model loading, FBX loading, tinting, and positioning.
 *
 * Extracted from Token3DAdapter.  Every function uses `this` and is designed
 * to be installed on the Token3DAdapter prototype via installMeshFactoryMethods().
 */

import {
  DEFAULT_BILLBOARD_SIZE,
  TOKEN_3D_MODELS,
  SELECTION_COLLIDER_HEIGHT,
  SELECTION_COLLIDER_RADIUS_RATIO,
} from './MannequinConfig.js';

// ── Mesh Creation ───────────────────────────────────────────────

/* ------------------------------------------------------------------ */
/*  Mesh creation                                                     */
/* ------------------------------------------------------------------ */

function _ensureTokenMesh(tokenEntry, scene) {
  if (!tokenEntry || tokenEntry.__threeMesh) return;
  const gm = this.gameManager;

  if (gm && gm.__threeTestDouble) {
    try {
      const three = gm.__threeTestDouble;
      const geo = new three.PlaneGeometry(DEFAULT_BILLBOARD_SIZE, DEFAULT_BILLBOARD_SIZE);
      const mat = this._createMaterialForToken(three, tokenEntry);
      const mesh = new three.Mesh(geo, mat);
      this._applyCommonMetadata(mesh, tokenEntry, { billboard: true, verticalOffset: 0 });
      this._positionMesh(mesh, tokenEntry);
      scene.add(mesh);
      tokenEntry.__threeMesh = mesh;
      return Promise.resolve(mesh);
    } catch (_) {
      return Promise.resolve(null);
    }
  }

  const typeKey = (tokenEntry.type || tokenEntry.creature?.type || '').toLowerCase();
  const config = TOKEN_3D_MODELS[typeKey] || null;

  if (config) {
    const promise = this._create3DToken(tokenEntry, scene, config);
    this._attachPromise(tokenEntry, promise);
    return promise;
  }

  const promise = this._createBillboardToken(tokenEntry, scene);
  this._attachPromise(tokenEntry, promise);
  return promise;
}

function _attachPromise(tokenEntry, promise) {
  if (!promise || typeof promise.then !== 'function') return;
  try {
    Object.defineProperty(tokenEntry, '__threeMeshPromise', {
      value: promise,
      enumerable: false,
    });
  } catch (_) {
    tokenEntry.__threeMeshPromise = promise;
  }
}

async function _createBillboardToken(tokenEntry, scene) {
  const three = await this._getThree();
  if (!three) return null;
  try {
    const geo = new three.PlaneGeometry(DEFAULT_BILLBOARD_SIZE, DEFAULT_BILLBOARD_SIZE);
    const mat = this._createMaterialForToken(three, tokenEntry);
    const mesh = new three.Mesh(geo, mat);
    this._applyCommonMetadata(mesh, tokenEntry, { billboard: true, verticalOffset: 0 });
    this._positionMesh(mesh, tokenEntry);
    scene.add(mesh);
    tokenEntry.__threeMesh = mesh;
    this.updateTokenOrientation(tokenEntry);
    this._refreshVisualState(tokenEntry);
    return mesh;
  } catch (error) {
    return null;
  }
}

async function _create3DToken(tokenEntry, scene, config) {
  try {
    const typeKey = (tokenEntry.type || tokenEntry.creature?.type || '').toLowerCase();
    const templateBundle = await this._loadModelTemplate(typeKey, config);
    if (!templateBundle) return null;
    const clone = await this._cloneTemplate(templateBundle.template);
    if (!clone) return null;
    const three = await this._getThree();
    if (!three) return null;

    const container = new three.Group();
    const baseName = tokenEntry.id || tokenEntry.creature?.type || typeKey || 'unk';
    container.name = `Token3D:${baseName}`;
    container.add(clone);

    this._attachSelectionCollider(container, three, config);

    if (config.baseRotation) {
      container.rotation.set(
        config.baseRotation.x || 0,
        config.baseRotation.y || 0,
        config.baseRotation.z || 0
      );
    }

    container.userData = container.userData || {};
    container.userData.__ttBaseRotation = {
      x: container.rotation.x,
      y: container.rotation.y,
      z: container.rotation.z,
    };

    container.userData.__ttBaseRotation = {
      x: container.rotation.x,
      y: container.rotation.y,
      z: container.rotation.z,
    };

    clone.traverse?.((child) => {
      if (child.isMesh || child.isSkinnedMesh) {
        const cast = config.shadows?.cast ?? true;
        const receive = config.shadows?.receive ?? true;
        child.castShadow = cast;
        child.receiveShadow = receive;
      }
    });

    this._applyCommonMetadata(container, tokenEntry, {
      billboard: false,
      is3D: true,
      verticalOffset: Number.isFinite(config.verticalOffset) ? config.verticalOffset : 0,
      baseYaw: config.baseRotation?.y || 0,
    });

    this._registerRootBones(tokenEntry, container);

    container.userData.__ttTintMaterials = this._collectTintTargets(container);
    this._positionMesh(container, tokenEntry);
    scene.add(container);
    tokenEntry.__threeMesh = container;
    this.updateTokenOrientation(tokenEntry);
    this._refreshVisualState(tokenEntry);

    await this._setupAnimationSet(tokenEntry, container, config, templateBundle);

    return container;
  } catch (_) {
    return null;
  }
}

// ── Skinned-Mesh Helper ───────────────────────────────────────────

/* ------------------------------------------------------------------ */
/*  Skinned-mesh helper                                               */
/* ------------------------------------------------------------------ */

function _findFirstSkinnedMesh(root) {
  if (!root) return null;
  if (root.isSkinnedMesh) return root;
  if (Array.isArray(root.children)) {
    for (const child of root.children) {
      const found = this._findFirstSkinnedMesh(child);
      if (found) return found;
    }
  }
  return null;
}

// ── Loaders ───────────────────────────────────────────────────────

/* ------------------------------------------------------------------ */
/*  Loaders                                                           */
/* ------------------------------------------------------------------ */

function _collectTintTargets(mesh) {
  const materials = [];
  if (!mesh) return materials;
  const push = (mat) => {
    if (!mat) return;
    if (Array.isArray(mat)) {
      mat.forEach(push);
    } else {
      materials.push(mat);
    }
  };
  if (typeof mesh.traverse === 'function') {
    mesh.traverse((child) => {
      if (child.material) push(child.material);
    });
  } else if (mesh.material) {
    push(mesh.material);
  }
  return materials;
}

async function _getThree() {
  if (this._threePromise) return this._threePromise;
  if (this.gameManager?.threeSceneManager?.three) {
    this._threePromise = Promise.resolve(this.gameManager.threeSceneManager.three);
    return this._threePromise;
  }
  this._threePromise = import('three').then((mod) => mod.default || mod).catch(() => null);
  return this._threePromise;
}

async function _getFBXLoaderCtor() {
  if (!this._fbxCtorPromise) {
    this._fbxCtorPromise = (async () => {
      try {
        const mod = await import('three/examples/jsm/loaders/FBXLoader.js');
        return mod.FBXLoader || mod.default || null;
      } catch (_) {
        if (typeof window !== 'undefined' && window.FBXLoader) return window.FBXLoader;
        if (typeof globalThis !== 'undefined' && globalThis.FBXLoader) {
          return globalThis.FBXLoader;
        }
        return null;
      }
    })();
  }
  return this._fbxCtorPromise;
}

async function _getSkeletonUtils() {
  if (!this._skeletonUtilsPromise) {
    this._skeletonUtilsPromise = (async () => {
      try {
        const mod = await import('three/examples/jsm/utils/SkeletonUtils.js');
        if (mod.SkeletonUtils) return mod.SkeletonUtils;
        if (typeof mod.clone === 'function') return mod;
        if (mod.default && typeof mod.default.clone === 'function') return mod.default;
      } catch (_) {
        /* ignore */
      }
      return null;
    })();
  }
  return this._skeletonUtilsPromise;
}

// ── Templates & Cloning ───────────────────────────────────────────

/* ------------------------------------------------------------------ */
/*  Templates & cloning                                               */
/* ------------------------------------------------------------------ */

function _buildPathVariants(path) {
  const base = String(path || '').replace(/\\/g, '/');
  const variants = [];
  const push = (p) => {
    if (!p || variants.includes(p)) return;
    variants.push(p);
  };
  push(base);
  if (!base.startsWith('./')) push(`./${base}`);
  if (!base.startsWith('/')) push(`/${base}`);
  if (base.includes(' ')) push(base.replace(/ /g, '%20'));
  variants.slice().forEach((v) => {
    if (v.includes(' ')) push(v.replace(/ /g, '%20'));
  });
  return variants;
}

async function _loadModelTemplate(typeKey, config) {
  const key = typeKey?.toLowerCase?.();
  if (!key) return null;
  if (!this._modelCache.has(key)) {
    const promise = (async () => {
      const three = await this._getThree();
      const FBXLoaderCtor = await this._getFBXLoaderCtor();
      if (!three || !FBXLoaderCtor) return null;
      const variants = this._buildPathVariants(config.path);
      let loaded = null;
      for (const url of variants) {
        try {
          const loader = new FBXLoaderCtor();
          loaded = await this._loadFBX(loader, url);
          if (loaded) break;
        } catch (_) {
          /* try next */
        }
      }
      if (!loaded) return null;
      const templateRoot = new three.Group();
      templateRoot.name = `TokenTemplate:${key}`;
      templateRoot.add(loaded);

      const centerBox = new three.Box3().setFromObject(templateRoot);
      const center = new three.Vector3();
      centerBox.getCenter(center);
      loaded.position.sub(center);

      const groundedBox = new three.Box3().setFromObject(templateRoot);
      const minY = groundedBox.min.y;
      loaded.position.y -= minY;

      const sizeBox = new three.Box3().setFromObject(templateRoot);
      const size = new three.Vector3();
      sizeBox.getSize(size);
      const tileSize = this.gameManager?.spatial?.tileWorldSize || 1;
      const span = (config.tileSpan ?? 1) * tileSize;
      const margin = Number.isFinite(config.margin) ? config.margin : 0.92;
      const desired = span * margin;
      const maxXZ = Math.max(size.x, size.z, 0.0001);
      let scaleFactor = config.scale;
      if (!Number.isFinite(scaleFactor) || scaleFactor <= 0) {
        scaleFactor = desired / maxXZ;
      }
      templateRoot.scale.setScalar(scaleFactor);
      templateRoot.updateMatrixWorld(true);

      return {
        template: templateRoot,
        animations: Array.isArray(loaded.animations) ? loaded.animations : [],
      };
    })();
    this._modelCache.set(key, promise);
  }
  return this._modelCache.get(key);
}

function _loadFBX(loader, url) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (obj) => {
      if (settled) return;
      settled = true;
      resolve(obj || null);
    };
    try {
      loader.load(
        url,
        (object) => finish(object),
        undefined,
        () => finish(null)
      );
    } catch (_) {
      finish(null);
    }
  });
}

async function _cloneTemplate(template) {
  if (!template) return null;
  try {
    const SkeletonUtils = await this._getSkeletonUtils();
    if (SkeletonUtils?.clone) {
      return SkeletonUtils.clone(template);
    }
  } catch (_) {
    /* fall through */
  }
  try {
    return template.clone(true);
  } catch (_) {
    return null;
  }
}

// ── Metadata, Tinting & Positioning ──────────────────────────────

/* ------------------------------------------------------------------ */
/*  Metadata, tinting & positioning                                   */
/* ------------------------------------------------------------------ */

function _applyCommonMetadata(mesh, tokenEntry, options = {}) {
  const type = tokenEntry?.type || tokenEntry?.creature?.type || 'unk';
  mesh.name = mesh.name || `Token3D:${tokenEntry?.id || type}`;
  mesh.userData = mesh.userData || {};
  const billboard = options.billboard !== false;
  mesh.userData.__ttBillboard = billboard;
  mesh.userData.__tt3DToken = !!options.is3D;
  mesh.userData.__ttVerticalBase = Number.isFinite(options.verticalOffset)
    ? options.verticalOffset
    : 0;
  mesh.userData.__ttManualVerticalOffset = 0;
  mesh.userData.__ttBaseYaw = Number.isFinite(options.baseYaw) ? options.baseYaw : 0;
  mesh.userData.__ttTokenType = type;
  mesh.userData.__ttTintMaterials = this._collectTintTargets(mesh);
  return mesh;
}

function _getMeshVerticalOffset(mesh) {
  if (!mesh?.userData) return 0;
  const base = Number.isFinite(mesh.userData.__ttVerticalBase) ? mesh.userData.__ttVerticalBase : 0;
  const manual = Number.isFinite(mesh.userData.__ttManualVerticalOffset)
    ? mesh.userData.__ttManualVerticalOffset
    : 0;
  return base + manual;
}

function _attachSelectionCollider(container, three, config = {}) {
  if (!container || !three) return;
  if (!container.userData) container.userData = {};
  if (container.userData.__ttSelectionCollider) return;

  try {
    const tileSize = Math.max(this.gameManager?.spatial?.tileWorldSize || 1, 1e-4);
    const radiusSetting = Number.isFinite(config.selectionColliderRadius)
      ? config.selectionColliderRadius
      : tileSize * SELECTION_COLLIDER_RADIUS_RATIO;
    const heightSetting = Number.isFinite(config.selectionColliderHeight)
      ? config.selectionColliderHeight
      : SELECTION_COLLIDER_HEIGHT;
    const radius = Math.max(radiusSetting, tileSize * 0.3);
    const height = Math.max(heightSetting, tileSize * 0.8);

    const geometry = new three.CylinderGeometry(radius, radius, height, 14, 1, false);
    const material = new three.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
    });
    const collider = new three.Mesh(geometry, material);
    collider.name = 'TokenSelectionCollider';
    collider.position.y = height * 0.5;
    collider.renderOrder = -10;
    container.add(collider);
    container.userData.__ttSelectionCollider = collider;
    container.userData.__ttSelectionColliderBaseY = collider.position.y;
    this._updateSelectionColliderHeight(container);
  } catch (_) {
    /* ignore collider issues */
  }
}

function _updateSelectionColliderHeight(container) {
  if (!container?.userData) return;
  const collider = container.userData.__ttSelectionCollider;
  if (!collider || !collider.position) return;
  const baseY = Number.isFinite(container.userData.__ttSelectionColliderBaseY)
    ? container.userData.__ttSelectionColliderBaseY
    : collider.position.y;
  const manualOffset = Number.isFinite(container.userData.__ttManualVerticalOffset)
    ? container.userData.__ttManualVerticalOffset
    : 0;
  const nextY = baseY - manualOffset;
  if (collider.position.y !== nextY) {
    collider.position.y = nextY;
  }
}

function _updateSelectionIndicatorHeight(tokenEntry) {
  const mesh = tokenEntry?.__threeMesh;
  const indicator = tokenEntry?.__ttSelectionIndicator;
  if (!mesh || !indicator || !indicator.position) return;
  const manualOffset = Number.isFinite(mesh.userData?.__ttManualVerticalOffset)
    ? mesh.userData.__ttManualVerticalOffset
    : 0;
  const baseY = Number.isFinite(indicator.userData?.__ttBaseY)
    ? indicator.userData.__ttBaseY
    : indicator.position.y;
  const nextY = baseY - manualOffset;
  if (indicator.position.y !== nextY) {
    indicator.position.y = nextY;
  }
}

function _positionMesh(mesh, tokenEntry) {
  try {
    const gm = this.gameManager;
    if (!gm || !gm.spatial) return false;
    const activeState = this._movementStates?.get?.(tokenEntry);
    if (activeState?.activeStep && !activeState.stepFinalized) {
      return false;
    }
    const storedWorld = tokenEntry?.world;
    const gx = tokenEntry.gridX ?? 0;
    const gy = tokenEntry.gridY ?? 0;
    let worldX;
    let worldZ;
    let worldY;

    if (
      storedWorld &&
      Number.isFinite(storedWorld.x) &&
      Number.isFinite(storedWorld.y) &&
      Number.isFinite(storedWorld.z)
    ) {
      worldX = storedWorld.x;
      worldY = storedWorld.y;
      worldZ = storedWorld.z;
    } else {
      const fallback = gm.spatial.gridToWorld(gx + 0.5, gy + 0.5, 0);
      worldX = fallback.x;
      worldZ = fallback.z;
    }

    let terrainWorldY;
    try {
      const elevation = gm.getTerrainHeight?.(gx, gy);
      if (Number.isFinite(elevation)) {
        terrainWorldY = elevation * gm.spatial.elevationUnit;
      }
    } catch (_) {
      terrainWorldY = undefined;
    }

    if (Number.isFinite(terrainWorldY)) {
      worldY = terrainWorldY;
    }

    if (!Number.isFinite(worldY)) {
      worldY = 0;
    }

    const baseOffset = this._getMeshVerticalOffset(mesh);
    mesh.position.set(worldX, worldY + this._verticalBias + baseOffset, worldZ);
    return true;
  } catch (_) {
    /* ignore */
  }
  return false;
}

/* ------------------------------------------------------------------ */
/*  Installer                                                         */
/* ------------------------------------------------------------------ */

export function installMeshFactoryMethods(prototype) {
  prototype._ensureTokenMesh = _ensureTokenMesh;
  prototype._attachPromise = _attachPromise;
  prototype._createBillboardToken = _createBillboardToken;
  prototype._create3DToken = _create3DToken;
  prototype._findFirstSkinnedMesh = _findFirstSkinnedMesh;
  prototype._collectTintTargets = _collectTintTargets;
  prototype._getThree = _getThree;
  prototype._getFBXLoaderCtor = _getFBXLoaderCtor;
  prototype._getSkeletonUtils = _getSkeletonUtils;
  prototype._buildPathVariants = _buildPathVariants;
  prototype._loadModelTemplate = _loadModelTemplate;
  prototype._loadFBX = _loadFBX;
  prototype._cloneTemplate = _cloneTemplate;
  prototype._applyCommonMetadata = _applyCommonMetadata;
  prototype._getMeshVerticalOffset = _getMeshVerticalOffset;
  prototype._attachSelectionCollider = _attachSelectionCollider;
  prototype._updateSelectionColliderHeight = _updateSelectionColliderHeight;
  prototype._updateSelectionIndicatorHeight = _updateSelectionIndicatorHeight;
  prototype._positionMesh = _positionMesh;
}
