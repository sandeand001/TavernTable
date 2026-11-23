import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  ASSET_SOURCE_CATALOG,
  getRepresentativeSourcePack,
  getSourcePack,
  normalizeSourcePack,
} from '../../../src/config/assets/AssetSourceCatalog.js';
import { ALL_BIOMES } from '../../../src/config/biome/BiomeConstants.js';
import { PURE_POLY_ASSETS } from '../../../src/config/assets/PurePolyAssets.js';
import ModelAssetCache from '../../../src/core/ModelAssetCache.js';

test('all downloaded terrain source packs are represented in the source catalog', () => {
  const downloaded = ASSET_SOURCE_CATALOG.filter(({ id }) => id !== 'assetquest-forest');
  expect(downloaded).toHaveLength(12);
  expect(new Set(ASSET_SOURCE_CATALOG.map(({ id }) => id)).size).toBe(ASSET_SOURCE_CATALOG.length);
  expect(downloaded.reduce((total, pack) => total + pack.modelFiles, 0)).toBe(4159);
  expect(
    downloaded.every(
      (pack) =>
        pack.noticeFile.startsWith('assets/terrain/source-packs/') &&
        pack.reviewState === 'source-only' &&
        pack.runtimeApproved === false &&
        pack.productionApproved === false
    )
  ).toBe(true);
});

test('source packs retain representative biome use and legal metadata', () => {
  const byGroup = Object.groupBy(ASSET_SOURCE_CATALOG, ({ group }) => group);
  expect(byGroup['biome-caves']).toHaveLength(4);
  expect(byGroup['biome-dungeons']).toHaveLength(1);
  expect(byGroup['biome-settlements']).toHaveLength(1);
  expect(byGroup.props.some((pack) => pack.id === 'jampot-3d-chests')).toBe(true);
  expect(byGroup['biome-structures'][0].license).toMatch(/CC0/i);
  expect(
    byGroup['biome-dungeons'][0].use.some(
      ({ variants, role }) => variants.includes('dungeon') && role === 'modular-room-kit'
    )
  ).toBe(true);
  const chest = byGroup.props.find(({ id }) => id === 'jampot-3d-chests');
  expect(chest.use[0].variants).toEqual(
    expect.arrayContaining(['dungeon', 'town', 'castle', 'cavern'])
  );
  expect(chest.use[0].consumer).toBe('src/terrain/generation/InteriorProps.js');
  expect(getRepresentativeSourcePack('source-iron-chest').id).toBe(
    'lowpoly-modular-dungeon-quaternius'
  );
  expect(getRepresentativeSourcePack('source-cave-entrance').id).toBe(
    'free-mine-assets-rubberduck'
  );
  expect(getRepresentativeSourcePack('source-cave-stalagmite').id).toBe(
    'free-mine-assets-rubberduck'
  );
  expect(getRepresentativeSourcePack('source-cave-column').id).toBe('low-poly-cave-agdg');
  expect(getRepresentativeSourcePack('source-medieval-wall-door').id).toBe(
    'medieval-village-megakit-quaternius'
  );
  const fungal = getRepresentativeSourcePack('mushroom-glow');
  expect(fungal.id).toBe('assetquest-forest');
  expect(fungal.license).toMatch(/CC0/i);
  expect(getRepresentativeSourcePack('mushroom-giant-cap')).toEqual(fungal);
});

test('every registered representative model is attributed to its source pack and format', () => {
  const cache = new ModelAssetCache();
  const representatives = Object.keys(cache._registry)
    .map((key) => ({ key, descriptor: cache._loadRegistryEntry(key) }))
    .filter(({ descriptor }) => descriptor.path.startsWith('assets/terrain/representatives/'));
  expect(representatives.length).toBeGreaterThan(0);
  for (const { key, descriptor } of representatives) {
    const source = getRepresentativeSourcePack(key);
    expect(source).not.toBeNull();
    expect(source.formats).toContain(descriptor.format.toLowerCase());
  }
});

