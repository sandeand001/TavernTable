// PickingService.js
// Centralized raycast + screen->grid mapping for hybrid 3D mode.
// Design goals:
//  - Single allocation of Raycaster + temp vectors
//  - Graceful no-op if Three unavailable or scene/camera not initialized
//  - Terrain hits are authoritative; bounded plane fallback only before the mesh exists

import { GameErrors } from '../../utils/error/ErrorHandler.js';

export class PickingService {
  // ── Constructor ───────────────────────────────────────────────────

  constructor({ gameManager } = {}) {
    this.gameManager = gameManager;
    this._three = gameManager?.threeSceneManager?.three || null;
    this._raycaster = null;
    this._v2 = null;
    this._hitPoint = null;
    this._plane = null; // ground plane
    this._tmpNormal = null;
    this._normalMatrix = null;
    this._layers = [];
    this._metrics = { raycasts: 0, lastMs: 0 };
    this._terrainIntersections = [];
  }

  // ── Three.js Initialization ──────────────────────────────────────

  async _ensureThree() {
    if (this._three) return this._three;
    const existing = this.gameManager?.threeSceneManager?.three;
    if (existing) {
      this._three = existing;
      return existing;
    }
    try {
      const mod = await import('three');
      const resolved = mod?.default || mod;
      this._three = resolved;
      return resolved;
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
      try {
        this._tmpNormal = new three.Vector3();
      } catch (_) {
        this._tmpNormal = null;
      }
      try {
        if (typeof three.Matrix3 === 'function') {
          this._normalMatrix = new three.Matrix3();
        } else {
          this._normalMatrix = null;
        }
      } catch (_) {
        this._normalMatrix = null;
      }
    }
    return !!this._raycaster && !!this._v2 && !!this._hitPoint && !!this._plane;
  }

