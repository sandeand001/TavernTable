/* eslint-disable prettier/prettier */
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
    this._isoYaw = Math.PI / 4; // default 45?? (diagonal)
    this._isoManualLock = false; // set true when user explicitly sets pitch so auto calibration won't override
    // Baseline seed pitch (kept stable so relative math does not drift when searching for a match).
    // This is NOT the final preset match pitch; the isometric camera preset will override with a calibrated value (currently 12.5??) BEFORE the first frustum lock capture.
    // Override the baseline (rarely needed) via: window.__TT_ISO_DEFAULT_PITCH_DEG = <number>
    const overrideDeg =
      (typeof window !== 'undefined' && window.__TT_ISO_DEFAULT_PITCH_DEG) || 20.5;
    // Calibrated preset pitch (deg) applied when iso mode is enabled;
    // can be overridden via window.__TT_ISO_PRESET_PITCH_DEG.
    // Reverted to classical isometric pitch (~35.264??) so that a single
    // tile step in +X / +Z projects to near-equal diagonals and vertical
    // compression matches 2D diamond (2:1 ratio).
    // If you previously relied on the steeper 52?? value, set:
    // window.__TT_ISO_PRESET_PITCH_DEG = 52 before enabling iso mode.
    this._isoPresetPitchDeg = 35.264389682754654; // atan(sin(45??)) in degrees
    this._isoPitch = (overrideDeg * Math.PI) / 180;
    // Simplified implementation: removed legacy vertical persistence, parity scaling, and frustum lock.
    // We keep a constant board-based frustum so pitch directly affects the vertical compression visually.
    this._isoBaseFrustum = null; // cached {halfWidth, halfHeight}
    // Zoom state (orthographic zoom implemented by scaling frustum extents)
    this._zoom = 1.0; // 1 == baseline
    this._minZoom = 0.35;
    this._maxZoom = 3.0;
    this._zoomEase = 0.18; // smoothing factor (0 == instant)
    this._targetZoom = this._zoom;
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

    // Expose namespace on instance so other systems (UI sliders, rebuilders) can reuse
    // the already imported Three module instead of doing additional dynamic imports.
    try {
      this.three = three;
    } catch (_) {
      /* ignore assignment failure */
    }

    try {
      this.scene = new three.Scene();

      // Ambient light (boosted vs earlier 0.6). Allow runtime override via window.__TT_AMBIENT_INTENSITY__.
      try {
        const ambIntensity =
          (typeof window !== 'undefined' && window.__TT_AMBIENT_INTENSITY__) || 0.9;
        this.scene.add(new three.AmbientLight(0xffffff, ambIntensity));
      } catch (_) {
        this.scene.add(new three.AmbientLight(0xffffff, 0.9));
      }

      // Soft hemisphere fill to reduce dark undertone (sky light + subtle ground bounce)
      try {
        const hemi = new three.HemisphereLight(0xf0f4ff, 0x3a2e1a, 0.55);
        hemi.name = 'TerrainHemiFill';
        this.scene.add(hemi);
      } catch (_) {
        /* ignore hemisphere failure */
      }

      // Key directional (sun) light for crisp foliage shading. Shadows optional (default on).
      try {
        const sunIntensity = (typeof window !== 'undefined' && window.__TT_SUN_INTENSITY__) || 1.15;
        const sun = new three.DirectionalLight(0xfff2e0, sunIntensity);
        sun.position.set(-6, 9, 5); // angled key
        sun.name = 'SunKeyLight';
        const enableShadows =
          typeof window === 'undefined' || window.__TT_ENABLE_SHADOWS__ !== false;
        if (enableShadows) {
          sun.castShadow = true;
          // Shadow map tuned to board size later; initial conservative bounds.
          const sCam = sun.shadow.camera;
          const span = Math.max(this.gameManager?.cols || 25, this.gameManager?.rows || 25) * 0.6;
          sCam.left = -span;
          sCam.right = span;
          sCam.top = span;
          sCam.bottom = -span;
          sCam.near = 0.5;
          sCam.far = 60;
          sun.shadow.mapSize.set(1024, 1024);
          sun.shadow.bias = -0.0005;
          sun.shadow.normalBias = 0.005;
        }
        this.scene.add(sun);
      } catch (_) {
        /* ignore sun light */
      }
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
        try {
          if (typeof window === 'undefined' || window.__TT_ENABLE_SHADOWS__ !== false) {
            this.renderer.shadowMap.enabled = true;
            if (three.PCFSoftShadowMap) this.renderer.shadowMap.type = three.PCFSoftShadowMap;
          }
        } catch (_) {
          /* ignore shadow enabling */
        }
        // Ensure correct color management so vertex colors authored in sRGB space are displayed faithfully.
        try {
          if (three.ColorManagement) {
            three.ColorManagement.enabled = true; // r170 still allows explicit enable
          }
        } catch (_) {
          /* ignore color mgmt */
        }
        try {
          // r152+ uses outputColorSpace instead of deprecated outputEncoding
          if (this.renderer.outputColorSpace !== undefined && three.SRGBColorSpace) {
            this.renderer.outputColorSpace = three.SRGBColorSpace;
          }
        } catch (_) {
          /* ignore colorspace */
        }
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

      // Wheel (zoom) listener attached to container (canvas has pointerEvents: none)
      try {
        if (!this._wheelListener && container) {
          this._wheelListener = (e) => {
            try {
              const dy = e.deltaY;
              const step = Math.exp(0.2); // ~1.22 per wheel notch
              // Inverted semantics: larger this._zoom => closer (smaller frustum via 1/zoom)
              let next = this._targetZoom * (dy > 0 ? 1 / step : step);
              if (next < this._minZoom) next = this._minZoom;
              if (next > this._maxZoom) next = this._maxZoom;
              this._targetZoom = next;
              if (this._zoomEase === 0) {
                this._zoom = this._targetZoom;
                this.reframe();
              }
              e.preventDefault();
            } catch (_) {
              /* ignore wheel */
            }
          };
          container.addEventListener('wheel', this._wheelListener, { passive: false });
        }
      } catch (_) {
        /* ignore wheel attach */
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
    const w = (typeof window !== 'undefined' && window.innerWidth) || 800;
    const h = (typeof window !== 'undefined' && window.innerHeight) || 600;
    try {
      this.renderer.setSize(w, h, false);
    } catch (_) {
      /* noop */
    }
    const aspect = w / h;
    const cols = this.gameManager?.cols || 25;
    const rows = this.gameManager?.rows || 25;
    const span = Math.max(cols, rows) * 0.6;
    this.camera.left = -span * aspect;
    this.camera.right = span * aspect;
    this.camera.top = span;
    this.camera.bottom = -span;
    try {
      this.camera.updateProjectionMatrix();
    } catch (_) {
      /* noop */
    }
  }

  _loop() {
    if (!this.renderer || !this.camera) return;
    const step = (ts) => {
      // timing / frame metrics
      if (this._metrics.lastFrameTs != null) {
        this._metrics.accumulatedMs += ts - this._metrics.lastFrameTs;
      }
      this._metrics.lastFrameTs = ts;
      // zoom easing
      try {
        this._updateZoom(ts - (this._prevZoomTs || ts));
      } catch (_) {
        /* noop */
      }
      this._prevZoomTs = ts;
      // render
      try {
        this.renderer.render(this.scene, this.camera);
      } catch (_) {
        /* noop */
      }
      // animation callbacks
      if (this._animCallbacks.length) {
        for (const fn of this._animCallbacks) {
          try {
            fn(ts);
          } catch (_) {
            /* noop */
          }
        }
      }
      // metrics export
      this._metrics.frameCount += 1;
      if (!this._loggedFirstFrame && this._metrics.frameCount === 1) {
        this._loggedFirstFrame = true;
        try {
          console.info('[ThreeSceneManager] First frame rendered', {
            degraded: this.degraded,
            startTime: this._metrics.startTime,
          });
        } catch (_) {
          /* noop */
        }
      }
      if (typeof window !== 'undefined') {
        try {
          window.__TT_METRICS__ = window.__TT_METRICS__ || {};
          window.__TT_METRICS__.three = this.getRenderStats();
        } catch (_) {
          /* noop */
        }
      }
      this._animationHandle = requestAnimationFrame(step);
    };
    this._animationHandle = requestAnimationFrame(step);
  }

  _injectDebugOverlay() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('three-debug-overlay')) return;
    let overlay;
    try {
      overlay = document.createElement('div');
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
    } catch (_) {
      /* noop */
    }
    const updateOverlay = () => {
      try {
        const stats = this.getRenderStats();
        const place = (window.__TT_METRICS__ && window.__TT_METRICS__.placeables) || {};
        if (overlay) {
          overlay.textContent = `3D frames:${stats.frameCount} avg:${stats.averageFrameMs.toFixed(2)}ms placeableGroups:${place.groups || 0} instances:${place.liveInstances || 0}`;
        }
      } catch (_) {
        /* noop */
      }
      requestAnimationFrame(updateOverlay);
    };
    requestAnimationFrame(updateOverlay);
  }

  setIsometricMode(enabled = true) {
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
  setIsoPitchDegrees(deg) {
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
  setCameraPitchDegrees(deg, { lock = false } = {}) {
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

  /** Internal: apply isometric camera base placement & debugging */
  _applyIsoCameraBase({ cx, cz, span }) {
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
  _computeIsoPosition({ isoPitch, isoYaw, cx, cz }) {
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

  /** Emit diagnostic info about current isometric pixel step ratio & effective pitch. */
  debugIsoCamera() {
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
  measureTileStepPixelsProjected() {
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
  calibrateTo2DTileAspect({ iterations = 28, minDeg = 10, maxDeg = 60 } = {}) {
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

  /** Smooth zoom interpolation (called per frame) */
  _updateZoom(dtMs) {
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

  setZoom(z) {
    if (!Number.isFinite(z)) return;
    const clamped = Math.min(this._maxZoom, Math.max(this._minZoom, z));
    this._targetZoom = clamped;
  }
  getZoom() {
    return this._zoom;
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

// Test environment hook: register instances for automatic cleanup if tracking enabled
try {
  if (typeof globalThis !== 'undefined' && !ThreeSceneManager.__TT_REGISTER_PATCHED__) {
    const origInit = ThreeSceneManager.prototype.initialize;
    ThreeSceneManager.prototype.initialize = async function patchedInitialize(...args) {
      const res = await origInit.apply(this, args);
      try {
        if (globalThis.__TT_REGISTER_THREE__) {
          globalThis.__TT_REGISTER_THREE__(this);
        }
      } catch (_) {
        /* ignore */
      }
      return res;
    };
    ThreeSceneManager.__TT_REGISTER_PATCHED__ = true;
  }
} catch (_) {
  /* ignore */
}
