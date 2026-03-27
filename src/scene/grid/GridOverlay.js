// GridOverlay.js — Grid overlay, brush preview, style stack, visibility toggles.
// Extracted from ThreeSceneManager.js (Phase 6). Installed via mixin pattern.

import { GRID_CONFIG } from '../../config/GameConstants.js';
import { TerrainBrushOverlay3D } from '../terrain/TerrainBrushOverlay3D.js';

// ── Grid Rebuild ───────────────────────────────────────────────────

function _rebuildGridOverlay(metrics = null, options = {}) {
  if (!this.scene || !this.three) return;
  const { force = false } = options;
  const three = this.three;
  const data = metrics || this._getBoardMetrics();
  if (!data) return;

  const { cols, rows, tileSize } = data;
  const key = `${cols}x${rows}x${tileSize}`;
  if (!force && this._gridOverlayGroup && this._gridOverlayKey === key) {
    this._gridOverlayGroup.visible = !!this.showBootstrapGrid;
    return;
  }

  if (!this._gridOverlayGroup) {
    this._gridOverlayGroup = new three.Group();
    this._gridOverlayGroup.name = 'BootstrapGridPlane';
    this.scene.add(this._gridOverlayGroup);
  }

  try {
    while (this._gridOverlayGroup.children.length) {
      const child = this._gridOverlayGroup.children.pop();
      try {
        child?.geometry?.dispose?.();
      } catch (_) {
        /* ignore */
      }
      try {
        if (Array.isArray(child?.material)) {
          for (const mat of child.material) mat?.dispose?.();
        } else {
          child?.material?.dispose?.();
        }
      } catch (_) {
        /* ignore */
      }
    }
  } catch (_) {
    /* ignore */
  }

  this._gridOverlayGroup.visible = !!this.showBootstrapGrid;
  this._gridOverlayGroup.renderOrder = -5;
  this._gridOverlayGroup.position.set(0, 0, 0);

  const { heights: tileHeights, elevationUnit } = this._computeTileHeights(cols, rows);
  const tileCount = cols * rows;
  const unitAbs = Math.max(Math.abs(elevationUnit), 0.0001);
  const scaleUnit = Math.max(tileSize, unitAbs);
  const fillOffset = -scaleUnit * 0.01;
  const lineOffset = scaleUnit * 0.004;

  const activeStyle = this._gridOverlayStyle || this._gridOverlayBaseStyle;
  const fillColor =
    activeStyle.fillColor ?? this._gridOverlayBaseStyle.fillColor ?? GRID_CONFIG.TILE_COLOR;
  const fillAlphaRaw =
    typeof activeStyle.fillAlpha === 'number'
      ? activeStyle.fillAlpha
      : (this._gridOverlayBaseStyle.fillAlpha ?? GRID_CONFIG.TILE_FILL_ALPHA ?? 0.32);
  const borderColor =
    activeStyle.borderColor ??
    this._gridOverlayBaseStyle.borderColor ??
    GRID_CONFIG.TILE_BORDER_COLOR;
  const borderAlpha =
    typeof activeStyle.borderAlpha === 'number'
      ? activeStyle.borderAlpha
      : (this._gridOverlayBaseStyle.borderAlpha ?? GRID_CONFIG.TILE_BORDER_ALPHA);
  const fillAlpha = Math.max(0, Math.min(1, fillAlphaRaw));

  if (three.PlaneGeometry && three.MeshBasicMaterial) {
    try {
      const baseGeometry = new three.PlaneGeometry(tileSize, tileSize, 1, 1);
      baseGeometry.rotateX(-Math.PI / 2);

      const fillMaterial = new three.MeshBasicMaterial({
        color: fillColor,
        transparent: fillAlpha < 1,
        opacity: fillAlpha,
        depthWrite: false,
      });
      fillMaterial.depthTest = true;
      fillMaterial.toneMapped = false;

      if (three.InstancedMesh && three.Object3D) {
        const fillMesh = new three.InstancedMesh(baseGeometry, fillMaterial, tileCount);
        fillMesh.name = 'GridBaseFill';
        fillMesh.instanceMatrix.setUsage?.(three.DynamicDrawUsage || three.StreamDrawUsage);
        fillMesh.frustumCulled = false;
        fillMesh.renderOrder = -10;
        fillMesh.castShadow = false;
        fillMesh.receiveShadow = false;
        const dummy = new three.Object3D();
        let idx = 0;
        for (let gy = 0; gy < rows; gy += 1) {
          for (let gx = 0; gx < cols; gx += 1) {
            const tileIdx = gy * cols + gx;
            const baseHeight = tileHeights[tileIdx] || 0;
            dummy.position.set(
              (gx + 0.5) * tileSize,
              baseHeight + fillOffset,
              (gy + 0.5) * tileSize
            );
            dummy.rotation.set(0, 0, 0);
            dummy.scale.set(1, 1, 1);
            dummy.updateMatrix();
            fillMesh.setMatrixAt(idx, dummy.matrix);
            idx += 1;
          }
        }
        fillMesh.count = tileCount;
        fillMesh.instanceMatrix.needsUpdate = true;
        this._gridOverlayGroup.add(fillMesh);
      } else {
        for (let gy = 0; gy < rows; gy += 1) {
          for (let gx = 0; gx < cols; gx += 1) {
            const tileIdx = gy * cols + gx;
            const baseHeight = tileHeights[tileIdx] || 0;
            const mesh = new three.Mesh(baseGeometry.clone(), fillMaterial.clone());
            mesh.position.set(
              (gx + 0.5) * tileSize,
              baseHeight + fillOffset,
              (gy + 0.5) * tileSize
            );
            mesh.renderOrder = -10;
            mesh.frustumCulled = false;
            mesh.castShadow = false;
            mesh.receiveShadow = false;
            this._gridOverlayGroup.add(mesh);
          }
        }
      }
    } catch (_) {
      /* ignore base fill */
    }
  }

  if (three.BufferGeometry && three.LineSegments && three.LineBasicMaterial) {
    try {
      const segments = [];
      const pushSegment = (x1, y1, z1, x2, y2, z2) => {
        segments.push(x1, y1, z1, x2, y2, z2);
      };

      for (let gy = 0; gy < rows; gy += 1) {
        for (let gx = 0; gx < cols; gx += 1) {
          const baseIdx = gy * cols + gx;
          const baseHeight = tileHeights[baseIdx] || 0;
          const h = baseHeight + lineOffset;
          const x0 = gx * tileSize;
          const x1 = (gx + 1) * tileSize;
          const z0 = gy * tileSize;
          const z1 = (gy + 1) * tileSize;
          pushSegment(x0, h, z0, x1, h, z0);
          pushSegment(x1, h, z0, x1, h, z1);
          pushSegment(x1, h, z1, x0, h, z1);
          pushSegment(x0, h, z1, x0, h, z0);
        }
      }

      if (segments.length) {
        const lineGeometry = new three.BufferGeometry();
        const positionArray = new Float32Array(segments);
        if (three.Float32BufferAttribute) {
          lineGeometry.setAttribute('position', new three.Float32BufferAttribute(positionArray, 3));
        } else {
          lineGeometry.setAttribute('position', new three.BufferAttribute(positionArray, 3));
        }
        lineGeometry.computeBoundingSphere?.();

        const lineMaterial = new three.LineBasicMaterial({
          color: borderColor,
          transparent: true,
          opacity: borderAlpha,
        });
        lineMaterial.depthWrite = false;
        lineMaterial.depthTest = true;
        lineMaterial.toneMapped = false;
        lineMaterial.linewidth = 1;
        const gridLines = new three.LineSegments(lineGeometry, lineMaterial);
        gridLines.name = 'GridLineFrame';
        gridLines.position.set(0, 0, 0);
        gridLines.renderOrder = -2;
        gridLines.frustumCulled = false;
        this._gridOverlayGroup.add(gridLines);
      }
    } catch (_) {
      /* ignore grid line creation */
    }
  }

  this._gridOverlayKey = key;
}

