/**
 * TerrainConstants.js - Configuration constants for the terrain modification system
 * 
 * Defines terrain-related configuration values following the existing pattern
 * Used by TerrainCoordinator and TerrainManager for consistent behavior
 */

export const TERRAIN_CONFIG = {
  DEFAULT_HEIGHT: 0,
  MIN_HEIGHT: -10,
  MAX_HEIGHT: 10,
  HEIGHT_STEP: 1,
  DEFAULT_BRUSH_SIZE: 1,
  MIN_BRUSH_SIZE: 1,
  MAX_BRUSH_SIZE: 5,
  HEIGHT_COLOR_SCALE: {
    '-10': 0x040913,
    '-9':  0x071225,
    '-8':  0x0b1c36,
    '-7':  0x112848,
    '-6':  0x18345a,
    '-5':  0x1f416d,
    '-4':  0x2a4f82,
    '-3':  0x365d97,
    '-2':  0x496ab1,
    '-1':  0x5d72c6,
    '0':   0x6b7280,
    '1':   0x1a7b53,
    '2':   0x138b48,
    '3':   0x16994b,
    '4':   0x21a556,
    '5':   0x3db268,
    '6':   0x64bf75,
    '7':   0x8fcc7f,
    '8':   0xb7d789,
    '9':   0xdfe09a,
    '10':  0xf3e9b2
  },
  HEIGHT_ALPHA: 0.7,
  HEIGHT_BORDER_ALPHA: 0.9,
  HEIGHT_BORDER_WIDTH: 2,
  ELEVATION_SHADOW_OFFSET: 8,
  BATCH_UPDATE_SIZE: 10
};
