import { ErrorHandler, ERROR_SEVERITY, ERROR_CATEGORY } from '../../utils/error/ErrorHandler.js';
import { logger, LOG_CATEGORY } from '../../utils/logger/Logger.js';
import { TerrainHeightUtils } from '../../utils/terrain/TerrainHeightUtils.js';
import { CoordinateUtils } from '../../utils/coordinates/CoordinateUtils.js';

/**
 * ElevationScaleController - Extracted logic for updating elevation perception scale.
 * Delegated by TerrainCoordinator.setElevationScale to avoid behavior changes.
 */
export class ElevationScaleController {
  // ── Constructor ──────────────────────────────────────────────
  constructor(coordinator) {
    this.c = coordinator; // TerrainCoordinator instance
  }

  // ── Scale Application ──────────────────────────────────────────────

  /** Apply a new elevation unit (pixels per level) and refresh visuals accordingly. */
  apply(unit, options = {}) {
    try {
      if (!Number.isFinite(unit) || unit < 0) return;
      if (this.c._elevationScale === unit) return;
      this.c._elevationScale = unit;
      // Update global height util override so all compute paths use the new unit
      TerrainHeightUtils.setElevationUnit(unit);

      // 1) Re-apply elevation to overlay tiles (no-op in 3D mode: terrainManager removed)

      // 2) Re-apply elevation to base grid tiles — no-op in 3D mode (mesh owns geometry)

      // 3) Reposition tokens vertically to match new scale and keep zIndex consistent
      if (this.c.gameManager?.tokenManager?.placedTokens) {
        this.c.gameManager.tokenManager.placedTokens.forEach((t) => {
          try {
            if (!t?.creature?.sprite) return;
            const sprite = t.creature.sprite;
            const iso = CoordinateUtils.gridToIsometric(
              t.gridX,
              t.gridY,
              this.c.gameManager.tileWidth,
              this.c.gameManager.tileHeight
            );
            const h = this.c.dataStore?.get(t.gridX, t.gridY) ?? 0;
            const elev = TerrainHeightUtils.calculateElevationOffset(h);
            sprite.x = iso.x;
            sprite.y = iso.y + elev;
            sprite.zIndex = (t.gridX + t.gridY) * 100 + 1;
          } catch (_) {
            /* ignore */
          }
        });
      }

      // 4) Re-apply elevation to placeables (handled by 3D mesh pool, no 2D terrainManager)

      // 5) No overlay container to sort in 3D mode
      // 6) If outside terrain mode and a biome is selected, repaint the biome canvas
      const shouldRepaintBiome = options?.repaintBiome !== false;
      if (
        shouldRepaintBiome &&
        !this.c.isTerrainModeActive &&
        typeof window !== 'undefined' &&
        window.selectedBiome
      ) {
        try {
          this.c.applyBiomePaletteToBaseGrid();
        } catch (_) {
          /* non-fatal repaint failure */
        }
      }

      logger.debug(
        'Elevation perception scale updated',
        {
          context: 'ElevationScaleController.apply',
          unit,
        },
        LOG_CATEGORY.USER
      );
      // Trigger 3D elevation parity recalculation if hybrid mode active.
      try {
        if (this.c?.gameManager?.sync3DElevationScaling) {
          this.c.gameManager.sync3DElevationScaling({ rebuild: true });
        }
      } catch (_) {
        /* ignore parity sync errors */
      }
    } catch (error) {
      new ErrorHandler().handle(error, ERROR_SEVERITY.LOW, ERROR_CATEGORY.UI, {
        context: 'ElevationScaleController.apply',
        unit,
      });
    }
  }
}
