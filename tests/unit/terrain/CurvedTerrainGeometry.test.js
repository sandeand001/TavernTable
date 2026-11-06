import { TerrainGeometry } from '../../../src/terrain/TerrainGeometry.js';
import { TerrainEngine } from '../../../src/terrain/TerrainEngine.js';

const board = () =>
  new TerrainGeometry({
    widthFeet: 50,
    depthFeet: 50,
    getTerrainHeightFeet: () => 0,
  });

function dome(geometry) {
  geometry.addSolid({
    id: 'dome',
    layerId: 'roof',
    bounds: { min: { x: 10, y: 0, z: 10 }, max: { x: 30, y: 10, z: 30 } },
    shape: {
      kind: 'ellipsoid',
      center: { x: 20, y: 0, z: 20 },
      radii: { x: 10, y: 10, z: 10 },
    },
  });
  geometry.carve({
    id: 'room',
    layerId: 'ground',
    bounds: { min: { x: 12, y: 0, z: 12 }, max: { x: 28, y: 8, z: 28 } },
    shape: {
      kind: 'ellipsoid',
      center: { x: 20, y: 0, z: 20 },
      radii: { x: 8, y: 8, z: 8 },
    },
  });
}

test('a hollow dome has a real floor and curved ceiling, not a hollow bounding box', () => {
  const geometry = board();
  dome(geometry);
  expect(geometry.getSurfacesAt(20, 20)).toEqual([
    { id: 'room:floor', heightFeet: 0, ceilingFeet: 8, layerId: 'ground' },
    { id: 'dome', heightFeet: 10, ceilingFeet: null, layerId: 'roof' },
  ]);
  expect(geometry.getSolidSpansAt(10.5, 10.5)).toEqual([
    { id: 'terrain', layerId: 'ground', bottom: -Infinity, top: 0 },
  ]);
  const offCenter = geometry.getSurfacesAt(24, 20);
  expect(offCenter[0].ceilingFeet).toBeGreaterThan(6.7);
  expect(offCenter[0].ceilingFeet).toBeLessThan(7.1);
  expect(offCenter[1].heightFeet).toBeGreaterThan(9);
  expect(offCenter[1].heightFeet).toBeLessThan(9.3);
});

test('curved clearance checks the whole body including a grazing corner', () => {
  const geometry = board();
  dome(geometry);
  expect(
    geometry.isSpaceClear({
      min: { x: 18, y: 0, z: 18 },
      max: { x: 22, y: 5, z: 22 },
    })
  ).toBe(true);
  expect(
    geometry.isSpaceClear({
      min: { x: 10.1, y: 1, z: 10.1 },
      max: { x: 11.1, y: 5, z: 11.1 },
    })
  ).toBe(true);
  expect(
    geometry.isSpaceClear({
      min: { x: 10.1, y: 1, z: 12 },
      max: { x: 12, y: 2, z: 18 },
    })
  ).toBe(false);
  expect(
    geometry.isSpaceClear({
      min: { x: 19, y: 7.5, z: 19 },
      max: { x: 21, y: 9, z: 21 },
    })
  ).toBe(false);
});

test('a horizontal tube has open ends, a flat ground path and an arched roof', () => {
  const geometry = board();
  geometry.addSolid({
    id: 'tube',
    bounds: { min: { x: 10, y: 0, z: 10 }, max: { x: 30, y: 10, z: 40 } },
    shape: {
      kind: 'cylinder',
      axis: 'z',
      center: { x: 20, y: 0, z: 25 },
      radii: { x: 10, y: 10, z: 15 },
    },
  });
  geometry.carve({
    id: 'bore',
    bounds: { min: { x: 12, y: 0, z: 10 }, max: { x: 28, y: 8, z: 40 } },
    shape: {
      kind: 'cylinder',
      axis: 'z',
      center: { x: 20, y: 0, z: 25 },
      radii: { x: 8, y: 8, z: 15 },
    },
  });
  expect(geometry.findSupport(20, 25, { belowFeet: 0, clearanceFeet: 5 })?.heightFeet).toBe(0);
  expect(geometry.getSurfacesAt(24, 25)[0].ceilingFeet).toBeLessThan(7.1);
  for (const z of [9.5, 10, 25, 39.9]) {
    expect(
      geometry.isSpaceClear({
        min: { x: 19, y: 0, z },
        max: { x: 21, y: 5, z: z + 1 },
      })
    ).toBe(true);
  }
});

test('curved volumes retain ordered carve/refill behavior and stable landing IDs', () => {
  const geometry = board();
  dome(geometry);
  geometry.addSolid({
    id: 'landing',
    layerId: 'upper',
    bounds: { min: { x: 18, y: 3, z: 18 }, max: { x: 22, y: 4, z: 22 } },
  });
  expect(geometry.findSupport(20, 20, { belowFeet: 7 })?.id).toBe('landing');
  expect(geometry.findSupport(20, 20, { belowFeet: 3 })?.heightFeet).toBe(0);
  expect(
    geometry.isSpaceClear({
      min: { x: 19, y: 3.5, z: 19 },
      max: { x: 21, y: 4.5, z: 21 },
    })
  ).toBe(false);
});

