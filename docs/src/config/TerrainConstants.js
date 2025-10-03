/**
 * TerrainConstants.js - Configuration constants for the terrain modification system
 *
 * Defines terrain-related configuration values following the existing pattern
 * Used by TerrainCoordinator and TerrainManager for consistent behavior
 */

/**
 * Terrain system configuration
 * Controls terrain height modification behavior and limits
 */
export const TERRAIN_CONFIG = {
  // Height system (expanded to +/-10 operational range)
  // NOTE: Biome palettes & terrain visuals automatically adapt via TERRAIN_CONFIG.
  DEFAULT_HEIGHT: 0,
  MIN_HEIGHT: -10,
  MAX_HEIGHT: 10,
  HEIGHT_STEP: 1,

  // Brush system
  DEFAULT_BRUSH_SIZE: 1,
  MIN_BRUSH_SIZE: 1,
  MAX_BRUSH_SIZE: 5,

  // Visual representation
  HEIGHT_COLOR_SCALE: {
    // Expanded color mapping for -10..10 range
    // Negative heights = deep abyssal blues → cool violets → desaturated mid
    // Positive heights = muted green → lush → warm plateau / light peaks
    '-10': 0x040913,
    '-9': 0x071225,
    '-8': 0x0b1c36,
    '-7': 0x112848,
    '-6': 0x18345a,
    '-5': 0x1f416d,
    '-4': 0x2a4f82,
    '-3': 0x365d97,
    '-2': 0x496ab1,
    '-1': 0x5d72c6,
    0: 0x6b7280,
    1: 0x1a7b53,
    2: 0x138b48,
    3: 0x16994b,
    4: 0x21a556,
    5: 0x3db268,
    6: 0x64bf75,
    7: 0x8fcc7f,
    8: 0xb7d789,
    9: 0xdfe09a,
    10: 0xf3e9b2,
  },

  // Visual effects
  HEIGHT_ALPHA: 0.7, // Base alpha for terrain tiles
  HEIGHT_BORDER_ALPHA: 0.9, // Border alpha for terrain tiles
  HEIGHT_BORDER_WIDTH: 2, // Border width for non-default heights
  ELEVATION_SHADOW_OFFSET: 8, // Pixel offset per height level for 3D elevation effect (slightly exaggerated)
  TERRAIN_MODE_OVERLAY_ALPHA: 0.45, // Fill alpha for non-neutral tiles while terrain mode is active
  TERRAIN_MODE_OVERLAY_BASE_ALPHA: 0.18, // Fill alpha for neutral tiles while terrain mode is active
  TERRAIN_MODE_MESH_ALPHA: 0.55, // Opacity for 3D terrain mesh while terrain mode is active

  // Performance settings
  BATCH_UPDATE_SIZE: 10, // Maximum cells to update per frame
  UPDATE_THROTTLE_MS: 16, // Minimum time between updates (60fps)

  // Input handling
  CONTINUOUS_PAINT_DELAY: 50, // Milliseconds between continuous paint operations

  // Animation (future enhancement)
  TRANSITION_DURATION: 200, // Milliseconds for height change animations
  EASING_FUNCTION: 'ease-out', // CSS easing function for animations
};

/**
 * Terrain tool definitions
 * Available tools for terrain modification
 */
export const TERRAIN_TOOLS = {
  RAISE: 'raise',
  LOWER: 'lower',
  LEVEL: 'level', // Future: flatten to specific height
  SMOOTH: 'smooth', // Future: smooth height transitions
};

/**
 * Terrain keyboard shortcuts
 * Key bindings for terrain tools and operations
 */
export const TERRAIN_SHORTCUTS = {
  RAISE_TOOL: 'KeyR',
  LOWER_TOOL: 'KeyL',
  INCREASE_BRUSH: 'BracketRight', // ]
  DECREASE_BRUSH: 'BracketLeft', // [
  RESET_TERRAIN: 'KeyT', // T (with modifiers)
  TOGGLE_TERRAIN_MODE: 'KeyG', // G for "ground" mode
};

/**
 * Terrain validation constraints
 * Used for input validation and sanitization
 */
export const TERRAIN_VALIDATION = {
  HEIGHT_RANGE: {
    min: TERRAIN_CONFIG.MIN_HEIGHT,
    max: TERRAIN_CONFIG.MAX_HEIGHT,
  },
  BRUSH_SIZE_RANGE: {
    min: TERRAIN_CONFIG.MIN_BRUSH_SIZE,
    max: TERRAIN_CONFIG.MAX_BRUSH_SIZE,
  },
  VALID_TOOLS: Object.values(TERRAIN_TOOLS),
  COORDINATE_VALIDATION: {
    requireInteger: true,
    requireNonNegative: true,
  },
};
