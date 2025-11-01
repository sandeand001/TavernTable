// Token3DAdapter.js - Phase 3 enhanced scaffold
// Bridges existing 2D token data structures to emerging 3D scene.
// Responsibilities:
//  - Create either billboard planes (legacy sprites) or true 3D models per token entry
//  - Keep Three.js representation synchronized with grid placement / terrain height
//  - Manage hover/selection highlighting and facing direction parity with 2D tokens

const TOKEN_3D_MODELS = {
  'defeated-doll': {
    path: 'assets/animated-sprites/Defeated.fbx',
    tileSpan: 1,
    margin: 0.92,
    baseRotation: { x: 0, y: Math.PI / 2, z: 0 },
    animation: {
      autoplay: true,
      loop: true,
      clampWhenFinished: false,
    },
    shadows: {
      cast: true,
      receive: true,
    },
    verticalOffset: 0,
  },
};

const DEFAULT_BILLBOARD_SIZE = 0.9;

export class Token3DAdapter {
  constructor(gameManager) {
    this.gameManager = gameManager;
    this._attached = false;
    this._verticalBias = 0;
    this._hoverToken = null;
    this._selectedToken = null;
    this._originalMaterials = new WeakMap();
    this._threePromise = null;
    this._fbxCtorPromise = null;
    this._skeletonUtilsPromise = null;
    this._modelCache = new Map();
    this._animationMixers = new Map();
    this._lastFrameTime = null;
    this._lastFacingRight = null;
    this._selectionColor = 0xffcc55;
  }

  attach() {
    if (this._attached) return;
    this._attached = true;
    try {
      this.syncAll();
    } catch (_) {
      /* ignore */
    }
    try {
      const gm = this.gameManager;
      if (gm?.threeSceneManager?.addAnimationCallback && !this._frameCallback) {
        this._frameCallback = () => {
          const gmRef = this.gameManager;
          const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
          let delta = 0;
          if (this._lastFrameTime != null) {
            delta = Math.max(0, (now - this._lastFrameTime) / 1000);
            if (delta > 0.1) delta = 0.1;
          }
          this._lastFrameTime = now;

          if (delta > 0 && this._animationMixers.size) {
            for (const mixer of this._animationMixers.values()) {
              try {
                mixer.update(delta);
              } catch (_) {
                /* ignore mixer update */
              }
            }
          }

          try {
            this._syncFacingDirection();
          } catch (_) {
            /* ignore */
          }

          try {
            const camera = gmRef?.threeSceneManager?.camera;
            if (!camera) return;
            const tokens = gmRef?.placedTokens || [];
            for (const t of tokens) {
              const mesh = t.__threeMesh;
              if (!mesh || typeof mesh.lookAt !== 'function') continue;
              if (mesh.userData?.__ttBillboard === false) continue;
              try {
                mesh.lookAt(camera.position);
              } catch (_) {
                /* ignore */
              }
            }
          } catch (_) {
            /* ignore */
          }
        };
        gm.threeSceneManager.addAnimationCallback(this._frameCallback);
      }
    } catch (_) {
      /* ignore */
    }
  }

  syncAll() {
    const gm = this.gameManager;
    if (!gm || !gm.is3DModeActive?.()) return;
    const scene = gm.threeSceneManager?.scene;
    if (!scene) return;
    const tokens = gm.placedTokens || [];
    for (const t of tokens) this._ensureTokenMesh(t, scene);
  }

  onTokenAdded(tokenEntry) {
    const gm = this.gameManager;
    if (!gm || !gm.is3DModeActive?.()) return;
    const scene = gm.threeSceneManager?.scene;
    if (!scene) return;
    return this._ensureTokenMesh(tokenEntry, scene);
  }