test('curved snapshots are versioned, isolated and backward compatible with box volumes', () => {
  const geometry = board();
  dome(geometry);
  const saved = geometry.save();
  expect(saved.version).toBe(2);
  const restored = board();
  restored.load(saved);
  expect(restored.save()).toEqual(saved);
  saved.volumes[0].shape.center.x = 0;
  expect(restored.getSurfacesAt(20, 20)[1].heightFeet).toBe(10);
  restored.load({
    version: 1,
    volumes: [
      {
        id: 'legacy',
        layerId: 'upper',
        operation: 'add',
        bounds: { min: { x: 10, y: 5, z: 10 }, max: { x: 20, y: 6, z: 20 } },
      },
    ],
  });
  expect(restored.save().version).toBe(1);
  expect(restored.findSupport(15, 15, { belowFeet: 10 })?.id).toBe('legacy');
});

test('the terrain owner preserves curved history and clips resize without squashing the shape', () => {
  const engine = new TerrainEngine(10, 10);
  const before = engine.save();
  const geometry = board();
  dome(geometry);
  engine.addVolumes(geometry.save().volumes);
  const saved = engine.save();
  const height = engine.geometry.getSurfacesAt(24, 20)[1].heightFeet;
  engine.setVisibleLayers(['ground']);
  expect(
    engine.geometry.isSpaceClear({
      min: { x: 19, y: 8, z: 19 },
      max: { x: 21, y: 10, z: 21 },
    })
  ).toBe(false);
  engine.undo();
  expect(engine.save()).toEqual(before);
  engine.redo();
  expect(engine.save()).toEqual(saved);
  engine.resize(5, 10);
  expect(engine.geometry.getSurfacesAt(24, 20)[1].heightFeet).toBeCloseTo(height, 7);
  const restored = new TerrainEngine(1, 1);
  restored.load(engine.save());
  expect(restored.geometry.getSurfacesAt(24, 20)).toEqual(engine.geometry.getSurfacesAt(24, 20));
});

test('curved collision caches follow committed height edits before notifying terrain listeners', () => {
  const engine = new TerrainEngine(10, 10);
  const geometry = board();
  dome(geometry);
  engine.addVolumes(geometry.save().volumes);
  const body = { min: { x: 1, y: 0, z: 1 }, max: { x: 2, y: 0.1, z: 2 } };
  expect(engine.geometry.isSpaceClear(body)).toBe(true);
  const observed = [];
  const unsubscribe = engine.onHeightChanged(() =>
    observed.push(engine.geometry.isSpaceClear(body))
  );
  engine.applyBrushAt(0, 0);
  expect(observed.length).toBeGreaterThan(0);
  expect(observed.every((clear) => clear === false)).toBe(true);
  unsubscribe();
  engine.undo();
  expect(engine.geometry.isSpaceClear(body)).toBe(true);
  engine.redo();
  expect(engine.geometry.isSpaceClear(body)).toBe(false);
});

test('curved ground remains solid below the rendering floor and cached solid cells are read-only', () => {
  const geometry = board();
  dome(geometry);
  expect(
    geometry.isSpaceClear({
      min: { x: 1, y: -2000005, z: 1 },
      max: { x: 2, y: -2000000, z: 2 },
    })
  ).toBe(false);
  const cells = geometry.getSolidCells();
  expect(Object.isFrozen(cells)).toBe(true);
  expect(Object.isFrozen(cells[0].faces[0].vertices)).toBe(true);
});

test.each([
  { floorFeet: NaN },
  { partition: { x: [0, 50], z: [0, 50] } },
  { partition: { x: [0, 5, 5, 50], z: [0, 50] } },
])('solid-cell queries reject invalid floors or lossy terrain partitions: %p', (options) => {
  expect(() => board().getSolidCells(options)).toThrow();
});

test.each([
  { kind: 'torus' },
  { kind: 'ellipsoid', segments: 1000000 },
  { kind: 'cylinder', axis: 'diagonal' },
  { kind: 'ellipsoid', radii: { x: 0, y: 10, z: 10 } },
  { kind: 'ellipsoid', center: { x: NaN, y: 0, z: 0 } },
  { kind: 'ellipsoid', center: null },
  { kind: 'cylinder', axis: null },
])('invalid curved input is rejected atomically: %p', (shape) => {
  const geometry = board();
  const before = geometry.save();
  expect(() =>
    geometry.addSolid({
      id: 'invalid',
      bounds: { min: { x: 10, y: 0, z: 10 }, max: { x: 30, y: 10, z: 30 } },
      shape,
    })
  ).toThrow();
  expect(geometry.save()).toEqual(before);
});
