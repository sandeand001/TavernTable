// TerrainBrushOverlay3D.js
// Renders the terrain brush footprint directly in the Three.js scene so editing happens in the 3D grid.

const DEFAULT_BRUSH_COLOR = 0x22d3ee;

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
      this._color = new three.Color(DEFAULT_BRUSH_COLOR);
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
    }
  }

  clear() {
    if (!this.isAvailable) return;
    try {
      if (this._instanced) {
        this._instanced.count = 0;
        this._instanced.instanceMatrix.needsUpdate = true;
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
      const gx = cell?.x;
      const gy = cell?.y;
      if (!Number.isFinite(gx) || !Number.isFinite(gy)) continue;
      validCells.push({ gx, gy });
    }

    if (!validCells.length) {
      this.clear();
      return;
    }

    this._ensureCapacity(validCells.length);
    if (!this._instanced) return;

    const tileSize = this._getTileWorldSize();
    const elevationUnit = this._getElevationUnit();
    const hoverOffset = Math.max(Math.abs(elevationUnit) * 0.025, tileSize * 0.005, 0.012);

    const hex = typeof style.color === 'number' ? style.color : DEFAULT_BRUSH_COLOR;
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

    this._lineAlpha = lineAlpha;
    this._lineWidth = lineWidth;
    const wantsOutline = lineAlpha > 0.001;
    if (wantsOutline) {
      this._ensureOutlinePool(validCells.length, hex);
      this._syncOutlineStyle(hex, lineAlpha, lineWidth);
    }

    const dummy = this._dummy;
    if (!dummy) return;

    const gm = this.gameManager;
    const terrainCoordinator = gm?.terrainCoordinator;

    const drawnCells = [];
    let instanceIndex = 0;

    for (const entry of validCells) {
      const { gx, gy } = entry;
      const heightLevel =
        terrainCoordinator?.getTerrainHeight?.(gx, gy) ?? gm?.getTerrainHeight?.(gx, gy) ?? 0;
      const x = (gx + 0.5) * tileSize;
      const z = (gy + 0.5) * tileSize;
      const y = heightLevel * elevationUnit + hoverOffset;
      dummy.position.set(x, y, z);
      dummy.rotation.set(-Math.PI * 0.5, 0, 0);
      dummy.scale.set(tileSize, 1, tileSize);
      dummy.updateMatrix();
      this._instanced.setMatrixAt(instanceIndex, dummy.matrix);

      if (wantsOutline) {
        const outline = this._outlinePool[instanceIndex];
        if (outline) {
          outline.visible = true;
          outline.position.set(x, y + hoverOffset * 0.35, z);
          outline.scale.set(tileSize, 1, tileSize);
        }
      }

      drawnCells.push({
        gx,
        gy,
        centerX: x,
        centerZ: z,
        worldTop: y,
      });

      instanceIndex += 1;
    }

    this._instanced.count = instanceIndex;
    this._instanced.instanceMatrix.needsUpdate = true;

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

  _ensureCapacity(required) {
    if (!this.isAvailable) return;
    if (this._instanced && this._capacity >= required) {
      return;
    }

    const three = this.three;
    if (!three?.InstancedMesh || !three?.PlaneGeometry || !three?.MeshBasicMaterial) return;

    const newCapacity = Math.max(required, this._capacity > 0 ? this._capacity * 2 : 32);

    if (this._instanced) {
      try {
        this._group.remove(this._instanced);
        this._instanced.geometry?.dispose?.();
        this._instanced.material?.dispose?.();
      } catch (_) {
        /* ignore */
      }
    }

    const geometry = new three.PlaneGeometry(1, 1);
    geometry.rotateX(-Math.PI * 0.5);
    const material = new three.MeshBasicMaterial({
      color: this._color || new three.Color(DEFAULT_BRUSH_COLOR),
      transparent: true,
      opacity: this._currentOpacity,
      depthWrite: false,
      side: three.FrontSide,
    });
    material.toneMapped = false;
    material.depthTest = false;

    const instanced = new three.InstancedMesh(geometry, material, newCapacity);
    instanced.name = 'TerrainBrushOverlay3DMesh';
    instanced.instanceMatrix.setUsage?.(three.DynamicDrawUsage || three.StreamDrawUsage);
    instanced.frustumCulled = false;
    instanced.count = 0;

    this._group.add(instanced);
    this._instanced = instanced;
    this._capacity = newCapacity;
  }

  _ensureOutlinePool(required, baseColor) {
    if (!this.isAvailable || !this.three?.LineSegments) return;
    if (!Array.isArray(this._outlinePool)) this._outlinePool = [];

    const three = this.three;
    if (!this._outlineMaterial || !(this._outlineMaterial instanceof three.LineBasicMaterial)) {
      this._outlineMaterial = new three.LineBasicMaterial({
        color: baseColor ?? DEFAULT_BRUSH_COLOR,
        transparent: true,
        opacity: this._lineAlpha,
        linewidth: this._lineWidth,
      });
      this._outlineMaterial.toneMapped = false;
      this._outlineMaterial.depthWrite = false;
      this._outlineMaterial.depthTest = false;
    }

    while (this._outlinePool.length < required) {
      let geometry;
      if (three.EdgesGeometry && three.PlaneGeometry) {
        const plane = new three.PlaneGeometry(1, 1);
        plane.rotateX(-Math.PI * 0.5);
        geometry = new three.EdgesGeometry(plane);
        plane.dispose?.();
      }
      if (!geometry) {
        const fallbackPlane = new three.PlaneGeometry(1, 1);
        fallbackPlane.rotateX(-Math.PI * 0.5);
        if (three.EdgesGeometry) {
          geometry = new three.EdgesGeometry(fallbackPlane);
          fallbackPlane.dispose?.();
        } else {
          const manual = new three.BufferGeometry();
          const corners = [
            [-0.5, 0, -0.5],
            [0.5, 0, -0.5],
            [0.5, 0, 0.5],
            [-0.5, 0, 0.5],
          ];
          const pts = [];
          for (let i = 0; i < corners.length; i += 1) {
            const a = corners[i];
            const b = corners[(i + 1) % corners.length];
            pts.push(a[0], a[1], a[2], b[0], b[1], b[2]);
          }
          const arr = new Float32Array(pts);
          if (three.Float32BufferAttribute) {
            manual.setAttribute('position', new three.Float32BufferAttribute(arr, 3));
          } else {
            manual.setAttribute('position', new three.BufferAttribute(arr, 3));
          }
          geometry = manual;
          fallbackPlane.dispose?.();
        }
      }
      geometry.computeBoundingSphere?.();
      const line = new three.LineSegments(geometry, this._outlineMaterial);
      line.name = `TerrainBrushOutline_${this._outlinePool.length}`;
      line.visible = false;
      line.frustumCulled = false;
      line.renderOrder = 12;
      this._group.add(line);
      this._outlinePool.push(line);
    }
  }

  _syncOutlineStyle(colorHex, lineAlpha, lineWidth) {
    if (!this._outlineMaterial) return;
    try {
      this._outlineMaterial.color.set(colorHex ?? DEFAULT_BRUSH_COLOR);
      this._outlineMaterial.opacity = lineAlpha;
      if (Number.isFinite(lineWidth)) this._outlineMaterial.linewidth = lineWidth;
      this._outlineMaterial.needsUpdate = true;
    } catch (_) {
      /* ignore */
    }
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
