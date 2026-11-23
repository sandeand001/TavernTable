import { ALL_BIOMES, CAVERN_BIOME_KEYS } from '../../../src/config/biome/BiomeConstants.js';
import {
  BIOME_GENERATION_FAMILIES,
  getBiomeGenerationFamily,
  normalizeBiomeGenerationChoices,
} from '../../../src/config/biome/BiomeGenerationFamilies.js';
import { TerrainEngine } from '../../../src/terrain/TerrainEngine.js';

test('thirteen biome families contain every legacy biome exactly once', () => {
  expect(BIOME_GENERATION_FAMILIES).toHaveLength(13);
  const configured = BIOME_GENERATION_FAMILIES.flatMap((entry) =>
    entry.variants.map((variant) => variant.key)
  );
  expect(new Set(configured).size).toBe(configured.length);
  expect(configured.sort()).toEqual(ALL_BIOMES.map(({ key }) => key).sort());
});

test('saved legacy biome keys resolve to their family and normalize valid choices', () => {
  expect(getBiomeGenerationFamily('crystalSpires').key).toBe('underground');
  expect(
    normalizeBiomeGenerationChoices('castle', {
      variant: 'ruinedCastle',
      footprint: 'expansive',
      layout: 'citadel',
      outskirts: 'none',
      density: 'sparse',
    })
  ).toEqual({
    biomeKey: 'ruinedCastle',
    canvasScale: 1.4,
    layoutFamily: 'citadel',
    outerWards: false,
    densityMultiplier: 0.55,
  });
});

test('Dungeon is an Underground variant, but does not use natural-cavern entrance options', () => {
  expect(getBiomeGenerationFamily('dungeon').key).toBe('underground');
  expect(CAVERN_BIOME_KEYS).not.toContain('dungeon');
  expect(normalizeBiomeGenerationChoices('underground', { variant: 'dungeon' })).toEqual({
    biomeKey: 'dungeon',
    dungeonRoomCount: 6,
  });
});

test('protected scenery is an explicit, saved biome choice with validated density', () => {
  const generation = normalizeBiomeGenerationChoices('desert', {
    variant: 'desertHot',
    assetPack: 'pure-poly',
    density: 'dense',
  });
  expect(generation).toMatchObject({
    biomeKey: 'desertHot',
    assetPack: 'pure-poly',
    densityMultiplier: 1.65,
  });
  const engine = new TerrainEngine(25, 25);
  expect(engine.generateBiomeElevation('desertHot', { ...generation, seed: 42 })).toBe(true);
  const saved = engine.save();
  const restored = new TerrainEngine(25, 25);
  restored.load(saved);
  expect(restored.generationRecipe.values.assetPack).toBe('pure-poly');
  expect(() => engine.planBiomeGeneration('dungeon', { seed: 42, assetPack: 'pure-poly' })).toThrow(
    /unavailable/i
  );
});

test.each(['desertHot', 'crystalFields', 'ocean'])(
  '%s generates no density-controlled assets at either setting',
  (biomeKey) => {
    const engine = new TerrainEngine(25, 25);
    for (const seed of [1, 42]) {
      const sparse = engine.planBiomeGeneration(biomeKey, { seed, densityMultiplier: 0.55 });
      const dense = engine.planBiomeGeneration(biomeKey, { seed, densityMultiplier: 1.65 });
      expect(sparse.placements).toEqual([]);
      expect(dense.placements).toEqual(sparse.placements);
      expect(dense.heights).toEqual(sparse.heights);
    }
  }
);

test.each([
  ['saltFlats', { relief: -1 }, /saved terrain relief/i],
  ['saltFlats', { saltFlatReliefVersion: 2 }, /saved salt flats relief version/i],
  ['crystalFields', { densityMultiplier: -1 }, /saved asset density/i],
])('invalid saved settings for %s fail explicitly', (biomeKey, values, message) => {
  expect(() =>
    normalizeBiomeGenerationChoices(
      biomeKey,
      { variant: biomeKey },
      { version: 1, biomeKey, values }
    )
  ).toThrow(message);
});

test('invalid or unrecognized family choices fail explicitly', () => {
  expect(() => normalizeBiomeGenerationChoices('not-a-family', {})).toThrow(/family/i);
  expect(() => normalizeBiomeGenerationChoices('forest', { variant: 'castle' })).toThrow(
    /variant/i
  );
});
