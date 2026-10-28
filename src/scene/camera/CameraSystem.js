// CameraSystem.js — Isometric mode, zoom, pitch, frustum, reframe, calibration.
// Extracted from ThreeSceneManager.js (Phase 6). Installed via mixin pattern.

import { GameErrors } from '../../utils/error/ErrorHandler.js';

const PERSPECTIVE_FOV = 35;
const TOP_DOWN_PITCH = (89.9 * Math.PI) / 180;

function _getCameraViewport() {
  const canvas = this.canvas || this.renderer?.domElement;
  const container = canvas?.parentElement;
  const rect = canvas?.getBoundingClientRect?.();
  const width = container?.clientWidth || rect?.width || canvas?.width || 800;
  const height = container?.clientHeight || rect?.height || canvas?.height || 600;
  return { width, height, aspect: width / height };
}

function getCameraTarget() {
  const tileSize = this.gameManager?.spatial?.tileWorldSize || 1;
  return {
    x: Number.isFinite(this._panCx) ? this._panCx : ((this.gameManager?.cols || 25) * tileSize) / 2,
    y: Number.isFinite(this._panCy) ? this._panCy : 0,
    z: Number.isFinite(this._panCz) ? this._panCz : ((this.gameManager?.rows || 25) * tileSize) / 2,
  };
}

function _getCameraFraming() {
  const tileSize = this.gameManager?.spatial?.tileWorldSize || 1;
  const width = (this.gameManager?.cols || 25) * tileSize;
  const depth = (this.gameManager?.rows || 25) * tileSize;
  const halfDiag = Math.hypot(width, depth) / 2;
  return {
    width,
    depth,
    halfDiag,
    halfHeight: this._isoMode ? halfDiag * 1.05 : Math.max(width, depth) * 0.5 * 1.08,
    aspect: this._getCameraViewport().aspect,
    zoom: this._zoom > 0 ? this._zoom : 1,
  };
}

function _ensureCameraProjection() {
  if (this.camera?.isOrthographicCamera) this._orthographicCamera ||= this.camera;
  if (this.camera?.isPerspectiveCamera) this._perspectiveCamera ||= this.camera;
  const useOrthographic = this._topDownView === true;
  const currentMatches = useOrthographic
    ? this.camera?.isOrthographicCamera
    : this.camera?.isPerspectiveCamera;
  if (currentMatches) return this.camera;

  const previous = this.camera;
  let next;
  if (useOrthographic) {
    this._orthographicCamera ||= new this.three.OrthographicCamera(-1, 1, 1, -1, -100, 2000);
    next = this._orthographicCamera;
  } else {
    this._perspectiveCamera ||= new this.three.PerspectiveCamera(
      PERSPECTIVE_FOV,
      this._getCameraViewport().aspect,
      0.1,
      2000
    );
    next = this._perspectiveCamera;
  }
  if (previous?.up) next.up.copy(previous.up);
  if (previous?.layers) next.layers.mask = previous.layers.mask;
  this.camera = next;
  return next;
}

function _getPerspectiveRadius(isoPitch, isoYaw) {
  const { width, depth, halfHeight, aspect, zoom } = this._getCameraFraming();
  const tangent = Math.tan((PERSPECTIVE_FOV * Math.PI) / 360);
  const forward = {
    x: -Math.cos(isoPitch) * Math.cos(isoYaw),
    z: -Math.cos(isoPitch) * Math.sin(isoYaw),
  };
  let distance = halfHeight / tangent;
  for (const x of [-width / 2, width / 2]) {
    for (const z of [-depth / 2, depth / 2]) {
      const viewDepth = x * forward.x + z * forward.z;
      const right = x * Math.sin(isoYaw) - z * Math.cos(isoYaw);
      const up = -Math.sin(isoPitch) * (x * Math.cos(isoYaw) + z * Math.sin(isoYaw));
      distance = Math.max(
        distance,
        Math.abs(right) / (tangent * aspect * 0.94) - viewDepth,
        Math.abs(up) / (tangent * 0.94) - viewDepth
      );
    }
  }
  return distance / zoom;
}

