import { logger, LOG_CATEGORY } from '../../utils/Logger.js';
import { GRID_CONFIG } from '../../config/GameConstants.js';
import { TERRAIN_CONFIG } from '../../config/TerrainConstants.js';
import BiomeCanvasPainter from '../../terrain/BiomeCanvasPainter.js';
import { getBiomeColorHex } from '../../config/BiomePalettes.js';
import { traceDiamondPath } from '../../utils/PixiShapeUtils.js';

/**
 * BiomeShadingController - façade for painterly biome shading outside terrain mode.
 * Delegated by TerrainCoordinator to keep behavior identical.
 */
export class BiomeShadingController {
  constructor(coordinator) {
    this.c = coordinator;
  }

  /** Re-color existing base grid tiles using currently selected biome palette. */
  applyToBaseGrid() {
    if (this.c.isTerrainModeActive) return;
    if (typeof window === 'undefined' || !window.selectedBiome) return;
    const biomeKey = window.selectedBiome;
    try {
      // Ensure grid container is available
      if (!this.c?.gameManager?.gridContainer) {
        logger.debug('Biome shading skipped: gridContainer missing', {
          context: 'BiomeShadingController.applyToBaseGrid',
          biome: biomeKey,
        });
        return;
      }
      // Mark that biome changed so projection can purge stale overlays if needed
      this.c.gameManager.__biomeVersion = (this.c.gameManager.__biomeVersion || 0) + 1;
      const richEnabled = !!window?.richShadingSettings?.enabled;
      // Ensure a continuous biome canvas exists and paint it from current heights if rich shading is enabled
      if (richEnabled) {
        if (!this.c._biomeCanvas) this.c._biomeCanvas = new BiomeCanvasPainter(this.c.gameManager);
        // Keep painter noise deterministic with our coordinator seed
        try {
          this.c._biomeCanvas.setSeed?.(this.c._biomeSeed >>> 0);
        } catch (_) {
          /* ignore setSeed error */
        }
      }
      const rows = this.c.gameManager.rows,
        cols = this.c.gameManager.cols;
      // Prefer authoritative heights from datastore when available to avoid sampling half-updated tiles
      let heights;
      if (this.c?.dataStore?.base && this.c?.dataStore?.base.length === rows) {
        heights = this.c.dataStore.base.map((r) => r.slice());
      } else {
        heights = Array(rows)
          .fill(null)
          .map(() => Array(cols).fill(0));
      }
      // Paint canvas only when rich shading is enabled; keep per-tile fills so tops raise visually
      if (richEnabled) {
        try {
          this.c._biomeCanvas.paint(biomeKey, heights, null);
        } catch (pe) {
          logger.warn('Biome painter paint() failed', {
            context: 'BiomeShadingController.applyToBaseGrid',
            biome: biomeKey,
            error: pe?.message,
            stack: pe?.stack,
          });
          throw pe;
        }
      } else {
        // If a painter exists from a previous run, clear its sprites to avoid ghost overlays
        try {
          this.c._biomeCanvas?.clear?.();
        } catch (_) {
          /* ignore */
        }
        // Ensure base tiles are visible when rich shading is disabled
        this.toggleBaseTileVisibility(true);
      }

      this.c.gameManager.gridContainer.children.forEach((child) => {
        if (!child.isGridTile) return;
        const h = typeof child.terrainHeight === 'number' ? child.terrainHeight : 0;
        // Provide coordinates to color function for variation
        this.c._currentColorEvalX = child.gridX;
        this.c._currentColorEvalY = child.gridY;
        const borderColor = GRID_CONFIG.TILE_BORDER_COLOR;
        const borderAlpha = GRID_CONFIG.TILE_BORDER_ALPHA;

        // Clean up any previous rich shading layers
        try {
          if (child.paintLayer) {
            child.removeChild(child.paintLayer);
            if (typeof child.paintLayer.destroy === 'function' && !child.paintLayer.destroyed) {
              child.paintLayer.destroy({ children: true });
            }
            child.paintLayer = null;
          }
          if (child.paintMask) {
            child.removeChild(child.paintMask);
            if (typeof child.paintMask.destroy === 'function' && !child.paintMask.destroyed) {
              child.paintMask.destroy();
            }
            child.paintMask = null;
          }
        } catch (_) {
          /* ignore */
        }

        child.clear();
        child.lineStyle(1, borderColor, borderAlpha);
        // Fill the top with the biome palette color so elevation offsets are visible on the tile itself
        try {
          const fillHex = getBiomeColorHex(
            biomeKey,
            h,
            this.c._currentColorEvalX,
            this.c._currentColorEvalY,
            {
              moisture: 0.5,
              slope: 0,
              aspectRad: 0,
              seed: this.c._biomeSeed >>> 0,
              mapFreq: window?.richShadingSettings?.mapFreq || 0.05,
            }
          );
          child.beginFill(fillHex, 1.0);
          // Track current top fill color so top-down projection squares can mirror biome coloration
          child.__currentFillColor = fillHex;
          traceDiamondPath(child, this.c.gameManager.tileWidth, this.c.gameManager.tileHeight);
          child.endFill();
        } catch (_) {
          // Fallback: draw border only
          traceDiamondPath(child, this.c.gameManager.tileWidth, this.c.gameManager.tileHeight);
          // Fallback path: ensure at least base color recorded
          if (typeof child.__currentFillColor === 'undefined') {
            child.__currentFillColor = GRID_CONFIG.TILE_COLOR;
          }
        }

        if (typeof child.baseIsoY === 'number') child.y = child.baseIsoY;
        if (h !== TERRAIN_CONFIG.DEFAULT_HEIGHT) this.c.addVisualElevationEffect(child, h);

        // If a top-down square already exists for this tile, recolor it immediately
        try {
          if (child.__topDownGraphic && child.__topDownGraphic.__isTopDownSquare) {
            const sq = child.__topDownGraphic;
            const g = sq; // PIXI.Graphics
            if (g && typeof g.clear === 'function') {
              g.clear();
              // Elevation brightness adjustment will run again when ensureTopDownSquare is called next switch.
              g.beginFill(
                child.__currentFillColor || child.__baseColor || GRID_CONFIG.TILE_COLOR,
                1.0
              );
              g.lineStyle({ width: 1, color: 0x000000, alpha: 0.15 });
              g.drawRect(
                -this.c.gameManager.tileWidth / 2,
                -this.c.gameManager.tileWidth / 2,
                this.c.gameManager.tileWidth,
                this.c.gameManager.tileWidth
              );
              g.endFill();
            }
            // Track version so stale squares from older biome passes can be detected if orphaned
            sq.__biomeVersion = this.c.gameManager.__biomeVersion;
          }
        } catch (_) {
          /* ignore square recolor errors */
        }
      });
      // Purge orphaned top-down squares whose parent tiles were removed during map regeneration
      try {
        const gc = this.c.gameManager.gridContainer;
        const toDestroy = [];
        gc.children.forEach((ch) => {
          if (ch && ch.__isTopDownSquare) {
            // If there is no corresponding base tile with same grid coords, mark for destroy
            const gx = ch.__gridX;
            const gy = ch.__gridY;
            const hasBase = gc.children.some(
              (c2) => c2?.isGridTile && c2.__gridX === gx && c2.__gridY === gy
            );
            if (!hasBase) toDestroy.push(ch);
          }
        });
        toDestroy.forEach((sq) => {
          try {
            if (gc.children.includes(sq)) gc.removeChild(sq);
            sq.destroy?.();
          } catch (_) {
            /* ignore */
          }
        });
      } catch (_) {
        /* ignore purge errors */
      }
      logger.debug(
        'Applied biome palette to base grid',
        { context: 'BiomeShadingController.applyToBaseGrid', biome: biomeKey },
        LOG_CATEGORY.USER
      );
    } catch (e) {
      // Downgraded to DEBUG to avoid noisy repeats; inner paint() warns on real failures
      logger.debug('Biome palette application encountered an error', {
        context: 'BiomeShadingController.applyToBaseGrid',
        biome: biomeKey,
        error: e?.message,
        stack: e?.stack,
      });
    } finally {
      this.c._currentColorEvalX = undefined;
      this.c._currentColorEvalY = undefined;
    }
  }

  /** Show or hide the base tile fills (keeping borders) */
  toggleBaseTileVisibility(show) {
    try {
      this.c.gameManager.gridContainer.children.forEach((child) => {
        if (!child?.isGridTile) return;
        child.clear();
        child.lineStyle(1, GRID_CONFIG.TILE_BORDER_COLOR, GRID_CONFIG.TILE_BORDER_ALPHA);
        if (show) {
          child.beginFill(GRID_CONFIG.TILE_COLOR, 1.0);
          child.__currentFillColor = GRID_CONFIG.TILE_COLOR;
        } else {
          // preserve last color reference even when hidden, do not overwrite
        }
        traceDiamondPath(child, this.c.gameManager.tileWidth, this.c.gameManager.tileHeight);
        if (show) child.endFill();
      });
    } catch (_) {
      /* ignore */
    }
  }

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
