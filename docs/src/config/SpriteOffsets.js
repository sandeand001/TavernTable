// SpriteOffsets.js — provides global accessors for per-sprite fine-tuning offsets
// Loaded by index.html before managers to support UIController expectations.

// Per-creature offsets (pixels). Negative dy lifts sprite up.
const SPRITE_OFFSETS = {
  goblin: { dx: 0, dy: -2 },
  skeleton: { dx: 0, dy: -4 },
  orc: { dx: 0, dy: -3 },
  mindflayer: { dx: 0, dy: -4 },
  beholder: { dx: 0, dy: -2 },
  dragon: { dx: 0, dy: -6 },
  minotaur: { dx: 0, dy: -5 },
  owlbear: { dx: 0, dy: -5 },
  troll: { dx: 0, dy: -5 },
};

// Default when type not listed
const DEFAULT_OFFSET = { dx: 0, dy: 0 };

// Expose a simple getter on window for compatibility with UIController
export function getSpriteOffset(type) {
  if (typeof type !== 'string') return { ...DEFAULT_OFFSET };
  const key = type.toLowerCase();
  return { ...(SPRITE_OFFSETS[key] || DEFAULT_OFFSET) };
}

// Also attach to window for inline onclick handlers expecting globals
if (typeof window !== 'undefined') {
  window.getSpriteOffset = getSpriteOffset;
}
