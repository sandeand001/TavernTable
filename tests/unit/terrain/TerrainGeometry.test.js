import { TerrainGeometry } from '../../../src/terrain/TerrainGeometry.js';
import { TerrainEngine } from '../../../src/terrain/TerrainEngine.js';

test('a bridge preserves ground support below its independent upper walkable surface', () => {
  const geometry = new TerrainGeometry({
    widthFeet: 100,
    depthFeet: 100,
    getTerrainHeightFeet: () => 0,
  });

  geometry.addSolid({
    id: 'bridge-deck',
    layerId: 'bridge',
    bounds: {
      min: { x: 20, y: 15, z: 20 },
      max: { x: 40, y: 17, z: 30 },
    },
  });
  expect(geometry.getSurfacesAt(25, 25)).toEqual([
    { id: 'terrain', heightFeet: 0, ceilingFeet: 15, layerId: 'ground' },
    { id: 'bridge-deck', heightFeet: 17, ceilingFeet: null, layerId: 'bridge' },
  ]);
  expect(geometry.getSurfacesAt(10, 10)).toEqual([
    { id: 'terrain', heightFeet: 0, ceilingFeet: null, layerId: 'ground' },
  ]);
});

test('a bounded cave cut creates a floor and ceiling without removing the hill above it', () => {
  const geometry = new TerrainGeometry({
    widthFeet: 100,
    depthFeet: 100,
    getTerrainHeightFeet: () => 30,
  });
  geometry.carve({
    id: 'cave-chamber',
    layerId: 'cave',
    bounds: {
      min: { x: 20, y: 0, z: 20 },
      max: { x: 40, y: 10, z: 40 },
    },
  });
  expect(geometry.getSurfacesAt(25, 25)).toEqual([
    { id: 'cave-chamber:floor', heightFeet: 0, ceilingFeet: 10, layerId: 'cave' },
    { id: 'terrain', heightFeet: 30, ceilingFeet: null, layerId: 'ground' },
  ]);
  expect(geometry.getSurfacesAt(10, 10)).toEqual([
    { id: 'terrain', heightFeet: 30, ceilingFeet: null, layerId: 'ground' },
  ]);
});

test('landing finds the next floor below, while clearance rejects a hidden overhead slab', () => {
  const geometry = new TerrainGeometry({
    widthFeet: 100,
    depthFeet: 100,
    getTerrainHeightFeet: () => 0,
  });
  geometry.addSolid({
    id: 'upper-floor',
    layerId: 'upper',
    bounds: { min: { x: 20, y: 9, z: 20 }, max: { x: 40, y: 10, z: 40 } },
  });
  expect(geometry.findSupport(25, 25, { belowFeet: 20, clearanceFeet: 5 })).toEqual({
    id: 'upper-floor',
    heightFeet: 10,
    ceilingFeet: null,
    layerId: 'upper',
  });
  expect(geometry.findSupport(25, 25, { belowFeet: 8, clearanceFeet: 5 })).toEqual({
    id: 'terrain',
    heightFeet: 0,
    ceilingFeet: 9,
    layerId: 'ground',
  });
  expect(
    geometry.isSpaceClear({
      min: { x: 22, y: 0, z: 22 },
      max: { x: 28, y: 5, z: 28 },
    })
  ).toBe(true);
  expect(
    geometry.isSpaceClear({
      min: { x: 22, y: 5, z: 22 },
      max: { x: 28, y: 11, z: 28 },
    })
  ).toBe(false);
  expect(
    geometry.isSpaceClear({
      min: { x: 22, y: 10, z: 22 },
      max: { x: 28, y: 15, z: 28 },
    })
  ).toBe(true);
});

test('the terrain owner persists and undoes geometry without turning a floor view into collision state', () => {
  const engine = new TerrainEngine(10, 10);
  const before = engine.save();
  engine.addVolume({
    id: 'upper-floor',
    layerId: 'upper',
    bounds: { min: { x: 10, y: 9, z: 10 }, max: { x: 30, y: 10, z: 30 } },
  });
  const saved = engine.save();
  expect(engine.geometry.getSurfacesAt(15, 15)).toHaveLength(2);
  engine.setVisibleLayers(['ground']);
  expect(engine.geometry.getSurfacesAt(15, 15)).toHaveLength(2);
  engine.undo();
  expect(engine.save()).toEqual(before);
  engine.redo();
  expect(engine.save()).toEqual(saved);
  const restored = new TerrainEngine(1, 1);
  restored.load(saved);
  expect(restored.geometry.getSurfacesAt(15, 15)).toEqual(engine.geometry.getSurfacesAt(15, 15));
  expect(restored.canUndo).toBe(false);
  expect(restored.visibleLayers).toBeNull();
});
