// PickingService.js
// Centralized raycast + screen->grid mapping for hybrid 3D mode.
// Design goals:
//  - Single allocation of Raycaster + temp vectors
//  - Graceful no-op if Three unavailable or scene/camera not initialized
//  - Ground plane intersection now; future: terrain/token/placeable meshes

export class PickingService {
  constructor({ gameManager } = {}) {
    this.gameManager = gameManager;
    this._three = gameManager?.threeSceneManager?.three || null;
    this._raycaster = null;
    this._v2 = null;
    this._hitPoint = null;
    this._plane = null; // ground plane
    this._layers = [];
    this._metrics = { raycasts: 0, lastMs: 0 };
  }

  async _ensureThree() {
    if (this._three) return this._three;
    const existing = this.gameManager?.threeSceneManager?.three;
    if (existing) {
      this._three = existing;
      return existing;
    }
    try {
      const three = await import('three');
      this._three = three;
      return three;
    } catch (_) {
      return null;
    }
  }

  _getThreeSync() {
    if (this._three) return this._three;
    const existing = this.gameManager?.threeSceneManager?.three;
    if (existing) {
      this._three = existing;
      return existing;
    }
    return null;
  }

  _ensureCorePickingObjects(three) {
    if (!three) return false;
    if (!this._raycaster) {
      try {
        this._raycaster = new three.Raycaster();
        this._v2 = new three.Vector2();
        this._hitPoint = new three.Vector3();
        this._plane = new three.Plane(new three.Vector3(0, 1, 0), 0);
      } catch (_) {
        this._raycaster = null;
        this._v2 = null;
        this._hitPoint = null;
        this._plane = null;
        return false;
      }
    }
    return true;
  }

  _executeGroundPick(three, clientX, clientY, targetElement = null) {
    if (!three) return null;
    if (!this._ensureCorePickingObjects(three)) return null;
    const gm = this.gameManager;
    if (!gm || !gm.is3DModeActive?.()) return null;
    const cam = gm.threeSceneManager?.camera;
    const canvas =
      targetElement ||
      gm.threeSceneManager?.canvas ||
      gm.app?.view ||
      (typeof document !== 'undefined' ? document.body : null);
    if (!cam || !canvas || typeof canvas.getBoundingClientRect !== 'function') return null;

    const rect = canvas.getBoundingClientRect();
    const width = rect?.width || 0;
    const height = rect?.height || 0;
    if (!width || !height) return null;

    const ndcX = ((clientX - rect.left) / width) * 2 - 1;
    const ndcY = -((clientY - rect.top) / height) * 2 + 1;
    this._v2.set(ndcX, ndcY);
    try {
      this._raycaster.setFromCamera(this._v2, cam);
    } catch (_) {
      return null;
    }
    if (!this._raycaster.ray.intersectPlane(this._plane, this._hitPoint)) return null;

    const { x, y, z } = this._hitPoint;
    let grid;
    try {
      grid = gm.spatial?.worldToGrid ? gm.spatial.worldToGrid(x, z) : null;
    } catch (_) {
      grid = null;
    }
    if (!grid) {
      const tileSize = gm?.spatial?.tileWorldSize || 1;
      grid = {
        gridX: Math.round(x / tileSize),
        gridY: Math.round(z / tileSize),
      };
    }
    return {
      world: { x, y, z },
      grid: { gx: grid.gridX, gy: grid.gridY },
      metrics: { raycasts: this._metrics.raycasts },
    };
  }

  _recordPickMetrics(start) {
    const end = (typeof performance !== 'undefined' && performance.now()) || Date.now();
    this._metrics.raycasts += 1;
    this._metrics.lastMs = end - start;
    try {
      if (typeof window !== 'undefined') {
        window.__TT_PICKING__ = {
          raycasts: this._metrics.raycasts,
          lastMs: this._metrics.lastMs,
        };
      }
    } catch (_) {
      /* ignore metrics errors */
    }
  }

  registerLayer(fn) {
    if (typeof fn === 'function') this._layers.push(fn);
  }

  async pickGround(clientX, clientY, targetElement = null) {
    const start = (typeof performance !== 'undefined' && performance.now()) || Date.now();
    try {
      const gm = this.gameManager;
      if (!gm || !gm.is3DModeActive?.()) return null;
      const three = await this._ensureThree();
      if (!three) return null;
      return this._executeGroundPick(three, clientX, clientY, targetElement);
    } catch (_) {
      return null;
    } finally {
      this._recordPickMetrics(start);
    }
  }

  pickGroundSync(clientX, clientY, targetElement = null) {
    const start = (typeof performance !== 'undefined' && performance.now()) || Date.now();
    try {
      const three = this._getThreeSync();
      if (!three) return null;
      return this._executeGroundPick(three, clientX, clientY, targetElement);
    } catch (_) {
      return null;
    } finally {
      this._recordPickMetrics(start);
    }
  }

  async pickAll(clientX, clientY, opts = {}) {
    const ground = await this.pickGround(clientX, clientY, opts.targetElement);
    if (!ground) return null;
    const hits = [];
    for (const layer of this._layers) {
      try {
        const r = layer(ground) || null;
        if (r) hits.push(r);
      } catch (_) {
        /* ignore */
      }
    }
    return { ...ground, hits };
  }

  async pickTokens(clientX, clientY, opts = {}) {
    const gm = this.gameManager;
    if (!gm) return [];
    const ground = await this.pickGround(clientX, clientY, opts.targetElement);
    if (!ground || !ground.grid) return [];
    const gx = Math.round(ground.grid.gx);
    const gy = Math.round(ground.grid.gy);
    if (!Number.isFinite(gx) || !Number.isFinite(gy)) return [];
    try {
      const tokens = gm.placedTokens || [];
      return tokens.filter((t) => t.gridX === gx && t.gridY === gy);
    } catch (_) {
      return [];
    }
  }

  async pickFirstToken(clientX, clientY, opts = {}) {
    const list = await this.pickTokens(clientX, clientY, opts);
    return list.length ? list[0] : null;
  }
}