  _ensureTokenMesh(tokenEntry, scene) {
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

  _attachPromise(tokenEntry, promise) {
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

  async _createBillboardToken(tokenEntry, scene) {
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

  async _create3DToken(tokenEntry, scene, config) {
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

      if (config.baseRotation) {
        container.rotation.set(
          config.baseRotation.x || 0,
          config.baseRotation.y || 0,
          config.baseRotation.z || 0
        );
      }

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

      container.userData.__ttTintMaterials = this._collectTintTargets(container);
      this._positionMesh(container, tokenEntry);
      scene.add(container);
      tokenEntry.__threeMesh = container;
      this.updateTokenOrientation(tokenEntry);
      this._refreshVisualState(tokenEntry);

      if (templateBundle.animations?.length) {
        const mixer = new three.AnimationMixer(container);
        const clip = templateBundle.animations[0];
        const action = mixer.clipAction(clip);
        if (action) {
          if (config.animation?.loop === false) {
            action.setLoop(three.LoopOnce, 0);
          }
          if (config.animation?.clampWhenFinished) {
            action.clampWhenFinished = true;
          }
          if (config.animation?.autoplay !== false) {
            action.play();
          }
        }
        this._animationMixers.set(tokenEntry, mixer);
      }

      return container;
    } catch (_) {
      return null;
    }
  }

  setVerticalBias(v) {
    if (!Number.isFinite(v)) return;
    this._verticalBias = v;
    this.resyncHeights();
  }

  resyncHeights() {
    try {
      const gm = this.gameManager;
      if (!gm || !gm.is3DModeActive?.()) return;
      const tokens = gm.placedTokens || [];
      for (const t of tokens) {
        const mesh = t.__threeMesh;
        if (!mesh) continue;
        this._positionMesh(mesh, t);
      }
    } catch (_) {
      /* ignore */
    }
  }

  onTokenRemoved(tokenEntry) {
    if (!tokenEntry || !tokenEntry.__threeMesh) return;
    const mesh = tokenEntry.__threeMesh;
    if (this._hoverToken === tokenEntry) this._hoverToken = null;
    if (this._selectedToken === tokenEntry) this._selectedToken = null;
    this._discardSelectionIndicator(tokenEntry);

    const mixer = this._animationMixers.get(tokenEntry);
    if (mixer) {
      try {
        mixer.stopAllAction();
      } catch (_) {
        /* ignore */
      }
      this._animationMixers.delete(tokenEntry);
    }

    const gm = this.gameManager;
    const scene = gm?.threeSceneManager?.scene;
    if (scene && typeof scene.remove === 'function') {
      try {
        scene.remove(mesh);
      } catch (_) {
        /* ignore */
      }
    }

    try {
      mesh.traverse?.((child) => {
        if (child.geometry && typeof child.geometry.dispose === 'function') {
          child.geometry.dispose();
        }
        if (child.material) {
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach((mat) => {
            if (mat && typeof mat.dispose === 'function') {
              mat.dispose();
            }
          });
        }
      });
    } catch (_) {
      /* ignore */
    }

    try {
      mesh.geometry && typeof mesh.geometry.dispose === 'function' && mesh.geometry.dispose();
    } catch (_) {
      /* ignore */
    }
    try {
      mesh.material && typeof mesh.material.dispose === 'function' && mesh.material.dispose();
    } catch (_) {
      /* ignore */
    }

    delete tokenEntry.__threeMesh;
    delete tokenEntry.__threeMeshPromise;
  }

  _createMaterialForToken(three, tokenEntry) {
    try {
      const sprite = tokenEntry?.creature?.sprite;
      const bt = sprite?.texture?.baseTexture;
      const src = bt?.resource?.source || bt?.resource;
      if (src && (src instanceof HTMLImageElement || src instanceof HTMLCanvasElement)) {
        const tex = new three.Texture(src);
        tex.needsUpdate = true;
        return new three.MeshBasicMaterial({
          map: tex,
          transparent: true,
          alphaTest: 0.05,
          depthWrite: false,
          side: three.DoubleSide,
        });
      }
      if (sprite && typeof document !== 'undefined') {
        const w = Math.max(1, sprite.width || 64);
        const h = Math.max(1, sprite.height || 64);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (ctx && src) {
          ctx.drawImage(src, 0, 0, w, h);
          const tex = new three.Texture(canvas);
          tex.needsUpdate = true;
          return new three.MeshBasicMaterial({
            map: tex,
            transparent: true,
            alphaTest: 0.05,
            depthWrite: false,
            side: three.DoubleSide,
          });
        }
      }
    } catch (_) {
      /* ignore and fallback */
    }
    return new three.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      side: three.DoubleSide,
    });
  }

  _syncFacingDirection() {
    const gm = this.gameManager;
    if (!gm || !gm.is3DModeActive?.()) return;
    const facingRight = this._getGlobalFacingRight();
    if (facingRight === this._lastFacingRight) return;
    this._lastFacingRight = facingRight;
    try {
      const tokens = gm.placedTokens || [];
      for (const token of tokens) {
        this.updateTokenOrientation(token);
      }
    } catch (_) {
      /* ignore */
    }
  }

  getSelectedToken() {
    return this._selectedToken || null;
  }

  setHoverToken(tokenEntry) {
    if (this._hoverToken === tokenEntry) return;
    const previous = this._hoverToken;
    this._hoverToken = tokenEntry || null;
    if (previous) this._refreshVisualState(previous);
    if (tokenEntry) this._refreshVisualState(tokenEntry);
  }

  setSelectedToken(tokenEntry) {
    if (this._selectedToken === tokenEntry) return;
    const previous = this._selectedToken;
    this._selectedToken = tokenEntry || null;
    if (previous) {
      this._refreshVisualState(previous);
    }
    if (tokenEntry) {
      this._refreshVisualState(tokenEntry);
    }
  }

