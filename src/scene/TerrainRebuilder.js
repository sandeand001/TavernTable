// TerrainRebuilder.js - Debounced orchestrator to rebuild the terrain mesh.
// Phase 2 scaffold: wires into GameManager / TerrainCoordinator later.

export class TerrainRebuilder {
  constructor({ gameManager, builder, debounceMs = 120 } = {}) {
    this.gameManager = gameManager;
    this.builder = builder; // instance of TerrainMeshBuilder
    this.debounceMs = debounceMs;
    this._timer = null;
    this._lastArgs = null;
  }

  request(args = {}) {
    this._lastArgs = args;
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => this._flush(), this.debounceMs);
    if (typeof this._timer.unref === 'function') this._timer.unref();
  }

  _flush() {
    const args = this._lastArgs || {};
    this._timer = null;
    try {
      this.rebuild(args);
    } catch (_) {
      /* swallow build errors early phase */
    }
  }

  rebuild({ three }) {
    if (!this.gameManager || !this.builder) return null;
    if (!this.gameManager.threeSceneManager || !this.gameManager.threeSceneManager.scene) {
      return null;
    }
    const gm = this.gameManager;
    const cols = gm.cols;
    const rows = gm.rows;
    const getHeight = (x, y) => gm.getTerrainHeight(x, y);
    const t0 = (typeof performance !== 'undefined' && performance.now()) || Date.now();
    const geo = this.builder.build({ cols, rows, getHeight, three });
    // Attach / replace mesh in scene
    const scene = gm.threeSceneManager.scene;
    let mesh = scene.getObjectByName('TerrainMesh');
    if (!mesh) {
      let material;
      try {
        // Use factory indirection so later biome tint logic is isolated.
        // Dynamic import to stay ESM-compliant.
        // Note: synchronous path not required; minor race acceptable (first frame builds fallback).
        material = new three.MeshStandardMaterial({ color: 0x777766, flatShading: false });
        import('./TerrainMaterialFactory.js')
          .then((mod) => {
            try {
              const upgraded = mod.createTerrainMaterial(three, {});
              if (upgraded && mesh) {
                mesh.material.dispose?.();
                mesh.material = upgraded;
              }
            } catch (_) {
              /* ignore */
            }
          })
          .catch(() => {});
      } catch (_) {
        material = new three.MeshStandardMaterial({ color: 0x777766, flatShading: false });
      }
      mesh = new three.Mesh(geo, material);
      mesh.name = 'TerrainMesh';
      // Center mesh so grid (0,0) aligns near corner; shift half extents
      mesh.position.set(cols * 0.5, 0, rows * 0.5);
      scene.add(mesh);
    } else {
      mesh.geometry.dispose();
      mesh.geometry = geo;
    }
    // Metrics capture
    try {
      const t1 = (typeof performance !== 'undefined' && performance.now()) || Date.now();
      const dt = t1 - t0;
      if (typeof window !== 'undefined') {
        window.__TT_METRICS__ = window.__TT_METRICS__ || {};
        window.__TT_METRICS__.terrain = window.__TT_METRICS__.terrain || {};
        window.__TT_METRICS__.terrain.lastRebuildMs = dt;
        window.__TT_METRICS__.terrain.lastRebuildCols = cols;
        window.__TT_METRICS__.terrain.lastRebuildRows = rows;
        window.__TT_METRICS__.terrain.rebuildCount =
          (window.__TT_METRICS__.terrain.rebuildCount || 0) + 1;
      }
    } catch (_) {
      /* ignore metrics errors */
    }
    return mesh;
  }
}
