// ThreeSceneManager.js
// Phase 1 bootstrap: minimal Three.js scene lifecycle behind feature flag.
// Safe to import in Jest/jsdom; dynamic loads and guards prevent hard WebGL dependency.

export class ThreeSceneManager {
  constructor(gameManager) {
    this.gameManager = gameManager;
    this.initialized = false;
    this.degraded = false; // true if WebGL init failed but we continue gracefully
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.canvas = null;
    this._animationHandle = null;
    // Metrics
    this._metrics = {
      startTime: null,
      frameCount: 0,
      accumulatedMs: 0,
      lastFrameTs: null,
    };
    this._loggedFirstFrame = false;
  }

  async initialize(containerId = 'game-container') {
    if (this.initialized) return; // idempotent
    let three;
    try {
      // Dynamic import so tests that don't need Three skip heavy path until invoked
      three = await import('three');
    } catch (e) {
      this.degraded = true;
      return; // can't even load module
    }

    try {
      this.scene = new three.Scene();
      // Basic ambient light so future objects are visible
      this.scene.add(new three.AmbientLight(0xffffff, 0.6));

      // Minimal reference grid plane (Phase 1): single flat plane to visualize world origin.
      try {
        const gridMaterial = new three.MeshBasicMaterial({
          color: 0x555555,
          wireframe: true,
          transparent: true,
          opacity: 0.25,
        });
        const gridGeometry = new three.PlaneGeometry(40, 40, 20, 20);
        const gridMesh = new three.Mesh(gridGeometry, gridMaterial);
        gridMesh.rotation.x = -Math.PI / 2; // make it horizontal (X/Z plane)
        gridMesh.position.set(20, 0, 20); // center around expected playable region (0..40)
        gridMesh.name = 'BootstrapGridPlane';
        this.scene.add(gridMesh);
      } catch (_) {
        /* non-fatal */
      }

      // Orthographic camera approximating existing isometric scale (will be tuned later)
      const aspect = 1; // placeholder; updated on resize
      const frustum = 20; // world units half-span
      this.camera = new three.OrthographicCamera(
        -frustum * aspect,
        frustum * aspect,
        frustum,
        -frustum,
        -100,
        500
      );
      this.camera.position.set(20, 40, 20); // simple elevated angle
      this.camera.lookAt(0, 0, 0);

      this.canvas = document.createElement('canvas');
      this.canvas.setAttribute('data-three', 'true');
      this.canvas.style.position = 'absolute';
      this.canvas.style.inset = '0';
      this.canvas.style.pointerEvents = 'none'; // non-interactive overlay for now
      this.canvas.style.zIndex = '0'; // current PIXI likely above; we'll manage ordering later

      this.renderer = new three.WebGLRenderer({
        canvas: this.canvas,
        antialias: true,
        alpha: true,
      });
      this.renderer.setPixelRatio(window.devicePixelRatio || 1);
      this._resize();
      window.addEventListener('resize', () => this._resize());

      const container = document.getElementById(containerId) || document.body;
      container.prepend(this.canvas); // place behind existing 2D content

      this.initialized = true;
      if (!this._metrics.startTime) {
        this._metrics.startTime =
          (typeof performance !== 'undefined' && performance.now()) || Date.now();
      }
      this._loop();
    } catch (e) {
      // Fallback to degraded mode (no renderer) but keep scene objects available for logic tests
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
      // Update camera frustum to current aspect for orthographic view
      const aspect = w / h;
      const span = 20;
      this.camera.left = -span * aspect;
      this.camera.right = span * aspect;
      this.camera.top = span;
      this.camera.bottom = -span;
      this.camera.updateProjectionMatrix();
    } catch (_) {
      /* non-fatal */
    }
  }

  _loop() {
    if (!this.renderer || !this.scene || !this.camera) return;
    const step = () => {
      if (!this.renderer) return; // disposed
      try {
        this.renderer.render(this.scene, this.camera);
      } catch (_) {
        // stop loop on persistent errors
        return;
      }
      // Metrics update
      try {
        const now = (typeof performance !== 'undefined' && performance.now()) || Date.now();
        if (this._metrics.lastFrameTs != null) {
          this._metrics.accumulatedMs += now - this._metrics.lastFrameTs;
        }
        this._metrics.lastFrameTs = now;
        this._metrics.frameCount += 1;
        if (!this._loggedFirstFrame && this._metrics.frameCount === 1) {
          this._loggedFirstFrame = true;
          try {
            // Lightweight one-time console info for diagnostics
            // eslint-disable-next-line no-console
            console.info('[ThreeSceneManager] First frame rendered', {
              degraded: this.degraded,
              startTime: this._metrics.startTime,
            });
          } catch (_) {
            /* ignore */
          }
        }
        // Optionally expose metrics globally for quick dev introspection
        if (typeof window !== 'undefined') {
          window.__TT_METRICS__ = window.__TT_METRICS__ || {};
          window.__TT_METRICS__.three = this.getRenderStats();
        }
      } catch (_) {
        /* ignore metrics errors */
      }
      this._animationHandle = requestAnimationFrame(step);
    };
    this._animationHandle = requestAnimationFrame(step);
  }

  /** Public: snapshot of render stats */
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
      window.removeEventListener('resize', this._resize);
      if (this.renderer) this.renderer.dispose();
      if (this.canvas && this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    } catch (_) {
      /* ignore */
    }
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.canvas = null;
    this.initialized = false;
  }
}
