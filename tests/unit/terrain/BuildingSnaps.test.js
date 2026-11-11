import { TerrainEngine } from '../../../src/terrain/TerrainEngine.js';
import { buildSurfaceRange, getSurfaceRoute } from '../../../src/terrain/SurfaceNavigation.js';

function twoRooms(source = 'manual', { baseFeet = 0, wingBaseFeet = baseFeet } = {}) {
  const engine = new TerrainEngine(40, 40);
  engine.placeStructure({
    id: 'keep',
    kind: 'building',
    xFeet: 40,
    zFeet: 40,
    lengthFeet: 40,
    widthFeet: 30,
    heightFeet: 10,
    baseFeet,
    source,
  });
  engine.placeStructure({
    id: 'wing',
    kind: 'building',
    xFeet: 90,
    zFeet: 40,
    lengthFeet: 30,
    widthFeet: 30,
    heightFeet: 10,
    baseFeet: wingBaseFeet,
    source,
  });
  return engine;
}

test('canceling a building snap preview preserves saved geometry and prevents a later commit', () => {
  const engine = twoRooms(),
    before = engine.save();
  const preview = engine.previewStructureSnap(
    'wing',
    { xFeet: 82.5, zFeet: 40 },
    { targetId: 'keep' }
  );

  expect(preview.structure).toMatchObject({ id: 'wing', xFeet: 75, zFeet: 40 });
  expect(engine.save()).toEqual(before);
  expect(engine.cancelStructureSnap(preview)).toBe(true);
  expect(() => engine.commitStructureSnap(preview)).toThrow(/cancel/i);
  expect(engine.save()).toEqual(before);
});

test('committing a compatible snap opens both walls and provides a continuous paid walking route', () => {
  const engine = twoRooms();
  const preview = engine.previewStructureSnap(
    'wing',
    { xFeet: 82.5, zFeet: 40 },
    { targetId: 'keep' }
  );
  expect(engine.commitStructureSnap(preview)).toBe(true);
  expect(
    engine.geometry.isSpaceClear({
      min: { x: 57.5, y: 1e-5, z: 37.5 },
      max: { x: 62.5, y: 6, z: 42.5 },
    })
  ).toBe(true);
  for (const x of [57.5, 60, 62.5])
    expect(
      engine.geometry.findSupport(x, 40, { belowFeet: 1e-5, clearanceFeet: 6 })?.heightFeet
    ).toBeCloseTo(0);

  const range = buildSurfaceRange({
    geometry: engine.geometry,
    start: { gridX: 10, gridY: 7, xFeet: 52.5, zFeet: 37.5, heightFeet: 0 },
    speedFeet: 30,
  });
  const route = getSurfaceRoute(range, 13, 7, { heightFeet: 0 });
  expect(route).not.toBeNull();
  expect(route.at(-1).cost).toBe(15);
});

test('the snap preview contains the real walkable opening without changing live geometry', () => {
  const engine = twoRooms(),
    before = engine.save();
  const preview = engine.previewStructureSnap(
    'wing',
    { xFeet: 82.5, zFeet: 40 },
    { targetId: 'keep' }
  );
  expect(preview.geometry).toBeDefined();
  const rendered = new TerrainEngine(40, 40);
  rendered.load({ ...before, geometry: preview.geometry });
  const body = {
    min: { x: 57.5, y: 1e-5, z: 37.5 },
    max: { x: 62.5, y: 6, z: 42.5 },
  };
  expect(rendered.geometry.isSpaceClear(body)).toBe(true);
  expect(engine.geometry.isSpaceClear(body)).toBe(false);
  expect(engine.cancelStructureSnap(preview)).toBe(true);
  expect(engine.save()).toEqual(before);
});

test('an authored join adopts both generated members so later generation preserves the connected structure', () => {
  const engine = twoRooms('generated');
  engine.commitStructureSnap(
    engine.previewStructureSnap('wing', { xFeet: 82.5, zFeet: 40 }, { targetId: 'keep' })
  );
  expect(engine.geometry.getStructures().map((spec) => spec.source)).toEqual(['manual', 'manual']);
  engine.generateBiomeElevation('grassland', { seed: 42, structures: false });
  expect(engine.geometry.getStructures().map((spec) => spec.id)).toEqual(['keep', 'wing']);
  expect(
    engine.geometry.isSpaceClear({
      min: { x: 57.5, y: 1e-5, z: 37.5 },
      max: { x: 62.5, y: 6, z: 42.5 },
    })
  ).toBe(true);
});

