import { GRID_CONFIG } from '../../config/GameConstants.js';
import { logger, LOG_CATEGORY } from '../../utils/logger/Logger.js';
import { getBiomeColorHex } from '../../config/biome/BiomePalettes.js';

/**
 * BiomeShadingController - façade for painterly biome shading outside terrain mode.
 * Delegated by TerrainCoordinator to keep behavior identical.
 */
export class BiomeShadingController {
  // ── Constructor ──────────────────────────────────────────────
  constructor(coordinator) {
    this.c = coordinator;
  }

  // ── Biome Palette Application ─────────────────────────────────────

  /** Re-color existing base grid tiles using currently selected biome palette.
   * In 3D mode the terrain mesh owns all coloring; this schedules a mesh rebuild. */
  applyToBaseGrid() {
    if (this.c.isTerrainModeActive) return;
    if (typeof window === 'undefined' || !window.selectedBiome) return;
    try {
      this.c.gameManager.__biomeVersion = (this.c.gameManager.__biomeVersion || 0) + 1;
      // Schedule 3D mesh recolor since biome palette changed.
      this.c.gameManager?.notifyTerrainHeightsChanged?.();
      logger.debug(
        'Applied biome palette (3D mesh recolor scheduled)',
        { context: 'BiomeShadingController.applyToBaseGrid', biome: window.selectedBiome },
        LOG_CATEGORY.USER
      );
    } catch (e) {
      logger.debug('Biome palette application encountered an error', {
        context: 'BiomeShadingController.applyToBaseGrid',
        error: e?.message,
      });
    }
  }

  // ── Base Tile Visibility ───────────────────────────────────────────

  /** Show or hide the base tile fills — no-op in 3D mode (mesh owns visuals). */
  toggleBaseTileVisibility(_show) {
    // 2D sprite tiles gone; Three.js mesh controls visibility.
  }

  // ── Color Resolution ──────────────────────────────────────────────

  /** Determine base tile color when not editing: biome palette if selected, else neutral. */
  getBiomeOrBaseColor(height, gx = 0, gy = 0) {
    try {
      if (!this.c.isTerrainModeActive && typeof window !== 'undefined' && window.selectedBiome) {
        const mapFreq =
          (typeof window !== 'undefined' && window.richShadingSettings?.mapFreq) || 0.05;
        const seed = (this.c._biomeSeed ?? 1337) >>> 0;
        const hex = getBiomeColorHex(window.selectedBiome, height, gx, gy, {
          moisture: 0.5,
          slope: 0,
          aspectRad: 0,
          seed,
          mapFreq,
        });
        return hex;
      }
    } catch (_) {
      /* ignore */
    }
    return GRID_CONFIG.TILE_COLOR;
  }
}
