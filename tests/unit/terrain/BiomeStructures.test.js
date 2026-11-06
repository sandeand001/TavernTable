import { TerrainEngine } from '../../../src/terrain/TerrainEngine.js';
import { getConstructionPalette } from '../../../src/config/biome/ConstructionPalettes.js';
import { getBiomeStructureBudget } from '../../../src/config/biome/SettlementProfiles.js';

test.each([
  'town',
  'city',
  'castle',
  'ruinedTown',
  'ruinedUrban',
  'ruinedCastle',
  'cavern',
  'mountain',
])(
  '%s produces bounded deterministic editable geometry with a strict generation budget',
  (biomeKey) => {
    const first = new TerrainEngine(25, 25),
      second = new TerrainEngine(25, 25);
    first.generateBiomeElevation(biomeKey, { seed: 42 });
    second.generateBiomeElevation(biomeKey, { seed: 42 });
    expect(first.save()).toEqual(second.save());
    const structures = first.geometry.getStructures();
    const budget = getBiomeStructureBudget(biomeKey);
    expect(structures.length).toBeGreaterThan(0);
    expect(structures.length).toBeLessThanOrEqual(budget.structures);
    expect(structures.every((spec) => spec.source === 'generated')).toBe(true);
    expect(first.geometry.save().volumes.length).toBeLessThanOrEqual(budget.volumes);
    expect(first.geometry.getSolidCells().length).toBeLessThan(16000);
    const saved = first.save();
    first.generateBiomeElevation(biomeKey, { seed: 42 });
    expect(first.save()).toEqual(saved);
  }
);

test('regeneration preserves manually placed structures and an edited generated structure becomes manual', () => {
  const engine = new TerrainEngine(25, 25);
  engine.generateBiomeElevation('city', { seed: 42 });
  const adopted = engine.geometry.getStructures()[0];
  engine.resizeStructure(adopted.id, { heightFeet: adopted.heightFeet + 10 });
  expect(engine.geometry.getStructures().find((spec) => spec.id === adopted.id).source).toBe(
    'manual'
  );
  engine.placeStructure({ id: 'manual', kind: 'dome', xFeet: 100, zFeet: 100, diameterFeet: 20 });
  const manual = engine.geometry.getStructures().filter((spec) => spec.source === 'manual');
  engine.generateBiomeElevation('desertHot', { seed: 17 });
  expect(engine.geometry.getStructures().filter((spec) => spec.source === 'manual')).toEqual(
    manual
  );
});

test('natural landscapes sometimes contain intact homes or broken buildings, never a settlement on every seed', () => {
  for (const biomeKey of ['forestTemperate', 'desertHot', 'grassland']) {
    const has = [];
    const homes = [];
    for (let seed = 1; seed <= 32; seed++) {
      const engine = new TerrainEngine(15, 15);
      engine.generateBiomeElevation(biomeKey, { seed });
      const generated = engine.geometry.getStructures();
      has.push(generated.length > 0);
      expect(generated.every((spec) => spec.baseFeet >= 0)).toBe(true);
      homes.push(...generated.filter((spec) => spec.kind === 'building'));
    }
    expect(has).toContain(true);
    expect(has).toContain(false);
    expect(homes.some((spec) => spec.ruined)).toBe(true);
    expect(homes.some((spec) => !spec.ruined)).toBe(true);
  }
  expect(getConstructionPalette('forestTemperate').masonry).not.toBe(
    getConstructionPalette('desertHot').masonry
  );
});

test('generation can omit structures, never adds underwater castles, and persists the generation option', () => {
  const engine = new TerrainEngine(25, 25);
  engine.setStructureGeneration(false);
  engine.generateBiomeElevation('castle', { seed: 42 });
  expect(engine.geometry.getStructures()).toEqual([]);
  const restored = new TerrainEngine(1, 1);
  restored.load(engine.save());
  expect(restored.structureGenerationEnabled).toBe(false);
  engine.setStructureGeneration(true);
  engine.generateBiomeElevation('ocean', { seed: 42 });
  expect(engine.geometry.getStructures()).toEqual([]);
});

test('palette-only selection never creates structures and failed protected generation leaves all data unchanged', () => {
  const engine = new TerrainEngine(25, 25);
  engine.setBiome('castle', { generateIfFlat: false });
  expect(engine.geometry.hasVolumes).toBe(false);
  engine.placeStructure({ id: 'manual', kind: 'dome', xFeet: 90, zFeet: 90 });
  const before = engine.save();
  const remove = engine.validateGeometryEdits(() => {
    throw new Error('A creature would lose its floor');
  });
  expect(() => engine.generateBiomeElevation('city', { seed: 42 })).toThrow(/creature/);
  expect(engine.save()).toEqual(before);
  remove();
});
