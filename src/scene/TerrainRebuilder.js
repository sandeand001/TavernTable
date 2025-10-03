// NOTE: Formatting managed by Prettier via lint:fix script.
// TerrainRebuilder.js - Debounced orchestrator to rebuild the terrain mesh.
// Applies elevation + biome-based vertex coloring.

// Simplified: expressive/atlas modes removed. Use 2D biome palette directly.
import { TERRAIN_CONFIG } from '../config/TerrainConstants.js';
import { GRID_CONFIG } from '../config/GameConstants.js';
import { getBiomeColorWithHydrology } from '../config/BiomePalettes.js';

export class TerrainRebuilder {
  constructor({ gameManager, builder, debounceMs = 120 } = {}) {
    this.gameManager = gameManager;
    this.builder = builder; // instance of TerrainMeshBuilder
    this.debounceMs = debounceMs;
    this._timer = null;
    this._lastArgs = null;
    this._lastFlushTime = Number.NEGATIVE_INFINITY;
  }

  request(args = {}) {
    this._lastArgs = this._mergeArgs(this._lastArgs, args);
    const safeDebounce = Number.isFinite(this.debounceMs) ? this.debounceMs : 0;
    const interval = Math.max(0, safeDebounce || 0);
    const rawNow = Date.now();
    const now = Number.isFinite(rawNow) ? rawNow : 0;
    let elapsed = now - this._lastFlushTime;
    if (!Number.isFinite(elapsed) || elapsed < 0) {
      elapsed = Number.POSITIVE_INFINITY;
    }
    if (elapsed >= interval) {
      if (this._timer) {
        clearTimeout(this._timer);
        this._timer = null;
      }
      this._flush();
      return;
    }
    const remaining = interval - elapsed;
    const delay = Number.isFinite(remaining) ? Math.max(0, remaining) : 0;
    if (!this._timer) {
      this._timer = setTimeout(() => this._flush(), delay);
      if (typeof this._timer.unref === 'function') this._timer.unref();
    }
  }

  _flush() {
    const args = this._lastArgs || {};
    this._timer = null;
    this._lastFlushTime = Date.now();
    try {
      this.rebuild(args);
    } catch (_) {
      /* swallow build errors early phase */
    }
  }

  _mergeArgs(existing, incoming) {
    const base = existing && typeof existing === 'object' ? { ...existing } : {};
    if (incoming && typeof incoming === 'object') {
      Object.keys(incoming).forEach((key) => {
        const value = incoming[key];
        if (value !== undefined) {
          base[key] = value;
        }
      });
    }
    return base;
  }