function setTopDownView(enabled) {
  const next = !!enabled;
  const matchesLens = next ? this.camera?.isOrthographicCamera : this.camera?.isPerspectiveCamera;
  if (this._topDownView === next && matchesLens) return;
  if (next && !this._topDownView) {
    this._savedOrbitView = {
      yaw: this._isoYaw,
      pitch: this._isoPitch,
      manualLock: this._isoManualLock,
    };
  } else if (!next && this._topDownView && this._savedOrbitView) {
    this._isoYaw = this._savedOrbitView.yaw;
    this._isoPitch = this._savedOrbitView.pitch;
    this._isoManualLock = this._savedOrbitView.manualLock;
    this._savedOrbitView = null;
  }
  this._topDownView = next;
  if (next) {
    this._isoPitch = TOP_DOWN_PITCH;
    this._isoManualLock = true;
  }
  if (!this.camera?.isCamera || this.degraded) return;
  this.reframe();
}

function _screenToGround(x, y) {
  if (!this.camera?.isCamera || !this.three) return null;
  const { width, height } = this._getCameraViewport();
  this.camera.updateMatrixWorld(true);
  this._cameraRaycaster ||= new this.three.Raycaster();
  this._cameraNdc ||= new this.three.Vector2();
  this._cameraGroundPlane ||= new this.three.Plane(new this.three.Vector3(0, 1, 0), 0);
  this._cameraGroundPlane.constant = -this.getCameraTarget().y;
  this._cameraNdc.set((x / width) * 2 - 1, 1 - (y / height) * 2);
  this._cameraRaycaster.setFromCamera(this._cameraNdc, this.camera);
  return this._cameraRaycaster.ray.intersectPlane(
    this._cameraGroundPlane,
    new this.three.Vector3()
  );
}

// ── Isometric / Pitch Mode ─────────────────────────────────────────

function setIsometricMode(enabled = true) {
  this._isoMode = !!enabled;
  if (!this.camera) return;
  if (this._isoMode && !this._topDownView) {
    // Apply preset pitch before first reframe
    try {
      if (!this._isoManualLock) {
        if (
          !(typeof window !== 'undefined' && window.__TT_DISABLE_ISO_PRESET_PITCH__) &&
          Number.isFinite(this._isoPresetPitchDeg)
        ) {
          const preset =
            (typeof window !== 'undefined' && window.__TT_ISO_PRESET_PITCH_DEG) ||
            this._isoPresetPitchDeg;
          this._isoPitch = (preset * Math.PI) / 180;
        }
      }
    } catch (_) {
      /* ignore */
    }
    // Optional auto-calibration: derive target vertical:horizontal pixel step ratio from 2D tile aspect (tileHeight / tileWidth) and solve pitch.
    try {
      if (typeof window !== 'undefined' && !this._isoManualLock) {
        const auto = window.__TT_AUTO_ISO_CALIBRATE__;
        if (auto === true) {
          // now opt-in instead of implicit
          // Defer until next frame so renderer & frustum are stable.
          requestAnimationFrame(() => {
            try {
              const tw =
                this.gameManager?.tileWidth || this.gameManager?.spatial?.tileWorldSize || 64;
              const th = this.gameManager?.tileHeight || tw * 0.5;
              const targetRatio = th / tw; // e.g., 32/64 = 0.5 for classic 2:1 diamond
              // Use a slightly widened search window to compensate for board scale differences.
              this.solveIsoPitchForTargetRatio(targetRatio, {
                minDeg: 25,
                maxDeg: 40,
                iterations: 22,
              });
              if (window.__TT_PITCH_DEBUG__) {
                window.__TT_PITCH_DEBUG__.autoCalibratedFor = { targetRatio, tw, th };
              }
            } catch (e) {
              /* ignore auto-calibration failure */
            }
          });
        }
      }
    } catch (_) {
      /* ignore */
    }
    // Precise optional 2D tile aspect pitch matching (explicit opt-in via __TT_ISO_MATCH_2D__)
    try {
      if (
        typeof window !== 'undefined' &&
        window.__TT_ISO_MATCH_2D__ &&
        !this._isoManualLock &&
        this.gameManager?.tileWidth &&
        this.gameManager?.tileHeight
      ) {
        requestAnimationFrame(() => {
          try {
            this.calibrateTo2DTileAspect();
          } catch (_) {
            /* ignore */
          }
        });
      }
    } catch (_) {
      /* ignore */
    }
  }
  const cols = this.gameManager?.cols || 25;
  const rows = this.gameManager?.rows || 25;
  const span = Math.max(cols, rows) * 0.6;
  this._applyCameraBase({ cx: cols * 0.5, cz: rows * 0.5, span });
  this.reframe();
}

