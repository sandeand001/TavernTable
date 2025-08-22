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

/**
 * Set a deterministic biome seed and repaint if applicable (outside terrain mode).
 * Mirrors TerrainCoordinator.setBiomeSeed behavior.
 * @param {import('../../TerrainCoordinator.js').TerrainCoordinator} c
 * @param {number} seed
 */
export function setBiomeSeed(c, seed) {
    if (!Number.isFinite(seed)) return;
    c._biomeSeed = (seed >>> 0);
    if (c._biomeCanvas) {
        try { c._biomeCanvas.setSeed?.(c._biomeSeed); } catch (_) { /* ignore setSeed error */ }
    }
    // Repaint if active outside terrain mode and a biome is selected
    if (!c.isTerrainModeActive && typeof window !== 'undefined' && window.selectedBiome) {
        try { c.applyBiomePaletteToBaseGrid(); } catch (_) { /* ignore repaint error */ }
    }
}

/**
 * Handle shading state after a terrain reset when outside terrain mode.
 * Applies biome shading if enabled+biome, or ensures base tiles visible and clears painter if disabled.
 * Safe no-op if called in terrain mode.
 * @param {import('../../TerrainCoordinator.js').TerrainCoordinator} c
 */
export function handlePostResetShading(c) {
    try {
        if (c.isTerrainModeActive || typeof window === 'undefined') return;
        const enabled = !!window.richShadingSettings?.enabled;
        const hasBiome = !!window.selectedBiome;
        if (enabled && hasBiome) {
            c.applyBiomePaletteToBaseGrid();
        } else if (!enabled) {
            c._toggleBaseTileVisibility(true);
            if (c._biomeCanvas) {
                try { c._biomeCanvas.clear(); } catch (_) { /* ignore clear error */ }
            }
        }
    } catch (_) {
        // swallow; non-fatal
    }
}
