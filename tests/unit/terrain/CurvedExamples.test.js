import * as three from 'three';
import { createCurvedExamples } from '../../../src/terrain/CurvedExamples.js';
import { TerrainEngine } from '../../../src/terrain/TerrainEngine.js';
import { buildSurfaceRange, getSurfaceRoute } from '../../../src/terrain/SurfaceNavigation.js';
import { TerrainVolumeMeshBuilder } from '../../../src/scene/terrain/TerrainVolumeMeshBuilder.js';
import {
  createDomeVolumes,
  createTubeVolumes,
  createCastleWallVolumes,
  createRoundTowerVolumes,
} from '../../../src/terrain/StructureShapes.js';

let engine;
beforeAll(() => {
  engine = new TerrainEngine(25, 25);
  engine.addVolumes(createCurvedExamples({ widthFeet: 125, depthFeet: 125 }));
});

test('the cave, tube and dome contain supported five-foot-high paths through real openings', () => {
  for (const [gridX, gridY, destinationX, destinationY] of [
    [6, 15, 6, 5],
    [19, 11, 19, 6],
  ]) {
    const range = buildSurfaceRange({
      geometry: engine.geometry,
      start: { gridX, gridY, heightFeet: 0 },
      speedFeet: 100,
    });
    const route = getSurfaceRoute(range, destinationX, destinationY, { heightFeet: 0 });
    expect(route).not.toBeNull();
    expect(route.length).toBeGreaterThan(0);
    expect(route.every((step) => step.heightFeet === 0)).toBe(true);
    expect(route.at(-1).cost).toBeLessThanOrEqual(100);
  }
  for (const [x, z] of [
    [32.5, 32.5],
    [35, 62.5],
    [95, 30],
  ]) {
    const support = engine.geometry.findSupport(x, z, { belowFeet: 0, clearanceFeet: 5 });
    expect(support?.heightFeet).toBe(0);
    expect(support.ceilingFeet).toBeGreaterThanOrEqual(5);
  }
});

test('paid parallel stairs sit flush against the wall and reach the battlements through a supported landing', () => {
  const volumes = engine.geometry.save().volumes;
  const wall = volumes.find((volume) => volume.id === 'curved-battlement-wall').bounds;
  const stairs = volumes.filter(
    (volume) => volume.id.startsWith('curved-battlement-stair-') && volume.operation === 'add'
  );
  expect(stairs).toHaveLength(8);
  expect(stairs.at(-1).bounds.min.x - stairs[0].bounds.min.x).toBe(35);
  expect(stairs.every((step) => step.bounds.min.z === stairs[0].bounds.min.z)).toBe(true);
  expect(stairs.every((step) => step.bounds.max.z === wall.min.z)).toBe(true);
  expect(stairs.every((step) => step.bounds.max.z - step.bounds.min.z === 5)).toBe(true);
  const landing = volumes.find((volume) => volume.id === 'curved-battlement-landing').bounds;
  expect(landing.min.z).toBe(stairs.at(-1).bounds.min.z);
  expect(landing.min.x).toBe(stairs.at(-1).bounds.max.x);
  expect(landing.max.z).toBeGreaterThan(wall.min.z);
  for (const step of stairs) {
    const x = (step.bounds.min.x + step.bounds.max.x) / 2;
    expect(
      engine.geometry.findSupport(x, wall.min.z - 0.01, {
        belowFeet: step.bounds.max.y,
        clearanceFeet: 5,
      })?.heightFeet
    ).toBe(step.bounds.max.y);
    expect(
      engine.geometry.isSpaceClear({
        min: { x: x - 0.5, y: step.bounds.max.y, z: wall.min.z - 3 },
        max: { x: x + 0.5, y: step.bounds.max.y + 5, z: wall.min.z - 2 },
      })
    ).toBe(true);
  }
  expect(engine.geometry.findSupport(62.5, 92.5, { belowFeet: 20 })?.heightFeet).toBe(10);
  const options = {
    geometry: engine.geometry,
    start: { gridX: 3, gridY: 17, heightFeet: 0 },
  };
  const short = buildSurfaceRange({ ...options, speedFeet: 30 });
  expect(getSurfaceRoute(short, 12, 20, { heightFeet: 10 })).toBeNull();
  const range = buildSurfaceRange({ ...options, speedFeet: 150 });
  const route = getSurfaceRoute(range, 20, 20, { heightFeet: 10 });
  expect(route).not.toBeNull();
  expect(route.some((step) => step.heightFeet > 0 && step.heightFeet < 10)).toBe(true);
  expect(route.at(-1).cost).toBeGreaterThan(30);
  expect(route.at(-1).cost).toBeLessThanOrEqual(100);
  expect(engine.geometry.findSupport(102.5, 102.5, { belowFeet: 9 })?.heightFeet).toBe(0);
  expect(engine.geometry.findSupport(102.5, 102.5, { belowFeet: 20 })?.heightFeet).toBe(10);
});

