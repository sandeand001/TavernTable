import { createHash } from 'node:crypto';
import { CAVERN_BIOME_KEYS } from '../../../src/config/biome/BiomeConstants.js';
import { TerrainEngine } from '../../../src/terrain/TerrainEngine.js';
import { TERRAIN_CONFIG } from '../../../src/config/terrain/TerrainConstants.js';
import {
  cavernEntranceCells,
  cavernPassageCells,
  createCavernInterior,
  naturalCavernRoutes,
  sculptCavernPassage,
} from '../../../src/terrain/generation/CavernInteriors.js';
import { createStructure } from '../../../src/terrain/ConstructionBlueprints.js';

test.each(CAVERN_BIOME_KEYS)(
  '%s keeps elevation-based cave floors and walls without procedural formations',
  (key) => {
    const engine = new TerrainEngine(25, 25);
    engine.configureGeometryScale(1.5);
    engine.generateBiomeElevation(key, { seed: 42 });
    expect(engine.cavern).toMatchObject({ version: 7, kind: 'main' });
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
  const versionFive = createCavernInterior({ ...options, recipeVersion: 5 });
  const next = createCavernInterior(options);
  expect(versionFive.heights).toEqual(old.heights);
  expect(old.geometry.structures.every((spec) => spec.rockProfileVersion === 1)).toBe(true);
  expect(old.geometry.volumes).toHaveLength(old.geometry.structures.length * 3);
  expect(next.geometry.volumes).toEqual([]);
  expect(next.heights).not.toEqual(versionFive.heights);
  expect(versionFive.heights).toEqual(
    createCavernInterior({ ...options, recipeVersion: 4 }).heights
  );
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
  expect(engine.cavern.version).toBe(7);
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

test('a reviewed cavern entrance count overrides the automatic exit profile', () => {
  const engine = new TerrainEngine(25, 25);
  engine.generateBiomeElevation('fungalGrove', {
    seed: 42,
    cavernExitCount: 4,
    cavernManualExits: ['north'],
  });
  expect(new Set(engine.cavern.exits)).toEqual(new Set(['north', 'east', 'south', 'west']));
});

test('underground biomes use distinct deterministic chamber and exit topologies', () => {
  const keys = CAVERN_BIOME_KEYS;
  const interiors = keys.map((biomeKey) =>
    createCavernInterior({ biomeKey, seed: 42, cols: 25, rows: 25 })
  );
  expect(new Set(interiors.map(({ cavern }) => cavern.exits.join(','))).size).toBeGreaterThan(2);
  expect(new Set(interiors.map(({ heights }) => JSON.stringify(heights))).size).toBe(keys.length);
  expect(interiors.some(({ cavern }) => cavern.exits.length === 3)).toBe(true);
  for (const [index, biomeKey] of keys.entries())
    expect(createCavernInterior({ biomeKey, seed: 42, cols: 25, rows: 25 })).toEqual(
      interiors[index]
    );
});

test('new cavern terrain avoids a straight flattened entrance strip without changing the prior recipe', () => {
  const options = { biomeKey: 'cavern', seed: 42, cols: 25, rows: 25, exits: ['north'] };
  const untouched = createCavernInterior({ ...options, exits: [], recipeVersion: 6 });
  const legacy = createCavernInterior({ ...options, recipeVersion: 6 });
  const current = createCavernInterior(options);
  const oldStrip = cavernPassageCells('north', options.cols, options.rows);
  const entrance = new Set(
    cavernEntranceCells('north', options.cols, options.rows).map(({ x, z }) => `${x}:${z}`)
  );
  const oldFlattened = oldStrip.filter(
    ({ x, z }) =>
      !entrance.has(`${x}:${z}`) && untouched.heights[z][x] !== -8 && legacy.heights[z][x] === -8
  );
  expect(oldFlattened.length).toBeGreaterThan(0);
  expect(
    oldFlattened.filter(({ x, z }) => current.heights[z][x] !== -8).length
  ).toBeGreaterThanOrEqual(Math.ceil(oldFlattened.length / 2));
  expect(current.cavern.version).toBeGreaterThan(legacy.cavern.version);
  const routes = naturalCavernRoutes({
    cols: options.cols,
    rows: options.rows,
    getHeight: (x, z) => current.heights[z][x],
    exits: current.cavern.exits,
    seed: options.seed,
  });
  expect(routes).toHaveLength(1);
  expect(routes[0].cells[0]).toEqual({ x: 12, z: 0 });
  expect(routes[0].cells.at(-1)).toEqual({ x: 12, z: 12 });
  expect(createCavernInterior({ ...options, recipeVersion: 6 })).toEqual(legacy);
});

test.each([
  ['cavern', '3c094983774e35425fc81f9ebe90cf521548618448034d59a5203af6de255e9e'],
  ['fungalGrove', '1b835d15e82561b7f87bf424dad98340e121edef865422f8994a6a2704fffa64'],
  ['crystalSpires', '71d371bbdc04f48a19dc82aa58719b40b80e1cf2767d71a7408eeaa388b01c73'],
])('the historical %s recipe reproduces its saved terrain', (biomeKey, fingerprint) => {
  const { heights } = createCavernInterior({
    biomeKey,
    seed: 42,
    cols: 25,
    rows: 25,
    recipeVersion: 6,
  });
  expect(createHash('sha256').update(JSON.stringify(heights)).digest('hex')).toBe(fingerprint);
});

test('natural passages bend through solid rock and remain unchanged when carved again', () => {
  const heights = Array.from({ length: 25 }, () => Array(25).fill(8));
  const options = { seed: 42, recipeVersion: 7 };
  const once = sculptCavernPassage(heights, 'north', options);
  const [route] = naturalCavernRoutes({
    cols: 25,
    rows: 25,
    getHeight: (x, z) => once[z][x],
    exits: ['north'],
    seed: options.seed,
  });
  expect(route.cells.some(({ x }) => Math.abs(x - 12) > 1)).toBe(true);
  expect([4, 5, 6, 7, 8].some((z) => once[z][12] !== -8)).toBe(true);
  expect(sculptCavernPassage(once, 'north', options)).toEqual(once);
});
