/* eslint-disable prettier/prettier */
// ThreeSceneManager.js
// Clean implementation with camera mode toggles and debug overlay.

import { GRID_CONFIG } from '../config/GameConstants.js';
import { logger, LOG_LEVEL, LOG_CATEGORY } from '../utils/Logger.js';
import { errorHandler, ERROR_SEVERITY, ERROR_CATEGORY } from '../utils/ErrorHandler.js';

import { installLightingMethods } from './lighting/LightingSystem.js';
import { installGridOverlayMethods } from './grid/GridOverlay.js';
import { installCameraMethods } from './camera/CameraSystem.js';

export class ThreeSceneManager {
  constructor(gameManager) {
    this.gameManager = gameManager;
    this.initialized = false;
    this.degraded = false;
    this.degradeReason = null;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.canvas = null;
    this._animationHandle = null;
    this._animCallbacks = [];
    this._sunLight = null;
    this._sunTarget = null;
    this._sunOffset = { x: -12, y: 14, z: 10 };
    this._sunRadius = Math.hypot(this._sunOffset.x, this._sunOffset.z) || 1;
    this._sunAzimuthRad = Math.atan2(this._sunOffset.z, this._sunOffset.x);
    this._targetSunAzimuthRad = this._sunAzimuthRad;
    this._sunAzimuthOffsetDeg = -40;
    this._sunTimeMinutes = 720;
    this._sunMinElevation = 6;
    this._sunMaxElevation = 14;
    this._sunAnimActive = false;
    this._sunAnimFn = null;
    this._sunLastAnimTs = null;
    this._sunLerpTauMs = 220;
    this.brushOverlay = null;
    this._gridOverlayGroup = null;
    this._gridOverlayKey = null;
    this._gridOverlayBaseStyle = {
      fillColor: GRID_CONFIG.TILE_COLOR,
      fillAlpha: GRID_CONFIG.TILE_FILL_ALPHA,
      borderColor: GRID_CONFIG.TILE_BORDER_COLOR,
      borderAlpha: GRID_CONFIG.TILE_BORDER_ALPHA,
    };
    this._gridOverlayStyle = { ...this._gridOverlayBaseStyle };
    this._gridOverlayStyleStack = [];
    this._terrainMeshOpacity = 1;
    this._ambientLight = null;
    this._hemisphereLight = null;
    this._timeOfDayProfile = null;
    this._terrainColorAttribute = null;
    this._terrainBaseColors = null;
    this._terrainColorGeometryId = null;
    this._placeablePool = null;
    this._colorCacheLinear = new Map();
    this._pendingLightingProfile = null;
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
    this._degradeNotified = false;
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
      this._handleDegraded('Three.js failed to load', { errorType: e?.constructor?.name });
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
      if (!this._hasUsableWebGLContext()) {
        this._handleDegraded('WebGL not available in this environment', {
          reason: 'webgl_unavailable',
        });
        return;
      }

      this.scene = new three.Scene();

      // Ambient light (boosted vs earlier 0.6). Allow runtime override via window.__TT_AMBIENT_INTENSITY__.
      let ambient = null;
      try {
        const ambIntensity =
          (typeof window !== 'undefined' && window.__TT_AMBIENT_INTENSITY__) || 0.9;
        ambient = new three.AmbientLight(0xffffff, ambIntensity);
      } catch (_) {
        ambient = null;
      }
      if (!ambient) {
        try {
          ambient = new three.AmbientLight(0xffffff, 0.9);
        } catch (_) {
          ambient = null;
        }
      }
      if (ambient) {
        try {
          ambient.name = 'GlobalAmbientLight';
        } catch (_) {
          /* ignore */
        }
        this.scene.add(ambient);
        this._ambientLight = ambient;
      }

      // Soft hemisphere fill to reduce dark undertone (sky light + subtle ground bounce)
      let hemi = null;
      try {
        hemi = new three.HemisphereLight(0xf0f4ff, 0x3a2e1a, 0.55);
      } catch (_) {
        hemi = null;
      }
      if (hemi) {
        try {
          hemi.name = 'TerrainHemiFill';
        } catch (_) {
          /* ignore */
        }
        this.scene.add(hemi);
        this._hemisphereLight = hemi;
      }

      // Key directional (sun) light for crisp foliage shading. Shadows optional (default on).
      try {
        const sunIntensity = (typeof window !== 'undefined' && window.__TT_SUN_INTENSITY__) || 1.15;
        const sun = new three.DirectionalLight(0xfff2e0, sunIntensity);
        sun.position.set(this._sunOffset.x, this._sunOffset.y, this._sunOffset.z); // relative offset; recentered after scene init
        sun.name = 'SunKeyLight';
        const enableShadows =
          typeof window === 'undefined' || window.__TT_ENABLE_SHADOWS__ !== false;
        if (enableShadows) {
          sun.castShadow = true;
          // Shadow map tuned to board size later; initial conservative bounds.
          const sCam = sun.shadow.camera;
          const gridW = this.gameManager?.cols || 25;
          const gridH = this.gameManager?.rows || 25;
          // Use full dimension *0.75 to reduce clipping at edges while limiting wasted shadow space.
          const span = Math.max(gridW, gridH) * 0.75;
          sCam.left = -span;
          sCam.right = span;
          sCam.top = span;
          sCam.bottom = -span;
          sCam.near = 0.5;
          sCam.far = 90;
          // Nudge update for helper tools if any (no-op in production)
          sCam.updateProjectionMatrix?.();
          // Increase map size slightly for sharper mid-board shadows.
          sun.shadow.mapSize.set(1536, 1536);
          sun.shadow.bias = -0.0005;
          sun.shadow.normalBias = 0.005;
          try {
            if (!this.__loggedSunShadow) {
              this.__loggedSunShadow = true;
              // eslint-disable-next-line no-console
              if (!(typeof window !== 'undefined' && window.__TT_QUIET_LOGS__))
                console.info('[ThreeSceneManager] Sun shadow camera', {
                  span,
                  left: sCam.left,
                  right: sCam.right,
                  top: sCam.top,
                  bottom: sCam.bottom,
                  near: sCam.near,
                  far: sCam.far,
                  mapSize: sun.shadow.mapSize?.x,
                });
            }
          } catch (_) {
            /* ignore */
          }
        }
        this.scene.add(sun);
        try {
          const target = sun.target || new three.Object3D();
          const metrics = this._getBoardMetrics();
          if (metrics) {
            target.position.set(metrics.centerX, 0, metrics.centerZ);
          }
          if (!target.parent && this.scene && typeof this.scene.add === 'function') {
            this.scene.add(target);
          }
          this._sunTarget = target;
        } catch (_) {
          this._sunTarget = sun.target;
        }
        this._sunLight = sun;
        this._updateSunCoverage();
        this._ensureSunAnimator();
        this._applyStoredSunTime();
        try {
          const profile = this.getTimeOfDayProfile(this._sunTimeMinutes ?? 720);
          this._applyTimeOfDayProfile(profile);
        } catch (_) {
          /* ignore initial lighting profile errors */
        }
      } catch (_) {
        /* ignore sun light */
      }
      this._rebuildGridOverlay();
      const initialGridVisible =
        typeof window !== 'undefined' &&
        typeof window.__TT_PENDING_BOOTSTRAP_GRID_VISIBLE === 'boolean'
          ? !!window.__TT_PENDING_BOOTSTRAP_GRID_VISIBLE
          : true;
      this.setBootstrapGridVisible(initialGridVisible);
      this._ensureBrushOverlay();

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
        try {
          this.renderer = new three.WebGLRenderer({
            canvas: this.canvas,
            antialias: true,
            alpha: true,
          });
        } catch (rendererError) {
          this._handleDegraded('Failed to create WebGL renderer', {
            reason: 'renderer_creation_failed',
            errorType: rendererError?.constructor?.name,
          });
          return;
        }
        try {
          if (typeof window === 'undefined' || window.__TT_ENABLE_SHADOWS__ !== false) {
            this.renderer.shadowMap.enabled = true;
            if (three.PCFSoftShadowMap) this.renderer.shadowMap.type = three.PCFSoftShadowMap;
            try {
              // Debug: log once to verify shadow system toggled
              if (!this.__loggedShadowInit) {
                this.__loggedShadowInit = true;
                // eslint-disable-next-line no-console
                if (!(typeof window !== 'undefined' && window.__TT_QUIET_LOGS__))
                  console.info('[ThreeSceneManager] ShadowMap enabled', {
                    type: this.renderer.shadowMap.type,
                  });
              }
            } catch (_) {
              /* ignore */
            }
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
        // Also debounce elevation parity sync so 3D height steps continue matching 2D pixel steps after viewport resize.
        try {
          if (!this._boundElevSync) {
            let t = null;
            this._boundElevSync = () => {
              if (t) clearTimeout(t);
              t = setTimeout(() => {
                try {
                  this.gameManager?.sync3DElevationScaling?.({ rebuild: false });
                } catch (_) {
                  /* ignore */
                }
              }, 120);
            };
            window.addEventListener('resize', this._boundElevSync);
          }
        } catch (_) {
          /* ignore elevation sync hook errors */
        }
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
      this._handleDegraded(e?.message || 'Three.js initialization failed', {
        errorType: e?.constructor?.name,
      });
    }
  }

  _hasUsableWebGLContext() {
    try {
      const isTestEnv =
        this?._testMode === true ||
        (typeof globalThis !== 'undefined' &&
          !!(globalThis.process?.env?.JEST_WORKER_ID ?? globalThis.process?.env?.TT_TEST_MODE));
      if (isTestEnv) {
        return true;
      }
      if (typeof document === 'undefined') return false;
      const canvas = document.createElement('canvas');
      const attrs = { failIfMajorPerformanceCaveat: true };
      const gl =
        canvas.getContext('webgl2', attrs) ||
        canvas.getContext('webgl', attrs) ||
        canvas.getContext('experimental-webgl', attrs);
      if (gl && typeof gl.getExtension === 'function') {
        try {
          const lose = gl.getExtension('WEBGL_lose_context');
          lose?.loseContext?.();
        } catch (_) {
          /* ignore */
        }
      }
      return !!gl;
    } catch (_) {
      return false;
    }
  }

  _handleDegraded(message, extra = {}) {
    this.degraded = true;
    if (message) {
      this.degradeReason = message;
    } else if (!this.degradeReason) {
      this.degradeReason = 'Three.js unavailable';
    }
    this.initialized = false;
    try {
      if (this._animationHandle) {
        try {
          cancelAnimationFrame(this._animationHandle);
        } catch (_) {
          /* ignore */
        }
      }
      this._animationHandle = null;
      if (this._boundResize && typeof window !== 'undefined') {
        window.removeEventListener('resize', this._boundResize);
      }
      this._boundResize = null;
      if (this._boundElevSync && typeof window !== 'undefined') {
        window.removeEventListener('resize', this._boundElevSync);
      }
      this._boundElevSync = null;
      this.scene = null;
      this.camera = null;
      if (this.renderer?.dispose) {
        try {
          this.renderer.dispose();
        } catch (_) {
          /* ignore */
        }
      }
      this.renderer = null;
      try {
        if (this.canvas?.parentNode) {
          this.canvas.parentNode.removeChild(this.canvas);
        }
      } catch (_) {
        /* ignore */
      }
      this.canvas = null;
    } catch (_) {
      /* ignore */
    }
    if (!this.scene) {
      this.scene = { children: [], isPlaceholderScene: true };
    }
    if (!this.camera) {
      this.camera = { isPlaceholderCamera: true };
    }
    try {
      logger.log(
        LOG_LEVEL.WARN,
        '3D renderer unavailable; continuing in 2D mode',
        LOG_CATEGORY.SYSTEM,
        {
          context: 'ThreeSceneManager.initialize',
          message: this.degradeReason,
          ...extra,
        }
      );
    } catch (_) {
      /* ignore */
    }
    try {
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        const detail = { reason: this.degradeReason, meta: { ...extra } };
        window.dispatchEvent(new CustomEvent('tt-hybrid-degraded', { detail }));
      }
    } catch (_) {
      /* ignore */
    }
    try {
      if (!this._degradeNotified && errorHandler) {
        errorHandler.handle(
          new Error(this.degradeReason),
          ERROR_SEVERITY.WARNING,
          ERROR_CATEGORY.RENDERING,
          {
            context: 'ThreeSceneManager.initialize',
            reason: this.degradeReason,
            suggestion:
              'Enable hardware acceleration (WebGL) in your browser settings to use the 3D renderer.',
          }
        );
        this._degradeNotified = true;
      }
    } catch (_) {
      /* ignore */
    }
    this._ensureDegradedPlaceholders();
  }

