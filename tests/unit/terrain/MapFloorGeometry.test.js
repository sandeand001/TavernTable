import { TerrainGeometry } from '../../../src/terrain/TerrainGeometry.js';

test('a map floor is a finite slab and an opening leaves no phantom earth below it', () => {
  const createFloor = () =>
    new TerrainGeometry({
      widthFeet: 25,
      depthFeet: 25,
      getTerrainHeightFeet: () => 0,
      terrainThicknessFeet: 0.5,
    });
  const floor = createFloor();
  expect(floor.getSolidSpansAt(7.5, 7.5)).toMatchObject([{ bottom: -0.5, top: 0 }]);
  expect(floor.findSupport(7.5, 7.5, { belowFeet: -1 })).toBeNull();
  floor.carve({
    id: 'opening',
    bounds: { min: { x: 5, y: -1, z: 5 }, max: { x: 10, y: 1, z: 10 } },
  });
  expect(floor.getSurfacesAt(7.5, 7.5)).toEqual([]);
  expect(
    floor.isSpaceClear({
      min: { x: 6, y: -2, z: 6 },
      max: { x: 9, y: 2, z: 9 },
    })
  ).toBe(true);
  const restored = createFloor();
  restored.load(floor.save());
  expect(restored.getSurfacesAt(7.5, 7.5)).toEqual([]);
  expect(restored.getSurfacesAt(12.5, 7.5)).toMatchObject([{ heightFeet: 0 }]);
});
