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
  // Height system (reverted to +/-5 operational range; biome palettes can still internally map if extended later)
  DEFAULT_HEIGHT: 0,
  MIN_HEIGHT: -5,
  MAX_HEIGHT: 5,
  HEIGHT_STEP: 1,
  
  // Brush system
  DEFAULT_BRUSH_SIZE: 1,
  MIN_BRUSH_SIZE: 1,
  MAX_BRUSH_SIZE: 5,
  
  // Visual representation
  HEIGHT_COLOR_SCALE: {
    // Simplified color mapping for -5..5 operational range
    // Negative heights = deep cool → violet transition
    // Positive heights = green → yellow‑green gradient
    '-5': 0x0b0f33,
    '-4': 0x1b2561,
    '-3': 0x3346a7,
    '-2': 0x5b63e5,
    '-1': 0x7a5ff2,
    '0':  0x6b7280,
    '1':  0x10b981,
    '2':  0x16a34a,
    '3':  0x4caf50,
    '4':  0xa2b91a,
    '5':  0xefe36a
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
