/**
 * Compute the visual Y-offset for a given terrain height.
 * Heuristic matches UIController original logic.
 */
export function computeElevationVisualOffset(height) {
  const tileH = (typeof window !== 'undefined' && window.gameManager) ? window.gameManager.tileHeight : 64;
  return -height * (tileH * 0.5);
}

export default computeElevationVisualOffset;
