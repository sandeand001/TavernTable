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
    const geo = this.builder.build({ cols, rows, getHeight, three });
    // Attach / replace mesh in scene
    const scene = gm.threeSceneManager.scene;
    let mesh = scene.getObjectByName('TerrainMesh');
    if (!mesh) {
      const material = new three.MeshStandardMaterial({ color: 0x777766, flatShading: false });
      mesh = new three.Mesh(geo, material);
      mesh.name = 'TerrainMesh';
      // Center mesh so grid (0,0) aligns near corner; shift half extents
      mesh.position.set(cols * 0.5, 0, rows * 0.5);
      scene.add(mesh);
    } else {
      mesh.geometry.dispose();
      mesh.geometry = geo;
    }
    return mesh;
  }
}