  ensureFallbackSurface() {
    if (!this.degraded) return;
    this._ensureDegradedPlaceholders();
  }

  _ensureDegradedPlaceholders() {
    const rect = (width = 1024, height = 768) => ({
      left: 0,
      top: 0,
      width,
      height,
      right: width,
      bottom: height,
    });

    try {
      const three = this.three;
      if (three) {
        if (!this.scene) {
          try {
            this.scene = new three.Scene();
          } catch (_) {
            this.scene = { isDegradedPlaceholder: true };
          }
        }
        if (!this.camera && three.OrthographicCamera) {
          try {
            const cols = this.gameManager?.cols || 25;
            const rows = this.gameManager?.rows || 25;
            const span = Math.max(cols, rows) * 0.6;
            const aspect = 1;
            this.camera = new three.OrthographicCamera(
              -span * aspect,
              span * aspect,
              span,
              -span,
              -100,
              500
            );
            this._applyCameraBase?.({ cx: cols * 0.5, cz: rows * 0.5, span });
          } catch (_) {
            this.camera = this.camera || { isDegradedPlaceholder: true };
          }
        }
      }
    } catch (_) {
      if (!this.scene) this.scene = { isDegradedPlaceholder: true };
      if (!this.camera) this.camera = { isDegradedPlaceholder: true };
    }

    if (!this.canvas) {
      if (typeof document !== 'undefined' && document.createElement) {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = canvas.width || 1024;
          canvas.height = canvas.height || 768;
          canvas.style = canvas.style || {};
          if (typeof canvas.getBoundingClientRect !== 'function') {
            canvas.getBoundingClientRect = () => rect(canvas.width, canvas.height);
          }
          this.canvas = canvas;
        } catch (_) {
          /* ignore */
        }
      }
      if (!this.canvas) {
        const width = 1024;
        const height = 768;
        this.canvas = {
          width,
          height,
          style: {},
          addEventListener: () => {},
          removeEventListener: () => {},
          getBoundingClientRect: () => rect(width, height),
        };
      }
    } else if (typeof this.canvas.getBoundingClientRect !== 'function') {
      const width = this.canvas.width || 1024;
      const height = this.canvas.height || 768;
      this.canvas.getBoundingClientRect = () => rect(width, height);
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
    this._updateSunCoverage();
  }