// ── Brush Overlay ─────────────────────────────────────────────────

function _ensureBrushOverlay() {
  if (this.brushOverlay) return this.brushOverlay;
  if (!this.three || !this.scene) return null;
  try {
    const overlay = new TerrainBrushOverlay3D({
      three: this.three,
      scene: this.scene,
      gameManager: this.gameManager,
    });
    if (overlay?.isAvailable) {
      this.brushOverlay = overlay;
    } else {
      this.brushOverlay = null;
    }
  } catch (_) {
    this.brushOverlay = null;
  }
  return this.brushOverlay;
}

// ── Style Stack ───────────────────────────────────────────────────

function pushGridOverlayStyle(style = {}) {
  if (!style) return;
  this._gridOverlayStyleStack.push({ ...this._gridOverlayStyle });
  this._gridOverlayStyle = {
    ...this._gridOverlayStyle,
    ...this._normalizeGridOverlayStyle(style),
  };
  this._rebuildGridOverlay();
}

function popGridOverlayStyle() {
  if (this._gridOverlayStyleStack.length) {
    this._gridOverlayStyle = this._gridOverlayStyleStack.pop();
  } else {
    this._gridOverlayStyle = { ...this._gridOverlayBaseStyle };
  }
  this._rebuildGridOverlay();
}

