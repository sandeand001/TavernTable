import { ErrorHandler, ERROR_SEVERITY, ERROR_CATEGORY } from '../../utils/ErrorHandler.js';
import { logger, LOG_CATEGORY } from '../../utils/Logger.js';
import { TerrainHeightUtils } from '../../utils/TerrainHeightUtils.js';
import { CoordinateUtils } from '../../utils/CoordinateUtils.js';

/**
 * ElevationScaleController - Extracted logic for updating elevation perception scale.
 * Delegated by TerrainCoordinator.setElevationScale to avoid behavior changes.
 */
export class ElevationScaleController {
  constructor(coordinator) {
    this.c = coordinator; // TerrainCoordinator instance
  }

  /** Apply a new elevation unit (pixels per level) and refresh visuals accordingly. */
  apply(unit) {
    try {
      if (!Number.isFinite(unit) || unit < 0) return;
      if (this.c._elevationScale === unit) return;
      this.c._elevationScale = unit;
      // Update global height util override so all compute paths use the new unit
      TerrainHeightUtils.setElevationUnit(unit);

      // 1) Re-apply elevation to overlay tiles without recreating them (preserve colors) when terrain mode is active
      if (this.c.terrainManager && this.c.isTerrainModeActive) {
        try {
          this.c.terrainManager.reapplyElevationScaleToOverlay();
        } catch (_) {
          /* non-fatal */
        }
      }

      // 2) Re-apply elevation to base grid tiles (position and faces)
      if (this.c.gameManager?.gridContainer?.children) {
        const children = this.c.gameManager.gridContainer.children;
        // First, remove any base faces to avoid duplicates; will be re-added per tile below
        children.forEach((child) => {
          if (child && child.isGridTile) {
            if (child.baseSideFaces && child.parent?.children?.includes(child.baseSideFaces)) {
              try {
                child.parent.removeChild(child.baseSideFaces);
                if (
                  typeof child.baseSideFaces.destroy === 'function' &&
                  !child.baseSideFaces.destroyed
                ) {
                  child.baseSideFaces.destroy();
                }
              } catch (_) {
                /* ignore */
              }
              child.baseSideFaces = null;
            }
          }
        });

        // Now recompute y position and shadows for each base tile; then re-add faces
        children.forEach((child) => {
          if (child && child.isGridTile) {
            try {
              // Reset to baseline
              if (typeof child.baseIsoY === 'number') child.y = child.baseIsoY;
              // Remove prior shadow
              if (child.shadowTile && child.parent?.children?.includes(child.shadowTile)) {
                child.parent.removeChild(child.shadowTile);
                if (typeof child.shadowTile.destroy === 'function' && !child.shadowTile.destroyed) {
                  child.shadowTile.destroy();
                }
                child.shadowTile = null;
              }
              // Apply new elevation offset
              const h = Number.isFinite(child.terrainHeight) ? child.terrainHeight : 0;
              if (h !== 0) {
                this.c.addVisualElevationEffect(child, h);
              }
              // Re-add base faces using current base heights
              const gx = child.gridX,
                gy = child.gridY;
              const height = Number.isFinite(child.terrainHeight) ? child.terrainHeight : 0;
              // Re-add base side faces using tile lifecycle controller
              this.c._tileLifecycle.addBase3DFaces(child, gx, gy, height);
            } catch (_) {
              /* continue on error */
            }
          }
        });
      }

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

      // 4) If overlay container exists, ensure it still sorts correctly
      try {
        this.c.gameManager?.gridContainer?.sortChildren?.();
      } catch (_) {
        /* no-op */
      }

      // 5) If outside terrain mode and a biome is selected, repaint the biome canvas
      if (!this.c.isTerrainModeActive && typeof window !== 'undefined' && window.selectedBiome) {
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
    } catch (error) {
      new ErrorHandler().handle(error, ERROR_SEVERITY.LOW, ERROR_CATEGORY.UI, {
        context: 'ElevationScaleController.apply',
        unit,
      });
    }
  }
}
