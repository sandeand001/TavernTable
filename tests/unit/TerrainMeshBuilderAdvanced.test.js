import { TerrainMeshBuilder } from '../../src/scene/TerrainMeshBuilder.js';

// Ensures advanced (hard-edges + walls) path produces more vertices than legacy plane
// and uses BufferGeometry when three namespace supplies it.

describe('TerrainMeshBuilder advanced path', () => {
  test('advanced build yields BufferGeometry with wall quads', async () => {
    let three;
    try {
      three = await import('three');
    } catch {
      return; // skip if three unavailable
    }
    const cols = 3;
    const rows = 2;
    const heights = [0, 1, 0, 1, 2, 1];
    const getH = (x, y) => heights[y * cols + x];
    const builder = new TerrainMeshBuilder({
      tileWorldSize: 1,
      elevationUnit: 0.5,
      hardEdges: true,
      forceAdvanced: true,
    });
    const geo = builder.build({
      cols,
      rows,
      getHeight: getH,
      three,
      getBiomeColor: () => 0x446688,
      getWallColor: () => 0x111111,
    });
    expect(geo).toBeTruthy();
    expect(geo.isBufferGeometry).toBe(true);
    const pos = geo.getAttribute('position');
    expect(pos).toBeTruthy();
    // Legacy plane would have (cols+1)*(rows+1)=12 vertices; advanced should exceed that (tops + some walls)
    expect(pos.count).toBeGreaterThan(12);
  });
});