test('walking across a gentle curved crown clears its own slope but still rejects a low overhead slab', () => {
  const local = new TerrainEngine(25, 25);
  local.addVolumes(createCurvedExamples({ widthFeet: 125, depthFeet: 125 }));
  const heightFeet = local.geometry.findSupport(97.5, 32.5, { belowFeet: 20 }).heightFeet;
  const range = () =>
    buildSurfaceRange({
      geometry: local.geometry,
      start: { gridX: 19, gridY: 6, heightFeet },
      speedFeet: 5,
    });
  expect(getSurfaceRoute(range(), 18, 5)?.at(-1).cost).toBe(5);
  local.addVolume({
    id: 'low-ceiling',
    bounds: { min: { x: 94.5, y: 19.8, z: 29.5 }, max: { x: 95.5, y: 20, z: 30.5 } },
  });
  expect(getSurfaceRoute(range(), 18, 5)).toBeNull();
});

test('a fractional curved landing starts navigation at its actual support instead of a different grid-center height', () => {
  const xFeet = 97.52;
  const zFeet = 32.54;
  const heightFeet = engine.geometry.findSupport(xFeet, zFeet, { belowFeet: 20 }).heightFeet;
  const range = buildSurfaceRange({
    geometry: engine.geometry,
    start: { gridX: 19, gridY: 6, xFeet, zFeet, heightFeet },
    speedFeet: 5,
  });
  expect(range.start.heightFeet).toBe(heightFeet);
  expect(getSurfaceRoute(range, 18, 5)?.at(-1).cost).toBe(5);
});

test('roof cutaways expose dome and cave interiors while retaining the real lower walls and physics', () => {
  const geometry = new TerrainVolumeMeshBuilder().build({
    geometry: engine.geometry,
    three,
    worldUnitsPerFoot: 1,
    visibleLayers: ['ground', 'cave', 'dome', 'castle'],
  });
  const material = new three.MeshBasicMaterial({ side: three.DoubleSide });
  const mesh = new three.Mesh(geometry, material);
  mesh.updateMatrixWorld(true);
  const ray = new three.Raycaster(new three.Vector3(95, 30, 30), new three.Vector3(0, -1, 0));
  expect(ray.intersectObject(mesh)[0]?.point.y).toBeCloseTo(0);
  ray.set(new three.Vector3(95, 3, 30), new three.Vector3(-1, 0, 0));
  expect(ray.intersectObject(mesh)[0]?.point.x).toBeGreaterThan(75);
  expect(engine.geometry.findSupport(95, 30, { belowFeet: 30 })?.heightFeet).toBe(15);
  expect(engine.geometry.getSurfacesAt(95, 30)[0].ceilingFeet).toBe(13);
  expect(geometry.getAttribute('position').count).toBeLessThan(150000);
  geometry.dispose();
  material.dispose();
});

test('the complete demo is one reversible edit and survives exact terrain save/reopen', () => {
  const saved = engine.save();
  const restored = new TerrainEngine(1, 1);
  restored.load(saved);
  expect(restored.save()).toEqual(saved);
  for (const [x, z] of [
    [32.5, 32.5],
    [35, 62.5],
    [95, 30],
    [102.5, 102.5],
  ]) {
    expect(restored.geometry.getSurfacesAt(x, z)).toEqual(engine.geometry.getSurfacesAt(x, z));
  }
  engine.undo();
  expect(engine.geometry.hasVolumes).toBe(false);
  engine.redo();
  expect(engine.save()).toEqual(saved);
});

test('the demo rejects undersized boards before producing partial structures', () => {
  expect(() => createCurvedExamples({ widthFeet: 120, depthFeet: 125 })).toThrow(/25 by 25/);
  expect(() => createCurvedExamples({ widthFeet: NaN, depthFeet: 125 })).toThrow();
});

test.each([createDomeVolumes, createTubeVolumes, createCastleWallVolumes, createRoundTowerVolumes])(
  'structure recipes are deterministic, serializable data for later seeded generation: %p',
  (create) => {
    const options = {
      id: 'reusable',
      bounds: { min: { x: 10, y: 0, z: 10 }, max: { x: 45, y: 15, z: 30 } },
    };
    const first = create(options);
    const second = create(options);
    expect(first).toEqual(second);
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
    first[0].bounds.min.x = 0;
    expect(second[0].bounds.min.x).toBe(10);
    expect(options.bounds.min.x).toBe(10);
  }
);

test('invalid authoring layers are rejected by recipes before returning volume data', () => {
  expect(() =>
    createDomeVolumes({
      id: 'invalid-layer',
      layerId: '',
      bounds: { min: { x: 10, y: 0, z: 10 }, max: { x: 45, y: 15, z: 30 } },
    })
  ).toThrow(/layer/i);
});
