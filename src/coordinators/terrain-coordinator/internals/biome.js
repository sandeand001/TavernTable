// Biome-related UI toggles and shading enablement outside of terrain mode
// This module centralizes the logic to enable/disable rich shading without altering behavior.

/**
 * Enable or disable the rich biome canvas shading outside terrain mode.
 * Mirrors existing TerrainCoordinator.setRichShadingEnabled behavior.
 * @param {import('../../TerrainCoordinator.js').TerrainCoordinator} c
 * @param {boolean} enabled
 */
export function setRichShadingEnabled(c, enabled) {
  try {
    if (typeof window !== 'undefined') {
      if (!window.richShadingSettings) window.richShadingSettings = {};
      window.richShadingSettings.enabled = !!enabled;
    }

    // Only affects outside terrain edit mode
    if (c.isTerrainModeActive) return;

    if (enabled) {
      if (typeof window !== 'undefined' && window.selectedBiome) {
        c.applyBiomePaletteToBaseGrid();
      }
    } else {
      // Disable: clear painter if present and restore base tiles
      try {
        if (c._biomeCanvas) {
          c._biomeCanvas.clear(() => c._toggleBaseTileVisibility(true));
        } else {
          c._toggleBaseTileVisibility(true);
        }
      } catch (_) {
        c._toggleBaseTileVisibility(true);
      }
    }
  } catch (_) {
    // ignore
  }
}