  updateTokenOrientation(tokenEntry) {
    if (!tokenEntry) return;
    const normalized = this._normalizeAngle(
      Number.isFinite(tokenEntry.facingAngle) ? tokenEntry.facingAngle : 0
    );
    tokenEntry.facingAngle = normalized;

    const mesh = tokenEntry.__threeMesh;
    const globalFlip = this._getGlobalFacingRight() ? 0 : Math.PI;

    if (mesh && mesh.userData?.__tt3DToken) {
      const baseYaw = mesh.userData.__ttBaseYaw || 0;
      const yaw = baseYaw + globalFlip + normalized;
      try {
        if (mesh.rotation) {
          mesh.rotation.y = yaw;
        } else {
          mesh.rotation = { y: yaw };
        }
      } catch (_) {
        /* ignore mesh rotation errors */
      }
      return;
    }

    if (mesh) {
      this._applyBillboardFacing(mesh, globalFlip);
    }

    try {
      const sprite = tokenEntry?.creature?.sprite;
      if (sprite) {
        const sign = globalFlip === 0 ? 1 : -1;
        if (sprite.scale && typeof sprite.scale.x === 'number') {
          const absX = Math.abs(sprite.scale.x || 1);
          sprite.scale.x = sign * absX;
        }
        if (typeof sprite.rotation === 'number') {
          sprite.rotation = normalized;
        }
      }
    } catch (_) {
      /* ignore sprite orientation errors */
    }
  }

  _applyBillboardFacing(mesh, globalFlip) {
    if (!mesh) return;
    const facingRight = globalFlip === 0;
    const sign = facingRight ? 1 : -1;
    if (!mesh.scale) mesh.scale = { x: sign, y: 1, z: 1 };
    mesh.scale.x = sign * Math.abs(mesh.scale.x || 1);
  }

  _getGlobalFacingRight() {
    const gm = this.gameManager;
    try {
      if (gm?.tokenManager?.getTokenFacingRight) {
        return !!gm.tokenManager.getTokenFacingRight();
      }
      if (typeof gm?.tokenManager?.tokenFacingRight === 'boolean') {
        return !!gm.tokenManager.tokenFacingRight;
      }
    } catch (_) {
      /* ignore */
    }
    return true;
  }

  _normalizeAngle(angle) {
    if (!Number.isFinite(angle)) return 0;
    const tau = Math.PI * 2;
    let normalized = angle;
    while (normalized <= -Math.PI) normalized += tau;
    while (normalized > Math.PI) normalized -= tau;
    return normalized;
  }

  clearHighlights() {
    this.setHoverToken(null);
    this.setSelectedToken(null);
  }

  async _showSelectionIndicator(tokenEntry) {
    try {
      const marker = await this._ensureSelectionIndicator(tokenEntry);
      if (marker) marker.visible = true;
    } catch (_) {
      /* ignore */
    }
  }

  _hideSelectionIndicator(tokenEntry) {
    try {
      const marker = tokenEntry?.__ttSelectionIndicator;
      if (marker) marker.visible = false;
    } catch (_) {
      /* ignore */
    }
  }

  _discardSelectionIndicator(tokenEntry) {
    try {
      const marker = tokenEntry?.__ttSelectionIndicator;
      if (marker) {
        marker.visible = false;
        if (marker.parent && typeof marker.parent.remove === 'function') {
          marker.parent.remove(marker);
        }
        if (marker.geometry?.dispose) marker.geometry.dispose();
        if (marker.material?.dispose) marker.material.dispose();
      }
      delete tokenEntry.__ttSelectionIndicator;
    } catch (_) {
      /* ignore */
    }
  }

  async _ensureSelectionIndicator(tokenEntry) {
    if (!tokenEntry || !tokenEntry.__threeMesh) return null;
    if (!tokenEntry.__threeMesh.userData?.__tt3DToken) return null;
    if (tokenEntry.__ttSelectionIndicator) return tokenEntry.__ttSelectionIndicator;
    const three = await this._getThree();
    if (!three) return null;
    try {
      const inner = 0.34;
      const outer = 0.47;
      const geometry = new three.RingGeometry(inner, outer, 48);
      const material = new three.MeshBasicMaterial({
        color: this._selectionColor,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        side: three.DoubleSide,
      });
      const ring = new three.Mesh(geometry, material);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.02;
      ring.name = 'TokenSelectionIndicator';
      if (typeof tokenEntry.__threeMesh.add === 'function') {
        tokenEntry.__threeMesh.add(ring);
      }
      tokenEntry.__ttSelectionIndicator = ring;
      return ring;
    } catch (_) {
      return null;
    }
  }