/** Adjust the isometric pitch (in degrees). Only applied when iso mode active. */
function setIsoPitchDegrees(deg) {
  if (!Number.isFinite(deg)) return;
  if (deg < 0) deg = 0; // permit true 0 from UI
  if (deg > 89.9) deg = 89.9; // avoid singularities at 90
  const rad = this._topDownView ? TOP_DOWN_PITCH : (deg * Math.PI) / 180;
  this._isoPitch = rad;
  this._isoManualLock = true; // prevent auto overrides going forward
  if (this._isoMode) {
    const cols = this.gameManager?.cols || 25;
    const rows = this.gameManager?.rows || 25;
    const span = Math.max(cols, rows) * 0.6;
    this._applyCameraBase({ cx: cols * 0.5, cz: rows * 0.5, span });
    this.reframe();
    try {
      this.debugIsoCamera();
    } catch (_) {
      /* ignore */
    }
  }
}

/**
 * General camera pitch setter (degrees) that works regardless of iso preset.
 * Re-uses the iso pitch backing field so existing math + sliders stay consistent.
 * Does NOT automatically enable iso mode; simply tilts current camera.
 */
function setCameraPitchDegrees(deg, { lock = false } = {}) {
  if (!Number.isFinite(deg)) return;
  if (deg < 0) deg = 0;
  if (deg > 89.9) deg = 89.9;
  const rad = this._topDownView ? TOP_DOWN_PITCH : (deg * Math.PI) / 180;
  this._isoPitch = rad;
  if (lock) this._isoManualLock = true;
  // Apply base orientation using current yaw but do not force iso mode.
  try {
    const cols = this.gameManager?.cols || 25;
    const rows = this.gameManager?.rows || 25;
    const span = Math.max(cols, rows) * 0.6;
    this._applyCameraBase({ cx: cols * 0.5, cz: rows * 0.5, span });
    this.reframe();
    if (this._isoMode) this.debugIsoCamera();
  } catch (_) {
    /* ignore */
  }
}
/** Optional combined setter for yaw/pitch (radians) */
function setIsoAngles({ yaw, pitch }) {
  if (Number.isFinite(yaw)) this._isoYaw = yaw;
  if (Number.isFinite(pitch) && !this._topDownView) this._isoPitch = pitch;
  if (this._isoMode) {
    const cols = this.gameManager?.cols || 25;
    const rows = this.gameManager?.rows || 25;
    const span = Math.max(cols, rows) * 0.6;
    this._applyCameraBase({ cx: cols * 0.5, cz: rows * 0.5, span });
    this.reframe();
  }
}

// ── Camera Base Placement ──────────────────────────────────────────

function _applyCameraBase({ cx, cz, span }) {
  if (!this.camera || this.degraded) return;
  this._ensureCameraProjection();
  const target = this.getCameraTarget();
  cx = target.x;
  cz = target.z;
  if (this._isoMode) {
    // Apply isometric camera base (extracted helper)
    this._applyIsoCameraBase({ cx, cy: target.y, cz, span });
  } else {
    // Free (non-iso) mode: spherical positioning relative to center
    try {
      const yaw = Number.isFinite(this._isoYaw) ? this._isoYaw : Math.PI / 4;
      const pitch = this._isoPitch != null ? this._isoPitch : 0.5;
      const { x, y, z, pitchNorm, minY } = this._computeIsoPosition({
        isoPitch: pitch,
        isoYaw: yaw,
        cx,
        cz,
      });
      this.camera.position.set(x, y + target.y, z);
      this.camera.lookAt(cx, target.y, cz);
      if (typeof window !== 'undefined') {
        const dx = cx - x;
        const dz = cz - z;
        const effectivePitch = Math.asin(y / Math.sqrt(dx * dx + dz * dz + y * y));
        window.__TT_PITCH_DEBUG__ = {
          requestedPitchDeg: (pitch * 180) / Math.PI,
          effectivePitchDeg: (effectivePitch * 180) / Math.PI,
          basis: 'free-spherical',
          position: this.camera.position.toArray(),
          isoMode: false,
          pitchNorm,
          minY,
        };
      }
    } catch (error) {
      GameErrors.rendering(error, { component: 'CameraSystem', operation: 'placeCamera' });
    }
  }
  this.camera.updateMatrixWorld(true);
  this.gameManager?.cameraRig?.attach?.(this.camera, {
    target: this.getCameraTarget(),
    zoom: 1 / (this._zoom || 1),
  });
  try {
    if (typeof window !== 'undefined') {
      window.__TT_THREE_CAMERA__ = {
        position: this.camera.position.toArray(),
        isoMode: this._isoMode,
      };
    }
  } catch (_) {
    /* ignore */
  }
}

