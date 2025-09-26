// ThreeSceneManager.js
// Clean implementation with camera mode toggles and debug overlay.

export class ThreeSceneManager {
  constructor(gameManager) {
    this.gameManager = gameManager;
    this.initialized = false;
    this.degraded = false;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.canvas = null;
    this._animationHandle = null;
    this._animCallbacks = [];
    // User-facing toggles
    this.showBootstrapGrid = true;
    this._isoMode = false;
    this._isoYaw = Math.PI / 4; // default 45° (diagonal)
    // Baseline seed pitch (kept stable so relative math does not drift when searching for a match).
    // This is NOT the final preset match pitch; the isometric camera preset will override with a calibrated value (currently 12.5°) BEFORE the first frustum lock capture.
    // Override the baseline (rarely needed) via: window.__TT_ISO_DEFAULT_PITCH_DEG = <number>
    const overrideDeg =
      (typeof window !== 'undefined' && window.__TT_ISO_DEFAULT_PITCH_DEG) || 20.5;
    // Calibrated preset pitch (deg) applied when iso mode is enabled; can be overridden via window.__TT_ISO_PRESET_PITCH_DEG.
    // Updated calibrated preset pitch after adopting non-adaptive frustum sizing.
    this._isoPresetPitchDeg = 52.0;
    this._isoPitch = (overrideDeg * Math.PI) / 180;
    // Simplified implementation: removed legacy vertical persistence, parity scaling, and frustum lock.
    // We keep a constant board-based frustum so pitch directly affects the vertical compression visually.
    this._isoBaseFrustum = null; // cached {halfWidth, halfHeight}
    // Metrics
    this._metrics = {
      startTime: null,
      frameCount: 0,
      accumulatedMs: 0,
      lastFrameTs: null,
    };
    this._loggedFirstFrame = false;
    try {
      if (typeof globalThis !== 'undefined' && globalThis.__TT_REGISTER_THREE__) {
        globalThis.__TT_REGISTER_THREE__(this);
      }
    } catch (_) {
      /* ignore */
    }
  }

  async initialize(containerId = 'game-container') {
    if (this.initialized) return;
    this._testMode =
      (typeof globalThis !== 'undefined' &&
        globalThis.process &&
        globalThis.process.env &&
        globalThis.process.env.JEST_WORKER_ID != null) ||
      false;
    let three;
    try {
      three = await import('three');
    } catch (e) {
      this.degraded = true;
      return;
    }

    try {
      this.scene = new three.Scene();
      this.scene.add(new three.AmbientLight(0xffffff, 0.6));

      // Bootstrap wireframe grid plane sized to grid dims.
      try {
        const gm = this.gameManager;
        const cols = gm?.cols || 25;
        const rows = gm?.rows || 25;
        const gridMaterial = new three.MeshBasicMaterial({
          color: 0x228833,
          wireframe: true,
          transparent: true,
          opacity: 0.22,
        });
        const gridGeometry = new three.PlaneGeometry(
          cols,
          rows,
          Math.min(cols, 50),
          Math.min(rows, 50)
        );
        gridGeometry.rotateX(-Math.PI / 2);
        const gridMesh = new three.Mesh(gridGeometry, gridMaterial);
        gridMesh.name = 'BootstrapGridPlane';
        gridMesh.position.set(cols * 0.5, 0, rows * 0.5);
        gridMesh.visible = !!this.showBootstrapGrid;
        this.scene.add(gridMesh);
      } catch (_) {
        /* ignore grid creation errors */
      }

      // Camera
      const cols = this.gameManager?.cols || 25;
      const rows = this.gameManager?.rows || 25;
      const span = Math.max(cols, rows) * 0.6;
      const frustum = span;
      const aspect = 1; // resized later
      this.camera = new three.OrthographicCamera(
        -frustum * aspect,
        frustum * aspect,
        frustum,
        -frustum,
        -100,
        500
      );
      this._applyCameraBase({ cx: cols * 0.5, cz: rows * 0.5, span });

      // Canvas / renderer
      this.canvas = document.createElement('canvas');
      this.canvas.setAttribute('data-three', 'true');
      Object.assign(this.canvas.style, {
        position: 'absolute',
        inset: '0',
        pointerEvents: 'none',
        zIndex: '0',
      });
      if (!this._testMode) {
        this.renderer = new three.WebGLRenderer({
          canvas: this.canvas,
          antialias: true,
          alpha: true,
        });
        this.renderer.setPixelRatio(window.devicePixelRatio || 1);
        this._resize();
        this._boundResize = () => this._resize();
        window.addEventListener('resize', this._boundResize);
      } else {
        this.renderer = {
          render: () => {},
          dispose: () => {},
          setPixelRatio: () => {},
          setSize: () => {},
        };
      }

      const container =
        (typeof document !== 'undefined' && document.getElementById(containerId)) || document.body;
      try {
        container.prepend && container.prepend(this.canvas);
      } catch (_) {
        /* ignore */
      }

      this.initialized = true;
      if (!this._metrics.startTime) {
        this._metrics.startTime =
          (typeof performance !== 'undefined' && performance.now()) || Date.now();
      }
      if (!this._testMode) {
        this._loop();
      } else {
        try {
          this.renderer.render(this.scene, this.camera);
          this._metrics.frameCount += 1;
        } catch (_) {
          /* ignore */
        }
      }

      this._injectDebugOverlay();
    } catch (e) {
      this.degraded = true;
      try {
        this.scene = this.scene || { stub: true };
        this.camera = this.camera || { stub: true };
      } catch (_) {
        /* ignore */
      }
    }
  }

