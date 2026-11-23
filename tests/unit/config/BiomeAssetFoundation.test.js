import { ALL_BIOMES } from '../../../src/config/biome/BiomeConstants.js';
import { TerrainEngine } from '../../../src/terrain/TerrainEngine.js';
import { TERRAIN_PLACEABLES } from '../../../src/config/terrain/TerrainPlaceables.js';
import {
  ASSET_CATALOG_VERSION,
  LEGACY_ASSET_CATALOG,
  normalizeAssetDefinition,
  normalizeAssetSource,
} from '../../../src/config/assets/AssetCatalog.js';
import {
  assetCatalogCoverage,
  generatedAssetSuitabilityViolations,
  getBiomeAssetPolicy,
  isAssetAllowedInBiome,
} from '../../../src/config/assets/BiomeAssetMatrix.js';
import { PURE_POLY_ASSETS } from '../../../src/config/assets/PurePolyAssets.js';

test('the versioned catalog covers every concrete legacy terrain asset', () => {
  const concrete = Object.entries(TERRAIN_PLACEABLES).filter(
    ([, definition]) => definition.modelKey || definition.representativeModelKey
  );
  expect(LEGACY_ASSET_CATALOG).toHaveLength(concrete.length);
  expect(new Set(LEGACY_ASSET_CATALOG.map(({ id }) => id)).size).toBe(concrete.length);
  for (const asset of LEGACY_ASSET_CATALOG)
    expect(normalizeAssetDefinition(asset).version).toBe(ASSET_CATALOG_VERSION);
});

test('every biome has an explicit family suitability policy', () => {
  for (const { key } of ALL_BIOMES) {
    const policy = getBiomeAssetPolicy(key);
    expect(policy.biomeKey).toBe(key);
    expect(policy.familyKey).toBeTruthy();
    expect(policy.allowedCategories.length).toBeGreaterThan(0);
  }
});

test('ordinary caves reject generated trees while Eldritch Rift keeps the magical exception', () => {
  expect(isAssetAllowedInBiome('tree-dead-a', 'cavern')).toBe(false);
  expect(isAssetAllowedInBiome('tree-dead-a', 'fungalGrove')).toBe(false);
  expect(isAssetAllowedInBiome('tree-dead-a', 'eldritchRift')).toBe(true);
  expect(isAssetAllowedInBiome('mushroom-common', 'cavern')).toBe(true);
});

test('accepted profile weights have no biome suitability violations', () => {
  const violations = generatedAssetSuitabilityViolations();
  expect(violations).toEqual([]);
  expect(assetCatalogCoverage()).toMatchObject({
    catalogedAssets: LEGACY_ASSET_CATALOG.length,
    reviewedAssets: 9 + PURE_POLY_ASSETS.length,
    unreviewedLegacyAssets: LEGACY_ASSET_CATALOG.length - 9 - PURE_POLY_ASSETS.length,
  });
});

test('protected asset categories have explicit, biome-specific suitability', () => {
  for (const asset of PURE_POLY_ASSETS) {
    for (const biome of asset.generatedBiomes) {
      expect(asset.biomes).toContain(biome);
      expect(isAssetAllowedInBiome(asset.id, biome)).toBe(true);
    }
    expect(isAssetAllowedInBiome(asset.id, 'dungeon')).toBe(asset.biomes.includes('dungeon'));
  }
  expect(isAssetAllowedInBiome('pure-poly-cactus-01', 'cavern')).toBe(false);
  expect(isAssetAllowedInBiome('pure-poly-stalagmite-05', 'desertHot')).toBe(false);
  expect(isAssetAllowedInBiome('pure-poly-grass-01', 'cavern')).toBe(false);
  expect(isAssetAllowedInBiome('pure-poly-grass-01', 'grassland')).toBe(true);
  expect(isAssetAllowedInBiome('pure-poly-pebbles-01', 'cavern')).toBe(true);
  expect(isAssetAllowedInBiome('pure-poly-pebbles-01', 'screeSlope')).toBe(true);
  expect(isAssetAllowedInBiome('pure-poly-pebbles-01', 'desertHot')).toBe(false);
  expect(isAssetAllowedInBiome('pure-poly-anvil-01', 'dungeon')).toBe(true);
  expect(PURE_POLY_ASSETS.find(({ id }) => id === 'pure-poly-anvil-01').generatedBiomes).toEqual(
    []
  );
});

test('all configured weighted assets resolve to renderable models', () => {
  const unavailable = assetCatalogCoverage().unavailableWeightedAssets;
  expect(unavailable).toEqual([]);
});

test('representative source-pack assets are available only in their intended variants', () => {
  expect(isAssetAllowedInBiome('source-medieval-wall-door', 'town')).toBe(true);
  expect(isAssetAllowedInBiome('source-medieval-wall-door', 'dungeon')).toBe(false);
  expect(isAssetAllowedInBiome('source-dungeon-wall', 'dungeon')).toBe(true);
  expect(isAssetAllowedInBiome('source-dungeon-torch', 'dungeon')).toBe(true);
  expect(isAssetAllowedInBiome('source-dungeon-torch', 'cavern')).toBe(true);
  expect(isAssetAllowedInBiome('source-dungeon-torch', 'grassland')).toBe(false);
  expect(isAssetAllowedInBiome('source-cave-entrance', 'hills')).toBe(true);
  expect(isAssetAllowedInBiome('source-cave-entrance', 'town')).toBe(false);
  for (const id of ['source-cave-stalagmite', 'source-cave-column']) {
    expect(isAssetAllowedInBiome(id, 'cavern')).toBe(true);
    expect(isAssetAllowedInBiome(id, 'crystalSpires')).toBe(true);
    expect(isAssetAllowedInBiome(id, 'grassland')).toBe(false);
  }
  for (const id of ['mushroom-glow', 'mushroom-giant-cap']) {
    expect(isAssetAllowedInBiome(id, 'fungalGrove')).toBe(true);
    expect(isAssetAllowedInBiome(id, 'grassland')).toBe(false);
  }
  expect(isAssetAllowedInBiome('source-iron-chest', 'castle')).toBe(true);
  expect(isAssetAllowedInBiome('source-iron-chest', 'grassland')).toBe(false);
});

