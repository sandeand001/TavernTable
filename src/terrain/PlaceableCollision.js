import { getPurePolyAsset } from '../config/assets/PurePolyAssets.js';

const DECORATIVE_SCENERY = new Set([
  'source-cave-stalagmite',
  'source-cave-column',
  'mushroom-glow',
  'mushroom-giant-cap',
]);

export function blocksCreatureMovement(placeable) {
  const type = placeable?.placeableType ?? placeable?.type;
  if (type === 'structure') return true;
  if (type !== 'plant') return false;
  const model = placeable.modelKey ?? placeable.placeableId ?? placeable.variantKey;
  if (
    ['formation', 'crystal', 'fungus', 'ore', 'light', 'grass', 'pebble'].includes(
      getPurePolyAsset(model)?.kind
    )
  )
    return false;
  return !DECORATIVE_SCENERY.has(model);
}

export function requiresCavernRouteClearance(placeable) {
  const model = placeable?.modelKey ?? placeable?.placeableId ?? placeable?.variantKey;
  return (
    blocksCreatureMovement(placeable) ||
    DECORATIVE_SCENERY.has(model) ||
    ['formation', 'crystal', 'fungus', 'ore', 'light'].includes(getPurePolyAsset(model)?.kind)
  );
}