  _getBoardMetrics() {
    try {
      const tileSize = this.gameManager?.spatial?.tileWorldSize || 1;
      const cols = Number.isFinite(this.gameManager?.cols) ? this.gameManager.cols : 25;
      const rows = Number.isFinite(this.gameManager?.rows) ? this.gameManager.rows : 25;
      const width = cols * tileSize;
      const depth = rows * tileSize;
      return {
        cols,
        rows,
        tileSize,
        centerX: width * 0.5,
        centerZ: depth * 0.5,
        halfWidth: width * 0.5,
        halfDepth: depth * 0.5,
        maxHalfSpan: Math.max(width, depth) * 0.5,
      };
    } catch (_) {
      return null;
    }
  }

  _computeTileHeights(cols, rows) {
    const total = cols * rows;
    const heights = new Float32Array(total);
    const gm = this.gameManager;
    const hasSampler = !!(gm && typeof gm.getTerrainHeight === 'function');
    const unitRaw = gm?.spatial?.elevationUnit;
    const elevationUnit = Number.isFinite(unitRaw) ? unitRaw : 0.5;

    let idx = 0;
    for (let gy = 0; gy < rows; gy += 1) {
      for (let gx = 0; gx < cols; gx += 1, idx += 1) {
        let heightLevel = 0;
        if (hasSampler) {
          try {
            const sample = gm.getTerrainHeight(gx, gy);
            if (Number.isFinite(sample)) heightLevel = sample;
          } catch (_) {
            /* ignore */
          }
        }
        heights[idx] = heightLevel * elevationUnit;
      }
    }

    return { heights, elevationUnit };
  }

