// SpriteOffsets.js - minimal canonical offset mapping
export const SPRITE_OFFSETS = {
  beholder: { dx: 0, dy: 0 },
  'defeated-doll': { dx: 0, dy: 0 },
  dragon: { dx: 0, dy: 0 },
  goblin: { dx: 0, dy: 0 },
  mindflayer: { dx: 0, dy: 0 },
  minotaur: { dx: 0, dy: 12 },
  orc: { dx: 0, dy: 0 },
  owlbear: { dx: 0, dy: 0 },
  skeleton: { dx: 0, dy: 0 },
  troll: { dx: 0, dy: 0 }
};

export function getSpriteOffset(type) {
  return SPRITE_OFFSETS[type] || { dx: 0, dy: 0 };
}
try {
  if (typeof window !== 'undefined') {
    if (!window.getSpriteOffset) window.getSpriteOffset = getSpriteOffset;
    if (!window.setSpriteOffset) window.setSpriteOffset = setSpriteOffset;
    if (!window.applySpriteOffsetsToTokens) window.applySpriteOffsetsToTokens = applyOffsetsToTokens;
    if (!window.SPRITE_OFFSETS) window.SPRITE_OFFSETS = SPRITE_OFFSETS;
  }
} catch(_) { /* no-op */ }
