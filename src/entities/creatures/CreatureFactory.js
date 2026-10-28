// src/entities/creatures/CreatureFactory.js - Factory for creating creature tokens

import CreatureToken from './CreatureToken.js';

// ── Public API ──────────────────────────────────────────────────
export function createCreature(type, x = 0, y = 0, facingRight = true) {
  return new CreatureToken(type, x, y, facingRight);
}
