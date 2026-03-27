// TerrainMaterialFactory.js - Phase 2 placeholder for future biome-aware materials.
// Current responsibility: return a basic material instance while providing an API
// seam for later biome tint / splat map upgrades.

export function createTerrainMaterial(three, { color = 0x777766 } = {}) {
  try {
    return new three.MeshStandardMaterial({ color, flatShading: false });
  } catch (_) {
    // Fallback stub for non-WebGL test environments.
    return { isMaterial: true, color };
  }
}
