const pack = (kind, category, biomes, generatedBiomes, targetHeight, entries) => {
  const allowed = Object.freeze([...biomes]);
  const generated = Object.freeze([...generatedBiomes]);
  return entries.map(([id, source, path, height = targetHeight, lightColor = null]) =>
    Object.freeze({
      id,
      source,
      path,
      kind,
      category,
      biomes: allowed,
      generatedBiomes: generated,
      targetHeight: height,
      ...(lightColor === null ? {} : { lightColor }),
    })
  );
};

export const PURE_POLY_ASSETS = Object.freeze([
  ...pack('formation', 'rock', ['cavern'], ['cavern'], 2.2, [
    [
      'pure-poly-stalagmite-01',
      'PP_Stalagmite_01',
      'assets/protected/pure-poly-stalagmite-01.ttasset',
    ],
    [
      'pure-poly-stalagmite-02',
      'PP_Stalagmite_02',
      'assets/protected/pure-poly-stalagmite-02.ttasset',
    ],
    [
      'pure-poly-stalagmite-03',
      'PP_Stalagmite_03',
      'assets/protected/pure-poly-stalagmite-03.ttasset',
    ],
    [
      'pure-poly-stalagmite-04',
      'PP_Stalagmite_04',
      'assets/protected/pure-poly-stalagmite-04.ttasset',
    ],
    [
      'pure-poly-stalagmite-05',
      'PP_Stalagmite_05',
      'assets/protected/pure-poly-stalagmite-05.ttasset',
    ],
    [
      'pure-poly-stalagmite-06',
      'PP_Stalagmite_06',
      'assets/protected/pure-poly-stalagmite-06.ttasset',
    ],
    [
      'pure-poly-stalagmite-07',
      'PP_Stalagmite_07',
      'assets/protected/pure-poly-stalagmite-07.ttasset',
    ],
    [
      'pure-poly-stalagmite-08',
      'PP_Stalagmite_08',
      'assets/protected/pure-poly-stalagmite-08.ttasset',
    ],
    [
      'pure-poly-cave-column-01',
      'PP_Rock_Column_01',
      'assets/protected/pure-poly-cave-column-01.ttasset',
      2.4,
    ],
    [
      'pure-poly-cave-column-02',
      'PP_Rock_Column_02',
      'assets/protected/pure-poly-cave-column-02.ttasset',
      2.4,
    ],
    [
      'pure-poly-cave-column-03',
      'PP_Rock_Column_03',
      'assets/protected/pure-poly-cave-column-03.ttasset',
      2.4,
    ],
    [
      'pure-poly-cave-column-04',
      'PP_Rock_Column_04',
      'assets/protected/pure-poly-cave-column-04.ttasset',
      2.4,
    ],
    [
      'pure-poly-cave-column-05',
      'PP_Rock_Column_05',
      'assets/protected/pure-poly-cave-column-05.ttasset',
      2.4,
    ],
  ]),
  ...pack(
    'rock',
    'rock',
    ['cavern', 'hills', 'mountain', 'alpine', 'screeSlope'],
    ['cavern'],
    1.8,
    [
      ['pure-poly-rock-01', 'PP_Rock_01', 'assets/protected/pure-poly-rock-01.ttasset'],
      ['pure-poly-rock-02', 'PP_Rock_02', 'assets/protected/pure-poly-rock-02.ttasset'],
      ['pure-poly-rock-03', 'PP_Rock_03', 'assets/protected/pure-poly-rock-03.ttasset', 1.4],
      ['pure-poly-rock-04', 'PP_Rock_04', 'assets/protected/pure-poly-rock-04.ttasset', 2],
      ['pure-poly-rock-05', 'PP_Rock_05', 'assets/protected/pure-poly-rock-05.ttasset', 1.7],
      ['pure-poly-rock-06', 'PP_Rock_06', 'assets/protected/pure-poly-rock-06.ttasset'],
      ['pure-poly-rock-07', 'PP_Rock_07', 'assets/protected/pure-poly-rock-07.ttasset', 1.4],
    ]
  ),
  ...pack(
    'pebble',
    'pebble',
    [
      'cavern',
      'grassland',
      'hills',
      'mountain',
      'alpine',
      'screeSlope',
      'forestTemperate',
      'forestConifer',
    ],
    [
      'cavern',
      'grassland',
      'hills',
      'mountain',
      'alpine',
      'screeSlope',
      'forestTemperate',
      'forestConifer',
    ],
    0.08,
    [
      ['pure-poly-pebbles-01', 'PP_Pebbles_01', 'assets/protected/pure-poly-pebbles-01.ttasset'],
      ['pure-poly-pebbles-02', 'PP_Pebbles_02', 'assets/protected/pure-poly-pebbles-02.ttasset'],
      ['pure-poly-pebbles-03', 'PP_Pebbles_03', 'assets/protected/pure-poly-pebbles-03.ttasset'],
      ['pure-poly-pebbles-04', 'PP_Pebbles_04', 'assets/protected/pure-poly-pebbles-04.ttasset'],
      ['pure-poly-pebbles-05', 'PP_Pebbles_05', 'assets/protected/pure-poly-pebbles-05.ttasset'],
      ['pure-poly-pebbles-06', 'PP_Pebbles_06', 'assets/protected/pure-poly-pebbles-06.ttasset'],
    ]
  ),
  ...pack(
    'crystal',
    'rock',
    ['cavern', 'crystalFields', 'crystalSpires'],
    ['crystalFields', 'crystalSpires'],
    2.2,
    [
      [
        'pure-poly-crystal-cluster-01',
        'PP_Crystal_Cluster_01_Blue',
        'assets/protected/pure-poly-crystal-cluster-01.ttasset',
      ],
      [
        'pure-poly-crystal-cluster-02',
        'PP_Crystal_Cluster_02_Blue',
        'assets/protected/pure-poly-crystal-cluster-02.ttasset',
      ],
      [
        'pure-poly-crystal-cluster-03',
        'PP_Crystal_Cluster_03_Blue',
        'assets/protected/pure-poly-crystal-cluster-03.ttasset',
      ],
      [
        'pure-poly-crystal-cluster-05',
        'PP_Crystal_Cluster_05_Blue',
        'assets/protected/pure-poly-crystal-cluster-05.ttasset',
      ],
    ]
  ),
  ...pack('crystal', 'rock', ['cavern', 'crystalFields'], ['crystalFields'], 2.2, [
    [
      'pure-poly-crystal-cluster-01-green',
      'PP_Crystal_Cluster_01_Green',
      'assets/protected/pure-poly-crystal-cluster-01-green.ttasset',
      2.2,
      0x78d77a,
    ],
    [
      'pure-poly-crystal-cluster-02-green',
      'PP_Crystal_Cluster_02_Green',
      'assets/protected/pure-poly-crystal-cluster-02-green.ttasset',
      2.2,
      0x78d77a,
    ],
    [
      'pure-poly-crystal-cluster-01-red',
      'PP_Crystal_Cluster_01_Red',
      'assets/protected/pure-poly-crystal-cluster-01-red.ttasset',
      2.2,
      0xff725e,
    ],
    [
      'pure-poly-crystal-cluster-02-red',
      'PP_Crystal_Cluster_02_Red',
      'assets/protected/pure-poly-crystal-cluster-02-red.ttasset',
      2.2,
      0xff725e,
    ],
  ]),
  ...pack(
    'cactus',
    'cactus',
    ['desertHot', 'sandDunes', 'thornscrub', 'oasis'],
    ['desertHot', 'sandDunes', 'thornscrub', 'oasis'],
    2,
    [
      ['pure-poly-cactus-01', 'PP_Cactus_01', 'assets/protected/pure-poly-cactus-01.ttasset', 2.4],
      ['pure-poly-cactus-06', 'PP_Cactus_06', 'assets/protected/pure-poly-cactus-06.ttasset'],
      ['pure-poly-cactus-12', 'PP_Cactus_12', 'assets/protected/pure-poly-cactus-12.ttasset', 1.4],
      ['pure-poly-cactus-16', 'PP_Cactus_16', 'assets/protected/pure-poly-cactus-16.ttasset', 0.55],
    ]
  ),
  ...pack(
    'fungus',
    'mushroom',
    ['cavern', 'fungalGrove', 'forestTemperate', 'mysticGrove'],
    ['cavern', 'fungalGrove', 'forestTemperate'],
    0.75,
    [
      [
        'pure-poly-mushroom-brown-01',
        'PP_Mushroom_Dark_Brown_01',
        'assets/protected/pure-poly-mushroom-brown-01.ttasset',
      ],
      [
        'pure-poly-mushroom-brown-03',
        'PP_Mushroom_Dark_Brown_03',
        'assets/protected/pure-poly-mushroom-brown-03.ttasset',
      ],
      [
        'pure-poly-mushroom-long-02',
        'PP_Mushroom_Long_Dark_Brown_02',
        'assets/protected/pure-poly-mushroom-long-02.ttasset',
        0.95,
      ],
      [
        'pure-poly-mushroom-long-03',
        'PP_Mushroom_Long_Dark_Brown_03',
        'assets/protected/pure-poly-mushroom-long-03.ttasset',
        0.95,
      ],
    ]
  ),
  ...pack(
    'fungus',
    'mushroom',
    ['cavern', 'fungalGrove', 'forestTemperate', 'mysticGrove'],
    ['fungalGrove', 'forestTemperate'],
    0.6,
    [
      [
        'pure-poly-mushroom-cluster-01',
        'PP_Mushrooms_Brown_01',
        'assets/protected/pure-poly-mushroom-cluster-01.ttasset',
      ],
      [
        'pure-poly-mushroom-cluster-02',
        'PP_Mushrooms_Brown_02',
        'assets/protected/pure-poly-mushroom-cluster-02.ttasset',
      ],
      [
        'pure-poly-mushroom-cluster-03',
        'PP_Mushrooms_Brown_03',
        'assets/protected/pure-poly-mushroom-cluster-03.ttasset',
      ],
      [
        'pure-poly-mushroom-cluster-04',
        'PP_Mushrooms_Brown_04',
        'assets/protected/pure-poly-mushroom-cluster-04.ttasset',
      ],
      [
        'pure-poly-mushroom-cluster-05',
        'PP_Mushrooms_Brown_05',
        'assets/protected/pure-poly-mushroom-cluster-05.ttasset',
      ],
      [
        'pure-poly-mushroom-cluster-06',
        'PP_Mushrooms_Brown_06',
        'assets/protected/pure-poly-mushroom-cluster-06.ttasset',
      ],
      [
        'pure-poly-mushroom-cluster-07',
        'PP_Mushrooms_Brown_07',
        'assets/protected/pure-poly-mushroom-cluster-07.ttasset',
      ],
      [
        'pure-poly-mushroom-cluster-stone-01',
        'PP_Mushrooms_Stone_Brown_01',
        'assets/protected/pure-poly-mushroom-cluster-stone-01.ttasset',
      ],
      [
        'pure-poly-mushroom-cluster-stone-02',
        'PP_Mushrooms_Stone_Brown_02',
        'assets/protected/pure-poly-mushroom-cluster-stone-02.ttasset',
      ],
      [
        'pure-poly-mushroom-cluster-stone-03',
        'PP_Mushrooms_Stone_Brown_03',
        'assets/protected/pure-poly-mushroom-cluster-stone-03.ttasset',
      ],
    ]
  ),
  ...pack(
    'grass',
    'grass',
    ['grassland', 'hills', 'forestTemperate', 'forestConifer'],
    ['grassland', 'hills', 'forestTemperate', 'forestConifer'],
    0.18,
    [
      ['pure-poly-grass-01', 'PP_Grass_01', 'assets/protected/pure-poly-grass-01.ttasset'],
      ['pure-poly-grass-02', 'PP_Grass_02', 'assets/protected/pure-poly-grass-02.ttasset'],
      ['pure-poly-grass-03', 'PP_Grass_03', 'assets/protected/pure-poly-grass-03.ttasset'],
      ['pure-poly-grass-04', 'PP_Grass_04', 'assets/protected/pure-poly-grass-04.ttasset'],
      ['pure-poly-grass-05', 'PP_Grass_05', 'assets/protected/pure-poly-grass-05.ttasset'],
      ['pure-poly-grass-06', 'PP_Grass_06', 'assets/protected/pure-poly-grass-06.ttasset'],
    ]
  ),
  ...pack(
    'tree',
    'tree',
    ['forestTemperate', 'forestConifer', 'mountain', 'alpine', 'cedarHighlands'],
    ['forestTemperate', 'forestConifer', 'mountain', 'alpine', 'cedarHighlands'],
    5.5,
    [
      ['pure-poly-fir-01', 'PP_Fir_Tree_01', 'assets/protected/pure-poly-fir-01.ttasset'],
      ['pure-poly-fir-04', 'PP_Fir_Tree_04', 'assets/protected/pure-poly-fir-04.ttasset'],
      ['pure-poly-fir-05', 'PP_Fir_Tree_05', 'assets/protected/pure-poly-fir-05.ttasset'],
    ]
  ),
  ...pack(
    'tree',
    'tree',
    ['forestTemperate', 'hills', 'mysticGrove'],
    ['forestTemperate', 'hills'],
    5.3,
    [
      [
        'pure-poly-birch-01',
        'PP_Fantasy_Birch_Tree_01',
        'assets/protected/pure-poly-birch-01.ttasset',
      ],
      [
        'pure-poly-birch-04',
        'PP_Fantasy_Birch_Tree_04',
        'assets/protected/pure-poly-birch-04.ttasset',
      ],
    ]
  ),
  ...pack(
    'tree',
    'tree',
    ['forestTemperate', 'hills', 'grassland'],
    ['forestTemperate', 'hills'],
    6,
    [
      ['pure-poly-tree-04', 'PP_Tree_04', 'assets/protected/pure-poly-tree-04.ttasset'],
      ['pure-poly-tree-05', 'PP_Tree_05', 'assets/protected/pure-poly-tree-05.ttasset'],
    ]
  ),
  ...pack(
    'tree',
    'tree',
    ['deadForest', 'wasteland', 'graveyard', 'ashWastes', 'volcanic'],
    ['deadForest', 'wasteland', 'graveyard', 'ashWastes'],
    4.8,
    [
      [
        'pure-poly-leafless-tree-01',
        'PP_Leafless_Tree_01',
        'assets/protected/pure-poly-leafless-tree-01.ttasset',
      ],
      [
        'pure-poly-leafless-tree-04',
        'PP_Leafless_Tree_04',
        'assets/protected/pure-poly-leafless-tree-04.ttasset',
      ],
      [
        'pure-poly-leafless-tree-05',
        'PP_Leafless_Tree_05',
        'assets/protected/pure-poly-leafless-tree-05.ttasset',
      ],
      [
        'pure-poly-leafless-tree-07',
        'PP_Leafless_Tree_07',
        'assets/protected/pure-poly-leafless-tree-07.ttasset',
      ],
      [
        'pure-poly-leafless-tree-08',
        'PP_Leafless_Tree_08',
        'assets/protected/pure-poly-leafless-tree-08.ttasset',
      ],
      [
        'pure-poly-leafless-tree-11',
        'PP_Leafless_Tree_11',
        'assets/protected/pure-poly-leafless-tree-11.ttasset',
      ],
    ]
  ),
  ...pack(
    'prop',
    'prop',
    [
      'cavern',
      'dungeon',
      'hills',
      'mountain',
      'town',
      'city',
      'castle',
      'ruinedTown',
      'ruinedUrban',
      'ruinedCastle',
    ],
    [],
    0.8,
    [
      [
        'pure-poly-anvil-01',
        'PP_Anvil_New_01_New_Iron',
        'assets/protected/pure-poly-anvil-01.ttasset',
        0.45,
      ],
      ['pure-poly-barrel-01', 'PP_Barrel_01', 'assets/protected/pure-poly-barrel-01.ttasset'],
      [
        'pure-poly-chest-01-iron',
        'PP_Treasure_Chest_01_Iron',
        'assets/protected/pure-poly-chest-01-iron.ttasset',
        0.6,
      ],
      [
        'pure-poly-chest-01-gold',
        'PP_Treasure_Chest_01_Gold',
        'assets/protected/pure-poly-chest-01-gold.ttasset',
        0.6,
      ],
      [
        'pure-poly-mine-cart-01',
        'PP_Mine_Cart_01',
        'assets/protected/pure-poly-mine-cart-01.ttasset',
        0.56,
      ],
      ['pure-poly-furnace-03', 'PP_Furnace_03', 'assets/protected/pure-poly-furnace-03.ttasset', 1],
      [
        'pure-poly-quenching-trough-01',
        'PP_Quenching_Trough_01',
        'assets/protected/pure-poly-quenching-trough-01.ttasset',
        0.45,
      ],
      [
        'pure-poly-grinding-stone-01',
        'PP_Grinding_Stone_01',
        'assets/protected/pure-poly-grinding-stone-01.ttasset',
        0.8,
      ],
      [
        'pure-poly-wooden-crate-01',
        'PP_Crate_Wooden_01',
        'assets/protected/pure-poly-wooden-crate-01.ttasset',
        0.6,
      ],
      [
        'pure-poly-wooden-table-01',
        'PP_Wooden_Table_01',
        'assets/protected/pure-poly-wooden-table-01.ttasset',
        0.45,
      ],
    ]
  ),
  ...pack(
    'light',
    'prop',
    [
      'cavern',
      'dungeon',
      'hills',
      'mountain',
      'town',
      'city',
      'castle',
      'ruinedTown',
      'ruinedUrban',
      'ruinedCastle',
    ],
    [],
    0.45,
    [
      [
        'pure-poly-lantern-01-iron',
        'PP_Lantern_01_Yellow_Gradient_Iron',
        'assets/protected/pure-poly-lantern-01-iron.ttasset',
      ],
    ]
  ),
  ...pack(
    'ore',
    'rock',
    ['cavern', 'dungeon', 'hills', 'mountain', 'crystalFields', 'crystalSpires'],
    [],
    0.3,
    [
      [
        'pure-poly-ore-01-blue',
        'PP_Stone_Veins_01_Blue',
        'assets/protected/pure-poly-ore-01-blue.ttasset',
      ],
      [
        'pure-poly-ore-01-copper',
        'PP_Stone_Veins_01_Copper',
        'assets/protected/pure-poly-ore-01-copper.ttasset',
      ],
      [
        'pure-poly-ore-01-gold',
        'PP_Stone_Veins_01_Gold',
        'assets/protected/pure-poly-ore-01-gold.ttasset',
      ],
      [
        'pure-poly-ore-01-green',
        'PP_Stone_Veins_01_Green',
        'assets/protected/pure-poly-ore-01-green.ttasset',
      ],
      [
        'pure-poly-ore-01-iron',
        'PP_Stone_Veins_01_Iron',
        'assets/protected/pure-poly-ore-01-iron.ttasset',
      ],
      [
        'pure-poly-ore-01-red',
        'PP_Stone_Veins_01_Red',
        'assets/protected/pure-poly-ore-01-red.ttasset',
      ],
      [
        'pure-poly-ore-01-silver',
        'PP_Stone_Veins_01_Silver',
        'assets/protected/pure-poly-ore-01-silver.ttasset',
      ],
      [
        'pure-poly-ore-02-blue',
        'PP_Stone_Veins_02_Blue',
        'assets/protected/pure-poly-ore-02-blue.ttasset',
      ],
      [
        'pure-poly-ore-02-copper',
        'PP_Stone_Veins_02_Copper',
        'assets/protected/pure-poly-ore-02-copper.ttasset',
      ],
      [
        'pure-poly-ore-02-gold',
        'PP_Stone_Veins_02_Gold',
        'assets/protected/pure-poly-ore-02-gold.ttasset',
      ],
      [
        'pure-poly-ore-02-green',
        'PP_Stone_Veins_02_Green',
        'assets/protected/pure-poly-ore-02-green.ttasset',
      ],
      [
        'pure-poly-ore-02-iron',
        'PP_Stone_Veins_02_Iron',
        'assets/protected/pure-poly-ore-02-iron.ttasset',
      ],
      [
        'pure-poly-ore-02-red',
        'PP_Stone_Veins_02_Red',
        'assets/protected/pure-poly-ore-02-red.ttasset',
      ],
      [
        'pure-poly-ore-02-silver',
        'PP_Stone_Veins_02_Silver',
        'assets/protected/pure-poly-ore-02-silver.ttasset',
      ],
      [
        'pure-poly-ore-03-blue',
        'PP_Stone_Veins_03_Blue',
        'assets/protected/pure-poly-ore-03-blue.ttasset',
      ],
      [
        'pure-poly-ore-03-copper',
        'PP_Stone_Veins_03_Copper',
        'assets/protected/pure-poly-ore-03-copper.ttasset',
      ],
      [
        'pure-poly-ore-03-gold',
        'PP_Stone_Veins_03_Gold',
        'assets/protected/pure-poly-ore-03-gold.ttasset',
      ],
      [
        'pure-poly-ore-03-green',
        'PP_Stone_Veins_03_Green',
        'assets/protected/pure-poly-ore-03-green.ttasset',
      ],
      [
        'pure-poly-ore-03-iron',
        'PP_Stone_Veins_03_Iron',
        'assets/protected/pure-poly-ore-03-iron.ttasset',
      ],
      [
        'pure-poly-ore-03-red',
        'PP_Stone_Veins_03_Red',
        'assets/protected/pure-poly-ore-03-red.ttasset',
      ],
      [
        'pure-poly-ore-03-silver',
        'PP_Stone_Veins_03_Silver',
        'assets/protected/pure-poly-ore-03-silver.ttasset',
      ],
    ]
  ),
]);

const byId = new Map(PURE_POLY_ASSETS.map((asset) => [asset.id, asset]));

export const PURE_POLY_GENERATION_BIOMES = Object.freeze([
  ...new Set(PURE_POLY_ASSETS.flatMap((asset) => asset.generatedBiomes)),
]);

export function getPurePolyAsset(id) {
  return byId.get(id) || null;
}

export function isCaveFormationModel(id) {
  return (
    /^source-cave-(stalagmite|column)$/.test(id || '') ||
    ['formation', 'crystal'].includes(getPurePolyAsset(id)?.kind)
  );
}
