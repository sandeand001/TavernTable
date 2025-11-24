// TerrainBrushOverlay3D.js
// Renders the terrain brush footprint directly in the Three.js scene so editing happens in the 3D grid.

import { BRUSH_COLORS } from '../terrain/brush/BrushCommon.js';
import {
  ensurePlaneMesh,
  ensureBoxMesh,
  syncMeshMaterial,
} from './terrain-brush/OverlayMeshPool.js';
import {
  ensureOutlinePool,
  syncOutlineStyle,
} from './terrain-brush/OverlayOutlinePool.js';

export class TerrainBrushOverlay3D {
  constructor({ three, scene, gameManager } = {}) {
    this.three = three;
    this.scene = scene;
    this.gameManager = gameManager;
    this._group = null;
    this._instanced = null;
    this._capacity = 0;
    this._dummy = null;
    this._color = null;
    this._currentOpacity = 0.25;
    this._outlinePool = [];
    this._outlineMaterial = null;
    this._activeOutlineCount = 0;
    this._lineAlpha = 0.9;
    this._lineWidth = 2;
    this._wallMeshX = null;
    this._wallMeshZ = null;
    this._wallCapacityX = 0;
    this._wallCapacityZ = 0;
    this._wallOpacity = 0.32;
    this._fillMesh = null;
    this._fillCapacity = 0;
    this._fillOpacity = 0.28;

    try {
      if (!three || !scene || !three.Group || !three.InstancedMesh) {
        return;
      }
      this._group = new three.Group();
      this._group.name = 'TerrainBrushOverlay3D';
      this._group.visible = false;
      this._group.renderOrder = 10; // render above terrain mesh, below tokens/placeables
      scene.add(this._group);
      this._dummy = new three.Object3D();
      this._color = new three.Color(BRUSH_COLORS.preview);
    } catch (_) {
      // Fail gracefully – overlay not available but editing continues.
      this._group = null;
    }
  }

  get isAvailable() {
    return !!(this._group && this.three && this.scene);
  }

  dispose() {
    try {
      if (this._instanced && this._instanced.parent) {
        this._instanced.parent.remove(this._instanced);
      }
      if (this._instanced) {
        try {
          this._instanced.geometry?.dispose?.();
        } catch (_) {
          /* ignore */
        }
        try {
          this._instanced.material?.dispose?.();
        } catch (_) {
          /* ignore */
        }
      }
      if (this._wallMeshX) {
        try {
          if (this._wallMeshX.parent) {
            this._wallMeshX.parent.remove(this._wallMeshX);
          }
        } catch (_) {
          /* ignore */
        }
        try {
          this._wallMeshX.geometry?.dispose?.();
        } catch (_) {
          /* ignore */
        }
        try {
          this._wallMeshX.material?.dispose?.();
        } catch (_) {
          /* ignore */
        }
      }
      if (this._wallMeshZ) {
        try {
          if (this._wallMeshZ.parent) {
            this._wallMeshZ.parent.remove(this._wallMeshZ);
          }
        } catch (_) {
          /* ignore */
        }
        try {
          this._wallMeshZ.geometry?.dispose?.();
        } catch (_) {
          /* ignore */
        }
        try {
          this._wallMeshZ.material?.dispose?.();
        } catch (_) {
          /* ignore */
        }
      }
      if (this._fillMesh) {
        try {
          if (this._fillMesh.parent) {
            this._fillMesh.parent.remove(this._fillMesh);
          }
        } catch (_) {
          /* ignore */
        }
        try {
          this._fillMesh.geometry?.dispose?.();
        } catch (_) {
          /* ignore */
        }
        try {
          this._fillMesh.material?.dispose?.();
        } catch (_) {
          /* ignore */
        }
      }
      if (this._group && this._group.parent) {
        this._group.parent.remove(this._group);
      }
      if (Array.isArray(this._outlinePool)) {
        for (const line of this._outlinePool) {
          try {
            line?.geometry?.dispose?.();
          } catch (_) {
            /* ignore */
          }
          try {
            if (Array.isArray(line?.material)) {
              for (const mat of line.material) mat?.dispose?.();
            } else {
              line?.material?.dispose?.();
            }
          } catch (_) {
            /* ignore */
          }
        }
      }
      try {
        this._outlineMaterial?.dispose?.();
      } catch (_) {
        /* ignore */
      }
    } catch (_) {
      /* ignore */
    } finally {
      this._instanced = null;
      this._group = null;
      this._outlinePool = [];
      this._outlineMaterial = null;
      this._activeOutlineCount = 0;
      this._wallMeshX = null;
      this._wallMeshZ = null;
      this._wallCapacityX = 0;
      this._wallCapacityZ = 0;
      this._fillMesh = null;
      this._fillCapacity = 0;
    }
  }