// ── Isometric Camera Internals ─────────────────────────────────────

/** Internal: apply isometric camera base placement & debugging */
function _applyIsoCameraBase({ cx, cy = 0, cz }) {
  const isoYaw = this._isoYaw;
  // Global hard override (diagnostics) takes precedence
  try {
    if (
      !this._topDownView &&
      typeof window !== 'undefined' &&
      Number.isFinite(window.__TT_FORCE_ISO_PITCH_DEG)
    ) {
      this._isoPitch = (window.__TT_FORCE_ISO_PITCH_DEG * Math.PI) / 180;
    }
  } catch (_) {
    /* ignore */
  }
  const isoPitch = this._isoPitch; // angle above ground plane (radians)
  let r;
  try {
    r = this._computeIsoPosition({ isoPitch, isoYaw, cx, cz });
  } catch (error) {
    GameErrors.rendering(error, { component: 'CameraSystem', operation: 'placeIsometricCamera' });
    return;
  }
  this.camera.position.set(r.x, r.y + cy, r.z);
  this.camera.lookAt(cx, cy, cz);
  // Debugging / inspection hooks
  if (typeof window !== 'undefined') {
    try {
      window.__TT_PITCH_DEBUG_EXTRA__ = {
        mode: 'iso',
        pitchNorm: r.pitchNorm,
        minY: r.minY,
        minFloor: r.minFloor,
        maxMin: r.maxMin,
      };
    } catch (_) {
      /* ignore */
    }
  }
  try {
    if (typeof window !== 'undefined') {
      const dx = cx - r.x;
      const dz = cz - r.z;
      const effectivePitch = Math.asin(r.y / Math.sqrt(dx * dx + dz * dz + r.y * r.y));
      try {
        if (window.__TT_VERBOSE_ISO_DEBUG__) {
          console.info('[IsoCamera] applyBase pitch', {
            requestedDeg: (isoPitch * 180) / Math.PI,
            effectiveDeg: (effectivePitch * 180) / Math.PI,
            manualLock: this._isoManualLock,
          });
        }
      } catch (_) {
        /* ignore */
      }
      window.__TT_PITCH_DEBUG__ = {
        requestedPitchDeg: (isoPitch * 180) / Math.PI,
        effectivePitchDeg: (effectivePitch * 180) / Math.PI,
        basis: 'halfDiag',
        position: this.camera.position.toArray(),
        horizReference: r.horizDistRef,
        manualLock: this._isoManualLock,
      };
    }
  } catch (_) {
    /* ignore */
  }
}

/** Compute iso camera spherical placement and minY easing (extracted for prettier indentation sanity) */
function _computeIsoPosition({ isoPitch, isoYaw, cx, cz }) {
  const cols = this.gameManager?.cols || 25;
  const rows = this.gameManager?.rows || 25;
  const tileSize = this.gameManager?.spatial?.tileWorldSize || 1;
  const width = cols * tileSize;
  const depth = rows * tileSize;
  const halfDiag = 0.5 * Math.sqrt(width * width + depth * depth);
  const radius = this.camera?.isPerspectiveCamera
    ? this._getPerspectiveRadius(isoPitch, isoYaw)
    : halfDiag * 1.08;
  const cosP = Math.cos(isoPitch);
  const sinP = Math.sin(isoPitch);
  const x = cx + radius * cosP * Math.cos(isoYaw);
  const z = cz + radius * cosP * Math.sin(isoYaw);
  let y = radius * sinP;
  const minFloor = halfDiag * 0.01;
  const maxMin = halfDiag * 0.15;
  const pitchNorm = Math.min(Math.max(isoPitch / (Math.PI * 0.5), 0), 1);
  const t = pitchNorm;
  const smooth = t * t * (3 - 2 * t);
  const minY = minFloor + (maxMin - minFloor) * smooth;
  if (y < minY) y = minY;
  return { x, y, z, horizDistRef: radius * cosP, pitchNorm, minY, minFloor, maxMin };
}

// ── Diagnostics & Measurement ─────────────────────────────────────

