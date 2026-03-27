// CameraRig.js
// Phase 1: Orthographic camera controller abstraction (pan, zoom, target focus).
// Pure math; no direct Three.js dependency beyond expected camera interface.

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

  attach(camera) {
    this.camera = camera;
    this._apply();
  }

  setTarget(x, z) {
    this.target.x = x;
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

  _apply() {
    if (!this.camera) return;
    const span = this.baseSpan * this.zoom;
    const aspect = this._getAspect();
    // Expect orthographic camera signature (left/right/top/bottom props + updateProjectionMatrix)
    if (typeof this.camera.left === 'number') {
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
    // Position camera relative to target while preserving its elevation vector
    if (this.camera.position) {
      // Keep Y; shift X/Z to follow target with an offset (iso-like angle assumption: camera looks from northwest)
      const y = this.camera.position.y ?? 40;
      const offset = span; // distance scaling with zoom keeps framing consistent
      this.camera.position.x = this.target.x - offset;
      this.camera.position.z = this.target.z - offset;
      this.camera.position.y = y;
    }
    if (typeof this.camera.lookAt === 'function') {
      try {
        this.camera.lookAt(this.target.x, 0, this.target.z);
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
