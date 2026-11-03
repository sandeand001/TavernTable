import { TerrainEngine } from '../../../src/terrain/TerrainEngine.js';
import { createLayeredExamples } from '../../../src/terrain/LayeredExamples.js';
import { buildSurfaceRange, getSurfaceRoute } from '../../../src/terrain/SurfaceNavigation.js';

test('the proof map has a reachable upper balcony, bridge underpass and hollow cave', () => {
  const engine = new TerrainEngine(25, 25);
  engine.addVolumes(createLayeredExamples({ widthFeet: 125, depthFeet: 125 }));
  const range = buildSurfaceRange({
    geometry: engine.geometry,
    start: { gridX: 19, gridY: 5, heightFeet: 0 },
    speedFeet: 200,
  });
  const balcony = getSurfaceRoute(range, 19, 18, { surfaceId: 'proof-balcony' });
  expect(balcony).not.toBeNull();
  expect(balcony.at(-1).heightFeet).toBe(10);
  expect(balcony.some((cell) => cell.surfaceId.startsWith('proof-building-stair-'))).toBe(true);
  const bridge = engine.geometry.getSurfacesAt(52.5, 22.5);
  expect(bridge.map((surface) => surface.heightFeet)).toEqual([0, 9]);
  const cave = engine.geometry.findSupport(27.5, 72.5, { belowFeet: 1, clearanceFeet: 5 });
  expect(cave).toMatchObject({ heightFeet: 0, ceilingFeet: 10, layerId: 'cave' });
  engine.undo();
  expect(engine.geometry.hasVolumes).toBe(false);
});