test('CC0 cave derivatives match their recorded fingerprints', () => {
  const directory = path.resolve('assets', 'terrain', 'representatives', 'cave-cc0');
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'ASSET_MANIFEST.json'), 'utf8'));
  expect(manifest.files.map(({ path: file }) => file).sort()).toEqual([
    'mine-frame.glb',
    'stalagmite-cluster.glb',
    'stone-column.glb',
  ]);
  for (const recorded of manifest.files) {
    const bytes = fs.readFileSync(path.join(directory, recorded.path));
    expect(bytes.length).toBe(recorded.bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(recorded.sha256);
  }
});

test('fungal runtime assets match the reviewed source fingerprints', () => {
  const directory = path.resolve('assets', 'terrain', 'representatives', 'fungal');
  const source = path.resolve('assets', 'terrain', 'plants', 'forest');
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'ASSET_MANIFEST.json'), 'utf8'));
  for (const entry of manifest.files) {
    const bytes = fs.readFileSync(path.join(directory, entry.path));
    const original = fs.readFileSync(path.join(source, ...entry.source.split('/')));
    expect(bytes.length).toBe(entry.bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256);
    expect(bytes).toEqual(original);
  }
});

test('the per-asset inventory accounts for every source-catalog pack', () => {
  const lines = fs
    .readFileSync(path.resolve('docs', 'ASSET-INVENTORY.csv'), 'utf8')
    .trimEnd()
    .split(/\r?\n/)
    .slice(1);
  const counts = new Map();
  for (const line of lines) {
    const packId = line.slice(0, line.indexOf(','));
    counts.set(packId, (counts.get(packId) ?? 0) + 1);
  }
  for (const pack of ASSET_SOURCE_CATALOG)
    expect(counts.get(pack.id)).toBe(
      pack.inventoryGranularity === 'file-variant' ? pack.modelFiles : pack.distinctAssets
    );
});

test('an incomplete source catalog entry cannot be admitted', () => {
  const [pack] = ASSET_SOURCE_CATALOG;
  expect(() => normalizeSourcePack({ ...pack, noticeFile: '' })).toThrow(/invalid/i);
  expect(() => normalizeSourcePack({ ...pack, sourceURL: 'file:///local' })).toThrow(/invalid/i);
  expect(() => normalizeSourcePack({ ...pack, modelFiles: 0 })).toThrow(/invalid/i);
  expect(() => normalizeSourcePack({ ...pack, distinctAssets: 0 })).toThrow(/invalid/i);
  expect(() => normalizeSourcePack({ ...pack, inventoryGranularity: 'unknown' })).toThrow(
    /invalid/i
  );
  expect(() =>
    normalizeSourcePack({ ...pack, use: [{ variants: [], role: 'bad', consumer: '' }] })
  ).toThrow(/invalid/i);
});

test('existing version-one source records remain valid without an audited asset count', () => {
  const existing = { ...ASSET_SOURCE_CATALOG[0] };
  delete existing.distinctAssets;
  expect(normalizeSourcePack(existing)).toEqual(existing);
});

