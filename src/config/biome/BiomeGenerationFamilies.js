import { ALL_BIOMES, CAVERN_BIOME_KEYS, DUNGEON_ROOM_COUNT } from './BiomeConstants.js';
import { getBiomeFloraProfile } from '../terrain/FloraProfiles.js';
import { PURE_POLY_GENERATION_BIOMES } from '../assets/PurePolyAssets.js';

const variants = (...keys) =>
  keys.map((key) => {
    const biome = ALL_BIOMES.find((entry) => entry.key === key);
    if (!biome) throw new Error(`Unknown biome generation variant: ${key}`);
    return { key: biome.key, label: biome.label };
  });

const options = (...entries) => entries.map(([value, label]) => ({ value, label }));
const optionValue = (option) => option.value ?? option.key;
const choice = (id, label, values, description) => {
  const entries = options(...values);
  return {
    id,
    label,
    options: entries,
    default:
      entries.find(({ value }) => ['balanced', 'standard', 'automatic', 'seeded'].includes(value))
        ?.value ?? entries[0].value,
    description,
  };
};

const RELIEF = {
  ...choice(
    'relief',
    'Terrain relief',
    [
      ['gentle', 'Gentle'],
      ['balanced', 'Balanced'],
      ['dramatic', 'Dramatic'],
    ],
    'Controls the difference between high and low ground.'
  ),
  variants: ALL_BIOMES.map(({ key }) => key),
};
const ROUGHNESS = {
  ...choice(
    'roughness',
    'Surface character',
    [
      ['smooth', 'Smooth'],
      ['balanced', 'Balanced'],
      ['rugged', 'Rugged'],
    ],
    'Controls how frequently slopes and landforms change.'
  ),
  variants: [
    'grassland',
    'hills',
    'forestTemperate',
    'forestConifer',
    'savanna',
    'steppe',
    'thornscrub',
    'cedarHighlands',
    'deadForest',
    'petrifiedForest',
  ],
};
const MOISTURE = {
  ...choice(
    'moisture',
    'Moisture balance',
    [
      ['dry', 'Drier'],
      ['balanced', 'Balanced'],
      ['wet', 'Wetter'],
    ],
    'Biases low ground toward basins or dry terrain where the biome supports it.'
  ),
  variants: [
    'desertHot',
    'desertCold',
    'oasis',
    'saltFlats',
    'geyserBasin',
    'swamp',
    'wetlands',
    'bloodMarsh',
    'mangrove',
  ],
};
const DENSITY = {
  ...choice(
    'density',
    'Asset density',
    [
      ['sparse', 'Sparse'],
      ['balanced', 'Moderate'],
      ['dense', 'Dense'],
    ],
    'Controls generated trees, rocks, mushrooms and other biome assets.'
  ),
  variants: ALL_BIOMES.filter(({ key }) => {
    const profile = getBiomeFloraProfile(key);
    return profile.density > 0 && Object.keys(profile.weights || {}).length > 0;
  }).map(({ key }) => key),
};
const FOOTPRINT = choice(
  'footprint',
  'Map footprint',
  [
    ['compact', 'Compact'],
    ['standard', 'Standard'],
    ['expansive', 'Expansive'],
  ],
  'Untouched settlement boards may expand to fit the selected footprint.'
);

const ASSET_PACK = {
  ...choice(
    'assetPack',
    'Scenery models',
    [
      ['standard', 'Built-in scenery'],
      ['pure-poly', 'Pure Poly scenery'],
    ],
    'Requires protected-asset access. Scenery still uses the existing grid-based movement rules.'
  ),
  variants: PURE_POLY_GENERATION_BIOMES,
};

const variantField = (list, defaultKey) => ({
  id: 'variant',
  label: 'Terrain variant',
  options: list,
  default: defaultKey,
  description: 'Selects the existing biome identity saved with the generated map.',
});

const family = ({ key, label, emoji, variantKeys, defaultKey, choices }) => ({
  key,
  label,
  emoji,
  variants: variants(...variantKeys),
  fields: [
    variantField(variants(...variantKeys), defaultKey),
    ...choices,
    ...(variantKeys.some((variant) => PURE_POLY_GENERATION_BIOMES.includes(variant))
      ? [ASSET_PACK]
      : []),
  ],
});

