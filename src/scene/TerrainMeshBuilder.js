// TerrainMeshBuilder.js - Phase 2 scaffold
// Responsible for constructing a heightfield mesh (initially flat) from grid elevation data.
// Future: will incorporate smoothing, normals, materials, biome-driven vertex color.

export class TerrainMeshBuilder {
  constructor(opts = {}) {
    this.tileWorldSize = opts.tileWorldSize || 1.0; // world units per tile (X/Z)
    this.elevationUnit = opts.elevationUnit || 0.5; // world Y per elevation level
  }

  build({ cols, rows, getHeight, three }) {
    if (!three) throw new Error('Three namespace required');
    if (!Number.isInteger(cols) || !Number.isInteger(rows)) {
      throw new Error('cols/rows must be integers');
    }
    const width = cols * this.tileWorldSize;
    const depth = rows * this.tileWorldSize;

    // Use PlaneGeometry oriented on X/Z (rotate later)
    const geo = new three.PlaneGeometry(width, depth, cols, rows);
    // Rotate to lie horizontally (Three plane by default is XY)
    geo.rotateX(-Math.PI / 2);

    // Elevation assignment: vertices aligned grid-wise. PlaneGeometry with segments (cols, rows)
    // yields (cols+1)*(rows+1) vertices in row-major order across X then Z.
    const pos = geo.attributes.position;
    const vxCount = pos.count;
    const vertsPerRow = cols + 1;
    for (let i = 0; i < vxCount; i++) {
      const zIndex = Math.floor(i / vertsPerRow); // 0..rows
      const xIndex = i - zIndex * vertsPerRow; // 0..cols
      // Sample height using nearest in-bounds cell (clamp at edges)
      const gx = Math.min(xIndex, cols - 1);
      const gy = Math.min(zIndex, rows - 1);
      const elev = typeof getHeight === 'function' ? getHeight(gx, gy) : 0;
      const y = elev * this.elevationUnit;
      pos.setY(i, y);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    return geo;
  }
}