  _resize() {
    if (!this.renderer || !this.camera) return;
    try {
      const w = window.innerWidth || 800;
      const h = window.innerHeight || 600;
      this.renderer.setSize(w, h, false);
      const aspect = w / h;
      const cols = this.gameManager?.cols || 25;
      const rows = this.gameManager?.rows || 25;
      const span = Math.max(cols, rows) * 0.6;
      this.camera.left = -span * aspect;
      this.camera.right = span * aspect;
      this.camera.top = span;
      this.camera.bottom = -span;
      this.camera.updateProjectionMatrix();
    } catch (_) {
      /* ignore resize */
    }
  }

  _loop() {
    if (!this.renderer || !this.camera) return;
    const step = (ts) => {
      try {
        if (this._metrics.lastFrameTs != null) {
          this._metrics.accumulatedMs += ts - this._metrics.lastFrameTs;
        }
        this._metrics.lastFrameTs = ts;
        // Render
        this.renderer.render(this.scene, this.camera);
        // Anim callbacks
        if (this._animCallbacks.length) {
          try {
            this._animCallbacks.forEach((fn) => {
              try {
                fn(ts);
              } catch (_) {
                /* ignore */
              }
            });
          } catch (_) {
            /* ignore */
          }
        }
        this._metrics.frameCount += 1;
        if (!this._loggedFirstFrame && this._metrics.frameCount === 1) {
          this._loggedFirstFrame = true;
          try {
            console.info('[ThreeSceneManager] First frame rendered', {
              degraded: this.degraded,
              startTime: this._metrics.startTime,
            });
          } catch (_) {
            /* ignore */
          }
        }
        if (typeof window !== 'undefined') {
          try {
            window.__TT_METRICS__ = window.__TT_METRICS__ || {};
            window.__TT_METRICS__.three = this.getRenderStats();
          } catch (_) {
            /* ignore */
          }
        }
      } catch (_) {
        /* ignore frame errors */
      }
      this._animationHandle = requestAnimationFrame(step);
    };
    this._animationHandle = requestAnimationFrame(step);
  }

