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
  // Height system
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
    // Extended color mapping for -10..10 range
    // Negative heights = deep cool → mid cool → violet transition
    // Positive heights = green → yellow → orange → red gradient
    '-10': 0x0b0f33, // Near black blue
    '-9':  0x131b4a,
    '-8':  0x1b2561,
    '-7':  0x233078,
    '-6':  0x2b3b90,
    '-5':  0x3346a7, // (old -5 ~ adapt)
    '-4':  0x3b51be,
    '-3':  0x4756d1,
    '-2':  0x5b63e5,
    '-1':  0x7a5ff2, // violet
    '0':   0x6b7280, // Neutral gray
    '1':   0x0f9d70,
    '2':   0x10b981, // Emerald
    '3':   0x16a34a, // Green (old 2)
    '4':   0x4caf50, // Mid green
    '5':   0xa2b91a, // Yellow‑green
    '6':   0xc9b416, // Yellow shifting
    '7':   0xeab308, // Yellow
    '8':   0xf59e0b, // Orange
    '9':   0xf97316, // Deep orange
    '10':  0xef4444  // Red
  },
  
  // Visual effects
  HEIGHT_ALPHA: 0.7,              // Base alpha for terrain tiles
  HEIGHT_BORDER_ALPHA: 0.9,       // Border alpha for terrain tiles
  HEIGHT_BORDER_WIDTH: 2,          // Border width for non-default heights
  ELEVATION_SHADOW_OFFSET: 6,      // Pixel offset per height level for 3D elevation effect
  
  // Performance settings
  BATCH_UPDATE_SIZE: 10,           // Maximum cells to update per frame
  UPDATE_THROTTLE_MS: 16,          // Minimum time between updates (60fps)
  
  // Input handling
  CONTINUOUS_PAINT_DELAY: 50,      // Milliseconds between continuous paint operations
  
  // Animation (future enhancement)
  TRANSITION_DURATION: 200,        // Milliseconds for height change animations
  EASING_FUNCTION: 'ease-out'      // CSS easing function for animations
};

/**
 * Terrain tool definitions
 * Available tools for terrain modification
 */
export const TERRAIN_TOOLS = {
  RAISE: 'raise',
  LOWER: 'lower',
  LEVEL: 'level',    // Future: flatten to specific height
  SMOOTH: 'smooth'   // Future: smooth height transitions
};

/**
 * Terrain keyboard shortcuts
 * Key bindings for terrain tools and operations
 */
export const TERRAIN_SHORTCUTS = {
  RAISE_TOOL: 'KeyR',
  LOWER_TOOL: 'KeyL',
  INCREASE_BRUSH: 'BracketRight',  // ]
  DECREASE_BRUSH: 'BracketLeft',   // [
  RESET_TERRAIN: 'KeyT',           // T (with modifiers)
  TOGGLE_TERRAIN_MODE: 'KeyG'      // G for "ground" mode
};

/**
 * Terrain validation constraints
 * Used for input validation and sanitization
 */
export const TERRAIN_VALIDATION = {
  HEIGHT_RANGE: {
    min: TERRAIN_CONFIG.MIN_HEIGHT,
    max: TERRAIN_CONFIG.MAX_HEIGHT
  },
  BRUSH_SIZE_RANGE: {
    min: TERRAIN_CONFIG.MIN_BRUSH_SIZE,
    max: TERRAIN_CONFIG.MAX_BRUSH_SIZE
  },
  VALID_TOOLS: Object.values(TERRAIN_TOOLS),
  COORDINATE_VALIDATION: {
    requireInteger: true,
    requireNonNegative: true
  }
};
