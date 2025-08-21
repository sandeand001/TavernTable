// src/config/GameConstants.js - Centralized game configuration and constants

/**
 * Grid configuration constants
 * Controls the isometric grid rendering and behavior
 */
export const GRID_CONFIG = {
  TILE_WIDTH: 64,
  TILE_HEIGHT: 32,
  DEFAULT_ROWS: 25,
  DEFAULT_COLS: 25,
  MIN_SIZE: 5,
  MAX_SIZE: 50,
  MIN_COLS: 5,
  MAX_COLS: 50,
  MIN_ROWS: 5,
  MAX_ROWS: 50,
  MIN_CELL_SIZE: 16,
  MAX_CELL_SIZE: 128,
  BACKGROUND_COLOR: 0x2c2c2c,
  GRID_LINE_COLOR: 0x555555,
  HOVER_COLOR: 0xFFFF00,
  TILE_COLOR: 0x444444,
  TILE_BORDER_COLOR: 0x666666,
  TILE_BORDER_ALPHA: 0.8,
  DEFAULT_SCALE: 1.0,
  MIN_SCALE: 0.5,
  MAX_SCALE: 3.0,
  ZOOM_SPEED: 0.1,
  INITIAL_Y_OFFSET: 100
};

/**
 * Application configuration
 * Core PIXI.js and rendering settings
 */
export const APP_CONFIG = {
  PIXI_SETTINGS: {
    backgroundColor: GRID_CONFIG.BACKGROUND_COLOR,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true
  },
  MAX_TOKENS: 100,
  ANIMATION_DURATION: 300
};