  _injectDebugOverlay() {
    try {
      if (typeof document === 'undefined') return;
      if (document.getElementById('three-debug-overlay')) return;
      const overlay = document.createElement('div');
      overlay.id = 'three-debug-overlay';
      Object.assign(overlay.style, {
        position: 'fixed',
        top: '0',
        right: '0',
        font: '12px monospace',
        background: 'rgba(0,0,0,0.35)',
        color: '#fff',
        padding: '4px 6px',
        zIndex: '9999',
      });
      document.body.appendChild(overlay);
      const updateOverlay = () => {
        try {
          const stats = this.getRenderStats();
          const place = (window.__TT_METRICS__ && window.__TT_METRICS__.placeables) || {};
          overlay.textContent = `3D frames:${stats.frameCount} avg:${stats.averageFrameMs.toFixed(2)}ms placeableGroups:${place.groups || 0} instances:${place.liveInstances || 0}`;
        } catch (_) {
          /* ignore */
        }
        requestAnimationFrame(updateOverlay);
      };
      requestAnimationFrame(updateOverlay);
    } catch (_) {
      /* ignore overlay errors */
    }
  }

  setIsometricMode(enabled = true) {
    this._isoMode = !!enabled;
    if (!this.camera) return;
    if (this._isoMode) {
      // Apply preset pitch before first reframe
      try {
        if (
          !(typeof window !== 'undefined' && window.__TT_DISABLE_ISO_PRESET_PITCH__) &&
          Number.isFinite(this._isoPresetPitchDeg)
        ) {
          const preset =
            (typeof window !== 'undefined' && window.__TT_ISO_PRESET_PITCH_DEG) ||
            this._isoPresetPitchDeg;
          this._isoPitch = (preset * Math.PI) / 180;
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
  setIsoPitchDegrees(deg) {
    if (!Number.isFinite(deg)) return;
    const rad = (deg * Math.PI) / 180;
    this._isoPitch = rad;
    if (this._isoMode) {
      const cols = this.gameManager?.cols || 25;
      const rows = this.gameManager?.rows || 25;
      const span = Math.max(cols, rows) * 0.6;
      this._applyCameraBase({ cx: cols * 0.5, cz: rows * 0.5, span });
      this.reframe();
    }
  }

  /** Optional combined setter for yaw/pitch (radians) */
  setIsoAngles({ yaw, pitch }) {
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

  _applyCameraBase({ cx, cz, span }) {
    if (!this.camera) return;
    if (this._isoMode) {
      const isoYaw = this._isoYaw;
      const isoPitch = this._isoPitch; // angle above ground plane (radians)
      // Compute a radius from the true grid diagonal so switching to iso does not visually "zoom" the board.
      let debugX, debugY, debugZ, horizDistRef;
      try {
        const cols = this.gameManager?.cols || 25;
        const rows = this.gameManager?.rows || 25;
        const tileSize = this.gameManager?.spatial?.tileWorldSize || 1;
        const width = cols * tileSize;
        const depth = rows * tileSize;
        const halfDiag = 0.5 * Math.sqrt(width * width + depth * depth);
        const horizontal = halfDiag * 1.08; // small margin
        const x = cx + horizontal * Math.cos(isoYaw);
        const z = cz + horizontal * Math.sin(isoYaw);
        let y = horizontal * Math.tan(isoPitch);
        const minY = halfDiag * 0.15;
        if (y < minY) y = minY;
        this.camera.position.set(x, y, z);
        debugX = x;
        debugY = y;
        debugZ = z;
        horizDistRef = horizontal;
      } catch (_) {
        const radius = span * 1.8;
        const horizontal = radius * Math.cos(isoPitch);
        const x = cx + horizontal * Math.cos(isoYaw);
        const z = cz + horizontal * Math.sin(isoYaw);
        const y = radius * Math.tan(isoPitch);
        this.camera.position.set(x, y, z);
        debugX = x;
        debugY = y;
        debugZ = z;
        horizDistRef = horizontal;
      }
      this.camera.lookAt(cx, 0, cz);
      try {
        if (typeof window !== 'undefined') {
          const dx = cx - debugX;
          const dz = cz - debugZ;
          const horizDist = Math.sqrt(dx * dx + dz * dz) || 1;
          const effectivePitch = Math.atan2(debugY, horizDist);
          window.__TT_PITCH_DEBUG__ = {
            requestedPitchDeg: (isoPitch * 180) / Math.PI,
            effectivePitchDeg: (effectivePitch * 180) / Math.PI,
            basis: 'halfDiag',
            position: this.camera.position.toArray(),
            horizReference: horizDistRef,
          };
        }
      } catch (_) {
        /* ignore */
      }
    } else {
      this.camera.position.set(cx + span, span * 1.4, cz + span);
      this.camera.lookAt(cx, 0, cz);
    }
    try {
      if (typeof window !== 'undefined')
        window.__TT_THREE_CAMERA__ = {
          position: this.camera.position.toArray(),
          isoMode: this._isoMode,
        };
    } catch (_) {
      /* ignore */
    }
  }

  /** Recompute orthographic frustum. Simplified: constant board-diagonal based box in iso; aspect-based span otherwise. */
  reframe() {
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
        this.camera.left = -hw;
        this.camera.right = hw;
        this.camera.top = hh;
        this.camera.bottom = -hh;
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
        this.camera.left = -baseSpan * aspect * margin;
        this.camera.right = baseSpan * aspect * margin;
        this.camera.top = baseSpan * margin;
        this.camera.bottom = -baseSpan * margin;
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
      } catch (_) {
        /* ignore */
      }
    }
  }

  // Removed legacy calibrateIsoPitch() in favor of explicit solveIsoPitchForTargetRatio() utility.

  /** Measure current pixel displacement for +X and +Z tile steps (after current frustum applied). */
  measureTileStepPixels() {
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

  /** Solve pitch numerically to match target vertical/horizontal pixel step ratio (parity disabled). */
  solveIsoPitchForTargetRatio(
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

  setBootstrapGridVisible(visible) {
    this.showBootstrapGrid = !!visible;
    if (!this.scene) return;
    try {
      const g = this.scene.getObjectByName('BootstrapGridPlane');
      if (g) g.visible = this.showBootstrapGrid;
    } catch (_) {
      /* ignore */
    }
  }

  setPixiGridVisible(visible) {
    try {
      const gc = this.gameManager?.gridContainer;
      if (gc) gc.visible = !!visible;
    } catch (_) {
      /* ignore */
    }
  }

  addAnimationCallback(fn) {
    if (typeof fn !== 'function') return () => {};
    this._animCallbacks.push(fn);
    return () => this.removeAnimationCallback(fn);
  }

  removeAnimationCallback(fn) {
    this._animCallbacks = this._animCallbacks.filter((f) => f !== fn);
  }

  getRenderStats() {
    const { startTime, frameCount, accumulatedMs } = this._metrics;
    const avg = frameCount > 0 ? accumulatedMs / frameCount : 0;
    return {
      initialized: this.initialized,
      degraded: this.degraded,
      startTime,
      frameCount,
      averageFrameMs: Number.isFinite(avg) ? +avg.toFixed(3) : 0,
    };
  }

  dispose() {
    try {
      if (this._animationHandle) cancelAnimationFrame(this._animationHandle);
    } catch (_) {
      /* ignore */
    }
    try {
      if (this._boundResize) window.removeEventListener('resize', this._boundResize);
    } catch (_) {
      /* ignore */
    }
    try {
      if (this.renderer) this.renderer.dispose();
    } catch (_) {
      /* ignore */
    }
    try {
      if (this.canvas && this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    } catch (_) {
      /* ignore */
    }
    this._animationHandle = null;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.canvas = null;
    this.initialized = false;
  }
}
