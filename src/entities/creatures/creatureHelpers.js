// src/entities/creatures/creatureHelpers.js - Creature type normalization and helper functions

import { CREATURE_SCALES } from '../../config/GameConstants.js';

// ── Private Data ────────────────────────────────────────────────
const CREATURE_COLORS = {
  mannequin: 0xcb99ff, // Lavender
};

const CREATURE_TYPE_ALIASES = {
  'defeated-doll': 'mannequin',
  'female-humanoid': 'mannequin',
};

// ── Public API ──────────────────────────────────────────────────
export function normalizeCreatureType(creatureType) {
  if (typeof creatureType !== 'string' || creatureType.length === 0) return '';
  const lower = creatureType.toLowerCase();
  return CREATURE_TYPE_ALIASES[lower] || lower;
}

export const CREATURE_HELPERS = {
  getScale(creatureType) {
    const normalized = normalizeCreatureType(creatureType);
    return CREATURE_SCALES[normalized] || CREATURE_SCALES.mannequin;
  },

  getColor(creatureType) {
    const normalized = normalizeCreatureType(creatureType);
    return CREATURE_COLORS[normalized] || CREATURE_COLORS.mannequin;
  },

  getAllTypes() {
    return Object.keys(CREATURE_SCALES);
  },
};