test('the purchased Pure Poly archive indexes every variant and identifies selected runtime models', () => {
  const pack = getSourcePack('pure-poly-mining-cave-blacksmith');
  expect(pack).toMatchObject({
    modelFiles: 2597,
    inventoryGranularity: 'file-variant',
    reviewState: 'source-only',
    runtimeApproved: false,
    productionApproved: false,
  });
  expect(pack.runtimeAssets).toEqual(PURE_POLY_ASSETS.map(({ id }) => id));
  const mappedVariants = new Set(pack.use.flatMap(({ variants }) => variants));
  expect(
    PURE_POLY_ASSETS.every((asset) =>
      asset.generatedBiomes.every((biome) => mappedVariants.has(biome))
    )
  ).toBe(true);
  const lines = fs
    .readFileSync(path.resolve('docs', 'ASSET-INVENTORY.csv'), 'utf8')
    .trimEnd()
    .split(/\r?\n/);
  const header = lines.shift().split(',');
  const entries = lines
    .filter((line) => line.startsWith(`${pack.id},`))
    .map((line) => {
      const values = line.split(',');
      expect(values).toHaveLength(header.length);
      return Object.fromEntries(header.map((name, index) => [name, values[index]]));
    });
  expect(entries).toHaveLength(pack.modelFiles);
  const names = entries.map((entry) => `${entry.asset}.fbx`);
  expect(new Set(names).size).toBe(pack.modelFiles);
  const notice = fs.readFileSync(path.resolve(pack.noticeFile), 'utf8');
  const fingerprint = /FBX filename index SHA-256: ([a-f0-9]{64})/.exec(notice);
  expect(fingerprint).not.toBeNull();
  expect(
    createHash('sha256')
      .update(names.sort().join('\n') + '\n')
      .digest('hex')
  ).toBe(fingerprint[1]);
  const biomeIds = new Set(ALL_BIOMES.map(({ key }) => key));
  const selected = new Map(PURE_POLY_ASSETS.map((asset) => [asset.source, asset]));
  for (const entry of entries) {
    const asset = selected.get(entry.asset);
    if (asset) {
      expect(entry.runtime_status).toBe(
        asset.generatedBiomes.length
          ? 'manual-placeable + generated-model (protected)'
          : 'manual-placeable (protected)'
      );
      expect(entry.runtime_keys).toBe(asset.id);
      expect(entry.runtime_allowed_biomes.split(' | ')).toEqual(asset.biomes);
      expect(
        asset.biomes.every((biome) => entry.candidate_biomes.split(' | ').includes(biome))
      ).toBe(true);
      expect(
        entry.current_generation_biomes ? entry.current_generation_biomes.split(' | ') : []
      ).toEqual(asset.generatedBiomes);
    } else {
      expect(entry.runtime_status).toBe('source-only');
      expect(entry.runtime_keys).toBe('');
      expect(entry.runtime_allowed_biomes).toBe('');
      expect(entry.current_generation_biomes).toBe('');
    }
    expect(entry.formats).toBe('fbx');
    expect(Number(entry.triangles)).toBeGreaterThan(0);
    expect(entry.source_size_xyz).toMatch(/^\d+(?:\.\d+)? x \d+(?:\.\d+)? x \d+(?:\.\d+)?$/);
    expect(entry.materials).toBeTruthy();
    expect(entry.candidate_biomes.split(' | ').every((biome) => biomeIds.has(biome))).toBe(true);
  }
  const byName = new Map(entries.map((entry) => [entry.asset, entry]));
  expect(byName.get('PP_Stalagmite_05').role).toBe('stalagmite cave formation');
  expect(byName.get('PP_Stalagmite_05').visually_sampled).toBe('yes');
  expect(byName.get('PP_Crystal_01_Blue').role).toMatch(/crystal/i);
  expect(byName.get('PP_Tree_Root_01').role).toBe('exposed tree root');
  expect(byName.get('PP_Tree_Root_01').candidate_biomes.split(' | ')).toContain('cavern');
  expect(byName.get('PP_Tree_Trunk_01').role).toBe('tree stump');
  expect(byName.get('PP_Pebbles_01').role).toBe('pebble cluster');
  expect(byName.get('PP_Torch_01').candidate_biomes.split(' | ')).not.toContain('cavern');
  expect(byName.get('PP_Torch_01').notes).toMatch(/inhabited/i);
});

test('selected Pure Poly models are encrypted and match their source and integrity records', () => {
  const noticeDirectory = path.resolve(
    'assets',
    'terrain',
    'source-packs',
    'biome-caves',
    'pure-poly-mining-cave-blacksmith'
  );
  const manifest = JSON.parse(fs.readFileSync(path.join(noticeDirectory, 'ENCRYPTED-MODELS.json')));
  const cache = new ModelAssetCache();
  expect(manifest.sourcePack).toBe('pure-poly-mining-cave-blacksmith');
  expect(manifest.files).toHaveLength(PURE_POLY_ASSETS.length);
  for (const asset of PURE_POLY_ASSETS) {
    const entry = manifest.files.find(({ assetId }) => assetId === asset.id);
    expect(entry).toMatchObject({ source: `${asset.source}.fbx`, path: asset.path });
    const descriptor = cache._loadRegistryEntry(asset.id);
    expect(descriptor).toMatchObject({
      path: asset.path,
      format: 'GLB',
      protectedKeyId: manifest.keyId,
    });
    const bytes = fs.readFileSync(path.resolve(...asset.path.split('/')));
    expect(bytes.subarray(0, 4).toString('ascii')).toBe('TTA1');
    expect(bytes.length).toBe(entry.bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256);
  }
});