  _refreshVisualState(tokenEntry) {
    const mesh = tokenEntry?.__threeMesh;
    if (!mesh) return;
    const is3DToken = !!mesh.userData?.__tt3DToken;

    if (this._selectedToken === tokenEntry) {
      this._restoreMaterial(mesh);
      if (is3DToken) {
        void this._showSelectionIndicator(tokenEntry);
      } else {
        this._hideSelectionIndicator(tokenEntry);
        this._applyTint(mesh, this._selectionColor);
      }
      return;
    }

    if (this._hoverToken === tokenEntry) {
      this._restoreMaterial(mesh);
      if (is3DToken) {
        this._hideSelectionIndicator(tokenEntry);
      } else {
        this._applyTint(mesh, 0x88ccff);
        this._hideSelectionIndicator(tokenEntry);
      }
      return;
    }

    this._restoreMaterial(mesh);
    this._hideSelectionIndicator(tokenEntry);
  }

  _applyTint(mesh, colorHex) {
    if (!mesh) return;
    const mats = mesh.userData?.__ttTintMaterials || this._collectTintTargets(mesh);
    mesh.userData = mesh.userData || {};
    mesh.userData.__ttTintMaterials = mats;
    if (!mats || !mats.length) return;
    for (const mat of mats) {
      if (!mat) continue;
      if (!this._originalMaterials.has(mat)) {
        this._originalMaterials.set(mat, {
          color: mat.color?.clone?.() || null,
          emissive: mat.emissive?.clone?.() || null,
        });
      }
      try {
        if (mat.color) mat.color.setHex(colorHex);
        if (mat.emissive) mat.emissive.setHex(colorHex);
        mat.needsUpdate = true;
      } catch (_) {
        /* ignore */
      }
    }
  }

  _restoreMaterial(mesh) {
    if (!mesh) return;
    const mats = mesh.userData?.__ttTintMaterials || [];
    for (const mat of mats) {
      if (!mat) continue;
      const snap = this._originalMaterials.get(mat);
      if (!snap) continue;
      try {
        if (snap.color && mat.color) mat.color.copy(snap.color);
        if (snap.emissive && mat.emissive) mat.emissive.copy(snap.emissive);
        mat.needsUpdate = true;
      } catch (_) {
        /* ignore */
      }
    }
  }

  _collectTintTargets(mesh) {
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

  async _getThree() {
    if (this._threePromise) return this._threePromise;
    if (this.gameManager?.threeSceneManager?.three) {
      this._threePromise = Promise.resolve(this.gameManager.threeSceneManager.three);
      return this._threePromise;
    }
    this._threePromise = import('three').then((mod) => mod.default || mod).catch(() => null);
    return this._threePromise;
  }

  async _getFBXLoaderCtor() {
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

  async _getSkeletonUtils() {
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

  _buildPathVariants(path) {
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

  async _loadModelTemplate(typeKey, config) {
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

  _loadFBX(loader, url) {
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

  async _cloneTemplate(template) {
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

  _applyCommonMetadata(mesh, tokenEntry, options = {}) {
    const type = tokenEntry?.type || tokenEntry?.creature?.type || 'unk';
    mesh.name = mesh.name || `Token3D:${tokenEntry?.id || type}`;
    mesh.userData = mesh.userData || {};
    const billboard = options.billboard !== false;
    mesh.userData.__ttBillboard = billboard;
    mesh.userData.__tt3DToken = !!options.is3D;
    mesh.userData.__ttVerticalBase = Number.isFinite(options.verticalOffset)
      ? options.verticalOffset
      : 0;
    mesh.userData.__ttBaseYaw = Number.isFinite(options.baseYaw) ? options.baseYaw : 0;
    mesh.userData.__ttTokenType = type;
    mesh.userData.__ttTintMaterials = this._collectTintTargets(mesh);
    return mesh;
  }

  _positionMesh(mesh, tokenEntry) {
    try {
      const gm = this.gameManager;
      if (!gm || !gm.spatial) return;
      const gx = tokenEntry.gridX ?? 0;
      const gy = tokenEntry.gridY ?? 0;
      const world = gm.spatial.gridToWorld(gx + 0.5, gy + 0.5, 0);
      let terrainH = 0;
      try {
        terrainH = (gm.getTerrainHeight?.(gx, gy) || 0) * gm.spatial.elevationUnit;
      } catch (_) {
        /* ignore */
      }
      const baseOffset = mesh.userData?.__ttVerticalBase || 0;
      mesh.position.set(world.x, terrainH + this._verticalBias + baseOffset, world.z);
    } catch (_) {
      /* ignore */
    }
  }
}
