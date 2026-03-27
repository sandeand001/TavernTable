// CameraSystem.js — Isometric mode, zoom, pitch, frustum, reframe, calibration.
// Extracted from ThreeSceneManager.js (Phase 6). Installed via mixin pattern.

// ── Isometric / Pitch Mode ─────────────────────────────────────────

function setIsometricMode(enabled = true) {
  this._isoMode = !!enabled;
  if (!this.camera) return;
  if (this._isoMode) {
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
  const rad = (deg * Math.PI) / 180;
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
  const rad = (deg * Math.PI) / 180;
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
  if (Number.isFinite(pitch)) this._isoPitch = pitch;
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
  if (!this.camera) return;
  if (this._isoMode) {
    // Apply isometric camera base (extracted helper)
    this._applyIsoCameraBase({ cx, cz, span });
  } else {
    // Free (non-iso) mode: spherical positioning relative to center
    try {
      const yaw = this._isoYaw || 0.78539816339;
      const pitch = this._isoPitch != null ? this._isoPitch : 0.5;
      const cols = this.gameManager?.cols || 25;
      const rows = this.gameManager?.rows || 25;
      const tileSize = this.gameManager?.spatial?.tileWorldSize || 1;
      const width = cols * tileSize;
      const depth = rows * tileSize;
      const halfDiag = 0.5 * Math.sqrt(width * width + depth * depth);
      const radius = halfDiag * 1.08;
      const cosP = Math.cos(pitch);
      const sinP = Math.sin(pitch);
      const x = cx + radius * cosP * Math.cos(yaw);
      const z = cz + radius * cosP * Math.sin(yaw);
      let y = radius * sinP;
      const minFloor = halfDiag * 0.01;
      const maxMin = halfDiag * 0.15;
      const pitchNorm = Math.min(Math.max(pitch / (Math.PI * 0.5), 0), 1);
      const t = pitchNorm;
      const smooth = t * t * (3 - 2 * t);
      const minY = minFloor + (maxMin - minFloor) * smooth;
      if (y < minY) y = minY;
      this.camera.position.set(x, y, z);
      this.camera.lookAt(cx, 0, cz);
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
    } catch (_) {
      this.camera.position.set(cx + span, span * 1.4, cz + span);
      this.camera.lookAt(cx, 0, cz);
    }
  }
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
function _applyIsoCameraBase({ cx, cz, span }) {
  const isoYaw = this._isoYaw;
  // Global hard override (diagnostics) takes precedence
  try {
    if (typeof window !== 'undefined' && Number.isFinite(window.__TT_FORCE_ISO_PITCH_DEG)) {
      this._isoPitch = (window.__TT_FORCE_ISO_PITCH_DEG * Math.PI) / 180;
    }
  } catch (_) {
    /* ignore */
  }
  const isoPitch = this._isoPitch; // angle above ground plane (radians)
  let r;
  try {
    r = this._computeIsoPosition({ isoPitch, isoYaw, cx, cz });
  } catch (_) {
    // Fallback simplified placement if helper fails
    const radius = span * 1.8;
    const cosP = Math.cos(isoPitch);
    const sinP = Math.sin(isoPitch);
    const x = cx + radius * cosP * Math.cos(isoYaw);
    const z = cz + radius * cosP * Math.sin(isoYaw);
    let y = radius * sinP;
    if (isoPitch > 1.3) {
      const halfDiag = span; // approximate fallback
      const dynMin = halfDiag * 0.05;
      if (y < dynMin) y = dynMin;
    }
    r = {
      x,
      y,
      z,
      horizDistRef: radius * Math.cos(isoPitch),
      pitchNorm: null,
      minY: y,
      minFloor: null,
      maxMin: null,
    };
  }
  this.camera.position.set(r.x, r.y, r.z);
  this.camera.lookAt(cx, 0, cz);
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
  const radius = halfDiag * 1.08; // constant framing radius
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
    if (!this._isoMode || !this.camera || !this.renderer || !this.three) return null;
    const three = this.three;
    const cols = this.gameManager?.cols || 25;
    const rows = this.gameManager?.rows || 25;
    const cx = cols * 0.5;
    const cz = rows * 0.5;
    const tileSize = this.gameManager?.spatial?.tileWorldSize || 1;
    const base = new three.Vector3(cx, 0, cz);
    const px = base.clone().add(new three.Vector3(tileSize, 0, 0));
    const pz = base.clone().add(new three.Vector3(0, 0, tileSize));
    const proj = (v) => {
      const vv = v.clone();
      vv.project(this.camera);
      const w = this.renderer.domElement.width || 1;
      const h = this.renderer.domElement.height || 1;
      return { x: (vv.x * 0.5 + 0.5) * w, y: (-vv.y * 0.5 + 0.5) * h };
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
    return { dxX, dyX, dxZ, dyZ, avgDx, avgDy, ratio: avgDy / (avgDx || 1) };
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

/** Recompute orthographic frustum. Simplified: constant board-diagonal based box in iso; aspect-based span otherwise. */
function reframe() {
  if (!this.camera) return;
  try {
    if (this._isoMode) {
      const cols = this.gameManager?.cols || 25;
      const rows = this.gameManager?.rows || 25;
      const tileSize = this.gameManager?.spatial?.tileWorldSize || 1;
      const width = cols * tileSize;
      const depth = rows * tileSize;
      const halfDiag = 0.5 * Math.sqrt(width * width + depth * depth);
      if (!this._isoBaseFrustum) {
        this._isoBaseFrustum = { halfWidth: halfDiag * 1.05, halfHeight: halfDiag * 1.05 };
      }
      const { halfWidth: hw, halfHeight: hh } = this._isoBaseFrustum;
      const z = this._zoom <= 0 ? 1 : this._zoom;
      const scale = 1 / z; // bigger zoom value => closer (smaller extents)
      this.camera.left = -hw * scale;
      this.camera.right = hw * scale;
      this.camera.top = hh * scale;
      this.camera.bottom = -hh * scale;
    } else {
      // Non-iso: simple aspect-based span relative to board size
      const cols = this.gameManager?.cols || 25;
      const rows = this.gameManager?.rows || 25;
      const tileSize = this.gameManager?.spatial?.tileWorldSize || 1;
      const width = cols * tileSize;
      const depth = rows * tileSize;
      const baseSpan = Math.max(width, depth) * 0.5;
      const w = (typeof window !== 'undefined' && window.innerWidth) || 800;
      const h = (typeof window !== 'undefined' && window.innerHeight) || 600;
      const aspect = w / h;
      const margin = 1.08;
      const z = this._zoom <= 0 ? 1 : this._zoom;
      const scale = 1 / z;
      this.camera.left = -baseSpan * aspect * margin * scale;
      this.camera.right = baseSpan * aspect * margin * scale;
      this.camera.top = baseSpan * margin * scale;
      this.camera.bottom = -baseSpan * margin * scale;
    }
    // Diagnostic raw measurement (non-mutating)
    try {
      const raw = this.measureTileStepPixels();
      if (raw && this.camera) {
        this.camera.__isoRawMeasurement = {
          dx: raw.dx,
          dy: raw.dy,
          ratio: raw.ratio,
          pitchDeg: (this._isoPitch * 180) / Math.PI,
          timestamp: (typeof performance !== 'undefined' && performance.now()) || Date.now(),
        };
      }
    } catch (_) {
      /* ignore */
    }
    this.camera.updateProjectionMatrix();
    this._updateSunCoverage();
  } catch (_) {
    // Fallback to previous heuristic if any error occurs
    try {
      const cols = this.gameManager?.cols || 25;
      const rows = this.gameManager?.rows || 25;
      const tileSize = this.gameManager?.spatial?.tileWorldSize || 1;
      const width = cols * tileSize;
      const depth = rows * tileSize;
      const yaw = this._isoMode ? this._isoYaw : Math.PI / 4;
      const halfX = (width * Math.cos(yaw) + depth * Math.sin(yaw)) * 0.5;
      const halfZ = (width * Math.sin(yaw) + depth * Math.cos(yaw)) * 0.5;
      const baseSpan = Math.max(halfX, halfZ);
      const w = (typeof window !== 'undefined' && window.innerWidth) || 800;
      const h = (typeof window !== 'undefined' && window.innerHeight) || 600;
      const aspect = w / h;
      const margin = 1.08;
      this.camera.left = -baseSpan * aspect * margin;
      this.camera.right = baseSpan * aspect * margin;
      this.camera.top = baseSpan * margin;
      this.camera.bottom = -baseSpan * margin;
      this.camera.updateProjectionMatrix();
      this._updateSunCoverage();
    } catch (_) {
      /* ignore */
    }
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
  try {
    if (!this.camera || !this.renderer || !this.gameManager) return null;
    if (!this.gameManager.tileWidth || !this.gameManager.tileHeight) return null;
    const tSize = this.gameManager?.spatial?.tileWorldSize || 1;
    const q = this.camera.quaternion || { x: 0, y: 0, z: 0, w: 1 };
    const rotate = (vx, vy, vz) => {
      const { x, y, z, w } = q;
      const ix = w * vx + y * vz - z * vy;
      const iy = w * vy + z * vx - x * vz;
      const iz = w * vz + x * vy - y * vx;
      const iw = -x * vx - y * vy - z * vz;
      return {
        x: ix * w + iw * -x + iy * -z - iz * -y,
        y: iy * w + iw * -y + iz * -x - ix * -z,
        z: iz * w + iw * -z + ix * -y - iy * -x,
      };
    };
    const right = rotate(1, 0, 0);
    const up = rotate(0, 1, 0);
    const canvasW = this.renderer.domElement.width || 1;
    const canvasH = this.renderer.domElement.height || 1;
    const frustumWidthWorld = this.camera.right - this.camera.left;
    const frustumHeightWorld = this.camera.top - this.camera.bottom;
    if (!(frustumWidthWorld > 0 && frustumHeightWorld > 0)) return null;
    const pxPerRight = canvasW / frustumWidthWorld;
    const pxPerUp = canvasH / frustumHeightWorld;
    const stepX = { x: tSize, y: 0, z: 0 };
    const stepZ = { x: 0, y: 0, z: tSize };
    const dotRX = stepX.x * right.x + stepX.y * right.y + stepX.z * right.z;
    const dotUX = stepX.x * up.x + stepX.y * up.y + stepX.z * up.z;
    const dotRZ = stepZ.x * right.x + stepZ.y * right.y + stepZ.z * right.z;
    const dotUZ = stepZ.x * up.x + stepZ.y * up.y + stepZ.z * up.z;
    const dxAvg = (Math.abs(dotRX) * pxPerRight + Math.abs(dotRZ) * pxPerRight) * 0.5;
    const dyAvg = (Math.abs(dotUX) * pxPerUp + Math.abs(dotUZ) * pxPerUp) * 0.5;
    return { dx: dxAvg, dy: dyAvg, ratio: dyAvg / dxAvg, pxPerRight, pxPerUp };
  } catch (_) {
    return null;
  }
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

// ── Mixin Installation ────────────────────────────────────────────

export function installCameraMethods(prototype) {
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
}
