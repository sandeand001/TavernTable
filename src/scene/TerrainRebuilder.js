// TerrainRebuilder.js - Debounced orchestrator to rebuild the terrain mesh.
// Applies elevation + biome-based vertex coloring.

// Simplified: expressive/atlas modes removed. Use 2D biome palette directly.
import { TERRAIN_CONFIG } from '../config/TerrainConstants.js';
import { getBiomeColorHex } from '../config/BiomePalettes.js';

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
    // Biome color selection, falling back to height palette.
    const gmBiomeGetter = (gx, gy, elev) => {
      try {
        if (
          typeof window !== 'undefined' &&
          window.selectedBiome &&
          !gm.terrainCoordinator?.isTerrainModeActive
        ) {
          return getBiomeColorHex(window.selectedBiome, elev);
        }
      } catch (_) {
        /* ignore biome path fallthrough */
      }
      const key = elev != null ? elev.toString() : '0';
      if (Object.prototype.hasOwnProperty.call(TERRAIN_CONFIG.HEIGHT_COLOR_SCALE, key)) {
        return TERRAIN_CONFIG.HEIGHT_COLOR_SCALE[key];
      }
      return TERRAIN_CONFIG.HEIGHT_COLOR_SCALE['0'] || 0x777766;
    };
    // Dark wall color for contrast; only used in advanced geometry path.
    const wallColor = 0x050505;
    const wantsWalls = !!(three && three.BufferGeometry);
    const geo = this.builder.build({
      cols,
      rows,
      getHeight,
      three,
      getBiomeColor: gmBiomeGetter,
      getWallColor: wantsWalls ? () => wallColor : undefined,
    });
    const scene = gm.threeSceneManager.scene;
    let mesh = scene.getObjectByName('TerrainMesh');
    if (!mesh) {
      let material;
      try {
        material = new three.MeshBasicMaterial({ vertexColors: true });
      } catch (_) {
        material = new three.MeshStandardMaterial({ color: 0x777766, flatShading: false });
      }
      try {
        if (geo.getAttribute('color') && material && material.isMaterial) {
          material.vertexColors = true;
        }
        if (material && material.isMaterial && three?.DoubleSide) {
          material.side = three.DoubleSide;
        }
      } catch (_) {
        /* ignore */
      }
      mesh = new three.Mesh(geo, material);
      mesh.name = 'TerrainMesh';
      mesh.position.set(0, 0, 0);
      scene.add(mesh);
    } else {
      mesh.geometry.dispose();
      mesh.geometry = geo;
      try {
        if (!mesh.material || !mesh.material.isMeshBasicMaterial) {
          try {
            mesh.material.dispose?.();
          } catch (_) {
            /* ignore dispose */
          }
          mesh.material = new three.MeshBasicMaterial({ vertexColors: true });
        }
      } catch (_) {
        /* ignore material swap */
      }
      try {
        if (geo.getAttribute('color') && mesh.material) {
          mesh.material.vertexColors = true;
          if (three?.DoubleSide) mesh.material.side = three.DoubleSide;
          mesh.material.needsUpdate = true;
        }
      } catch (_) {
        /* ignore */
      }
      try {
        if (mesh.position && (mesh.position.x !== 0 || mesh.position.z !== 0)) {
          mesh.position.set(0, 0, 0);
        }
      } catch (_) {
        /* ignore reposition */
      }
    }
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