  // ── Core Picking Logic ───────────────────────────────────────────

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
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY))
      throw new Error('Picking requires finite pointer coordinates');

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width ? canvas.width / rect.width : 1;
    const scaleY = canvas.height ? canvas.height / rect.height : 1;
    const width = canvas.width || rect.width || 0;
    const height = canvas.height || rect.height || 0;
    if (!width || !height) return null;

    const canvasX = (clientX - rect.left) * scaleX;
    const canvasY = (clientY - rect.top) * scaleY;
    if (canvasX < 0 || canvasY < 0 || canvasX > width || canvasY > height) return null;

    const ndcX = (canvasX / width) * 2 - 1;
    const ndcY = -(canvasY / height) * 2 + 1;
    this._v2.set(ndcX, ndcY);
    this._raycaster.setFromCamera(this._v2, cam);

    let worldX;
    let worldY;
    let worldZ;
    let usedTerrainMesh = false;
    let surface = null;
    let terrainDistance = Infinity;
    const tileSize = gm?.spatial?.tileWorldSize || 1;
    const safeTileSize = tileSize > 0 ? tileSize : 1;
    const terrainMesh = gm.threeSceneManager?.scene?.getObjectByName?.('TerrainMesh') || null;

    if (terrainMesh && terrainMesh.visible !== false) {
      this._terrainIntersections.length = 0;
      this._raycaster.intersectObject(terrainMesh, true, this._terrainIntersections);
      if (this._terrainIntersections.length) {
        const firstHit = this._terrainIntersections[0];
        if (firstHit?.point) {
          terrainDistance = Number.isFinite(firstHit.distance) ? firstHit.distance : Infinity;
          this._hitPoint.copy(firstHit.point);
          worldX = this._hitPoint.x;
          worldY = this._hitPoint.y;
          worldZ = this._hitPoint.z;
          const wallNormal = this._extractWorldFaceNormal(firstHit);
          if (wallNormal && Math.abs(wallNormal.y) < 0.45) {
            const sideHeight = (direction) => {
              const offset = safeTileSize * 1e-4 * direction;
              const grid = gm.spatial?.worldToGrid?.(
                worldX + wallNormal.x * offset,
                worldZ + wallNormal.z * offset
              );
              return grid ? gm.getTerrainHeight?.(grid.gridX, grid.gridY) : undefined;
            };
            const outwardHeight = sideHeight(1);
            const inwardHeight = sideHeight(-1);
            // Heightfield walls can have inward triangle winding; topology defines the solid side.
            if (
              Number.isFinite(outwardHeight) &&
              Number.isFinite(inwardHeight) &&
              outwardHeight > inwardHeight
            )
              wallNormal.negate();
            surface = {
              kind: 'wall',
              point: { x: worldX, y: worldY, z: worldZ },
              normal: { x: wallNormal.x, y: wallNormal.y, z: wallNormal.z },
            };
            const insetRaw = tileSize * 0.1;
            const inset = Math.min(Math.max(insetRaw, 0.01), tileSize * 0.25);
            worldX -= wallNormal.x * inset;
            worldZ -= wallNormal.z * inset;
          }
          usedTerrainMesh = true;
        }
      }
      this._terrainIntersections.length = 0;
    }

    const adapter = gm?.token3DAdapter;
    let tokenResult = adapter?.pickTokenByRay
      ? surface || !usedTerrainMesh
        ? adapter.pickTokenByRay(this._raycaster, { precise: true })
        : adapter.pickTokenByRay(this._raycaster)
      : null;
    if (surface && tokenResult?.distance > terrainDistance + tileSize * 1e-4) tokenResult = null;
    const tokenOnlyPick = () => {
      if (!tokenResult?.token) return null;
      const token = tokenResult.token;
      const point = tokenResult.point || token.world;
      if (!point || ![point.x, point.y, point.z].every(Number.isFinite))
        throw new Error('A picked creature requires a valid hit position');
      const hasGrid =
        Number.isInteger(token.gridX) &&
        Number.isInteger(token.gridY) &&
        token.gridX >= 0 &&
        token.gridY >= 0 &&
        token.gridX < gm.cols &&
        token.gridY < gm.rows;
      return {
        world: { x: point.x, y: point.y, z: point.z },
        grid: hasGrid ? { gx: token.gridX, gy: token.gridY } : null,
        token,
        tokenHitPoint: tokenResult.point || null,
        tokenDistance: Number.isFinite(tokenResult.distance) ? tokenResult.distance : null,
        metrics: { raycasts: this._metrics.raycasts },
      };
    };
    // A rendered board miss is background, not a hit on an infinite fallback plane.
    if (terrainMesh && !usedTerrainMesh) return tokenOnlyPick();

    if (!usedTerrainMesh) {
      if (!this._raycaster.ray.intersectPlane(this._plane, this._hitPoint)) return tokenOnlyPick();
      worldX = this._hitPoint.x;
      worldY = this._hitPoint.y;
      worldZ = this._hitPoint.z;
    }

    const clampIndex = (value, maxInclusive) => Math.min(Math.max(value, 0), maxInclusive);

    const maxCols = Number.isFinite(gm?.cols) ? gm.cols - 1 : null;
    const maxRows = Number.isFinite(gm?.rows) ? gm.rows - 1 : null;
    if (!Number.isInteger(maxCols) || maxCols < 0 || !Number.isInteger(maxRows) || maxRows < 0)
      return tokenOnlyPick();
    const computeGridFromWorld = () => {
      const base = gm.spatial?.worldToGrid
        ? gm.spatial.worldToGrid(worldX, worldZ)
        : { gridX: Math.floor(worldX / safeTileSize), gridY: Math.floor(worldZ / safeTileSize) };
      if (!base || !Number.isFinite(base.gridX) || !Number.isFinite(base.gridY))
        throw new Error('Picking could not map the hit to valid grid coordinates');
      const gx = base.gridX;
      const gy = base.gridY;
      return {
        // A real hit exactly on an outer mesh edge belongs to its adjacent tile.
        gridX: usedTerrainMesh ? clampIndex(gx, maxCols) : gx,
        gridY: usedTerrainMesh ? clampIndex(gy, maxRows) : gy,
      };
    };
    const isWithinBoard = (cell) =>
      Number.isInteger(cell.gridX) &&
      Number.isInteger(cell.gridY) &&
      cell.gridX >= 0 &&
      cell.gridY >= 0 &&
      cell.gridX <= maxCols &&
      cell.gridY <= maxRows;

    let grid = computeGridFromWorld();
    if (!isWithinBoard(grid)) return tokenOnlyPick();

    if (!usedTerrainMesh) {
      const elevationLevels = gm.getTerrainHeight?.(grid.gridX, grid.gridY);
      const elevationUnit = gm?.spatial?.elevationUnit || 0;
      if (Number.isFinite(elevationLevels) && Number.isFinite(elevationUnit) && this._plane) {
        const targetWorldY = elevationLevels * elevationUnit;
        if (Math.abs(targetWorldY - worldY) > 1e-5) {
          const originalConstant = this._plane.constant;
          try {
            this._plane.constant = -targetWorldY;
            if (!this._raycaster.ray.intersectPlane(this._plane, this._hitPoint))
              return tokenOnlyPick();
            worldX = this._hitPoint.x;
            worldY = this._hitPoint.y;
            worldZ = this._hitPoint.z;
            grid = computeGridFromWorld();
          } finally {
            this._plane.constant = originalConstant;
          }
        }
      }
      if (!isWithinBoard(grid)) return tokenOnlyPick();
    }

    return {
      world: { x: worldX, y: worldY, z: worldZ },
      grid: { gx: grid.gridX, gy: grid.gridY },
      token: tokenResult?.token || null,
      tokenHitPoint: tokenResult?.point || null,
      tokenDistance: Number.isFinite(tokenResult?.distance) ? tokenResult.distance : null,
      ...(surface ? { surface } : {}),
      metrics: { raycasts: this._metrics.raycasts },
    };
  }

  // ── Metrics ───────────────────────────────────────────────────────

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

  // ── Public API ────────────────────────────────────────────────────

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
    } catch (error) {
      GameErrors.input(error, {
        component: 'PickingService',
        operation: 'pickGround',
        clientX,
        clientY,
      });
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
    } catch (error) {
      GameErrors.input(error, {
        component: 'PickingService',
        operation: 'pickGroundSync',
        clientX,
        clientY,
      });
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

  // ── Internal Helpers ──────────────────────────────────────────

  _extractWorldFaceNormal(intersection) {
    try {
      const base = intersection?.face?.normal;
      if (!base || !this._tmpNormal) return null;
      const normal = this._tmpNormal.copy(base);
      const object = intersection.object;
      if (object?.matrixWorld && this._normalMatrix) {
        this._normalMatrix.getNormalMatrix(object.matrixWorld);
        normal.applyMatrix3(this._normalMatrix).normalize();
      } else {
        normal.normalize();
      }
      return normal;
    } catch (_) {
      return null;
    }
  }
}