/** Emit diagnostic info about current isometric pixel step ratio & effective pitch. */
function debugIsoCamera() {
  try {
    if (!this._isoMode) return null;
    const m = this.measureTileStepPixels();
    if (typeof window !== 'undefined') {
      window.__TT_ISO_DEBUG__ = {
        ratio: m?.ratio,
        dx: m?.dx,
        dy: m?.dy,
        pitchRequestedDeg: (this._isoPitch * 180) / Math.PI,
        manualLock: this._isoManualLock,
        camPos: this.camera?.position?.toArray?.(),
      };
    }
    return m;
  } catch (_) {
    return null;
  }
}
// Projected measurement using Three.js project() for accuracy
function measureTileStepPixelsProjected() {
  try {
    if (!this.camera || !this.renderer || !this.three) return null;
    const three = this.three;
    const { x: cx, y: cy, z: cz } = this.getCameraTarget();
    const tileSize = this.gameManager?.spatial?.tileWorldSize || 1;
    const { width, height } = this._getCameraViewport();
    this.camera.updateMatrixWorld(true);
    const base = new three.Vector3(cx, cy, cz);
    const px = base.clone().add(new three.Vector3(tileSize, 0, 0));
    const pz = base.clone().add(new three.Vector3(0, 0, tileSize));
    const proj = (v) => {
      const vv = v.clone();
      vv.project(this.camera);
      return { x: (vv.x * 0.5 + 0.5) * width, y: (-vv.y * 0.5 + 0.5) * height };
    };
    const b = proj(base);
    const bx = proj(px);
    const bz = proj(pz);
    const dxX = Math.abs(bx.x - b.x);
    const dyX = Math.abs(bx.y - b.y);
    const dxZ = Math.abs(bz.x - b.x);
    const dyZ = Math.abs(bz.y - b.y);
    const avgDx = (dxX + dxZ) * 0.5;
    const avgDy = (dyX + dyZ) * 0.5;
    return {
      dx: avgDx,
      dy: avgDy,
      dxX,
      dyX,
      dxZ,
      dyZ,
      avgDx,
      avgDy,
      ratio: avgDy / (avgDx || 1),
    };
  } catch (_) {
    return null;
  }
}
// ── Calibration ───────────────────────────────────────────────────

function calibrateTo2DTileAspect({ iterations = 28, minDeg = 10, maxDeg = 60 } = {}) {
  if (!this._isoMode) return null;
  const tw = this.gameManager?.tileWidth;
  const th = this.gameManager?.tileHeight;
  if (!(tw && th)) return null;
  const targetRatio = th / tw;
  const cols = this.gameManager?.cols || 25;
  const rows = this.gameManager?.rows || 25;
  const span = Math.max(cols, rows) * 0.6;
  const original = this._isoPitch;
  let best = { err: Infinity, pitch: original, ratio: null, deg: (original * 180) / Math.PI };
  for (let i = 0; i < iterations; i++) {
    const t = i / (iterations - 1);
    const deg = minDeg + (maxDeg - minDeg) * t;
    this._isoPitch = (deg * Math.PI) / 180;
    this._applyCameraBase({ cx: cols * 0.5, cz: rows * 0.5, span });
    this.reframe();
    const m = this.measureTileStepPixelsProjected() || this.measureTileStepPixels();
    if (m) {
      const err = Math.abs(m.ratio - targetRatio);
      if (err < best.err) best = { err, pitch: this._isoPitch, ratio: m.ratio, deg };
    }
  }
  this._isoPitch = best.pitch;
  this._isoManualLock = true;
  this._applyCameraBase({ cx: cols * 0.5, cz: rows * 0.5, span });
  this.reframe();
  try {
    if (typeof window !== 'undefined') {
      window.__TT_ISO_2D_CALIBRATION__ = {
        targetRatio,
        bestDeg: (best.pitch * 180) / Math.PI,
        bestRatio: best.ratio,
        err: best.err,
        iterations,
        range: [minDeg, maxDeg],
      };
    }
  } catch (_) {
    /* ignore */
  }
  return best;
}
// ── Frustum / Reframe ─────────────────────────────────────────────

