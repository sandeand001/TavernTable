import { TerrainGeometry } from '../../../src/terrain/TerrainGeometry.js';
import { buildSurfaceRange, getSurfaceRoute } from '../../../src/terrain/SurfaceNavigation.js';

test('surface navigation can reach a bridge deck via stairs and the ground beneath it separately', () => {
  const geometry = new TerrainGeometry({
    widthFeet: 50,
    depthFeet: 25,
    getTerrainHeightFeet: () => 0,
  });
  geometry.addSolid({
    id: 'bridge',
    layerId: 'bridge',
    bounds: { min: { x: 25, y: 8, z: 5 }, max: { x: 45, y: 9, z: 15 } },
  });
  for (let i = 0; i < 6; i++)
    geometry.addSolid({
      id: `step-${i}`,
      layerId: 'bridge',
      bounds: {
        min: { x: i * 5, y: 0, z: 5 },
        max: { x: (i + 1) * 5, y: (i + 1) * 1.5, z: 10 },
      },
    });
  const range = buildSurfaceRange({
    geometry,
    start: { gridX: 0, gridY: 0, heightFeet: 0 },
    speedFeet: 100,
  });
  const ground = getSurfaceRoute(range, 6, 2, { surfaceId: 'terrain' });
  const deck = getSurfaceRoute(range, 6, 2, { surfaceId: 'bridge' });
  expect(ground.at(-1)).toMatchObject({ heightFeet: 0, surfaceId: 'terrain' });
  expect(deck.at(-1)).toMatchObject({ heightFeet: 9, surfaceId: 'bridge' });
  expect(deck.some((cell) => cell.surfaceId.startsWith('step-'))).toBe(true);
  expect(ground.every((cell) => cell.heightFeet === 0)).toBe(true);
  expect(deck.at(-1).cost).toBe(deck.length * 5);
  expect(ground.at(-1).cost).toBe(ground.length * 5);
});