test('reapplying the same joined snap is a no-op and preserves the original single Undo', () => {
  const engine = twoRooms(),
    original = engine.save();
  engine.commitStructureSnap(
    engine.previewStructureSnap('wing', { xFeet: 82.5, zFeet: 40 }, { targetId: 'keep' })
  );
  const joined = engine.save();
  const repeated = engine.previewStructureSnap(
    'wing',
    { xFeet: 75, zFeet: 40 },
    { targetId: 'keep' }
  );
  expect(engine.commitStructureSnap(repeated)).toBe(false);
  expect(engine.save()).toEqual(joined);
  expect(engine.undo()).toBe(true);
  expect(engine.save()).toEqual(original);
});

test('a stale snap cannot overwrite an intervening construction edit', () => {
  const engine = twoRooms(),
    preview = engine.previewStructureSnap('wing', { xFeet: 82.5, zFeet: 40 }, { targetId: 'keep' });
  engine.resizeStructure('keep', { heightFeet: 20 });
  const edited = engine.save();
  expect(() => engine.commitStructureSnap(preview)).toThrow(/map changed/i);
  expect(engine.save()).toEqual(edited);
});

test('incompatible floor elevations reject a snap without changing either building', () => {
  const engine = twoRooms('manual', { wingBaseFeet: 5 }),
    before = engine.save();
  expect(() =>
    engine.previewStructureSnap('wing', { xFeet: 82.5, zFeet: 40 }, { targetId: 'keep' })
  ).toThrow(/no compatible walkable floor elevations/i);
  expect(engine.save()).toEqual(before);
});

test('a shared face narrower than ten feet rejects the connection without changing saved geometry', () => {
  const engine = twoRooms(),
    before = engine.save();
  expect(() =>
    engine.previewStructureSnap('wing', { xFeet: 82.5, zFeet: 63 }, { targetId: 'keep' })
  ).toThrow(/no compatible building face/i);
  expect(engine.save()).toEqual(before);
});

test('independent joins with floor-like member IDs preserve both real openings and distinct saved identities', () => {
  const engine = new TerrainEngine(60, 40);
  for (const [id, xFeet, lengthFeet] of [
    ['a', 40, 40],
    ['b-f0-c', 90, 30],
    ['a-f0-b', 170, 40],
    ['c', 220, 30],
  ])
    engine.placeStructure({
      id,
      kind: 'building',
      xFeet,
      zFeet: 40,
      lengthFeet,
      widthFeet: 30,
      heightFeet: 10,
    });
  for (const [id, xFeet, targetId] of [
    ['b-f0-c', 82.5, 'a'],
    ['c', 212.5, 'a-f0-b'],
  ])
    engine.commitStructureSnap(engine.previewStructureSnap(id, { xFeet }, { targetId }));
  for (const x of [60, 190])
    expect(
      engine.geometry.isSpaceClear({
        min: { x: x - 2.5, y: 1e-5, z: 37.5 },
        max: { x: x + 2.5, y: 6, z: 42.5 },
      })
    ).toBe(true);
  expect(
    engine.geometry.save().volumes.filter((volume) => volume.id.startsWith('compound-opening-'))
  ).toHaveLength(2);
});

test('a shared opening cannot carve away unrelated manual construction', () => {
  const engine = twoRooms();
  engine.addVolumes([
    {
      id: 'manual-column',
      layerId: 'castle',
      operation: 'add',
      source: 'manual',
      bounds: { min: { x: 59, y: 0, z: 39 }, max: { x: 62, y: 10, z: 41 } },
    },
  ]);
  const before = engine.save();
  expect(() =>
    engine.previewStructureSnap('wing', { xFeet: 82.5, zFeet: 40 }, { targetId: 'keep' })
  ).toThrow(/protected construction/i);
  expect(engine.save()).toEqual(before);
});

test('moving a snapped room cannot carve earlier manual construction out of its destination', () => {
  const engine = twoRooms(),
    wing = engine.geometry.getStructures().find((spec) => spec.id === 'wing');
  engine.removeStructure('wing');
  engine.addVolumes([
    {
      id: 'manual-room-column',
      layerId: 'castle',
      operation: 'add',
      source: 'manual',
      bounds: { min: { x: 69, y: 0, z: 39 }, max: { x: 71, y: 10, z: 41 } },
    },
  ]);
  engine.placeStructure(wing);
  const before = engine.save();
  expect(() =>
    engine.previewStructureSnap('wing', { xFeet: 82.5, zFeet: 40 }, { targetId: 'keep' })
  ).toThrow(/protected construction/i);
  expect(engine.save()).toEqual(before);
});