// ── Terrain Brush Preview ──────────────────────────────────────────

function setTerrainBrushPreview(cells = [], style = {}) {
  if (!this.gameManager?.is3DModeActive?.()) {
    this.brushOverlay?.clear?.();
    return;
  }
  const overlay = this._ensureBrushOverlay();
  try {
    overlay?.setHighlight?.(cells, style);
  } catch (_) {
    /* ignore brush overlay errors */
  }
}

function clearTerrainBrushPreview() {
  try {
    this.brushOverlay?.clear?.();
  } catch (_) {
    /* ignore */
  }
}

// ── Terrain Mesh Opacity ───────────────────────────────────────────

function setTerrainMeshOpacity(opacity = 1) {
  const clamped = Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : 1;
  this._terrainMeshOpacity = clamped;
  let mesh = null;
  try {
    mesh = this.scene?.getObjectByName?.('TerrainMesh') || null;
  } catch (_) {
    mesh = null;
  }
  if (!mesh || !mesh.material) return;
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const mat of materials) {
    if (!mat) continue;
    if (typeof mat.opacity === 'number') mat.opacity = clamped;
    if ('transparent' in mat) mat.transparent = clamped < 0.999;
    if ('depthWrite' in mat) mat.depthWrite = clamped >= 0.999;
    if ('needsUpdate' in mat) mat.needsUpdate = true;
  }
}

// ── Grid Sync & Helpers ───────────────────────────────────────────

function syncGridOverlayToTerrain() {
  try {
    this._rebuildGridOverlay(null, { force: true });
  } catch (_) {
    /* ignore */
  }
}

function _normalizeGridOverlayStyle(style = {}) {
  const normalized = {};
  if (style.fillColor !== undefined) normalized.fillColor = style.fillColor;
  if (typeof style.fillAlpha === 'number') normalized.fillAlpha = style.fillAlpha;
  if (style.borderColor !== undefined) normalized.borderColor = style.borderColor;
  if (typeof style.borderAlpha === 'number') normalized.borderAlpha = style.borderAlpha;
  return normalized;
}

// ── Visibility Toggle ─────────────────────────────────────────────

function setBootstrapGridVisible(visible) {
  this.showBootstrapGrid = !!visible;
  if (typeof window !== 'undefined') {
    window.__TT_PENDING_BOOTSTRAP_GRID_VISIBLE = this.showBootstrapGrid;
    const listeners = window.__TT_GRID_VISIBILITY_LISTENERS__;
    if (Array.isArray(listeners)) {
      listeners.forEach((fn) => {
        try {
          fn(this.showBootstrapGrid);
        } catch (_) {
          /* ignore listener error */
        }
      });
    }
  }
  if (!this.scene) return;
  try {
    if (this._gridOverlayGroup) {
      this._gridOverlayGroup.visible = this.showBootstrapGrid;
    } else {
      const fallback = this.scene.getObjectByName('BootstrapGridPlane');
      if (fallback) fallback.visible = this.showBootstrapGrid;
    }
  } catch (_) {
    /* ignore */
  }
}

function setPixiGridVisible(visible) {
  try {
    const gc = this.gameManager?.gridContainer;
    if (!gc) return;
    const enabled = !!visible;
    gc.visible = enabled;
    if (typeof gc.renderable === 'boolean') gc.renderable = enabled;
    if ('interactiveChildren' in gc) gc.interactiveChildren = enabled;
    if ('alpha' in gc) gc.alpha = enabled ? 1 : 0;
  } catch (_) {
    /* ignore */
  }
}

export function installGridOverlayMethods(prototype) {
  prototype._rebuildGridOverlay = _rebuildGridOverlay;
  prototype._ensureBrushOverlay = _ensureBrushOverlay;
  prototype.pushGridOverlayStyle = pushGridOverlayStyle;
  prototype.popGridOverlayStyle = popGridOverlayStyle;
  prototype.setTerrainBrushPreview = setTerrainBrushPreview;
  prototype.clearTerrainBrushPreview = clearTerrainBrushPreview;
  prototype.setTerrainMeshOpacity = setTerrainMeshOpacity;
  prototype.syncGridOverlayToTerrain = syncGridOverlayToTerrain;
  prototype._normalizeGridOverlayStyle = _normalizeGridOverlayStyle;
  prototype.setBootstrapGridVisible = setBootstrapGridVisible;
  prototype.setPixiGridVisible = setPixiGridVisible;
}
