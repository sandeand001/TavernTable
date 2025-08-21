/**
 * BiomeConstants.js - Defines biome taxonomy and metadata for terrain system.
 *
 * Grouping hierarchy: GROUP -> list of biome definitions.
 * Each biome has: key (stable id), label (UI), emoji (optional), category (broad type), rarity.
 */

export const BIOME_GROUPS = {
  Common: [
    { key: 'grassland', label: 'Grassland', emoji: '\ud83c\udf3e', rarity: 'common' },
    { key: 'hills', label: 'Hills', emoji: '\u26f0\ufe0f', rarity: 'common' },
    { key: 'forestTemperate', label: 'Temperate Forest', emoji: '\ud83c\udf33', rarity: 'common' },
    { key: 'forestConifer', label: 'Conifer Forest', emoji: '\ud83c\udf32', rarity: 'common' },
    { key: 'savanna', label: 'Savanna', emoji: '\ud83e\udd92', rarity: 'common' },
    { key: 'steppe', label: 'Steppe / Prairie', emoji: '\ud83c\udf3e', rarity: 'common' }
  ],
  Desert: [
    { key: 'desertHot', label: 'Hot Desert', emoji: '\ud83c\udfdc\ufe0f', rarity: 'uncommon' },
    { key: 'desertCold', label: 'Cold Desert', emoji: '\ud83e\udd76', rarity: 'uncommon' },
    { key: 'sandDunes', label: 'Sand Dunes', emoji: '\ud83c\udf2c\ufe0f', rarity: 'uncommon' },
    { key: 'oasis', label: 'Oasis', emoji: '\ud83d\udca7', rarity: 'uncommon' },
    { key: 'saltFlats', label: 'Salt Flats', emoji: '\ud83e\uddc2', rarity: 'rare' },
    { key: 'thornscrub', label: 'Thornscrub / Chaparral', emoji: '\ud83c\udf35', rarity: 'uncommon' }
  ],
  Arctic: [
    { key: 'tundra', label: 'Tundra', emoji: '\u2744\ufe0f', rarity: 'uncommon' },
    { key: 'glacier', label: 'Glacier / Ice Sheet', emoji: '\ud83e\uddca', rarity: 'rare' },
    { key: 'frozenLake', label: 'Frozen Lake', emoji: '\ud83e\uddca', rarity: 'rare' },
    { key: 'packIce', label: 'Pack Ice', emoji: '\ud83e\uddca', rarity: 'rare' }
  ],
  Mountain: [
    { key: 'mountain', label: 'Mountain', emoji: '\ud83c\udfd4\ufe0f', rarity: 'common' },
    { key: 'alpine', label: 'Alpine', emoji: '\u26f0\ufe0f', rarity: 'uncommon' },
    { key: 'screeSlope', label: 'Scree Slope', emoji: '\ud83e\udea8', rarity: 'uncommon' },
    { key: 'cedarHighlands', label: 'Cedar Highlands', emoji: '\ud83c\udf32', rarity: 'uncommon' },
    { key: 'geyserBasin', label: 'Geyser Basin', emoji: '\u2668\ufe0f', rarity: 'rare' }
  ],
  Wetlands: [
    { key: 'swamp', label: 'Swamp / Marsh', emoji: '\ud83e\udeb5', rarity: 'uncommon' },
    { key: 'wetlands', label: 'Wetlands (Bog/Fen)', emoji: '\ud83e\udd86', rarity: 'uncommon' },
    { key: 'floodplain', label: 'Floodplain', emoji: '\ud83c\udf27\ufe0f', rarity: 'common' },
    { key: 'bloodMarsh', label: 'Blood Marsh', emoji: '\ud83e\ude78', rarity: 'exotic' },
    { key: 'mangrove', label: 'Mangrove', emoji: '\ud83d\udef6', rarity: 'rare' }
  ],
  Aquatic: [
    { key: 'coast', label: 'Coast / Beach', emoji: '\ud83c\udfd6\ufe0f', rarity: 'common' },
    { key: 'riverLake', label: 'River / Lake', emoji: '\ud83c\udfde\ufe0f', rarity: 'common' },
    { key: 'ocean', label: 'Ocean (Deep)', emoji: '\ud83c\udf0a', rarity: 'uncommon' },
    { key: 'coralReef', label: 'Coral Reef', emoji: '\ud83d\udc20', rarity: 'rare' }
  ],
  ForestVariants: [
    { key: 'deadForest', label: 'Dead / Burnt Forest', emoji: '\ud83d\udd25', rarity: 'uncommon' },
    { key: 'petrifiedForest', label: 'Petrified Forest', emoji: '\ud83e\udea8', rarity: 'rare' },
    { key: 'bambooThicket', label: 'Bamboo Thicket', emoji: '\ud83c\udf8d', rarity: 'uncommon' },
    { key: 'orchard', label: 'Orchard', emoji: '\ud83c\udf4e', rarity: 'common' },
    { key: 'mysticGrove', label: 'Mystic Grove', emoji: '\u2728', rarity: 'exotic' },
    { key: 'feywildBloom', label: 'Feywild Bloom', emoji: '\ud83e\uddda', rarity: 'exotic' },
    { key: 'shadowfellForest', label: 'Shadowfell Forest', emoji: '\ud83c\udf11', rarity: 'exotic' }
  ],
  Underground: [
    // ...additional biomes...
  ]
};
