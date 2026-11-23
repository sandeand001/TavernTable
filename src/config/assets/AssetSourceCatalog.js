import { ASSET_CATALOG_VERSION } from './AssetCatalog.js';
import { PURE_POLY_ASSETS } from './PurePolyAssets.js';

const SOURCE_PACKS = [
  {
    id: 'low-poly-mining-cave-dglopez',
    group: 'biome-caves',
    name: 'Low Poly Mining and Cave Asset Pack',
    creator: 'dglopez',
    sourceURL: 'https://dglopez.itch.io/low-poly-mining-cave-asset-pack-30-free-3d-models',
    license: 'Custom royalty-free end-product license',
    noticeFile:
      'assets/terrain/source-packs/biome-caves/low-poly-mining-cave-dglopez/SOURCE-NOTICE.txt',
    modelFiles: 90,
    distinctAssets: 30,
    formats: ['fbx', 'obj', 'glb'],
    use: [
      {
        variants: ['hills', 'mountain', 'alpine', 'cedarHighlands', 'volcanic', 'cavern'],
        role: 'terrain-entrance',
        consumer: 'src/terrain/generation/BiomeStructures.js',
        detail: 'Mine mouth, rock opening, supports, rails, carts and ore props',
      },
      {
        variants: ['cavern', 'crystalFields', 'crystalSpires'],
        role: 'placeable-props',
        consumer: 'src/terrain/flora/BiomePopulation.js',
        detail: 'Stalagmite clusters, rock columns, ore, rubble and mining scatter',
      },
    ],
  },
  {
    id: 'pure-poly-mining-cave-blacksmith',
    group: 'biome-caves',
    name: 'Low Poly Mining, Cave & Blacksmith Pack (individual FBX files)',
    creator: 'Pure Poly',
    sourceURL: 'https://www.fab.com/listings/626d3388-33d2-4012-a944-cb512baf83b4',
    license: 'Fab Standard License; NoAI; no standalone redistribution',
    noticeFile:
      'assets/terrain/source-packs/biome-caves/pure-poly-mining-cave-blacksmith/SOURCE-NOTICE.txt',
    modelFiles: 2597,
    inventoryGranularity: 'file-variant',
    formats: ['fbx'],
    runtimeAssets: PURE_POLY_ASSETS.map(({ id }) => id),
    use: [
      {
        variants: ['cavern', 'crystalFields', 'crystalSpires', 'dungeon'],
        role: 'cave-formation-and-shell-candidates',
        consumer: 'src/terrain/flora/BiomePopulation.js',
        detail: 'Stalagmites, cave walls, tunnel shells, crystals and mineral formations',
      },
      {
        variants: ['cavern', 'hills', 'mountain', 'dungeon'],
        role: 'deliberate-mining-site-candidates',
        consumer: 'src/terrain/generation/BiomeStructures.js',
        detail: 'Entrances, supports, rails, carts, ores and equipment for planned mining sites',
      },
      {
        variants: ['town', 'city', 'castle', 'ruinedCastle', 'dungeon'],
        role: 'forge-and-settlement-candidates',
        consumer: 'src/terrain/generation/InteriorProps.js',
        detail: 'Forge structures, tools, containers, treasure and inhabited-site light fixtures',
      },
      {
        variants: [
          'desertHot',
          'sandDunes',
          'thornscrub',
          'oasis',
          'grassland',
          'hills',
          'forestTemperate',
          'forestConifer',
          'mysticGrove',
          'cavern',
          'fungalGrove',
        ],
        role: 'natural-vegetation-candidates',
        consumer: 'src/terrain/flora/BiomePopulation.js',
        detail:
          'Selected cacti, grasses and fungi for supported natural scenery; more candidates remain',
      },
      {
        variants: [
          'cavern',
          'grassland',
          'hills',
          'mountain',
          'alpine',
          'screeSlope',
          'forestTemperate',
          'forestConifer',
        ],
        role: 'natural-pebble-candidates',
        consumer: 'src/terrain/flora/BiomePopulation.js',
        detail: 'Selected passable pebble clusters; other stone variants remain candidates',
      },
      {
        variants: [
          'forestTemperate',
          'forestConifer',
          'hills',
          'mountain',
          'alpine',
          'cedarHighlands',
          'deadForest',
          'wasteland',
          'graveyard',
          'ashWastes',
        ],
        role: 'forest-and-dry-land-tree-candidates',
        consumer: 'src/terrain/flora/BiomePopulation.js',
        detail:
          'Selected firs, broadleaf, autumn birches and leafless trees; further variants remain',
      },
    ],
  },
  {
    id: 'free-mine-assets-rubberduck',
    group: 'biome-caves',
    name: 'Free Mine Assets (selected runtime derivatives)',
    creator: 'rubberduck',
    sourceURL: 'https://opengameart.org/content/free-mine-assets-pack',
    license: 'CC0 1.0 Universal',
    noticeFile:
      'assets/terrain/source-packs/biome-caves/free-mine-assets-rubberduck/SOURCE-NOTICE.txt',
    modelFiles: 2,
    distinctAssets: 2,
    formats: ['glb'],
    runtimeAssets: ['source-cave-entrance', 'source-cave-stalagmite'],
    use: [
      {
        variants: ['hills', 'mountain', 'alpine', 'cedarHighlands', 'volcanic', 'cavern'],
        role: 'manual-entrance-frame',
        consumer: 'src/config/terrain/TerrainPlaceables.js',
        detail: 'Decorative wooden frame, not a terrain opening',
      },
      {
        variants: ['cavern', 'crystalSpires'],
        role: 'cave-formation',
        consumer: 'src/terrain/flora/BiomePopulation.js',
        detail: 'Recolored faceted stalagmite cluster',
      },
    ],
  },
  {
    id: 'low-poly-cave-agdg',
    group: 'biome-caves',
    name: 'Low Poly Cave Assets (selected runtime derivative)',
    creator: 'agdg reject',
    sourceURL: 'https://opengameart.org/content/low-poly-cave-assets',
    license: 'CC0 1.0 Universal',
    noticeFile: 'assets/terrain/source-packs/biome-caves/low-poly-cave-agdg/SOURCE-NOTICE.txt',
    modelFiles: 1,
    distinctAssets: 1,
    formats: ['glb'],
    runtimeAssets: ['source-cave-column'],
    use: [
      {
        variants: ['cavern', 'crystalSpires'],
        role: 'cave-formation',
        consumer: 'src/terrain/flora/BiomePopulation.js',
        detail: 'Recolored faceted stone column',
      },
    ],
  },
  {
    id: 'lowpoly-modular-dungeon-quaternius',
    group: 'biome-dungeons',
    name: 'LowPoly Modular Dungeon Pack',
    creator: 'Quaternius',
    sourceURL: 'https://quaternius.itch.io/lowpoly-modular-dungeon-pack',
    license: 'CC0 1.0 Universal',
    noticeFile:
      'assets/terrain/source-packs/biome-dungeons/lowpoly-modular-dungeon-quaternius/SOURCE-NOTICE.txt',
    modelFiles: 144,
    distinctAssets: 48,
    formats: ['blend', 'fbx', 'obj'],
    runtimeAssets: ['source-dungeon-wall', 'source-dungeon-torch', 'source-iron-chest'],
    use: [
      {
        variants: ['dungeon'],
        role: 'modular-room-kit',
        consumer: 'src/terrain/generation/DungeonLayouts.js',
        detail: 'Walls, floors, corridors, stairs, doors, cells and dungeon rooms',
      },
      {
        variants: [
          'dungeon',
          'cavern',
          'fungalGrove',
          'crystalFields',
          'crystalSpires',
          'eldritchRift',
        ],
        role: 'local-light-source',
        consumer: 'src/scene/lighting/UndergroundLighting.js',
        detail: 'CC0 torch with a bounded, map-local visual light',
      },
      {
        variants: ['castle', 'ruinedCastle', 'cliffsideCastle', 'mountainCastle'],
        role: 'underground-interior-kit',
        consumer: 'src/terrain/generation/CastleCellars.js',
        detail: 'Cellar and dungeon furnishing modules beneath castle sites',
      },
      {
        variants: [
          'cavern',
          'dungeon',
          'town',
          'city',
          'castle',
          'ruinedTown',
          'ruinedUrban',
          'ruinedCastle',
        ],
        role: 'manual-loot-container',
        consumer: 'src/config/terrain/TerrainPlaceables.js',
        detail: 'Wood and metal chest with opaque material import',
      },
    ],
  },
  {
    id: 'fantasy-props-megakit-quaternius',
    group: 'biome-props',
    name: 'Fantasy Props MegaKit',
    creator: 'Quaternius',
    sourceURL: 'https://quaternius.itch.io/fantasy-props-megakit',
    license: 'CC0 1.0 Universal',
    noticeFile:
      'assets/terrain/source-packs/biome-props/fantasy-props-megakit-quaternius/SOURCE-NOTICE.txt',
    modelFiles: 282,
    distinctAssets: 94,
    formats: ['fbx', 'gltf', 'obj'],
    use: [
      {
        variants: ['town', 'ruinedTown', 'city', 'ruinedUrban'],
        role: 'settlement-props',
        consumer: 'src/terrain/generation/SettlementLayouts.js',
        detail: 'Market, street, guard, storage and building-adjacent props',
      },
      {
        variants: ['castle', 'ruinedCastle', 'cliffsideCastle', 'mountainCastle'],
        role: 'castle-props',
        consumer: 'src/terrain/generation/CastleSites.js',
        detail: 'Courtyard, battlement, gate, armoury and bailey dressing',
      },
      {
        variants: ['dungeon'],
        role: 'interior-props',
        consumer: 'src/terrain/generation/DungeonLayouts.js',
        detail: 'Furniture, cover, storage and encounter dressing',
      },
    ],
  },
  {
    id: 'fantasy-tavern-cerberies3d',
    group: 'biome-props',
    name: 'Fantasy Tavern',
    creator: 'cerberies3D',
    sourceURL: 'https://cerberies3d.itch.io/fantasy-tavern-104-semi-realistic-props',
    license: 'Personal and commercial end products; no standalone asset redistribution',
    noticeFile:
      'assets/terrain/source-packs/biome-props/fantasy-tavern-cerberies3d/SOURCE-NOTICE.txt',
    modelFiles: 180,
    distinctAssets: 104,
    formats: ['fbx'],
    use: [
      {
        variants: ['town', 'city', 'castle'],
        role: 'interior-furnishing',
        consumer: 'src/campaigns/BuildingAssembly.js',
        detail: 'Tavern, kitchen, dining, storage and inhabited-room props',
      },
      {
        variants: ['ruinedTown', 'ruinedUrban', 'ruinedCastle', 'dungeon'],
        role: 'ruin-furnishing',
        consumer: 'src/terrain/generation/SettlementLayouts.js',
        detail: 'Selected furnishings for abandoned rooms; wear requires separate treatment',
      },
      {
        variants: ['cavern', 'crystalFields', 'crystalSpires'],
        role: 'crystal-formations',
        consumer: 'src/terrain/flora/BiomePopulation.js',
        detail: 'Crystal Cluster and Crystal Small are candidates for underground formations',
      },
    ],
  },
  {
    id: 'medieval-village-megakit-quaternius',
    group: 'biome-settlements',
    name: 'Medieval Village MegaKit',
    creator: 'Quaternius',
    sourceURL: 'https://quaternius.itch.io/medieval-village-megakit',
    license: 'CC0 1.0 Universal',
    noticeFile:
      'assets/terrain/source-packs/biome-settlements/medieval-village-megakit-quaternius/SOURCE-NOTICE.txt',
    modelFiles: 528,
    distinctAssets: 176,
    formats: ['fbx', 'gltf', 'obj'],
    runtimeAssets: [
      'source-medieval-wall-door',
      'source-medieval-wall-straight',
      'source-medieval-wall-window-wide',
      'source-medieval-wall-window-thin',
      'source-medieval-roof',
      'source-medieval-balcony',
      'source-medieval-roof-front',
    ],
    use: [
      {
        variants: ['town', 'ruinedTown', 'city', 'ruinedUrban'],
        role: 'settlement-module-kit',
        consumer: 'src/terrain/generation/SettlementLayouts.js',
        detail: 'Walls, doors, windows, shutters, roofs, stairs, balconies and settlement details',
      },
      {
        variants: ['castle', 'ruinedCastle'],
        role: 'outer-settlement',
        consumer: 'src/terrain/generation/SettlementLayouts.js',
        detail: 'Castle outskirts, service buildings and ward structures',
      },
    ],
  },
  {
    id: 'castle-wall-kit-loaf',
    group: 'biome-structures',
    name: 'Castle Wall Kit',
    creator: 'loafbrr',
    sourceURL: 'https://loafbrr.itch.io/castle-wall-kit',
    license: 'CC0 1.0 Universal',
    noticeFile:
      'assets/terrain/source-packs/biome-structures/castle-wall-kit-loaf/SOURCE-NOTICE.txt',
    modelFiles: 3,
    distinctAssets: 116,
    formats: ['blend', 'fbx', 'gltf'],
    use: [
      {
        variants: ['castle', 'ruinedCastle', 'cliffsideCastle', 'mountainCastle'],
        role: 'castle-shell-kit',
        consumer: 'src/terrain/generation/CastleSites.js',
        detail: '116 named modules in one scene: walls, gates, towers, battlements and stairs',
      },
    ],
  },
  {
    id: 'fantasy-weapons-lite-justcreate3d',
    group: 'equipment',
    name: 'Low Poly RPG Fantasy Weapons Lite',
    creator: 'JustCreate3D (Oleh Lila)',
    sourceURL: 'https://justcreate3d.itch.io/low-poly-rpg-fantasy-weapons-lite',
    license: 'Digital Asset License; finished-project use, no standalone redistribution',
    noticeFile:
      'assets/terrain/source-packs/equipment/fantasy-weapons-lite-justcreate3d/SOURCE-NOTICE.txt',
    modelFiles: 7,
    distinctAssets: 7,
    formats: ['fbx'],
    use: [
      {
        variants: ['town', 'city', 'castle', 'dungeon'],
        role: 'equipment-props',
        consumer: 'src/terrain/generation/InteriorProps.js',
        detail: 'Weapon racks, armouries, loot and equipped-room dressing',
      },
    ],
  },
  {
    id: 'kenney-retro-fantasy',
    group: 'equipment',
    name: 'Retro Fantasy Kit',
    creator: 'Kenney',
    sourceURL: 'https://kenney.nl/assets/retro-fantasy-kit',
    license: 'CC0 1.0 Universal',
    noticeFile: 'assets/terrain/source-packs/equipment/kenney-retro-fantasy/SOURCE-NOTICE.txt',
    modelFiles: 315,
    distinctAssets: 105,
    formats: ['fbx', 'obj', 'glb'],
    use: [
      {
        variants: [
          'town',
          'city',
          'castle',
          'ruinedTown',
          'ruinedUrban',
          'ruinedCastle',
          'dungeon',
        ],
        role: 'fallback-and-test-kit',
        consumer: 'src/terrain/generation/InteriorProps.js',
        detail: 'Low-poly fallback props, weapons and settlement dressing',
      },
    ],
  },
  {
    id: 'jampot-3d-chests',
    group: 'props',
    name: 'Jampot 3D Chests Pack',
    creator: 'Jampot.gg',
    sourceURL: 'https://jampot-gg.itch.io/jampot-3d-chests-pack',
    license: 'Royalty-Free Commercial; no raw-file resale or asset-store redistribution',
    noticeFile: 'assets/terrain/source-packs/props/jampot-3d-chests/SOURCE-NOTICE.txt',
    modelFiles: 10,
    distinctAssets: 5,
    formats: ['fbx', 'glb'],
    use: [
      {
        variants: ['dungeon', 'town', 'city', 'castle', 'ruinedCastle', 'cavern', 'crystalFields'],
        role: 'loot-container',
        consumer: 'src/terrain/generation/InteriorProps.js',
        detail: 'Chest and treasure-container placement with openable lid variants',
      },
    ],
  },
  {
    id: 'assetquest-forest',
    group: 'biome-forest',
    name: 'Free Stylized Forest Asset Kit',
    creator: 'Asset Quest',
    sourceURL: 'https://assetquest.itch.io/',
    license: 'CC0 1.0 Universal',
    noticeFile: 'assets/terrain/plants/forest/Forest_Kit_License.txt',
    modelFiles: 118,
    distinctAssets: 118,
    formats: ['fbx'],
    runtimeAssets: ['mushroom-glow', 'mushroom-giant-cap'],
    use: [
      {
        variants: ['fungalGrove'],
        role: 'fungal-cave-scenery',
        consumer: 'src/terrain/flora/BiomePopulation.js',
        detail: 'Glowing purple mushroom clusters and giant red caps',
      },
    ],
  },
];

