import { createStructure } from '../../../src/terrain/ConstructionBlueprints.js';
import {
  buildingLevels,
  buildingLevelElevation,
  buildingStairs,
  changeBuildingLevelHeight,
  removeBuildingLevel,
  addBuildingLevel,
} from '../../../src/terrain/BuildingModel.js';
import { TerrainEngine } from '../../../src/terrain/TerrainEngine.js';
import { buildSurfaceRange, getSurfaceRoute } from '../../../src/terrain/SurfaceNavigation.js';

function house() {
  return createStructure({
    id: 'hall',
    kind: 'building',
    xFeet: 60,
    zFeet: 60,
    heightFeet: 30,
    lengthFeet: 40,
    widthFeet: 30,
  });
}

test('raising one room to twenty feet shifts only higher levels and the roof, with stable floor identities', () => {
  const original = house(),
    next = changeBuildingLevelHeight(original, 0, 20);
  expect(next.heightFeet).toBe(40);
  expect(buildingLevels(next).map((level) => [level.id, level.elevationFeet])).toEqual([
    [0, 0],
    [1, 20],
    [2, 30],
  ]);
  expect(buildingLevelElevation(next, 1)).toBe(20);
  expect(original.heightFeet).toBe(30);
});

test('removing a complete upper slab keeps all higher elevations and identifiers unchanged', () => {
  const next = removeBuildingLevel(house(), 1);
  expect(next.heightFeet).toBe(30);
  expect(buildingLevels(next).map((level) => [level.id, level.elevationFeet])).toEqual([
    [0, 0],
    [2, 20],
  ]);
  const added = addBuildingLevel(next);
  expect(buildingLevels(added).map((level) => [level.id, level.elevationFeet])).toEqual([
    [0, 0],
    [2, 20],
    [3, 30],
  ]);
  expect(added.heightFeet).toBe(40);
});

test('adding a level after removing the highest floor never reuses the deleted floor identity', () => {
  const removed = removeBuildingLevel(house(), 2),
    added = addBuildingLevel(removed);
  expect(buildingLevels(added).map((level) => level.id)).toEqual([0, 1, 3]);
  expect(() => removeBuildingLevel(added, 2)).toThrow(/existing|no longer|select/i);
});

test('whole-floor removal never silently deletes a manually authored balcony or window', () => {
  const spec = house();
  spec.building.balconies = [
    { id: 'deck', floor: 1, side: 'south', u: 0.5, widthFeet: 10, depthFeet: 5 },
  ];
  expect(() => removeBuildingLevel(spec, 1)).toThrow(/feature|balcony|window/i);
});

test('the ground floor remains the building base, rather than becoming an unsupported shell', () => {
  expect(() => removeBuildingLevel(house(), 0)).toThrow(/ground|base|lowest/i);
});

test.each([15, 20, 25, 30])(
  '%i-foot stairs have real supported treads no higher than the existing step limit',
  (rise) => {
    const layout = buildingStairs(house(), rise);
    expect(layout.path.at(-1).y).toBe(rise);
    let previous = 0;
    for (const point of layout.path) {
      expect(point.y - previous).toBeLessThanOrEqual(1.5);
      previous = point.y;
    }
    for (const point of layout.path)
      expect(
        layout.steps.some(
          (step) =>
            point.x >= step.bounds.min.x &&
            point.x <= step.bounds.max.x &&
            point.z >= step.bounds.min.z &&
            point.z <= step.bounds.max.z &&
            Math.abs(point.y - step.bounds.max.y) < 1e-6
        )
      ).toBe(true);
  }
);

test('castle wall stairs run parallel and flush to one side and open onto the battlement', () => {
  const engine = new TerrainEngine(35, 25);
  engine.placeStructure({
    id: 'wall',
    kind: 'wall',
    style: 'battlement',
    wallStairs: true,
    xFeet: 80,
    zFeet: 80,
    lengthFeet: 80,
    widthFeet: 15,
    heightFeet: 10,
  });
  const stairs = engine.geometry
    .save()
    .volumes.filter((volume) => /^wall-stair-\d+$/.test(volume.id));
  expect(stairs).toHaveLength(8);
  expect(stairs.every((volume) => volume.bounds.max.z === 72.5)).toBe(true);
  expect(stairs.map((volume) => volume.bounds.max.y)).toEqual([
    1.25, 2.5, 3.75, 5, 6.25, 7.5, 8.75, 10,
  ]);
  const start = { gridX: 7, gridY: 14, heightFeet: 0, xFeet: 37.5, zFeet: 70 };
  const range = buildSurfaceRange({ geometry: engine.geometry, start, speedFeet: 100 });
  expect(getSurfaceRoute(range, 17, 15, { heightFeet: 10 })).not.toBeNull();
});

test('a new turret defaults to a crenellated walkable roof instead of the round-building cone', () => {
  const spec = createStructure({ id: 'tower', kind: 'turret', xFeet: 60, zFeet: 60 });
  expect(spec.building.roof).toBe('battlement');
  expect(buildingLevels(spec).at(-1)).toMatchObject({ id: 100, elevationFeet: 20, roofDeck: true });
});

test('a new tall battlement fits compact physical stairs rather than requiring a full straight sixty-foot ascent', () => {
  const engine = new TerrainEngine(35, 30);
  expect(() =>
    engine.placeStructure({
      id: 'wall',
      kind: 'wall',
      style: 'battlement',
      wallStairs: true,
      xFeet: 80,
      zFeet: 80,
      heightFeet: 60,
      lengthFeet: 60,
      widthFeet: 15,
    })
  ).not.toThrow();
});

test('an independent cellar excavates beneath the surface and can extend beyond a building footprint', () => {
  const engine = new TerrainEngine(30, 30);
  engine.placeStructure({
    id: 'cellar',
    kind: 'cellar',
    xFeet: 75,
    zFeet: 75,
    lengthFeet: 60,
    widthFeet: 40,
    heightFeet: 20,
  });
  expect(
    buildingLevels(engine.geometry.getStructures()[0]).map((level) => level.elevationFeet)
  ).toEqual([-20, -10]);
  expect(
    engine.geometry.isSpaceClear({ min: { x: 50, y: -18, z: 65 }, max: { x: 55, y: -13, z: 70 } })
  ).toBe(true);
  expect(engine.geometry.findSupport(52.5, 67.5, { belowFeet: 1 }).heightFeet).toBe(0);
});

test.each([15, 25, 35])(
  'a %i-foot cellar ends at its declared excavation depth with valid room gaps',
  (heightFeet) => {
    const spec = createStructure({
      id: 'cellar',
      kind: 'cellar',
      xFeet: 60,
      zFeet: 60,
      heightFeet,
    });
    const levels = buildingLevels(spec);
    expect(levels[0].elevationFeet).toBe(-heightFeet);
    for (let i = 1; i < levels.length; i++)
      expect(levels[i].elevationFeet - levels[i - 1].elevationFeet).toBeGreaterThanOrEqual(10);
  }
);