  clear() {
    if (!this.isAvailable) return;
    try {
      if (this._instanced) {
        this._instanced.count = 0;
        this._instanced.instanceMatrix.needsUpdate = true;
      }
      if (this._wallMeshX) {
        this._wallMeshX.count = 0;
        this._wallMeshX.instanceMatrix.needsUpdate = true;
        this._wallMeshX.visible = false;
      }
      if (this._wallMeshZ) {
        this._wallMeshZ.count = 0;
        this._wallMeshZ.instanceMatrix.needsUpdate = true;
        this._wallMeshZ.visible = false;
      }
      if (this._fillMesh) {
        this._fillMesh.count = 0;
        this._fillMesh.instanceMatrix.needsUpdate = true;
        this._fillMesh.visible = false;
      }
      if (Array.isArray(this._outlinePool)) {
        for (const line of this._outlinePool) {
          if (line) line.visible = false;
        }
      }
      this._activeOutlineCount = 0;
      this._group.visible = false;
    } catch (_) {
      /* ignore */
    }
  }

  setHighlight(cells = [], style = {}) {
    if (!this.isAvailable) return;
    if (!Array.isArray(cells) || cells.length === 0) {
      this.clear();
      return;
    }

    const validCells = [];
    for (const cell of cells) {
      const gx = cell?.x ?? cell?.gridX;
      const gy = cell?.y ?? cell?.gridY;
      if (!Number.isFinite(gx) || !Number.isFinite(gy)) continue;
      const currentHeight = Number.isFinite(cell?.currentHeight) ? cell.currentHeight : null;
      const previewHeight = Number.isFinite(cell?.previewHeight) ? cell.previewHeight : null;
      validCells.push({ gx, gy, currentHeight, previewHeight });
    }

    if (!validCells.length) {
      this.clear();
      return;
    }
    const baseColorHex =
      typeof this._color?.getHex === 'function' ? this._color.getHex() : BRUSH_COLORS.preview;
    const planeResult = ensurePlaneMesh({
      three: this.three,
      group: this._group,
      mesh: this._instanced,
      capacity: this._capacity,
      required: validCells.length,
      colorHex: baseColorHex,
      opacity: this._currentOpacity,
    });
    this._instanced = planeResult.mesh;
    this._capacity = planeResult.capacity;
    if (!this._instanced) return;

    const selectedKeys = new Set();
    for (const entry of validCells) {
      selectedKeys.add(`${entry.gx},${entry.gy}`);
    }

    const wallEntriesX = [];
    const wallEntriesZ = [];
    const fillEntries = [];

    const tileSize = this._getTileWorldSize();
    const elevationUnit = this._getElevationUnit();
    const hoverOffset = Math.max(Math.abs(elevationUnit) * 0.025, tileSize * 0.005, 0.012);

    const hex = typeof style.color === 'number' ? style.color : BRUSH_COLORS.preview;
    const fillAlpha = typeof style.fillAlpha === 'number' ? style.fillAlpha : 0.12;
    const lineAlphaRaw = typeof style.lineAlpha === 'number' ? style.lineAlpha : 0.9;
    const lineAlpha = Math.max(0, Math.min(1, lineAlphaRaw));
    const lineWidth = typeof style.lineWidth === 'number' ? style.lineWidth : 2;

    const material = this._instanced.material;
    try {
      if (material && material.color) {
        this._color.set(hex);
        material.color.copy(this._color);
      }
      if (material) {
        material.opacity = fillAlpha;
        material.transparent = material.opacity < 1;
        material.needsUpdate = material.opacity !== this._currentOpacity;
      }
      this._currentOpacity = fillAlpha;
    } catch (_) {
      /* ignore */
    }

    const wallAlphaRaw = typeof style.wallAlpha === 'number' ? style.wallAlpha : this._wallOpacity;
    const wallOpacity = Math.max(0, Math.min(1, wallAlphaRaw));
    this._wallOpacity = wallOpacity;
    const fillAlphaRaw =
      typeof style.volumeAlpha === 'number' ? style.volumeAlpha : this._fillOpacity;
    const fillOpacity = Math.max(0, Math.min(1, fillAlphaRaw));
    this._fillOpacity = fillOpacity;

    this._lineAlpha = lineAlpha;
    this._lineWidth = lineWidth;
    const wantsOutline = lineAlpha > 0.001;
    if (wantsOutline) {
      const outlineResult = ensureOutlinePool({
        three: this.three,
        group: this._group,
        pool: this._outlinePool,
        material: this._outlineMaterial,
        required: validCells.length,
        baseColor: hex,
        lineAlpha,
        lineWidth,
      });
      this._outlinePool = outlineResult.pool;
      this._outlineMaterial = outlineResult.material;
      syncOutlineStyle(this._outlineMaterial, hex, lineAlpha, lineWidth);
    }

    const dummy = this._dummy;
    if (!dummy) return;

    const gm = this.gameManager;
    const terrainCoordinator = gm?.terrainCoordinator;

    const drawnCells = [];
    let instanceIndex = 0;

    for (const entry of validCells) {
      const { gx, gy, currentHeight, previewHeight } = entry;
      const baseHeight = Number.isFinite(currentHeight)
        ? currentHeight
        : (terrainCoordinator?.getTerrainHeight?.(gx, gy) ?? gm?.getTerrainHeight?.(gx, gy) ?? 0);
      const targetHeight = Number.isFinite(previewHeight) ? previewHeight : baseHeight;
      const baseWorld = baseHeight * elevationUnit;
      const previewWorld = targetHeight * elevationUnit;
      const deltaLevels = targetHeight - baseHeight;
      const deltaWorld = deltaLevels * elevationUnit;
      const x = (gx + 0.5) * tileSize;
      const z = (gy + 0.5) * tileSize;
      const worldTop = previewWorld + hoverOffset;
      dummy.position.set(x, worldTop, z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(tileSize, 1, tileSize);
      dummy.updateMatrix();
      this._instanced.setMatrixAt(instanceIndex, dummy.matrix);

      if (wantsOutline) {
        const outline = this._outlinePool[instanceIndex];
        if (outline) {
          outline.visible = true;
          outline.position.set(x, worldTop + hoverOffset * 0.35, z);
          outline.scale.set(tileSize, 1, tileSize);
        }
      }

      drawnCells.push({
        gx,
        gy,
        centerX: x,
        centerZ: z,
        worldTop,
        baseWorld,
        previewWorld,
        deltaWorld,
      });

      if (deltaWorld > 1e-6) {
        const topWorld = worldTop;
        const bottomWorld = baseWorld;
        const height = Math.max(Math.abs(topWorld - bottomWorld), hoverOffset * 0.25);
        const centerY = (topWorld + bottomWorld) * 0.5;
        fillEntries.push({
          position: { x, y: centerY, z },
          scale: { x: tileSize, y: height, z: tileSize },
        });
      }

      instanceIndex += 1;
    }

    this._instanced.count = instanceIndex;
    this._instanced.instanceMatrix.needsUpdate = true;

    if (fillEntries.length > 0) {
      const fillResult = ensureBoxMesh({
        three: this.three,
        group: this._group,
        mesh: this._fillMesh,
        capacity: this._fillCapacity,
        required: fillEntries.length,
        colorHex: hex,
        opacity: fillOpacity,
        name: 'TerrainBrushOverlay3DFill',
        renderOrder: 10,
      });
      this._fillMesh = fillResult.mesh;
      this._fillCapacity = fillResult.capacity;
    }

    if (this._fillMesh) {
      if (fillEntries.length > 0) {
        syncMeshMaterial(this._fillMesh, hex, fillOpacity);
        let fillIndex = 0;
        for (const entry of fillEntries) {
          dummy.position.set(entry.position.x, entry.position.y, entry.position.z);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(entry.scale.x, entry.scale.y, entry.scale.z);
          dummy.updateMatrix();
          this._fillMesh.setMatrixAt(fillIndex, dummy.matrix);
          fillIndex += 1;
        }
        this._fillMesh.count = fillIndex;
        this._fillMesh.instanceMatrix.needsUpdate = true;
        this._fillMesh.visible = true;
      } else {
        this._fillMesh.count = 0;
        this._fillMesh.visible = false;
        this._fillMesh.instanceMatrix.needsUpdate = true;
      }
    }

    const halfTile = tileSize * 0.5;
    const wallThickness = Math.min(tileSize * 0.25, Math.max(tileSize * 0.08, hoverOffset * 6));
    const edgeOffset = Math.max(halfTile - wallThickness * 0.5, tileSize * 0.02);

    const neighborOffsets = [
      { dx: 0, dy: -1, axis: 'x', dir: -1 },
      { dx: 0, dy: 1, axis: 'x', dir: 1 },
      { dx: -1, dy: 0, axis: 'z', dir: -1 },
      { dx: 1, dy: 0, axis: 'z', dir: 1 },
    ];

    for (const cell of drawnCells) {
      if (Math.abs(cell.deltaWorld) <= 1e-6) continue;

      const planeHeight = cell.previewWorld + hoverOffset;
      const paddedBase = cell.baseWorld + hoverOffset * 0.2;
      const isRaise = cell.deltaWorld >= 0;
      const topWorld = isRaise ? planeHeight : paddedBase;
      const bottomWorld = isRaise ? cell.baseWorld : planeHeight;
      const height = Math.abs(topWorld - bottomWorld);
      if (height <= 1e-6) continue;
      const centerY = (topWorld + bottomWorld) * 0.5;

      for (const edge of neighborOffsets) {
        const neighborKey = `${cell.gx + edge.dx},${cell.gy + edge.dy}`;
        if (selectedKeys.has(neighborKey)) continue;

        if (edge.axis === 'x') {
          wallEntriesX.push({
            position: {
              x: cell.centerX,
              y: centerY,
              z: cell.centerZ + edge.dir * edgeOffset,
            },
            scale: {
              x: tileSize,
              y: height,
              z: wallThickness,
            },
          });
        } else {
          wallEntriesZ.push({
            position: {
              x: cell.centerX + edge.dir * edgeOffset,
              y: centerY,
              z: cell.centerZ,
            },
            scale: {
              x: wallThickness,
              y: height,
              z: tileSize,
            },
          });
        }
      }
    }

    if (wallEntriesX.length > 0) {
      const wallXResult = ensureBoxMesh({
        three: this.three,
        group: this._group,
        mesh: this._wallMeshX,
        capacity: this._wallCapacityX,
        required: wallEntriesX.length,
        colorHex: hex,
        opacity: wallOpacity,
        name: 'TerrainBrushOverlay3DWallX',
        renderOrder: 11,
      });
      this._wallMeshX = wallXResult.mesh;
      this._wallCapacityX = wallXResult.capacity;
    }
    if (wallEntriesZ.length > 0) {
      const wallZResult = ensureBoxMesh({
        three: this.three,
        group: this._group,
        mesh: this._wallMeshZ,
        capacity: this._wallCapacityZ,
        required: wallEntriesZ.length,
        colorHex: hex,
        opacity: wallOpacity,
        name: 'TerrainBrushOverlay3DWallZ',
        renderOrder: 11,
      });
      this._wallMeshZ = wallZResult.mesh;
      this._wallCapacityZ = wallZResult.capacity;
    }

    if (this._wallMeshX) {
      if (wallEntriesX.length > 0) {
        syncMeshMaterial(this._wallMeshX, hex, wallOpacity);
        let wallIndex = 0;
        for (const entry of wallEntriesX) {
          dummy.position.set(entry.position.x, entry.position.y, entry.position.z);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(entry.scale.x, entry.scale.y, entry.scale.z);
          dummy.updateMatrix();
          this._wallMeshX.setMatrixAt(wallIndex, dummy.matrix);
          wallIndex += 1;
        }
        this._wallMeshX.count = wallIndex;
        this._wallMeshX.instanceMatrix.needsUpdate = true;
        this._wallMeshX.visible = true;
      } else {
        this._wallMeshX.count = 0;
        this._wallMeshX.visible = false;
        this._wallMeshX.instanceMatrix.needsUpdate = true;
      }
    }

    if (this._wallMeshZ) {
      if (wallEntriesZ.length > 0) {
        syncMeshMaterial(this._wallMeshZ, hex, wallOpacity);
        let wallIndex = 0;
        for (const entry of wallEntriesZ) {
          dummy.position.set(entry.position.x, entry.position.y, entry.position.z);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(entry.scale.x, entry.scale.y, entry.scale.z);
          dummy.updateMatrix();
          this._wallMeshZ.setMatrixAt(wallIndex, dummy.matrix);
          wallIndex += 1;
        }
        this._wallMeshZ.count = wallIndex;
        this._wallMeshZ.instanceMatrix.needsUpdate = true;
        this._wallMeshZ.visible = true;
      } else {
        this._wallMeshZ.count = 0;
        this._wallMeshZ.visible = false;
        this._wallMeshZ.instanceMatrix.needsUpdate = true;
      }
    }

    if (wantsOutline) {
      this._activeOutlineCount = instanceIndex;
      for (let idx = instanceIndex; idx < this._outlinePool.length; idx += 1) {
        const line = this._outlinePool[idx];
        if (line) line.visible = false;
      }
    } else if (this._activeOutlineCount) {
      for (const line of this._outlinePool) {
        if (line) line.visible = false;
      }
      this._activeOutlineCount = 0;
    }

    this._group.visible = true;
  }

  _getTileWorldSize() {
    const gm = this.gameManager;
    const fallback = 1;
    try {
      return gm?.spatial?.tileWorldSize || fallback;
    } catch (_) {
      return fallback;
    }
  }

  _getElevationUnit() {
    const gm = this.gameManager;
    const fallback = 0.5;
    try {
      return gm?.spatial?.elevationUnit || fallback;
    } catch (_) {
      return fallback;
    }
  }
}

export default TerrainBrushOverlay3D;
