import { TERRAIN_PLACEABLES } from '../terrain/TerrainPlaceables.js';
import { getPurePolyAsset, isCaveFormationModel } from './PurePolyAssets.js';

export const ASSET_CATALOG_VERSION = 1;

const CATEGORY_PATTERNS = [
  [
    'tree',
    /^tree-|^family-(birch|cherry|dead|giant-pine|pine|deciduous|crimson-remnant|thick-trunk|spectral)$/,
  ],
  ['bush', /^bush-/],
  ['tropical-plant', /^plant-tropical-/],
  ['flower', /^flower-/],
  ['grass', /^grass-/],
  ['mushroom', /^mushroom-/],
  ['pebble', /^pebble-/],
  ['rock', /^(?:rock-|source-cave-(?:stalagmite|column)$)/],
];

const REPRESENTATIVE_PROVENANCE = {
  'source-medieval-wall-door': {
    sourcePack: 'medieval-village-megakit-quaternius',
    license: 'CC0 1.0 Universal',
  },
  'source-dungeon-wall': {
    sourcePack: 'lowpoly-modular-dungeon-quaternius',
    license: 'CC0 1.0 Universal',
  },
  'source-dungeon-torch': {
    sourcePack: 'lowpoly-modular-dungeon-quaternius',
    license: 'CC0 1.0 Universal',
  },
  'source-cave-entrance': {
    sourcePack: 'free-mine-assets-rubberduck',
    license: 'CC0 1.0 Universal',
  },
  'source-cave-stalagmite': {
    sourcePack: 'free-mine-assets-rubberduck',
    license: 'CC0 1.0 Universal',
  },
  'source-cave-column': {
    sourcePack: 'low-poly-cave-agdg',
    license: 'CC0 1.0 Universal',
  },
  'source-iron-chest': {
    sourcePack: 'lowpoly-modular-dungeon-quaternius',
    license: 'CC0 1.0 Universal',
  },
  'mushroom-glow': {
    sourcePack: 'assetquest-forest',
    license: 'CC0 1.0 Universal',
  },
  'mushroom-giant-cap': {
    sourcePack: 'assetquest-forest',
    license: 'CC0 1.0 Universal',
  },
};

const identifier = (value) =>
  typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(value);

export function inferAssetCategory(id) {
  const purchased = getPurePolyAsset(id);
  if (purchased) return purchased.category;
  const match = CATEGORY_PATTERNS.find(([, pattern]) => pattern.test(id));
  return match?.[0] || 'prop';
}

export function normalizeAssetDefinition(input) {
  if (
    !input ||
    typeof input !== 'object' ||
    !identifier(input.id) ||
    input.version !== ASSET_CATALOG_VERSION ||
    !identifier(input.modelKey) ||
    ![
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
    ].includes(input.category) ||
    !['plant', 'plant-family', 'path', 'structure'].includes(input.runtimeType) ||
    !['ground', 'floor', 'structure', 'any'].includes(input.placement?.surface) ||
    !Number.isFinite(input.placement?.footprintFeet?.x) ||
    !Number.isFinite(input.placement?.footprintFeet?.z) ||
    input.placement.footprintFeet.x <= 0 ||
    input.placement.footprintFeet.z <= 0 ||
    !Number.isFinite(input.placement?.spacingTiles) ||
    input.placement.spacingTiles < 0 ||
    !['fixed', 'free'].includes(input.placement?.rotation) ||
    !['existing-runtime-unverified', 'reviewed', 'generated'].includes(input.provenance?.status) ||
    (input.provenance?.status !== 'existing-runtime-unverified' &&
      (!identifier(input.provenance?.sourcePack) ||
        typeof input.provenance?.license !== 'string' ||
        !input.provenance.license.trim()))
  )
    throw new Error(`Asset definition "${input?.id || 'unknown'}" is invalid`);
  return JSON.parse(JSON.stringify(input));
}

export function normalizeAssetSource(input) {
  if (
    !input ||
    typeof input !== 'object' ||
    input.version !== ASSET_CATALOG_VERSION ||
    !identifier(input.id) ||
    typeof input.name !== 'string' ||
    !input.name.trim() ||
    typeof input.creator !== 'string' ||
    !input.creator.trim() ||
    typeof input.sourceURL !== 'string' ||
    !input.sourceURL.startsWith('https://') ||
    typeof input.license !== 'string' ||
    !input.license.trim() ||
    !Array.isArray(input.noticeFiles) ||
    !input.noticeFiles.length ||
    input.noticeFiles.some((file) => typeof file !== 'string' || !file.trim()) ||
    !Array.isArray(input.assets) ||
    !input.assets.length ||
    new Set(input.assets).size !== input.assets.length ||
    input.assets.some((id) => !identifier(id))
  )
    throw new Error(`Asset source "${input?.id || 'unknown'}" is invalid`);
  return JSON.parse(JSON.stringify(input));
}

export function deriveLegacyAssetDefinition(id, definition) {
  const category = inferAssetCategory(id);
  const isFamily = definition.type === 'plant-family';
  const purchased = getPurePolyAsset(id);
  const reviewed = purchased
    ? {
        sourcePack: 'pure-poly-mining-cave-blacksmith',
        license: 'Fab Standard License; NoAI; no standalone redistribution',
      }
    : REPRESENTATIVE_PROVENANCE[id];
  const caveFormation = isCaveFormationModel(id);
  const giantMushroom = id === 'mushroom-giant-cap';
  const fungalModel = giantMushroom || id === 'mushroom-glow';
  return normalizeAssetDefinition({
    version: ASSET_CATALOG_VERSION,
    id,
    label: definition.label || id,
    modelKey: definition.modelKey || definition.representativeModelKey || id,
    category,
    runtimeType: definition.type,
    placement: {
      surface:
        fungalModel ||
        ['prop', 'light', 'ore', 'tree', 'grass'].includes(purchased?.kind) ||
        ['rock', 'pebble', 'mushroom', 'cactus'].includes(category)
          ? 'ground'
          : 'any',
      footprintFeet: {
        x:
          giantMushroom || purchased?.kind === 'cactus'
            ? 10
            : category === 'tree' || caveFormation || fungalModel
              ? 5
              : 2.5,
        z:
          giantMushroom || purchased?.kind === 'cactus'
            ? 10
            : category === 'tree' || caveFormation || fungalModel
              ? 5
              : 2.5,
      },
      spacingTiles: caveFormation
        ? 3
        : fungalModel || ['rock', 'pebble'].includes(category)
          ? 1
          : 0,
      rotation: isFamily ? 'free' : 'fixed',
    },
    rendering: {
      castShadow: true,
      foliage: ['tree', 'bush', 'tropical-plant', 'flower', 'grass'].includes(category),
    },
    provenance: {
      status: reviewed ? 'reviewed' : 'existing-runtime-unverified',
      sourcePack: reviewed?.sourcePack || null,
      license: reviewed?.license || null,
      notes: reviewed
        ? 'Approved representative model; pack-wide runtime expansion remains disabled.'
        : 'Legacy runtime asset; source pack and license mapping require review before re-ingest.',
    },
  });
}

export const LEGACY_ASSET_CATALOG = Object.freeze(
  Object.entries(TERRAIN_PLACEABLES)
    .filter(([, definition]) => definition.modelKey || definition.representativeModelKey)
    .map(([id, definition]) => deriveLegacyAssetDefinition(id, definition))
);

const ASSET_BY_ID = new Map(LEGACY_ASSET_CATALOG.map((entry) => [entry.id, entry]));

export function getAssetDefinition(id) {
  return ASSET_BY_ID.get(id) || null;
}
