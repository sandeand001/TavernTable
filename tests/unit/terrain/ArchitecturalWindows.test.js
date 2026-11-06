import { createStructure } from '../../../src/terrain/ConstructionBlueprints.js';
import {
  buildingWindows,
  buildingWallPoint,
  buildingLocalToFeet,
} from '../../../src/terrain/BuildingModel.js';
import { TerrainEngine } from '../../../src/terrain/TerrainEngine.js';

const house = (building = undefined) =>
  createStructure({
    id: 'house',
    kind: 'building',
    xFeet: 125,
    zFeet: 125,
    lengthFeet: 100,
    widthFeet: 80,
    heightFeet: 30,
    ...(building ? { building } : {}),
  });

test('new large buildings have at most two deliberately spaced automatic windows per facade and floor', () => {
  const spec = house(),
    windows = buildingWindows(spec);
  expect(windows.length).toBeGreaterThan(0);
  expect(windows.length).toBeLessThanOrEqual(24);
  for (const side of ['north', 'east', 'south', 'west'])
    for (let floor = 0; floor < 3; floor++)
      expect(
        windows.filter((window) => window.side === side && window.floor === floor).length
      ).toBeLessThanOrEqual(2);
  expect(spec.building.windowLayout).toMatchObject({ version: 2, style: 'residential' });
});

test('saved profiles without a sparse layout retain their old automatic windows through reopening and resizing', () => {
  const spec = house({ version: 2 });
  const original = buildingWindows(spec);
  expect(original).toHaveLength(48);
  expect(spec.building.windowLayout).toBeUndefined();
  const engine = new TerrainEngine(50, 50);
  engine.placeStructure(spec);
  const saved = engine.save(),
    reopened = new TerrainEngine(1, 1);
  reopened.load(saved);
  expect(reopened.save()).toEqual(saved);
  reopened.resizeStructure('house', { heightFeet: 40 });
  expect(reopened.geometry.getStructures()[0].building.windowLayout).toBeUndefined();
  expect(
    buildingWindows(reopened.geometry.getStructures()[0]).filter((window) => window.floor < 3)
  ).toEqual(original);
});

test('sparse defensive automatic windows do not prohibit manually authored windows on another wall', () => {
  const engine = new TerrainEngine(30, 30);
  const manual = {
    id: 'chosen',
    floor: 1,
    side: 'north',
    u: 0.5,
    widthFeet: 5,
    heightFeet: 5,
    sillFeet: 2,
  };
  engine.placeStructure({
    id: 'tower',
    kind: 'turret',
    xFeet: 70,
    zFeet: 70,
    diameterFeet: 30,
    heightFeet: 20,
    building: {
      windowLayout: { version: 1, style: 'fortress', sides: ['south'] },
      windows: [manual],
    },
  });
  const before = engine.save(),
    windows = buildingWindows(engine.geometry.getStructures()[0]);
  expect(windows.filter((window) => window.side === 'north')).toEqual([manual]);
  expect(
    windows.filter((window) => window.id !== 'chosen').every((window) => window.side === 'south')
  ).toBe(true);
  engine.resizeStructure('tower', { diameterFeet: 35 });
  expect(buildingWindows(engine.geometry.getStructures()[0])).toContainEqual(manual);
  engine.undo();
  expect(engine.save()).toEqual(before);
});

test.each(['town', 'city', 'castle'])(
  '%s generation uses sparse profiles rather than the saved legacy window grid',
  (biomeKey) => {
    const engine = new TerrainEngine(50, 50);
    engine.generateBiomeElevation(biomeKey, { seed: 42 });
    for (const spec of engine.geometry.getStructures().filter((spec) => spec.building)) {
      expect(spec.building.windowLayout).toBeDefined();
      const current = buildingWindows(spec).filter((window) => /^f\d+-/.test(window.id));
      const legacy = buildingWindows({
        ...spec,
        building: { ...spec.building, windowLayout: undefined },
      }).filter((window) => /^f\d+-/.test(window.id));
      expect(current.length).toBeLessThanOrEqual(legacy.length);
    }
  }
);

test.each([1, 2, 7, 42])(
  'castle seed %i never puts an automatic turret window on an outward-facing wall',
  (seed) => {
    const engine = new TerrainEngine(50, 50);
    engine.generateBiomeElevation('castle', { seed });
    const towers = engine.geometry.getStructures().filter((spec) => spec.kind === 'turret');
    expect(towers.length).toBeGreaterThanOrEqual(4);
    let count = 0;
    for (const spec of towers)
      for (const window of buildingWindows(spec)) {
        if (!/^f\d+-/.test(window.id)) continue;
        count++;
        const wall = buildingLocalToFeet(spec, buildingWallPoint(spec, window.side, window.u));
        const facing =
          (wall.x - spec.xFeet) * (125 - spec.xFeet) + (wall.z - spec.zFeet) * (125 - spec.zFeet);
        expect({ name: spec.name, side: window.side, facing }).toMatchObject({
          facing: expect.any(Number),
        });
        expect(facing).toBeGreaterThan(0);
      }
    expect(count).toBeGreaterThan(0);
  }
);

test.each([
  { version: 9, style: 'residential', sides: ['north'] },
  { version: 1, style: 'missing', sides: ['north'] },
  { version: 1, style: 'residential', sides: ['north', 'north'] },
  { version: 1, style: 'residential', sides: ['up'] },
])('invalid sparse layouts are rejected atomically: %j', (windowLayout) => {
  const engine = new TerrainEngine(50, 50);
  engine.placeStructure(house());
  const before = engine.save();
  expect(() =>
    engine.resizeStructure('house', {
      building: { ...engine.geometry.getStructures()[0].building, windowLayout },
    })
  ).toThrow(/window|building/i);
  expect(engine.save()).toEqual(before);
});
