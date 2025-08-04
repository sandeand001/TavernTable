// js/config/CreatureConfig.js - Configuration constants for creature tokens

/**
 * Creature scaling configuration
 * Defines size multipliers for different creature types
 */
export const CREATURE_SCALES = {
  // Large creatures (2x2 grid coverage)
  dragon: 0.125,
  
  // Medium-large creatures  
  beholder: 0.08,
  minotaur: 0.08,
  owlbear: 0.08,
  troll: 0.08,
  
  // Medium creatures (single grid coverage)
  skeleton: 0.06,
  mindflayer: 0.06,
  orc: 0.06,
  
  // Small creatures
  goblin: 0.05
};

/**
 * Creature color mapping for fallback graphics
 * Used when PNG sprites are not available
 */
export const CREATURE_COLORS = {
  dragon: 0xFF0000,      // Red
  skeleton: 0xFFFFFF,    // White
  beholder: 0x800080,    // Purple
  goblin: 0x00FF00,      // Green
  mindflayer: 0x4B0082,  // Indigo
  minotaur: 0x8B4513,    // Brown
  orc: 0x808080,         // Gray
  owlbear: 0xA52A2A,     // Dark Red
  troll: 0x228B22        // Forest Green
};

/**
 * Default fallback values
 */
export const CREATURE_DEFAULTS = {
  scale: 0.06,
  color: 0x808080,
  radius: 20
};

/**
 * Get the scale value for a creature type
 * @param {string} creatureType - The creature type
 * @returns {number} The scale multiplier
 */
export function getCreatureScale(creatureType) {
  return CREATURE_SCALES[creatureType?.toLowerCase()] || CREATURE_DEFAULTS.scale;
}

/**
 * Get the color value for a creature type
 * @param {string} creatureType - The creature type
 * @returns {number} The color hex value
 */
export function getCreatureColor(creatureType) {
  return CREATURE_COLORS[creatureType?.toLowerCase()] || CREATURE_DEFAULTS.color;
}
