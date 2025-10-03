// Token3DAdapter.js - Phase 3 scaffold
// Bridges existing 2D token data structures to emerging 3D scene.
// Current responsibilities:
//  - On token added, create a Three.js plane (billboard) positioned via SpatialCoordinator
//  - Keep plane reference attached to token entry for future sync (facing, selection highlighting)
// Degraded gracefully if Three or hybrid scene unavailable.

export class Token3DAdapter {
  constructor(gameManager) {
    this.gameManager = gameManager;
    this._attached = false;
    this._verticalBias = 0; // additional Y offset above terrain height (world units)
    this._hoverToken = null; // token entry currently hovered (grid-based picking)
    this._selectedToken = null; // token entry explicitly selected
    this._originalMaterials = new WeakMap(); // store original material refs for restoration
  }

  attach() {
    if (this._attached) return;
    this._attached = true;
    // Initial sync for already placed tokens
    try {
      this.syncAll();
    } catch (_) {
      /* ignore */
    }
    // Register unified per-frame callback (facing sync + billboard orientation) once.
    try {
      const gm = this.gameManager;
      if (gm?.threeSceneManager?.addAnimationCallback && !this._frameCallback) {
        this._frameCallback = () => {
          // Facing sync (only mutates if changed)
          try {
            this._syncFacingDirection();
          } catch (_) {
            /* ignore */
          }
          // Billboard orientation for all token meshes
          try {
            const camera = gm.threeSceneManager?.camera;
            if (!camera) return;
            const tokens = gm.placedTokens || [];
            for (const t of tokens) {
              const mesh = t.__threeMesh;
              if (!mesh || typeof mesh.lookAt !== 'function') continue;
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

  /** Iterate existing tokens and ensure a 3D representation exists. */
  syncAll() {
    const gm = this.gameManager;
    if (!gm || !gm.is3DModeActive?.()) return;
    const scene = gm.threeSceneManager?.scene;
    if (!scene) return;
    const tokens = gm.placedTokens || [];
    for (const t of tokens) this._ensureTokenMesh(t, scene);
  }

  /** Public hook: call when a new token is added to collection */
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
    // Test override: allow injecting three stub synchronously (used by unit tests)
    if (gm && gm.__threeTestDouble) {
      try {
        const three = gm.__threeTestDouble;
        const size = 0.9;
        const geo = new three.PlaneGeometry(size, size);
        const mat = this._createMaterialForToken(three, tokenEntry);
        const mesh = new three.Mesh(geo, mat);
        mesh.name = `Token3D:${tokenEntry.id || tokenEntry.creature?.type || 'unk'}`;
        const gx = tokenEntry.gridX ?? 0;
        const gy = tokenEntry.gridY ?? 0;
        const world = gm.spatial.gridToWorld(gx + 0.5, gy + 0.5, 0);
        const terrainH = (gm.getTerrainHeight?.(gx, gy) || 0) * gm.spatial.elevationUnit;
        mesh.position.set(world.x, terrainH + this._verticalBias, world.z);
        // orientation handled in unified frame callback
        // Billboard orientation handled by unified frame callback now.
        scene.add(mesh);
        tokenEntry.__threeMesh = mesh;
        return Promise.resolve(mesh);
      } catch (_) {
        return Promise.resolve(null);
      }
    }
    // Dynamic import inside method to avoid upfront three cost if degraded.
    const p = import('three')
      .then((three) => {
        try {
          const size = 0.9; // plane size in world units (placeholder)
          const geo = new three.PlaneGeometry(size, size);
          const mat = this._createMaterialForToken(three, tokenEntry);
          const mesh = new three.Mesh(geo, mat);
          mesh.name = `Token3D:${tokenEntry.id || tokenEntry.creature?.type || 'unk'}`;
          // Position: center of grid cell in world space (Y from terrain height)
          const gx = tokenEntry.gridX ?? 0;
          const gy = tokenEntry.gridY ?? 0;
          const world = gm.spatial.gridToWorld(gx + 0.5, gy + 0.5, 0);
          const terrainH = (gm.getTerrainHeight?.(gx, gy) || 0) * gm.spatial.elevationUnit;
          mesh.position.set(world.x, terrainH + this._verticalBias, world.z);
          // Billboard behavior: rotate to face camera on each frame (simple hook)
          // orientation handled in unified frame callback
          // Billboard handled by unified frame callback
          scene.add(mesh);
          tokenEntry.__threeMesh = mesh;
          return mesh;
        } catch (_) {
          /* ignore token mesh creation errors */
          return null;
        }
      })
      .catch(() => null);
    // Expose promise for test harness / diagnostics (non-enumerable to avoid pollution)
    try {
      Object.defineProperty(tokenEntry, '__threeMeshPromise', { value: p, enumerable: false });
    } catch (_) {
      tokenEntry.__threeMeshPromise = p; // fallback
    }
    return p;
  }

  /** Adjust extra vertical bias (world units) applied to all token billboards */
  setVerticalBias(v) {
    if (!Number.isFinite(v)) return;
    this._verticalBias = v;
    this.resyncHeights();
  }

  /** Recompute Y for all token meshes based on current terrain + bias (call after terrain change). */
  resyncHeights() {
    try {
      const gm = this.gameManager;
      if (!gm || !gm.is3DModeActive?.()) return;
      const tokens = gm.placedTokens || [];
      for (const t of tokens) {
        const mesh = t.__threeMesh;
        if (!mesh) continue;
        const gx = t.gridX ?? 0;
        const gy = t.gridY ?? 0;
        let terrainH = 0;
        try {
          terrainH = (gm.getTerrainHeight?.(gx, gy) || 0) * gm.spatial.elevationUnit;
        } catch (_) {
          /* ignore */
        }
        mesh.position.y = terrainH + this._verticalBias;
      }
    } catch (_) {
      /* ignore */
    }
  }

  /** Public hook: call when a token is removed from collection */
  onTokenRemoved(tokenEntry) {
    if (!tokenEntry || !tokenEntry.__threeMesh) return;
    try {
      const mesh = tokenEntry.__threeMesh;
      // Clean up any highlight state references
      if (this._hoverToken === tokenEntry) this._hoverToken = null;
      if (this._selectedToken === tokenEntry) this._selectedToken = null;
      const gm = this.gameManager;
      const scene = gm?.threeSceneManager?.scene;
      if (scene && typeof scene.remove === 'function') {
        try {
          scene.remove(mesh);
        } catch (_) {
          /* ignore */
        }
      }
      // Dispose GPU resources
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
    } finally {
      delete tokenEntry.__threeMesh;
    }
  }

  /** Attempt to derive a texture from the 2D sprite; falls back to flat color. */
  _createMaterialForToken(three, tokenEntry) {
    try {
      const sprite = tokenEntry?.creature?.sprite;
      // If PIXI sprite present with a baseTexture (common in PIXI), extract its resource.
      const bt = sprite?.texture?.baseTexture;
      const src = bt?.resource?.source || bt?.resource; // handle different PIXI versions
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
      // Fallback: if we can render sprite to an offscreen canvas (e.g., if has `render`), attempt minimal capture
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

  /** Internal: synchronize horizontal facing (flip) for all token meshes if changed. */
  _syncFacingDirection() {
    const gm = this.gameManager;
    if (!gm || !gm.is3DModeActive?.()) return;
    const facingRight = (() => {
      try {
        if (gm.tokenManager?.getTokenFacingRight) {
          return gm.tokenManager.getTokenFacingRight();
        }
        if (typeof gm.tokenManager?.tokenFacingRight === 'boolean') {
          return gm.tokenManager.tokenFacingRight;
        }
      } catch (_) {
        /* ignore */
      }
      return true; // default
    })();
    if (facingRight === this._lastFacingRight) return;
    this._lastFacingRight = facingRight;
    const sign = facingRight ? 1 : -1;
    try {
      const tokens = gm.placedTokens || [];
      for (const t of tokens) {
        const mesh = t.__threeMesh;
        if (!mesh) continue;
        if (!mesh.scale) mesh.scale = { x: sign, y: 1, z: 1 }; // safety for test doubles
        mesh.scale.x = sign * Math.abs(mesh.scale.x || 1);
      }
    } catch (_) {
      /* ignore */
    }
  }

  /** Apply hover highlight (non-destructive) */
  setHoverToken(tokenEntry) {
    if (this._hoverToken === tokenEntry) return;
    if (this._hoverToken && this._hoverToken.__threeMesh) {
      this._restoreMaterial(this._hoverToken.__threeMesh);
    }
    this._hoverToken = tokenEntry || null;
    if (tokenEntry && tokenEntry.__threeMesh) {
      this._applyTint(tokenEntry.__threeMesh, 0x88ccff);
    }
  }

  /** Explicit selection highlight (stronger tint) */
  setSelectedToken(tokenEntry) {
    if (this._selectedToken === tokenEntry) return;
    if (this._selectedToken && this._selectedToken.__threeMesh) {
      this._restoreMaterial(this._selectedToken.__threeMesh);
    }
    this._selectedToken = tokenEntry || null;
    if (tokenEntry && tokenEntry.__threeMesh) {
      this._applyTint(tokenEntry.__threeMesh, 0xffcc55);
    }
  }

  clearHighlights() {
    this.setHoverToken(null);
    this.setSelectedToken(null);
  }

  _applyTint(mesh, colorHex) {
    const mat = mesh.material;
    if (!mat) return;
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

  _restoreMaterial(mesh) {
    const mat = mesh.material;
    if (!mat) return;
    const snap = this._originalMaterials.get(mat);
    if (!snap) return;
    try {
      if (snap.color && mat.color) mat.color.copy(snap.color);
      if (snap.emissive && mat.emissive) mat.emissive.copy(snap.emissive);
      mat.needsUpdate = true;
    } catch (_) {
      /* ignore */
    }
  }
}