  rebuild({ three } = {}) {
    if (!this.gameManager || !this.builder) return null;
    if (!this.gameManager.threeSceneManager || !this.gameManager.threeSceneManager.scene) {
      return null;
    }
    // Fallback to the globally imported three namespace if caller did not pass it.
    const threeNs = three || this.gameManager.threeSceneManager.three;
    const forceStandard = typeof window !== 'undefined' && window.__TT_TERRAIN_STANDARD__;
    const gm = this.gameManager;
    const cols = gm.cols;
    const rows = gm.rows;
    const getHeight = (x, y) => gm.getTerrainHeight(x, y);
    const t0 = (typeof performance !== 'undefined' && performance.now()) || Date.now();
    const neutralColor = GRID_CONFIG?.TILE_COLOR ?? 0x444444;
    const gmBiomeGetter = (gx, gy, elev) => {
      const h = Number.isFinite(elev) ? elev : 0;
      const terrainModeActive =
        (gm?.terrainCoordinator?.isTerrainModeActive ?? false) ||
        (typeof gm.isTerrainModeActive === 'function' && gm.isTerrainModeActive());
      if (terrainModeActive) {
        const palette = TERRAIN_CONFIG.HEIGHT_COLOR_SCALE || {};
        const clamped = Math.max(
          TERRAIN_CONFIG.MIN_HEIGHT ?? -Infinity,
          Math.min(TERRAIN_CONFIG.MAX_HEIGHT ?? Infinity, Math.round(h))
        );
        let color = palette[clamped];
        if (color == null) color = palette[String(clamped)];
        if (color == null) color = palette[0];
        if (color == null) color = palette['0'];
        if (color == null) color = 0x6b7280;
        return color;
      }
      const biomeKey =
        (typeof window !== 'undefined' && window.selectedBiome) ||
        gm?.terrainCoordinator?._lastGeneratedBiomeKey ||
        'grassland';
      const userSelectedBiome =
        typeof window !== 'undefined' && window.__TT_USER_SELECTED_BIOME__ === true;
      if (!userSelectedBiome) {
        return neutralColor;
      }
      try {
        // Prefer hydrology-enhanced color if available
        return getBiomeColorWithHydrology(biomeKey, h);
      } catch (_) {
        const key = h.toString();
        if (Object.prototype.hasOwnProperty.call(TERRAIN_CONFIG.HEIGHT_COLOR_SCALE, key)) {
          return TERRAIN_CONFIG.HEIGHT_COLOR_SCALE[key];
        }
        return TERRAIN_CONFIG.HEIGHT_COLOR_SCALE['0'] || neutralColor;
      }
    };
    const wallColor = 0x050505;
    const wantsWalls = !!(threeNs && threeNs.BufferGeometry);
    const geo = this.builder.build({
      cols,
      rows,
      getHeight,
      three: threeNs,
      getBiomeColor: gmBiomeGetter,
      getWallColor: wantsWalls ? () => wallColor : undefined,
    });
    // Debug sample of first vertex color to help diagnose "all black" issues.
    try {
      if (typeof window !== 'undefined' && !window.__TT_LAST_TERRAIN_COLOR_SAMPLE__) {
        const colAttr = geo.getAttribute('color');
        if (colAttr && colAttr.count > 0) {
          const r = Math.round(colAttr.array[0] * 255);
          const g2 = Math.round(colAttr.array[1] * 255);
          const b = Math.round(colAttr.array[2] * 255);
          const sampleHex = (r << 16) | (g2 << 8) | b;
          window.__TT_LAST_TERRAIN_COLOR_SAMPLE__ = sampleHex;
          // eslint-disable-next-line no-console
          console.info('[TerrainRebuilder] Sample vertex color hex:', sampleHex.toString(16));
        }
      }
    } catch (_) {
      /* ignore debug sampling */
    }
    const scene = gm.threeSceneManager.scene;
    let mesh = scene.getObjectByName('TerrainMesh');
    if (!mesh) {
      let material;
      // Prefer Lambert (simpler diffuse) unless explicitly overridden to Standard via flag.
      const forceStandard = typeof window !== 'undefined' && window.__TT_TERRAIN_STANDARD__;
      try {
        if (!forceStandard && threeNs?.MeshLambertMaterial) {
          material = new threeNs.MeshLambertMaterial({ vertexColors: true });
        } else if (threeNs?.MeshStandardMaterial) {
          material = new threeNs.MeshStandardMaterial({
            vertexColors: true,
            flatShading: false,
            roughness: 0.92,
            metalness: 0.0,
          });
        }
      } catch (_) {
        /* fallback below */
      }
      if (!material) {
        material = new (threeNs?.MeshBasicMaterial || function Dummy() {})({ vertexColors: true });
      }
      try {
        if (geo.getAttribute('color') && material && material.isMaterial) {
          material.vertexColors = true;
        }
        if (material && material.isMaterial && threeNs?.DoubleSide) {
          material.side = threeNs.DoubleSide;
        }
      } catch (_) {
        /* ignore */
      }
      mesh = new threeNs.Mesh(geo, material);
      mesh.name = 'TerrainMesh';
      mesh.position.set(0, 0, 0);
      // Enable ground to receive shadows from directional light (flora, tokens)
      try {
        mesh.receiveShadow = true;
      } catch (_) {
        /* ignore shadow flag set failure */
      }
      scene.add(mesh);
    } else {
      mesh.geometry.dispose();
      mesh.geometry = geo;
      try {
        // If current material is Basic, upgrade to Standard once for lighting.
        if (
          threeNs?.MeshLambertMaterial &&
          !forceStandard &&
          (!mesh.material ||
            mesh.material.isMeshBasicMaterial ||
            mesh.material.isMeshStandardMaterial)
        ) {
          try {
            mesh.material.dispose?.();
          } catch (_) {
            /* ignore */
          }
          try {
            mesh.material = new threeNs.MeshLambertMaterial({ vertexColors: true });
          } catch (_) {
            /* ignore */
          }
        } else if (
          forceStandard &&
          threeNs?.MeshStandardMaterial &&
          (!mesh.material ||
            mesh.material.isMeshBasicMaterial ||
            mesh.material.isMeshLambertMaterial)
        ) {
          try {
            mesh.material.dispose?.();
          } catch (_) {
            /* ignore */
          }
          try {
            mesh.material = new threeNs.MeshStandardMaterial({
              vertexColors: true,
              flatShading: false,
              roughness: 0.92,
              metalness: 0.0,
            });
          } catch (_) {
            mesh.material = new threeNs.MeshBasicMaterial({ vertexColors: true });
          }
        }
      } catch (_) {
        /* ignore material swap */
      }
      try {
        if (geo.getAttribute('color') && mesh.material) {
          mesh.material.vertexColors = true;
          if (threeNs?.DoubleSide) mesh.material.side = threeNs.DoubleSide;
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
      const currentOpacity = Number.isFinite(gm?.threeSceneManager?._terrainMeshOpacity)
        ? gm.threeSceneManager._terrainMeshOpacity
        : 1;
      gm?.threeSceneManager?.setTerrainMeshOpacity?.(currentOpacity);
    } catch (_) {
      /* ignore opacity sync */
    }
    try {
      gm?.threeSceneManager?.syncGridOverlayToTerrain?.();
    } catch (_) {
      /* ignore grid overlay sync */
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