const identifier = (value) =>
  typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(value);

export function normalizeSourcePack(input) {
  if (
    !input ||
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
    typeof input.noticeFile !== 'string' ||
    !input.noticeFile.trim() ||
    !Number.isInteger(input.modelFiles) ||
    input.modelFiles < 1 ||
    (input.distinctAssets !== undefined &&
      (!Number.isInteger(input.distinctAssets) || input.distinctAssets < 1)) ||
    (input.inventoryGranularity !== undefined && input.inventoryGranularity !== 'file-variant') ||
    !Array.isArray(input.formats) ||
    !input.formats.length ||
    !Array.isArray(input.runtimeAssets) ||
    new Set(input.runtimeAssets).size !== input.runtimeAssets.length ||
    input.runtimeAssets.some((id) => !identifier(id)) ||
    !Array.isArray(input.use) ||
    !input.use.length ||
    input.use.some(
      (entry) =>
        !entry ||
        !Array.isArray(entry.variants) ||
        !entry.variants.length ||
        entry.variants.some((variant) => typeof variant !== 'string' || !variant.trim()) ||
        typeof entry.role !== 'string' ||
        !entry.role.trim() ||
        typeof entry.consumer !== 'string' ||
        !entry.consumer.trim() ||
        typeof entry.detail !== 'string' ||
        !entry.detail.trim()
    )
  )
    throw new Error(`Source pack "${input?.id || 'unknown'}" is invalid`);
  return JSON.parse(JSON.stringify(input));
}

export const ASSET_SOURCE_CATALOG = Object.freeze(
  SOURCE_PACKS.map((pack) =>
    normalizeSourcePack({
      version: ASSET_CATALOG_VERSION,
      reviewState: 'source-only',
      runtimeApproved: false,
      productionApproved: false,
      runtimeAssets: [],
      ...pack,
    })
  )
);

export function getSourcePack(id) {
  return ASSET_SOURCE_CATALOG.find((pack) => pack.id === id) || null;
}

export function getRepresentativeSourcePack(assetId) {
  return ASSET_SOURCE_CATALOG.find((pack) => pack.runtimeAssets.includes(assetId)) || null;
}
