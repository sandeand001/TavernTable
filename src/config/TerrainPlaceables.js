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
// Legacy tree frame arrays removed (2D sprites deprecated for plants)

export const TREE_PLACEABLES = {
  'tree-green-deciduous': {
    label: 'Green Deciduous',
    img: null, // 2D legacy removed; use 3D model
    modelKey: 'common-broadleaf-1',
    type: 'plant',
    scaleMode: 'contain',
    baselineOffsetPx: 16,
  },
  'tree-green-conifer': {
    label: 'Green Conifer',
    img: null,
    modelKey: 'pine-conifer-1',
    type: 'plant',
    scaleMode: 'contain',
    baselineOffsetPx: 16,
  },
  'tree-green-willow': {
    label: 'Green Willow',
    img: null,
    modelKey: 'common-broadleaf-4',
    type: 'plant',
    scaleMode: 'contain',
    baselineOffsetPx: 16,
  },
  'tree-single-palm': {
    label: 'Single Palm',
    img: null,
    modelKey: 'common-broadleaf-2',
    type: 'plant',
    scaleMode: 'contain',
    baselineOffsetPx: 16,
  },
  'tree-double-palm': {
    label: 'Double Palm',
    img: null,
    modelKey: 'common-broadleaf-3',
    type: 'plant',
    scaleMode: 'contain',
    baselineOffsetPx: 16,
  },
  'tree-green-oval': {
    label: 'Green Oval',
    img: null,
    modelKey: 'common-broadleaf-2',
    type: 'plant',
    scaleMode: 'contain',
    baselineOffsetPx: 16,
  },
  'tree-green-columnar': {
    label: 'Green Columnar',
    img: null,
    modelKey: 'pine-conifer-2',
    type: 'plant',
    scaleMode: 'contain',
    baselineOffsetPx: 16,
  },
  'tree-green-small': {
    label: 'Green Small',
    img: null,
    modelKey: 'pine-conifer-4',
    type: 'plant',
    scaleMode: 'contain',
    baselineOffsetPx: 16,
  },
  'tree-green-small-oval': {
    label: 'Green Small Oval',
    img: null,
    modelKey: 'pine-conifer-5',
    type: 'plant',
    scaleMode: 'contain',
    baselineOffsetPx: 16,
  },
  'tree-green-tall-columnar': {
    label: 'Green Tall Columnar',
    img: null,
    modelKey: 'pine-conifer-3',
    type: 'plant',
    scaleMode: 'contain',
    baselineOffsetPx: 16,
  },
  'tree-orange-deciduous': {
    label: 'Orange Deciduous',
    img: null,
    modelKey: 'common-broadleaf-3',
    type: 'plant',
    scaleMode: 'contain',
    baselineOffsetPx: 16,
  },
  'tree-yellow-willow': {
    label: 'Yellow Willow',
    img: null,
    modelKey: 'common-broadleaf-5',
    type: 'plant',
    scaleMode: 'contain',
    baselineOffsetPx: 16,
  },
  'tree-yellow-conifer': {
    label: 'Yellow Conifer',
    img: null,
    modelKey: 'pine-conifer-5',
    type: 'plant',
    scaleMode: 'contain',
    baselineOffsetPx: 16,
  },
  'tree-bare-deciduous': {
    label: 'Bare Deciduous',
    img: null,
    modelKey: 'twisted-bare-1',
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

// (Former forest billboard experimental group removed; placeholder comments pruned.)
