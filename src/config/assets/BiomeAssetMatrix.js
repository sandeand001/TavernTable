import { ALL_BIOMES, BIOME_GROUPS } from '../biome/BiomeConstants.js';
import { getBiomeGenerationFamily } from '../biome/BiomeGenerationFamilies.js';
import { BIOME_FLORA_PROFILES, unavailableWeightedAssets } from '../terrain/FloraProfiles.js';
import { getAssetDefinition, inferAssetCategory, LEGACY_ASSET_CATALOG } from './AssetCatalog.js';
import { getPurePolyAsset } from './PurePolyAssets.js';

const ALL_CATEGORIES = [
  'tree',
  'bush',
  'tropical-plant',
  'flower',
  'grass',
  'mushroom',
  'cactus',
  'pebble',
  'rock',
  'prop',
];

const FAMILY_RULES = {
  wildlands: { allowed: ALL_CATEGORIES },
  forest: { allowed: ALL_CATEGORIES },
  desert: {
    allowed: [
      'tree',
      'bush',
      'tropical-plant',
      'flower',
      'grass',
      'cactus',
      'pebble',
      'rock',
      'prop',
    ],
  },
  frozen: { allowed: ['tree', 'bush', 'grass', 'rock', 'pebble', 'prop'] },
  highlands: { allowed: ['tree', 'bush', 'grass', 'rock', 'pebble', 'prop'] },
  wetland: { allowed: ALL_CATEGORIES },
  water: { allowed: ['tree', 'tropical-plant', 'flower', 'grass', 'rock', 'pebble', 'prop'] },
  underground: { allowed: ['mushroom', 'rock', 'pebble', 'prop'] },
  volcanic: { allowed: ['tree', 'rock', 'pebble', 'prop'] },
  settlement: { allowed: ['tree', 'bush', 'flower', 'grass', 'rock', 'pebble', 'prop'] },
  castle: { allowed: ['tree', 'bush', 'flower', 'grass', 'rock', 'pebble', 'prop'] },
  wasteland: { allowed: ['tree', 'bush', 'grass', 'mushroom', 'rock', 'pebble', 'prop'] },
  exotic: { allowed: ALL_CATEGORIES },
};

export function getBiomeAssetPolicy(biomeKey) {
  const biome = ALL_BIOMES.find(({ key }) => key === biomeKey);
  const family = getBiomeGenerationFamily(biomeKey);
  if (!biome || !family) throw new Error('Choose a valid biome for asset suitability');
  const allowed = new Set(FAMILY_RULES[family.key].allowed);
  if (biomeKey === 'eldritchRift') {
    allowed.add('tree');
    return {
      biomeKey,
      familyKey: family.key,
      allowedCategories: [...allowed],
      exception: 'Magical anomalous trees are permitted in Eldritch Rift only.',
    };
  }
  return { biomeKey, familyKey: family.key, allowedCategories: [...allowed], exception: null };
}

export function isAssetAllowedInBiome(assetIdOrDefinition, biomeKey) {
  const assetId =
    typeof assetIdOrDefinition === 'string' ? assetIdOrDefinition : assetIdOrDefinition?.id;
  const asset = getAssetDefinition(assetId);
  if (!asset) return false;
  const purchased = getPurePolyAsset(assetId);
  if (purchased) return purchased.biomes.includes(biomeKey);
  if (Object.hasOwn(REPRESENTATIVE_VARIANTS, assetId))
    return isRepresentativeAllowedInBiome(assetId, biomeKey);
  return getBiomeAssetPolicy(biomeKey).allowedCategories.includes(asset.category);
}

const REPRESENTATIVE_VARIANTS = {
  'source-medieval-wall-door': [
    'town',
    'city',
    'castle',
    'ruinedTown',
    'ruinedUrban',
    'ruinedCastle',
  ],
  'source-dungeon-wall': ['castle', 'ruinedCastle', 'cliffsideCastle', 'mountainCastle', 'dungeon'],
  'source-dungeon-torch': BIOME_GROUPS.Underground.map(({ key }) => key),
  'source-cave-entrance': ['hills', 'mountain', 'alpine', 'cedarHighlands', 'volcanic', 'cavern'],
  'source-cave-stalagmite': ['cavern', 'crystalSpires'],
  'source-cave-column': ['cavern', 'crystalSpires'],
  'mushroom-glow': ['fungalGrove'],
  'mushroom-giant-cap': ['fungalGrove'],
  'source-iron-chest': [
    'town',
    'city',
    'castle',
    'ruinedTown',
    'ruinedUrban',
    'ruinedCastle',
    'dungeon',
    'cavern',
  ],
};

export function isRepresentativeAllowedInBiome(assetId, biomeKey) {
  return REPRESENTATIVE_VARIANTS[assetId]?.includes(biomeKey) === true;
}

function profileFor(biomeKey) {
  return BIOME_FLORA_PROFILES.find((entry) => entry.re.test(biomeKey));
}

export function generatedAssetSuitabilityViolations() {
  const violations = [];
  for (const biome of ALL_BIOMES) {
    const profile = profileFor(biome.key);
    for (const assetId of Object.keys(profile?.weights || {})) {
      if (!isAssetAllowedInBiome(assetId, biome.key))
        violations.push({
          biomeKey: biome.key,
          familyKey: getBiomeGenerationFamily(biome.key)?.key || null,
          assetId,
          category: inferAssetCategory(assetId),
        });
    }
  }
  return violations;
}

export function assetCatalogCoverage() {
  return {
    catalogedAssets: LEGACY_ASSET_CATALOG.length,
    reviewedAssets: LEGACY_ASSET_CATALOG.filter(
      ({ provenance }) => provenance.status === 'reviewed'
    ).length,
    unreviewedLegacyAssets: LEGACY_ASSET_CATALOG.filter(
      ({ provenance }) => provenance.status === 'existing-runtime-unverified'
    ).length,
    generatedViolations: generatedAssetSuitabilityViolations(),
    unavailableWeightedAssets: unavailableWeightedAssets(),
  };
}
