// CameraRig.js
// Camera controller abstraction (pan, zoom, target focus).
// Pure math; no direct Three.js dependency beyond expected camera interface.

// ── Camera Rig ─────────────────────────────────────────────────
export class CameraRig {
  constructor(options = {}) {
    const {
      minZoom = 0.4,
      maxZoom = 3.0,
      zoomStep = 0.1,
      baseSpan = 20, // matches ThreeSceneManager initial span
      startZoom = 1.0,
      target = { x: 20, z: 20 },
    } = options;
    this.minZoom = minZoom;
    this.maxZoom = maxZoom;
    this.zoomStep = zoomStep;
    this.baseSpan = baseSpan;
    this.zoom = startZoom;
    this.target = { ...target };
    this.camera = null; // assigned on attach
  }

  // ── Public API ──────────────────────────────────────────────────

  attach(camera, { target = null, zoom = null } = {}) {
    this.camera = camera;
    if (target) this.target = { ...target };
    if (Number.isFinite(zoom)) this.zoom = zoom;
    this._appliedTarget = { ...this.target };
    this._perspectiveZoomScale = camera?.isPerspectiveCamera ? camera.zoom * this.zoom : 1;
    // Do NOT call _apply() here — CameraSystem._applyCameraBase owns initial camera
    // positioning. The rig only applies when explicitly panned/zoomed.
  }

  setTarget(x, z, y = this.target.y ?? 0) {
    this.target.x = x;
    this.target.y = y;
    this.target.z = z;
    this._apply();
  }

  pan(dx, dz) {
    this.target.x += dx;
    this.target.z += dz;
    this._apply();
  }

  zoomIn() {
    this.setZoom(this.zoom - this.zoomStep);
  }

  zoomOut() {
    this.setZoom(this.zoom + this.zoomStep);
  }

  setZoom(value) {
    const clamped = Math.min(this.maxZoom, Math.max(this.minZoom, value));
    if (clamped === this.zoom) return;
    this.zoom = clamped;
    this._apply();
  }

  // ── Internal ────────────────────────────────────────────────────

  _apply() {
    if (!this.camera) return;
    const span = this.baseSpan * this.zoom;
    const aspect = this._getAspect();
    if (this.camera.isPerspectiveCamera) {
      this.camera.zoom = this._perspectiveZoomScale / this.zoom;
      this.camera.updateProjectionMatrix();
    } else if (typeof this.camera.left === 'number') {
      this.camera.left = -span * aspect;
      this.camera.right = span * aspect;
      this.camera.top = span;
      this.camera.bottom = -span;
      if (typeof this.camera.updateProjectionMatrix === 'function') {
        try {
          this.camera.updateProjectionMatrix();
        } catch (_) {
          /* ignore */
        }
      }
    }
    if (this.camera.position) {
      const previous = this._appliedTarget || this.target;
      this.camera.position.x += this.target.x - previous.x;
      this.camera.position.y += (this.target.y ?? 0) - (previous.y ?? 0);
      this.camera.position.z += this.target.z - previous.z;
    }
    this._appliedTarget = { ...this.target };
    if (typeof this.camera.lookAt === 'function') {
      try {
        this.camera.lookAt(this.target.x, this.target.y ?? 0, this.target.z);
      } catch (_) {
        /* ignore */
      }
    }
  }

  _getAspect() {
    try {
      const w = window.innerWidth || 800;
      const h = window.innerHeight || 600;
      return w / h;
    } catch (_) {
      return 4 / 3;
    }
  }
}