export const BIOME_GENERATION_FAMILIES = Object.freeze([
  family({
    key: 'wildlands',
    label: 'Plains & Wildlands',
    emoji: '🌾',
    variantKeys: ['grassland', 'hills', 'savanna', 'steppe'],
    defaultKey: 'grassland',
    choices: [RELIEF, ROUGHNESS, MOISTURE, DENSITY],
  }),
  family({
    key: 'forest',
    label: 'Forest',
    emoji: '🌳',
    variantKeys: [
      'forestTemperate',
      'forestConifer',
      'deadForest',
      'petrifiedForest',
      'bambooThicket',
      'orchard',
      'mysticGrove',
      'feywildBloom',
      'shadowfellForest',
    ],
    defaultKey: 'forestTemperate',
    choices: [RELIEF, ROUGHNESS, MOISTURE, DENSITY],
  }),
  family({
    key: 'desert',
    label: 'Desert',
    emoji: '🏜️',
    variantKeys: ['desertHot', 'desertCold', 'sandDunes', 'oasis', 'saltFlats', 'thornscrub'],
    defaultKey: 'desertHot',
    choices: [RELIEF, ROUGHNESS, MOISTURE, DENSITY],
  }),
  family({
    key: 'frozen',
    label: 'Frozen',
    emoji: '❄️',
    variantKeys: ['tundra', 'glacier', 'frozenLake', 'packIce'],
    defaultKey: 'tundra',
    choices: [RELIEF, ROUGHNESS, MOISTURE, DENSITY],
  }),
  family({
    key: 'highlands',
    label: 'Mountains & Highlands',
    emoji: '🏔️',
    variantKeys: ['mountain', 'alpine', 'screeSlope', 'cedarHighlands', 'geyserBasin'],
    defaultKey: 'mountain',
    choices: [RELIEF, ROUGHNESS, MOISTURE, DENSITY],
  }),
  family({
    key: 'wetland',
    label: 'Wetland',
    emoji: '🪵',
    variantKeys: ['swamp', 'wetlands', 'floodplain', 'bloodMarsh', 'mangrove'],
    defaultKey: 'swamp',
    choices: [RELIEF, ROUGHNESS, MOISTURE, DENSITY],
  }),
  family({
    key: 'water',
    label: 'Water & Coast',
    emoji: '🌊',
    variantKeys: ['coast', 'riverLake', 'ocean', 'coralReef'],
    defaultKey: 'coast',
    choices: [RELIEF, ROUGHNESS, MOISTURE, DENSITY],
  }),
  family({
    key: 'underground',
    label: 'Underground',
    emoji: '🕳️',
    variantKeys: [
      'cavern',
      'dungeon',
      'fungalGrove',
      'crystalFields',
      'crystalSpires',
      'eldritchRift',
    ],
    defaultKey: 'cavern',
    choices: [
      {
        ...choice(
          'entrances',
          'Main entrances',
          [
            ['automatic', 'Use biome default'],
            ['1', 'One'],
            ['2', 'Two'],
            ['3', 'Three'],
            ['4', 'Four'],
          ],
          'Controls generated side passages. Manual connections are preserved.'
        ),
        variants: CAVERN_BIOME_KEYS,
      },
      {
        ...choice(
          'dungeonRoomCount',
          'Dungeon rooms',
          Array.from(
            { length: DUNGEON_ROOM_COUNT.max - DUNGEON_ROOM_COUNT.min + 1 },
            (_, index) => {
              const count = index + DUNGEON_ROOM_COUNT.min;
              return [String(count), `${count} ${count === 1 ? 'room' : 'rooms'}`];
            }
          ),
          'Choose how many connected rooms to fit on this grid.'
        ),
        default: String(DUNGEON_ROOM_COUNT.default),
        variants: ['dungeon'],
      },
      DENSITY,
    ],
  }),
  family({
    key: 'volcanic',
    label: 'Volcanic',
    emoji: '🌋',
    variantKeys: ['volcanic', 'obsidianPlain', 'ashWastes', 'lavaFields'],
    defaultKey: 'volcanic',
    choices: [RELIEF, ROUGHNESS, MOISTURE, DENSITY],
  }),
  family({
    key: 'settlement',
    label: 'Settlement',
    emoji: '🏘️',
    variantKeys: ['town', 'city', 'ruinedTown', 'ruinedUrban'],
    defaultKey: 'town',
    choices: [FOOTPRINT, DENSITY],
  }),
  family({
    key: 'castle',
    label: 'Castle',
    emoji: '🏰',
    variantKeys: ['castle', 'cliffsideCastle', 'mountainCastle', 'ruinedCastle'],
    defaultKey: 'castle',
    choices: [
      FOOTPRINT,
      {
        ...choice(
          'layout',
          'Castle plan',
          [
            ['seeded', 'Seeded plan'],
            ['citadel', 'Citadel'],
            ['bailey', 'Bailey'],
            ['palace', 'Palace'],
          ],
          'Changes the connected keep and ward topology.'
        ),
        variants: ['castle', 'ruinedCastle'],
      },
      {
        ...choice(
          'outskirts',
          'Outer ward',
          [
            ['automatic', 'Use available space'],
            ['none', 'Leave surroundings open'],
          ],
          'Large maps may add buildings outside the main curtain.'
        ),
        variants: ['castle', 'ruinedCastle'],
      },
      DENSITY,
    ],
  }),
  family({
    key: 'wasteland',
    label: 'Wasteland & Ruins',
    emoji: '🪦',
    variantKeys: ['wasteland', 'graveyard'],
    defaultKey: 'wasteland',
    choices: [RELIEF, ROUGHNESS, MOISTURE, DENSITY],
  }),
  family({
    key: 'exotic',
    label: 'Exotic',
    emoji: '✨',
    variantKeys: ['astralPlateau', 'arcaneLeyNexus'],
    defaultKey: 'astralPlateau',
    choices: [RELIEF, ROUGHNESS, MOISTURE, DENSITY],
  }),
]);

