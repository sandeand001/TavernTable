// SpatialCoordinator.js
// Phase 0: Canonical grid <-> world mapping abstraction for 3D transition.
// This introduces a stable coordinate contract without changing existing 2D behavior.
// World Axis Convention: X (east), Z (south), Y (up).
// Defaults (can be tuned later): one grid cell = 1 world unit on X and Z, elevation level = 0.5 world units.

export class SpatialCoordinator {
  constructor(options = {}) {
    const {
      tileWorldSize = 1.0, // width & depth of a single grid tile in world units
      elevationUnit = 0.5, // world units per elevation level
    } = options;

    this.tileWorldSize = tileWorldSize;
    this.elevationUnit = elevationUnit;
  }

  /**
   * Convert grid (gx, gy, elevation) to world coordinates.
   * Grid (0,0) maps to world (0,0,0). We center tiles at their origin; consumers can offset for visuals.
   * @param {number} gx
   * @param {number} gy
   * @param {number} elevation (integer or float levels)
   * @returns {{x:number,y:number,z:number}}
   */
  gridToWorld(gx, gy, elevation = 0) {
    const x = gx * this.tileWorldSize;
    const z = gy * this.tileWorldSize;
    const y = elevation * this.elevationUnit;
    return { x, y, z };
  }

  /**
   * Convert world (x,z) back to integer grid. Rounds to nearest; callers can choose custom snapping later.
   * @param {number} x
   * @param {number} z
   * @returns {{gridX:number, gridY:number}}
   */
  worldToGrid(x, z) {
    const size = this.tileWorldSize || 1;
    const invSize = 1 / size;
    const gridX = Math.floor(x * invSize);
    const gridY = Math.floor(z * invSize);
    return { gridX, gridY };
  }

  /**
   * Convert elevation in levels to world Y displacement.
   * @param {number} elevation
   * @returns {number}
   */
  elevationToWorldY(elevation) {
    return elevation * this.elevationUnit;
  }

  /**
   * Optionally update scale factors (e.g., when user changes elevation scale UI).
   */
  reconfigure({ tileWorldSize, elevationUnit } = {}) {
    if (Number.isFinite(tileWorldSize) && tileWorldSize > 0) this.tileWorldSize = tileWorldSize;
    if (Number.isFinite(elevationUnit) && elevationUnit > 0) this.elevationUnit = elevationUnit;
  }
}
