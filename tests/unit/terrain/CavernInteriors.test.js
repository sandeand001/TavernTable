import { BIOME_GROUPS } from '../../../src/config/biome/BiomeConstants.js';
import { TerrainEngine } from '../../../src/terrain/TerrainEngine.js';
import { TERRAIN_CONFIG } from '../../../src/config/terrain/TerrainConstants.js';
import { createCavernInterior } from '../../../src/terrain/generation/CavernInteriors.js';
import { createStructure } from '../../../src/terrain/ConstructionBlueprints.js';

test.each(BIOME_GROUPS.Underground.map(({ key }) => key))(
  '%s keeps elevation-based cave floors and walls without procedural formations',
  (key) => {
    const engine = new TerrainEngine(25, 25);
    engine.configureGeometryScale(1.5);
    engine.generateBiomeElevation(key, { seed: 42 });
    expect(engine.cavern).toMatchObject({ version: 5, kind: 'main' });
    expect(engine.geometry.getStructures()).toEqual([]);
    expect(engine.geometry.save().volumes).toEqual([]);
    expect(engine.geometry.save().floorFootprints).toBeUndefined();
    const heights = engine.save().heights;
    expect(heights[12][12]).toBe(-8);
    expect(Math.min(...heights.flat())).toBeGreaterThanOrEqual(TERRAIN_CONFIG.MIN_HEIGHT);
    expect(Math.max(...heights.flat())).toBeLessThanOrEqual(TERRAIN_CONFIG.MAX_HEIGHT);
    const rim = [
      ...heights[0],
      ...heights[24],
      ...heights.map((row) => row[0]),
      ...heights.map((row) => row[24]),
    ];
    expect((Math.max(...rim) - heights[12][12]) * 1.5).toBeGreaterThanOrEqual(25);
    expect(heights.flat().filter((height) => height <= -5).length).toBeGreaterThan(250);
  }
);

test('removing formations leaves the elevation cave and historical recipe reconstruction unchanged', () => {
  const options = { biomeKey: 'cavern', seed: 42, cols: 25, rows: 25 };
  const old = createCavernInterior({ ...options, recipeVersion: 3 });
  const next = createCavernInterior(options);
  expect(next.heights).toEqual(old.heights);
  expect(old.geometry.structures.every((spec) => spec.rockProfileVersion === 1)).toBe(true);
  expect(old.geometry.volumes).toHaveLength(old.geometry.structures.length * 3);
  expect(next.geometry.volumes).toEqual([]);
  expect(next.heights).toEqual(createCavernInterior({ ...options, recipeVersion: 4 }).heights);
  expect(createCavernInterior({ ...options, recipeVersion: 3 })).toEqual(old);
});

test('regeneration removes old generated formations but preserves authored structures and saved compatibility', () => {
  const engine = new TerrainEngine(25, 25);
  const previous = createCavernInterior({
    biomeKey: 'cavern',
    seed: 42,
    cols: 25,
    rows: 25,
    recipeVersion: 4,
  });
  engine.load({ ...engine.save(), ...previous });
  expect(engine.geometry.getStructures().length).toBeGreaterThan(0);
  const wall = createStructure({
    id: 'authored-wall',
    kind: 'wall',
    xFeet: 62.5,
    zFeet: 62.5,
    baseFeet: -12,
    lengthFeet: 10,
    heightFeet: 10,
  });
  engine.placeStructure(wall);
  const before = engine.save(),
    restored = new TerrainEngine(25, 25);
  restored.load(before);
  expect(restored.save()).toEqual(before);
  engine.generateBiomeElevation('cavern', { seed: 42 });
  expect(engine.cavern.version).toBe(5);
  expect(engine.geometry.getStructures()).toEqual([wall]);
  expect(engine.geometry.save().volumes.every((volume) => volume.structureId === wall.id)).toBe(
    true
  );
  const saved = engine.save();
  restored.load(saved);
  expect(restored.save()).toEqual(saved);
});

test('elevation caverns remain deterministic, editable with the ordinary brush, undoable and persistent', () => {
  const engine = new TerrainEngine(25, 25);
  engine.configureGeometryScale(1.5);
  engine.generateBiomeElevation('cavern', { seed: 42 });
  const original = engine.save();
  engine.generateBiomeElevation('cavern', { seed: 42 });
  expect(engine.save()).toEqual(original);
  engine.setBrushSize(1);
  engine.setTool('raise');
  engine.beginBrushStroke(12, 12);
  engine.commitBrushStroke();
  expect(
    engine.geometry.findSupport(62.5, 62.5, { belowFeet: -10, clearanceFeet: 5 }).heightFeet
  ).toBe(-10.5);
  engine.undo();
  expect(engine.getHeightAt(12, 12)).toBe(-8);
  engine.setTool('lower');
  engine.beginBrushStroke(12, 12);
  engine.commitBrushStroke();
  expect(
    engine.geometry.findSupport(62.5, 62.5, { belowFeet: -12, clearanceFeet: 5 }).heightFeet
  ).toBe(-13.5);
  const saved = engine.save(),
    restored = new TerrainEngine(25, 25);
  restored.configureGeometryScale(1.5);
  restored.load(saved);
  expect(restored.save()).toEqual(saved);
});

test('disabling automatic side areas still sculpts an elevation-based cavern', () => {
  const engine = new TerrainEngine(25, 25);
  engine.generateBiomeElevation('cavern', { seed: 42, structures: false });
  expect(engine.cavern.exits).toEqual([]);
  expect(engine.getHeightAt(12, 12)).toBe(-8);
  expect(engine.geometry.getStructures()).toEqual([]);
  expect(engine.geometry.save().volumes).toEqual([]);
});
