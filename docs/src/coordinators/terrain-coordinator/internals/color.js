/**
 * Determine base tile color when not editing: biome palette if selected, else neutral.
 * Extracted from TerrainCoordinator to keep the coordinator lean.
 * @param {import('../../TerrainCoordinator.js').TerrainCoordinator} c
 * @param {number} height
 */
export function getBiomeOrBaseColor(c, height) {
  const gx = c._currentColorEvalX ?? 0;
  const gy = c._currentColorEvalY ?? 0;
  return c._biomeShading.getBiomeOrBaseColor(height, gx, gy);
}