  _updateSunCoverage() {
    const sun = this._sunLight;
    if (!sun || !this.scene) return;
    const metrics = this._getBoardMetrics();
    if (!metrics) return;
    this._rebuildGridOverlay(metrics);
    const { centerX, centerZ, halfWidth, halfDepth, maxHalfSpan } = metrics;
    try {
      const target = this._sunTarget || sun.target;
      if (target) {
        target.position.set(centerX, 0, centerZ);
        if (!target.parent && typeof this.scene.add === 'function') {
          this.scene.add(target);
        }
        target.updateMatrixWorld?.();
      }
    } catch (_) {
      /* ignore target failures */
    }
    try {
      if (sun.position) {
        sun.position.set(
          centerX + this._sunOffset.x,
          this._sunOffset.y,
          centerZ + this._sunOffset.z
        );
      }
    } catch (_) {
      /* ignore position failures */
    }
    try {
      const cam = sun.shadow?.camera;
      if (cam) {
        const padding = Math.max(halfWidth, halfDepth) * 0.35 + 2;
        const extent = Math.max(halfWidth, halfDepth) + padding;
        cam.left = -extent;
        cam.right = extent;
        cam.top = extent;
        cam.bottom = -extent;
        cam.near = Math.min(cam.near || 0.5, 0.5);
        const minFar = this._sunOffset.y + maxHalfSpan * 3 + 10;
        cam.far = Math.max(cam.far || 90, minFar);
        cam.updateProjectionMatrix?.();
        try {
          if (sun.shadow) sun.shadow.needsUpdate = true;
        } catch (_) {
          /* ignore */
        }
      }
    } catch (_) {
      /* ignore shadow failures */
    }
    try {
      sun.updateMatrixWorld?.();
    } catch (_) {
      /* ignore */
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
          if (!(typeof window !== 'undefined' && window.__TT_QUIET_LOGS__))
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
      degradeReason: this.degradeReason,
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
      if (this._gridOverlayGroup) {
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
        if (this._gridOverlayGroup.parent) {
          this._gridOverlayGroup.parent.remove(this._gridOverlayGroup);
        }
      }
    } catch (_) {
      /* ignore */
    }
    try {
      this.brushOverlay?.dispose?.();
    } catch (_) {
      /* ignore */
    }
    this.brushOverlay = null;
    this._gridOverlayGroup = null;
    this._gridOverlayKey = null;
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

// Install mixin methods onto prototype.
installLightingMethods(ThreeSceneManager.prototype);
installGridOverlayMethods(ThreeSceneManager.prototype);
installCameraMethods(ThreeSceneManager.prototype);