/** Update the active lens and its board-relative framing. */
function reframe() {
  if (!this.camera || this.degraded) return;
  try {
    this._ensureCameraProjection();
    const { halfHeight, aspect, zoom } = this._getCameraFraming();
    if (this.camera.isPerspectiveCamera) {
      this.camera.aspect = aspect;
      this.camera.fov = PERSPECTIVE_FOV;
      this.camera.zoom = 1;
    } else {
      this.camera.left = (-halfHeight * aspect) / zoom;
      this.camera.right = (halfHeight * aspect) / zoom;
      this.camera.top = halfHeight / zoom;
      this.camera.bottom = -halfHeight / zoom;
      this.camera.zoom = 1;
    }
    this.camera.updateProjectionMatrix();
    const target = this.getCameraTarget();
    this._applyCameraBase({
      cx: target.x,
      cz: target.z,
      span: Math.max(this.gameManager?.cols || 25, this.gameManager?.rows || 25) * 0.6,
    });
    this._updateSunCoverage();
  } catch (error) {
    GameErrors.rendering(error, { component: 'CameraSystem', operation: 'reframe' });
  }
}

// ── Zoom ──────────────────────────────────────────────────────────

/** Smooth zoom interpolation (called per frame) */
function _updateZoom(dtMs) {
  if (this._zoom === this._targetZoom) return;
  if (this._zoomEase === 0) {
    this._zoom = this._targetZoom;
    this.reframe();
    return;
  }
  const t = 1 - Math.pow(1 - this._zoomEase, Math.max(1, dtMs / 16));
  const before = this._zoom;
  this._zoom = before + (this._targetZoom - before) * t;
  if (Math.abs(this._zoom - this._targetZoom) < 0.0005) this._zoom = this._targetZoom;
  if (this._zoom !== before) this.reframe();
}

function setZoom(z) {
  if (!Number.isFinite(z)) return;
  const clamped = Math.min(this._maxZoom, Math.max(this._minZoom, z));
  this._targetZoom = clamped;
}
function getZoom() {
  return this._zoom;
}

// ── Tile Step Measurement ─────────────────────────────────────────

// Removed legacy calibrateIsoPitch() in favor of explicit solveIsoPitchForTargetRatio() utility.

/** Measure current pixel displacement for +X and +Z tile steps (after current frustum applied). */
function measureTileStepPixels() {
  return this.measureTileStepPixelsProjected();
}

// ── Pitch Solver ──────────────────────────────────────────────────

/** Solve pitch numerically to match target vertical/horizontal pixel step ratio (parity disabled). */
function solveIsoPitchForTargetRatio(
  targetRatio = 0.5,
  { minDeg = 10, maxDeg = 35, iterations = 18 } = {}
) {
  if (!this._isoMode) return null;
  const cols = this.gameManager?.cols || 25;
  const rows = this.gameManager?.rows || 25;
  const span = Math.max(cols, rows) * 0.6;
  const origPitch = this._isoPitch;
  let best = { pitch: origPitch, err: Infinity, ratio: null, deg: (origPitch * 180) / Math.PI };
  for (let i = 0; i < iterations; i++) {
    const t = i / (iterations - 1);
    const deg = minDeg + (maxDeg - minDeg) * t;
    this._isoPitch = (deg * Math.PI) / 180;
    this._applyCameraBase({ cx: cols * 0.5, cz: rows * 0.5, span });
    this.reframe();
    const m = this.measureTileStepPixels();
    if (m) {
      const err = Math.abs(m.ratio - targetRatio);
      if (err < best.err) best = { pitch: this._isoPitch, err, ratio: m.ratio, deg };
    }
  }
  // Apply best pitch
  this._isoPitch = best.pitch;
  // Re-apply with original behaviors
  this._applyCameraBase({ cx: cols * 0.5, cz: rows * 0.5, span });
  this.reframe();
  try {
    if (typeof window !== 'undefined') {
      window.__TT_ISO_PITCH_SOLVE__ = {
        targetRatio,
        bestDeg: (best.pitch * 180) / Math.PI,
        bestRatio: best.ratio,
        err: best.err,
        iterations,
        range: [minDeg, maxDeg],
      };
    }
  } catch (_) {
    /* ignore */
  }
  best.bestDeg = best.deg; // backward compatibility for UI check
  return best;
}

// ── Pan / Zoom (Three.js camera) ──────────────────────────────────

/**
 * Pan the camera by a screen-space pixel delta.
 * Converts pixel movement → world XZ movement using camera frustum and orientation.
 * Call on every mousemove during drag.
 */