const FAMILY_BY_KEY = new Map(
  BIOME_GENERATION_FAMILIES.flatMap((entry) => [
    [entry.key, entry],
    ...entry.variants.map((variant) => [variant.key, entry]),
  ])
);

export function getBiomeGenerationFamily(key) {
  return FAMILY_BY_KEY.get(key) || null;
}

export function getBiomeGenerationVariant(key) {
  const familyEntry = getBiomeGenerationFamily(key);
  return familyEntry?.variants.find((variant) => variant.key === key) || null;
}

export function isBiomeGenerationFieldAvailable(field, biomeKey, assetPack = 'standard') {
  return (
    !field.variants ||
    field.variants.includes(biomeKey) ||
    (field.id === 'density' &&
      assetPack === 'pure-poly' &&
      PURE_POLY_GENERATION_BIOMES.includes(biomeKey))
  );
}

function selectedValue(input, field, fallback) {
  const value = input[field.id] ?? fallback?.[field.id] ?? field.default ?? field.options[0].value;
  if (!field.options.some((option) => option.value === value || option.key === value))
    throw new Error(`Choose a valid ${field.label.toLowerCase()}`);
  return value;
}

export function normalizeBiomeGenerationChoices(familyKey, input = {}, recipe = null) {
  const selectedFamily = getBiomeGenerationFamily(familyKey);
  if (!selectedFamily) throw new Error('Choose a valid biome family');
  const variantFieldDefinition = selectedFamily.fields.find(({ id }) => id === 'variant');
  const biomeKey = selectedValue(input, variantFieldDefinition) || selectedFamily.variants[0]?.key;
  const assetPackField = selectedFamily.fields.find(({ id }) => id === 'assetPack');
  const hasAssetPack = assetPackField && assetPackField.variants.includes(biomeKey);
  if (!hasAssetPack && input.assetPack !== undefined)
    throw new Error('The selected scenery source is unavailable for this biome');
  const previousAssetPack =
    recipe?.version === 1 && recipe.biomeKey === biomeKey ? recipe.values?.assetPack : undefined;
  const assetPack = hasAssetPack
    ? selectedValue(input, assetPackField, { assetPack: previousAssetPack })
    : 'standard';
  const activeFields = selectedFamily.fields.filter((field) =>
    isBiomeGenerationFieldAvailable(field, biomeKey, assetPack)
  );
  const values = Object.fromEntries(
    activeFields.map((field) => [
      field.id,
      field.id === 'assetPack' ? assetPack : selectedValue(input, field),
    ])
  );
  const generation = { biomeKey };
  if (assetPack === 'pure-poly') generation.assetPack = assetPack;
  if (selectedFamily.fields.some(({ id }) => id === 'relief')) {
    const previousRelief =
      recipe?.version === 1 && recipe.biomeKey === biomeKey ? recipe.values?.relief : undefined;
    if (
      previousRelief !== undefined &&
      (!Number.isFinite(previousRelief) || previousRelief < 0.1 || previousRelief > 5)
    )
      throw new TypeError('Saved terrain relief setting is invalid');
    generation.relief = values.relief
      ? { gentle: 0.7, balanced: 1, dramatic: 1.4 }[values.relief]
      : (previousRelief ?? 1);
    if (biomeKey === 'saltFlats') {
      const previousVersion =
        recipe?.version === 1 && recipe.biomeKey === biomeKey
          ? recipe.values?.saltFlatReliefVersion
          : undefined;
      if (previousVersion !== undefined && previousVersion !== 1)
        throw new TypeError('Saved Salt Flats relief version is invalid');
      generation.saltFlatReliefVersion = 1;
    }
  }
  if (values.roughness)
    generation.roughness = { smooth: 0.75, balanced: 1, rugged: 1.35 }[values.roughness];
  else if (selectedFamily.fields.some(({ id }) => id === 'roughness')) {
    const previousRoughness =
      recipe?.version === 1 && recipe.biomeKey === biomeKey ? recipe.values?.roughness : undefined;
    if (
      previousRoughness !== undefined &&
      (!Number.isFinite(previousRoughness) || previousRoughness < 0.1 || previousRoughness > 5)
    )
      throw new TypeError('Saved surface character setting is invalid');
    generation.roughness = previousRoughness ?? 1;
  }
  if (values.moisture)
    generation.waterBias = { dry: 0.25, balanced: 0, wet: -0.25 }[values.moisture];
  else if (selectedFamily.fields.some(({ id }) => id === 'moisture')) {
    const previousBias =
      recipe?.version === 1 && recipe.biomeKey === biomeKey ? recipe.values?.waterBias : undefined;
    if (
      previousBias !== undefined &&
      (!Number.isFinite(previousBias) || Math.abs(previousBias) > 5)
    )
      throw new TypeError('Saved moisture setting is invalid');
    generation.waterBias = previousBias ?? 0;
  }
  if (values.density)
    generation.densityMultiplier = { sparse: 0.55, balanced: 1, dense: 1.65 }[values.density];
  else if (biomeKey !== 'dungeon' && selectedFamily.fields.some(({ id }) => id === 'density')) {
    const previousDensity =
      recipe?.version === 1 && recipe.biomeKey === biomeKey
        ? recipe.values?.densityMultiplier
        : undefined;
    if (
      previousDensity !== undefined &&
      (!Number.isFinite(previousDensity) || previousDensity < 0 || previousDensity > 100)
    )
      throw new TypeError('Saved asset density setting is invalid');
    generation.densityMultiplier = previousDensity ?? 1;
  }
  if (values.footprint)
    generation.canvasScale = { compact: 0.8, standard: 1, expansive: 1.4 }[values.footprint];
  if (values.layout && values.layout !== 'seeded') generation.layoutFamily = values.layout;
  if (values.outskirts) generation.outerWards = values.outskirts !== 'none';
  if (values.entrances && values.entrances !== 'automatic')
    generation.cavernExitCount = Number(values.entrances);
  if (values.dungeonRoomCount) generation.dungeonRoomCount = Number(values.dungeonRoomCount);
  return generation;
}

