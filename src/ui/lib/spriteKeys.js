/**
 * Derive a stable key for a sprite to store per-creature offsets.
 * Tries creatureType, name, then texture cache IDs, then UID fallback.
 */
export function getCurrentSpriteKey(sprite) {
  if (!sprite) return null;
  return (
    sprite.creatureType ||
        sprite.name ||
        (sprite.texture && sprite.texture.textureCacheIds && sprite.texture.textureCacheIds[0]) ||
        `uid_${sprite.uid || sprite._texture?.uid}`
  );
}

export default getCurrentSpriteKey;
