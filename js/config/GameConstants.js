// js/config/GameConstants.js - Centralized game configuration and constants

/**
 * Grid configuration constants
 * Controls the isometric grid rendering and behavior
 */
export const GRID_CONFIG = {
  // Tile dimensions for isometric projection
  TILE_WIDTH: 64,
  TILE_HEIGHT: 32,
  
  // Default grid size
  DEFAULT_ROWS: 10,
  DEFAULT_COLS: 10,
  
  // Grid size limits
  MIN_SIZE: 5,
  MAX_SIZE: 50,
  
  // Colors
  BACKGROUND_COLOR: 0x2c2c2c,
  GRID_LINE_COLOR: 0x555555,
  HOVER_COLOR: 0xFFFF00
};

/**
 * Application configuration
 * Core PIXI.js and rendering settings
 */
export const APP_CONFIG = {
  // PIXI Application settings
  PIXI_SETTINGS: {
    backgroundColor: GRID_CONFIG.BACKGROUND_COLOR,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true
  },
  
  // Performance settings
  MAX_TOKENS: 100,
  ANIMATION_DURATION: 300
};

/**
 * Input and interaction constants
 */
export const INPUT_CONFIG = {
  // Mouse interaction
  PAN_BUTTON: 'space',
  ZOOM_SENSITIVITY: 0.1,
  
  // Token placement
  SNAP_THRESHOLD: 10,
  DRAG_THRESHOLD: 5
};

/**
 * Validation helpers
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
    return x >= 0 && x < cols && y >= 0 && y < rows;
  }
};