export function getBiomeGenerationReviewDefaults(biomeKey, recipe = null) {
  const selectedFamily = getBiomeGenerationFamily(biomeKey);
  if (!selectedFamily) return {};
  const defaults = Object.fromEntries(
    selectedFamily.fields.map((field) => [field.id, field.default ?? optionValue(field.options[0])])
  );
  defaults.variant = biomeKey;
  if (!recipe || recipe.version !== 1 || recipe.biomeKey !== biomeKey) return defaults;
  const values = recipe.values || {};
  if (values.assetPack !== undefined) {
    if (!['standard', 'pure-poly'].includes(values.assetPack))
      throw new TypeError('Saved scenery source is invalid');
    defaults.assetPack = values.assetPack;
  }
  if (values.relief)
    defaults.relief =
      values.relief <= 0.85 ? 'gentle' : values.relief >= 1.2 ? 'dramatic' : 'balanced';
  if (values.roughness)
    defaults.roughness =
      values.roughness <= 0.85 ? 'smooth' : values.roughness >= 1.2 ? 'rugged' : 'balanced';
  if (Number.isFinite(values.waterBias))
    defaults.moisture =
      values.waterBias < -0.1 ? 'wet' : values.waterBias > 0.1 ? 'dry' : 'balanced';
  if (values.densityMultiplier)
    defaults.density =
      values.densityMultiplier < 0.8
        ? 'sparse'
        : values.densityMultiplier > 1.25
          ? 'dense'
          : 'balanced';
  if (values.canvasScale)
    defaults.footprint =
      values.canvasScale < 0.9 ? 'compact' : values.canvasScale > 1.15 ? 'expansive' : 'standard';
  defaults.layout = values.layoutFamily || 'seeded';
  defaults.outskirts = values.outerWards === false ? 'none' : 'automatic';
  defaults.entrances =
    values.cavernExitCount === undefined ? 'automatic' : String(values.cavernExitCount);
  if (values.dungeonRoomCount !== undefined)
    defaults.dungeonRoomCount = String(values.dungeonRoomCount);
  return defaults;
}