test('a representative has the same biome restrictions whether identified by ID or definition', () => {
  const door = LEGACY_ASSET_CATALOG.find(({ id }) => id === 'source-medieval-wall-door');
  expect(isAssetAllowedInBiome(door, 'town')).toBe(isAssetAllowedInBiome(door.id, 'town'));
  expect(isAssetAllowedInBiome(door, 'dungeon')).toBe(isAssetAllowedInBiome(door.id, 'dungeon'));
});

test('unknown assets and forged categories cannot bypass biome placement rules', () => {
  expect(isAssetAllowedInBiome('unregistered-candidate', 'cavern')).toBe(false);
  expect(isAssetAllowedInBiome({ id: 'unregistered-candidate', category: 'prop' }, 'town')).toBe(
    false
  );
  expect(isAssetAllowedInBiome({ id: 'tree-dead-a', category: 'prop' }, 'cavern')).toBe(false);
  expect(isAssetAllowedInBiome({ id: 'tree-dead-a', category: 'prop' }, 'eldritchRift')).toBe(true);

  const engine = new TerrainEngine(5, 5);
  engine.setBiome('town', { generateIfFlat: false });
  expect(() => engine.setSelectedPlaceable('unregistered-candidate')).toThrow(/not allowed/i);
  expect(() => engine.emitPlaceableChanged(1, 1, 'unregistered-candidate')).toThrow(/not allowed/i);
});

test.each(ALL_BIOMES.map(({ key }) => key))(
  '%s plans registered, suitable assets across grid sizes and seeds',
  (biomeKey) => {
    const engine = new TerrainEngine(10, 10);
    const before = engine.save();
    for (const { cols, rows, seed } of [
      { cols: 16, rows: 13, seed: 1 },
      { cols: 25, rows: 25, seed: 42 },
    ]) {
      const options = { seed, structures: false };
      const target = { cols, rows, clear: true };
      const first = engine.planBiomeGeneration(biomeKey, options, target);
      const repeat = engine.planBiomeGeneration(biomeKey, options, target);
      expect(first.heights).toEqual(repeat.heights);
      expect(first.placements).toEqual(repeat.placements);
      for (const { placeableId } of first.placements) {
        expect(TERRAIN_PLACEABLES[placeableId]).toBeDefined();
        expect(isAssetAllowedInBiome(placeableId, biomeKey)).toBe(true);
      }
    }
    expect(engine.save()).toEqual(before);
  }
);

test('ordinary cave trees cannot be selected or emitted while Eldritch Rift remains exceptional', () => {
  const engine = new TerrainEngine(5, 5);
  engine.setBiome('cavern', { generateIfFlat: false });
  expect(() => engine.setSelectedPlaceable('tree-dead-a')).toThrow(/not allowed/i);
  expect(() => engine.emitPlaceableChanged(1, 1, 'tree-dead-a')).toThrow(/not allowed/i);
  expect(() => engine.setSelectedPlaceable('mushroom-common')).not.toThrow();

  engine.setBiome('eldritchRift', { generateIfFlat: false });
  expect(() => engine.setSelectedPlaceable('tree-dead-a')).not.toThrow();
  engine.setBiome('cavern', { generateIfFlat: false });
  expect(engine.getSelectedPlaceable()).toBeNull();
});

test('invalid future asset definitions fail explicitly', () => {
  expect(() =>
    normalizeAssetDefinition({ version: 1, id: 'bad', modelKey: '', category: 'unknown' })
  ).toThrow(/invalid/i);
});

test('new reviewed assets and source packs require complete provenance', () => {
  const source = normalizeAssetSource({
    version: ASSET_CATALOG_VERSION,
    id: 'example-source-pack',
    name: 'Example Pack',
    creator: 'Example Creator',
    sourceURL: 'https://example.invalid/model-pack',
    license: 'CC BY 4.0',
    noticeFiles: ['assets/FRONTEND-NOTICES.txt'],
    assets: ['example-chest'],
  });
  expect(source.assets).toEqual(['example-chest']);
  expect(() =>
    normalizeAssetDefinition({
      version: ASSET_CATALOG_VERSION,
      id: 'example-chest',
      modelKey: 'example-chest-a',
      category: 'prop',
      runtimeType: 'structure',
      placement: {
        surface: 'floor',
        footprintFeet: { x: 2.5, z: 2.5 },
        spacingTiles: 0,
        rotation: 'free',
      },
      provenance: {
        status: 'reviewed',
        sourcePack: source.id,
        license: source.license,
      },
    })
  ).not.toThrow();
  expect(() => normalizeAssetSource({ ...source, sourceURL: 'file:///local-only' })).toThrow(
    /invalid/i
  );
  expect(() =>
    normalizeAssetDefinition({
      ...LEGACY_ASSET_CATALOG[0],
      provenance: { status: 'reviewed' },
    })
  ).toThrow(/invalid/i);
});
