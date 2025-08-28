/**
 * TerrainPlaceables.js - lightweight config for small placeable terrain assets
 * Each entry is id -> { label, imgPath, type }
 * type: 'path' (coexists with tokens) | 'structure' (exclusive)
 */
export const TERRAIN_PLACEABLES = {
  // scaleMode: 'contain' (fit inside tile, preserve aspect),
  //            'cover'   (cover tile, preserve aspect, may overflow),
  //            'stretch' (force exact tile dimensions, may distort)
  'path-dirt': { label: 'Dirt Path', img: 'assets/terrain/paths/dirt-path-tile.png', type: 'path', scaleMode: 'cover', baselineOffsetPx: 0 },
  'path-stone': { label: 'Stone Path', img: 'assets/terrain/paths/stone-path-tile.png', type: 'path', scaleMode: 'cover', baselineOffsetPx: 0 },
  'structure-crumbling-brick': { label: 'Crumbling Brick Wall', img: 'assets/terrain/structures/crumbling-brick-wall-topleft-to-bottomright.png', type: 'structure', scaleMode: 'contain', baselineOffsetPx: 0 }
};

export default { TERRAIN_PLACEABLES };
