import { TerrainMeshBuilder } from '../../src/scene/TerrainMeshBuilder.js';

// Verifies multi-cell height pattern correctly maps to geometry Y values.
// Skips gracefully if Three.js cannot be imported in the test environment.

describe('TerrainMeshBuilder vertex height propagation', () => {
  test('checker + ramp pattern maps to expected vertex Y samples', async () => {
    let three;
    try {
      three = await import('three');
    } catch {
      return; // skip if three unavailable (degraded env)
    }
    const cols = 5;
    const rows = 4;
    // Pattern: ramp in X plus alternating offset in Y to increase variance
    const heights = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const base = x; // ramp
        const alt = (x + y) % 2 === 0 ? 0 : 1; // checker bump
        heights.push(base + alt); // range 0..(cols-1)+1
      }
    }
    const getH = (x, y) => heights[y * cols + x];
    const elevationUnit = 0.5;
    const builder = new TerrainMeshBuilder({ tileWorldSize: 1, elevationUnit });
    const geo = builder.build({ cols, rows, getHeight: getH, three });
    const pos = geo.attributes.position;
    const vertsPerRow = cols + 1;

    function idx(xi, zi) {
      return zi * vertsPerRow + xi;
    }

    // Sample interior vertex representing cell (2,2) area (clamped to cell (2,2) for height)
    const interior = pos.getY(idx(2, 2));
    // Height at (min(2,4), min(2,3)) => (2,2) => base=2 alt=(2+2)%2=0 => 2 * 0.5
    expect(interior).toBeCloseTo(2 * elevationUnit, 5);

    // Edge vertex beyond last column clamps to last cell (cols-1)
    const edge = pos.getY(idx(cols, 1)); // xi=5 clamps to cell 4
    const expectedEdgeH = heights[1 * cols + (cols - 1)] * elevationUnit;
    expect(edge).toBeCloseTo(expectedEdgeH, 5);

    // Corner vertex (max,max) clamps to last cell (cols-1, rows-1)
    const corner = pos.getY(idx(cols, rows));
    const expectedCornerH = heights[(rows - 1) * cols + (cols - 1)] * elevationUnit;
    expect(corner).toBeCloseTo(expectedCornerH, 5);
  });
});