function panBy(screenDx, screenDy) {
  if (!this.camera || this.degraded) return;
  try {
    const { width, height } = this._getCameraViewport();
    const before = this._screenToGround(width / 2, height / 2);
    const after = this._screenToGround(width / 2 + screenDx, height / 2 + screenDy);
    if (!before || !after) return;
    const target = this.getCameraTarget();
    this.setCameraTarget(target.x + before.x - after.x, target.z + before.z - after.z);
  } catch (error) {
    GameErrors.rendering(error, { component: 'CameraSystem', operation: 'pan' });
  }
}

/**
 * Set camera focus in world space, preserving its current height when omitted.
 */
function setCameraTarget(cx, cz, cy = this.getCameraTarget().y) {
  if (![cx, cy, cz].every(Number.isFinite)) {
    GameErrors.rendering(new Error('Camera focus coordinates must be finite'), {
      component: 'CameraSystem',
      operation: 'setCameraTarget',
    });
    return;
  }
  this._panCx = cx;
  this._panCy = cy;
  this._panCz = cz;
  const cols = this.gameManager?.cols || 25;
  const rows = this.gameManager?.rows || 25;
  const span = Math.max(cols, rows) * 0.6;
  this._applyCameraBase({ cx, cz, span });
}

/**
 * Reset camera target to board center and clear stored pan offset.
 */
function resetCameraTarget() {
  const cols = this.gameManager?.cols || 25;
  const rows = this.gameManager?.rows || 25;
  const tileSize = this.gameManager?.spatial?.tileWorldSize || 1;
  this._panCx = cols * tileSize * 0.5;
  this._panCy = 0;
  this._panCz = rows * tileSize * 0.5;
  const span = Math.max(cols, rows) * 0.6;
  this._applyCameraBase({ cx: this._panCx, cz: this._panCz, span });
}

/**
 * Zoom by a multiplicative factor while keeping the world point under (mouseX, mouseY) stable.
 * mouseX, mouseY are canvas-relative pixel coordinates.
 */
function zoomAtScreenPoint(factor, mouseX, mouseY) {
  if (!this.camera || !Number.isFinite(factor) || factor <= 0 || this.degraded) return;
  try {
    const before = this._screenToGround(mouseX, mouseY);
    const newZoom = Math.min(this._maxZoom, Math.max(this._minZoom, this._zoom * factor));
    this._zoom = newZoom;
    this._targetZoom = newZoom;
    this.reframe();
    const after = this._screenToGround(mouseX, mouseY);
    if (before && after) {
      const target = this.getCameraTarget();
      this.setCameraTarget(target.x + before.x - after.x, target.z + before.z - after.z);
    }
  } catch (error) {
    GameErrors.rendering(error, { component: 'CameraSystem', operation: 'zoom' });
  }
}

// ── Mixin Installation ────────────────────────────────────────────

export function installCameraMethods(prototype) {
  prototype._getCameraViewport = _getCameraViewport;
  prototype.getCameraTarget = getCameraTarget;
  prototype._getCameraFraming = _getCameraFraming;
  prototype._ensureCameraProjection = _ensureCameraProjection;
  prototype._getPerspectiveRadius = _getPerspectiveRadius;
  prototype._screenToGround = _screenToGround;
  prototype.setTopDownView = setTopDownView;
  prototype.setIsometricMode = setIsometricMode;
  prototype.setIsoPitchDegrees = setIsoPitchDegrees;
  prototype.setCameraPitchDegrees = setCameraPitchDegrees;
  prototype.setIsoAngles = setIsoAngles;
  prototype._applyCameraBase = _applyCameraBase;
  prototype._applyIsoCameraBase = _applyIsoCameraBase;
  prototype._computeIsoPosition = _computeIsoPosition;
  prototype.debugIsoCamera = debugIsoCamera;
  prototype.measureTileStepPixelsProjected = measureTileStepPixelsProjected;
  prototype.calibrateTo2DTileAspect = calibrateTo2DTileAspect;
  prototype.reframe = reframe;
  prototype._updateZoom = _updateZoom;
  prototype.setZoom = setZoom;
  prototype.getZoom = getZoom;
  prototype.measureTileStepPixels = measureTileStepPixels;
  prototype.solveIsoPitchForTargetRatio = solveIsoPitchForTargetRatio;
  prototype.panBy = panBy;
  prototype.setCameraTarget = setCameraTarget;
  prototype.resetCameraTarget = resetCameraTarget;
  prototype.zoomAtScreenPoint = zoomAtScreenPoint;
}
