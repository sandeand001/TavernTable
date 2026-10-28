// src/entities/creatures/creatureHelpers.js - Creature type normalization and helper functions

import { CREATURE_SCALES } from '../../config/GameConstants.js';
import {
  DEFAULT_CHARACTER_ID,
  getCharacterDefinition,
  normalizeCreatureType,
} from '../../config/CharacterCatalog.js';

export { normalizeCreatureType };

export function getCreatureTypeLabel(creatureType) {
  const character = getCharacterDefinition(creatureType);
  if (character) return character.label;
  const type = normalizeCreatureType(creatureType);
  return type
    ? type
        .split(/[-_\s]+/)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
    : 'Creature';
}

export function getTokenDisplayName(token) {
  return token?.name || token?.label || getCreatureTypeLabel(token?.type);
}

export const CREATURE_HELPERS = {
  getScale(creatureType) {
    const normalized = normalizeCreatureType(creatureType);
    return CREATURE_SCALES[normalized] || CREATURE_SCALES[DEFAULT_CHARACTER_ID];
  },

  getColor(creatureType) {
    return (getCharacterDefinition(creatureType) || getCharacterDefinition(DEFAULT_CHARACTER_ID))
      .color;
  },

  getAllTypes() {
    return Object.keys(CREATURE_SCALES);
  },
};
