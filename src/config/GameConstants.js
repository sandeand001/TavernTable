// src/config/GameConstants.js - Centralized game configuration and constants

/**
 * Grid configuration constants
 * Controls the isometric grid rendering and behavior
 */
export const GRID_CONFIG = {
  // Tile dimensions for isometric projection
  TILE_WIDTH: 64,
  TILE_HEIGHT: 32,

  // Default grid size
  DEFAULT_ROWS: 25,
  DEFAULT_COLS: 25,

  // Grid size limits
  MIN_SIZE: 5,
  MAX_SIZE: 50,
  MIN_COLS: 5,
  MAX_COLS: 50,
  MIN_ROWS: 5,
  MAX_ROWS: 50,
  MIN_CELL_SIZE: 16,
  MAX_CELL_SIZE: 128,

  // Colors
  BACKGROUND_COLOR: 0x2c2c2c,
  GRID_LINE_COLOR: 0x555555,
  HOVER_COLOR: 0xffff00,
  TILE_COLOR: 0x444444,
  TILE_FILL_ALPHA: 1.0,
  TILE_BORDER_COLOR: 0x666666,
  TILE_BORDER_ALPHA: 0.8,
  TERRAIN_MODE_TILE_COLOR: 0x5a67d8,
  TERRAIN_MODE_TILE_FILL_ALPHA: 0.9,
  TERRAIN_MODE_TILE_BORDER_COLOR: 0x2c5282,
  TERRAIN_MODE_TILE_BORDER_ALPHA: 0.95,

  // Scale and positioning
  DEFAULT_SCALE: 1.0,
  MIN_SCALE: 0.5,
  MAX_SCALE: 3.0,
  ZOOM_SPEED: 0.1,
  INITIAL_Y_OFFSET: 100,
};

/**
 * Application configuration
 * Core PIXI.js and rendering settings
 */
// (Removed unused APP_CONFIG during NFC cleanup)

/**
 * Input and interaction constants
 */
// (Removed unused INPUT_CONFIG during NFC cleanup)

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
  goblin: 0.05,
};

/**
 * Creature footprint configuration (in tiles)
 * Defines how many grid cells wide/high a creature occupies for snapping
 */
// (Removed unused CREATURE_FOOTPRINTS during NFC cleanup)

/**
 * Optional per-creature baseline Y offsets (in pixels at scale=1)
 * Negative moves the sprite up (useful when textures include bottom padding)
 */
// (Removed unused CREATURE_BASELINE_OFFSETS during NFC cleanup)

/**
 * Creature color mapping for fallback graphics
 * Used when PNG sprites are not available
 */
// (Removed unused CREATURE_COLORS during NFC cleanup)

/**
 * Global token placement fine-tuning offset (pixels)
 * Applied after computing isometric center so that bottom-center anchored sprites
 * visually align with tiles. Negative values shift left/up.
 * Calibrated to correct observed constant Δ=(+3,+8) (tokens too far right and down).
 */
export const TOKEN_PLACEMENT_OFFSET = { x: 3, y: 8 };

/**
 * Validation helpers
 * Provides consistent validation logic across the application
 */
export const VALIDATION = {
  /**
   * Validate grid dimensions
   * @param {number} width - Grid width
   * @param {number} height - Grid height
   * @returns {boolean} True if valid
   */
  isValidGridSize(width, height) {
    return (
      Number.isInteger(width) &&
      Number.isInteger(height) &&
      width >= GRID_CONFIG.MIN_SIZE &&
      width <= GRID_CONFIG.MAX_SIZE &&
      height >= GRID_CONFIG.MIN_SIZE &&
      height <= GRID_CONFIG.MAX_SIZE
    );
  },

  /**
   * Validate coordinate is within grid bounds
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   * @param {number} cols - Grid columns
   * @param {number} rows - Grid rows
   * @returns {boolean} True if valid
   */
  isValidCoordinate(x, y, cols, rows) {
    return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x < cols && y >= 0 && y < rows;
  },

  /**
   * Validate creature type
   * @param {string} type - Creature type
   * @returns {boolean} True if valid
   */
  isValidCreatureType(type) {
    return (
      typeof type === 'string' &&
      type.length > 0 &&
      Object.hasOwnProperty.call(CREATURE_SCALES, type.toLowerCase())
    );
  },
};

/**
 * Helper functions for creature configuration
 */
export const CREATURE_HELPERS = {
  /**
   * Get the scale value for a creature type
   * @param {string} creatureType - The creature type
   * @returns {number} The scale multiplier
   */
  getScale(creatureType) {
    return CREATURE_SCALES[creatureType?.toLowerCase()] || CREATURE_SCALES.goblin;
  },

  /**
   * Get the color value for a creature type
   * @param {string} creatureType - The creature type
   * @returns {number} The color hex value
   */
  getColor() {
    // color mapping removed; callers should supply sprite assets
    return 0xffffff;
  },

  /**
   * Get all available creature types
   * @returns {string[]} Array of creature type names
   */
  getAllTypes() {
    return Object.keys(CREATURE_SCALES);
  },
};

/**
 * Dice system configuration
 */
export const DICE_CONFIG = {
  // Valid dice sides for RPG systems
  VALID_SIDES: [4, 6, 8, 10, 12, 20, 100],

  // Dice count limits
  MIN_COUNT: 1,
  MAX_COUNT: 10,

  // Animation settings
  ANIMATION_FRAMES: 20,
  RESULT_DISPLAY_DURATION: 1000,

  // Color coding for results
  COLORS: {
    MAX_ROLL: '#4CAF50', // Green for maximum roll
    MIN_ROLL: '#f44336', // Red for minimum roll
    NORMAL_ROLL: '#ffffff', // White for normal roll
  },
};

// RETENTION NOTE (2025-09-19): APP_CONFIG, INPUT_CONFIG, CREATURE_* groups surfaced as unused by
// heuristic scan; they're intentionally exported as part of the public configuration surface and
// may be consumed by external automation/scripts not in this repository. Keep (NFC).
