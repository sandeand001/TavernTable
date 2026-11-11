import { TerrainEngine } from '../../../src/terrain/TerrainEngine.js';
import { buildingForHeight, buildingWindows } from '../../../src/terrain/BuildingModel.js';

function fixture(roof = 'domed', kind = 'building', version = undefined) {
  const engine = new TerrainEngine(25, 25);
  engine.placeStructure({
    id: 'house',
    kind,
    xFeet: 60,
    zFeet: 60,
    lengthFeet: 40,
    widthFeet: 30,
    diameterFeet: 30,
    heightFeet: 40,
    building: { roof, ...(version === undefined ? {} : { version }) },
  });
  return engine;
}

test.each(['domed', 'conical'])(
  'new rectangular %s roofs cover their footprint corners rather than ending on an inset round cap',
  (roof) => {
    const engine = fixture(roof);
    expect(engine.geometry.findSupport(77, 72.75, { belowFeet: 50 }).heightFeet).toBeGreaterThan(
      40
    );
    expect(engine.geometry.findSupport(60, 60, { belowFeet: 50 }).heightFeet).toBeCloseTo(45);
    expect(engine.geometry.getStructures()[0].building.version).toBe(2);
  }
);

test.each(['domed', 'conical'])(
  'round %s roofs retain a round base and do not fill the square bounding-box corners',
  (roof) => {
    const engine = fixture(roof, 'turret');
    expect(engine.geometry.findSupport(72.75, 72.75, { belowFeet: 50 }).heightFeet).toBe(0);
    expect(engine.geometry.findSupport(60, 60, { belowFeet: 50 }).heightFeet).toBeCloseTo(45);
  }
);

test.each(['domed', 'conical'])(
  'saved version-one %s roofs keep their original silhouette until an explicit edit upgrades it',
  (roof) => {
    const engine = fixture(roof, 'building', 1);
    const saved = engine.save(),
      restored = new TerrainEngine(25, 25);
    restored.load(saved);
    expect(restored.save()).toEqual(saved);
    expect(restored.geometry.findSupport(77, 72.75, { belowFeet: 50 }).heightFeet).toBe(40);
  }
);

test('windows support a small real aperture and a large aperture spanning multiple storeys', () => {
  const engine = fixture();
  const spec = engine.geometry.getStructures()[0];
  const windows = [
    { id: 'small', floor: 0, side: 'east', u: 0.25, widthFeet: 0.5, heightFeet: 1, sillFeet: 3 },
    { id: 'tall', floor: 0, side: 'west', u: 0.5, widthFeet: 15, heightFeet: 35, sillFeet: 2 },
  ];
  expect(() =>
    engine.resizeStructure('house', {
      building: {
        ...spec.building,
        autoWindows: false,
        windows,
      },
    })
  ).not.toThrow();
  expect(
    engine.geometry.save().volumes.find((volume) => volume.id === 'house-window-small').bounds
  ).toMatchObject({ min: { y: 3 }, max: { y: 4 } });
  expect(
    engine.geometry.save().volumes.find((volume) => volume.id === 'house-window-tall').bounds
  ).toMatchObject({ min: { y: 2 }, max: { y: 37 } });
});

test('a tall custom window replaces overlapping automatic windows on every affected floor', () => {
  const engine = fixture();
  const spec = engine.geometry.getStructures()[0];
  const tall = {
    id: 'tall',
    floor: 0,
    side: 'east',
    u: 0.5,
    widthFeet: 20,
    heightFeet: 35,
    sillFeet: 2,
  };
  const windows = buildingWindows({ ...spec, building: { ...spec.building, windows: [tall] } });
  expect(windows.some((window) => window.id === 'tall')).toBe(true);
  expect(
    windows.some((window) => window.side === 'east' && window.floor === 1 && window.id !== 'tall')
  ).toBe(false);
  expect(
    windows.some((window) => window.side === 'east' && window.floor === 2 && window.id !== 'tall')
  ).toBe(false);
});

test('lowering the building clips a tall window instead of leaving a cut above the new roof', () => {
  const engine = fixture();
  const building = engine.geometry.getStructures()[0].building;
  building.windows = [
    { id: 'tall', floor: 1, side: 'east', u: 0.5, widthFeet: 10, heightFeet: 25, sillFeet: 2 },
  ];
  const shortened = buildingForHeight(building, 30);
  expect(shortened.windows[0].heightFeet).toBe(17);
  expect(building.windows[0].heightFeet).toBe(25);
});

test('round/rectangular base changes preserve structure identity and are undoable', () => {
  const engine = fixture('conical');
  const before = engine.save();
  engine.resizeStructure('house', { kind: 'turret', diameterFeet: 40 });
  expect(engine.geometry.getStructures()[0]).toMatchObject({
    id: 'house',
    kind: 'turret',
    diameterFeet: 40,
  });
  engine.undo();
  expect(engine.save()).toEqual(before);
});
