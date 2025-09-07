import { TERRAIN_CONFIG } from '../../../config/TerrainConstants.js';

/**
 * Safely read a terrain height from the working data array with guards.
 * Mirrors TerrainCoordinator.getTerrainHeight original behavior.
 */
export function getTerrainHeight(c, gridX, gridY) {
  const heights = c?.dataStore?.working;
  if (!heights || !Array.isArray(heights)) {
    return TERRAIN_CONFIG.DEFAULT_HEIGHT;
  }
  if (!Number.isInteger(gridX) || !Number.isInteger(gridY)) {
    return TERRAIN_CONFIG.DEFAULT_HEIGHT;
  }
  if (gridY < 0 || gridY >= heights.length) {
    return TERRAIN_CONFIG.DEFAULT_HEIGHT;
  }
  const row = heights[gridY];
  if (!Array.isArray(row)) {
    return TERRAIN_CONFIG.DEFAULT_HEIGHT;
  }
  if (gridX < 0 || gridX >= row.length) {
    return TERRAIN_CONFIG.DEFAULT_HEIGHT;
  }
  return row[gridX];
}
