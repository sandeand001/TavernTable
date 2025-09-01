/**
 * TerrainPlaceables.js - lightweight config for small placeable terrain assets
 * Each entry is id -> { label, imgPath, type }
 * type: 'path' (coexists with tokens) | 'structure' (exclusive)
 */
export const TERRAIN_PLACEABLES = {
  // scaleMode: 'contain' (fit inside tile, preserve aspect),
  //            'cover'   (cover tile, preserve aspect, may overflow),
  //            'stretch' (force exact tile dimensions, may distort)
  'path-dirt': {
    label: 'Dirt Path',
    img: 'assets/terrain/paths/dirt-path-tile.png',
    type: 'path',
    scaleMode: 'cover',
    baselineOffsetPx: 0,
  },
  'path-stone': {
    label: 'Stone Path',
    img: 'assets/terrain/paths/stone-path-tile.png',
    type: 'path',
    scaleMode: 'cover',
    baselineOffsetPx: 0,
  },
  'structure-crumbling-brick': {
    label: 'Crumbling Brick Wall',
    img: 'assets/terrain/structures/crumbling-brick-wall-topleft-to-bottomright.png',
    type: 'structure',
    scaleMode: 'contain',
    baselineOffsetPx: 0,
  },
};

export default { TERRAIN_PLACEABLES };

// Tree groups (multi-variant placeables). Each key below points to an array of
// image paths. The placeable system accepts `img` as either a string or an
// array; when an array is provided the tile selection algorithm will pick a
// variant deterministically for initial placement and `cyclePlaceableVariant`
// can be used to rotate through alternatives.
// These entries are intentionally named with the prefix `tree-` so UI/tooling
// can distinguish them from single-image placeables.
const TREE_FRAME_SUFFIXES = [
  '00000',
  '10000',
  '20000',
  '30000',
  '40000',
  '50000',
  '60000',
  '70000',
];

// Helper to build frame paths without multi-line map formatting churn
const treeFrames = (pattern) => TREE_FRAME_SUFFIXES.map((s) => pattern.replace('{s}', s));

export const TREE_PLACEABLES = {
  'tree-green-deciduous': {
    label: 'Green Deciduous',
    img: treeFrames('assets/terrain/plants/trees/green_deciduous_trees/_tree_01_{s}.png'),
    type: 'plant',
    scaleMode: 'contain',
    baselineOffsetPx: 16,
  },
  'tree-green-conifer': {
    label: 'Green Conifer',
    img: treeFrames('assets/terrain/plants/trees/green_conifer_trees/_tree_02_{s}.png'),
    type: 'plant',
    scaleMode: 'contain',
    baselineOffsetPx: 16,
  },
  'tree-green-willow': {
    label: 'Green Willow',
    img: treeFrames('assets/terrain/plants/trees/green_willow_trees/_tree_05_{s}.png'),
    type: 'plant',
    scaleMode: 'contain',
    baselineOffsetPx: 16,
  },
  'tree-single-palm': {
    label: 'Single Palm',
    img: treeFrames('assets/terrain/plants/trees/single_palm_trees/_tree_03_{s}.png'),
    type: 'plant',
    scaleMode: 'contain',
    baselineOffsetPx: 16,
  },
  'tree-double-palm': {
    label: 'Double Palm',
    img: treeFrames('assets/terrain/plants/trees/doulble_palm_trees/_tree_04_{s}.png'),
    type: 'plant',
    scaleMode: 'contain',
    baselineOffsetPx: 16,
  },
  'tree-green-oval': {
    label: 'Green Oval',
    img: treeFrames('assets/terrain/plants/trees/green_oval_deciduous_trees/_tree_09_{s}.png'),
    type: 'plant',
    scaleMode: 'contain',
    baselineOffsetPx: 16,
  },
  'tree-green-columnar': {
    label: 'Green Columnar',
    img: treeFrames('assets/terrain/plants/trees/green_columnar_deciduouis_trees/_tree_08_{s}.png'),
    type: 'plant',
    scaleMode: 'contain',
    baselineOffsetPx: 16,
  },
  'tree-green-small': {
    label: 'Green Small',
    img: treeFrames('assets/terrain/plants/trees/green_small_deciduous_trees/_tree_12_{s}.png'),
    type: 'plant',
    scaleMode: 'contain',
    baselineOffsetPx: 16,
  },
  'tree-green-small-oval': {
    label: 'Green Small Oval',
    img: treeFrames('assets/terrain/plants/trees/green_small_oval_trees/_tree_11_{s}.png'),
    type: 'plant',
    scaleMode: 'contain',
    baselineOffsetPx: 16,
  },
  'tree-green-tall-columnar': {
    label: 'Green Tall Columnar',
    img: treeFrames(
      'assets/terrain/plants/trees/green_tall_columnar_deciduous_trees/_tree_13_{s}.png'
    ),
    type: 'plant',
    scaleMode: 'contain',
    baselineOffsetPx: 16,
  },
  'tree-orange-deciduous': {
    label: 'Orange Deciduous',
    img: treeFrames('assets/terrain/plants/trees/Orange_decisuous_trees/_tree_14_{s}.png'),
    type: 'plant',
    scaleMode: 'contain',
    baselineOffsetPx: 16,
  },
  'tree-yellow-willow': {
    label: 'Yellow Willow',
    img: treeFrames('assets/terrain/plants/trees/yellow_willow_trees/_tree_06_{s}.png'),
    type: 'plant',
    scaleMode: 'contain',
    baselineOffsetPx: 16,
  },
  'tree-yellow-conifer': {
    label: 'Yellow Conifer',
    img: treeFrames('assets/terrain/plants/trees/yellow_conifer_trees/_tree_07_{s}.png'),
    type: 'plant',
    scaleMode: 'contain',
    baselineOffsetPx: 16,
  },
  'tree-bare-deciduous': {
    label: 'Bare Deciduous',
    img: treeFrames('assets/terrain/plants/trees/bare_decisuous_trees/_tree_10_{s}.png'),
    type: 'plant',
    scaleMode: 'contain',
    baselineOffsetPx: 16,
  },
};

// Merge TREE_PLACEABLES into TERRAIN_PLACEABLES so existing code can reference
// all placeables from a single exported object.
Object.entries(TREE_PLACEABLES).forEach(([k, v]) => {
  TERRAIN_PLACEABLES[k] = v;
});
