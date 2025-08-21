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
  constructor(coordinator) { this.c = coordinator; }

  /** Re-color existing base grid tiles using currently selected biome palette. */
  applyToBaseGrid() {
    if (this.c.isTerrainModeActive) return;
    if (typeof window === 'undefined' || !window.selectedBiome) return;
    const biomeKey = window.selectedBiome;
    try {
      // Ensure grid container is available
      if (!this.c?.gameManager?.gridContainer) {
        logger.debug('Biome shading skipped: gridContainer missing', { context: 'BiomeShadingController.applyToBaseGrid', biome: biomeKey });
        return;
      }
      // Ensure a continuous biome canvas exists and paint it from current heights
      if (!this.c._biomeCanvas) this.c._biomeCanvas = new BiomeCanvasPainter(this.c.gameManager);
      // Keep painter noise deterministic with our coordinator seed
      try { this.c._biomeCanvas.setSeed?.(this.c._biomeSeed >>> 0); } catch (_) { /* ignore setSeed error */ }
      const rows = this.c.gameManager.rows, cols = this.c.gameManager.cols;
      const heights = Array(rows).fill(null).map(() => Array(cols).fill(0));
      this.c.gameManager.gridContainer.children.forEach(ch => {
        if (!ch?.isGridTile) return;
        const gx = ch.gridX, gy = ch.gridY;
        if (gy >= 0 && gy < rows && gx >= 0 && gx < cols) heights[gy][gx] = Number.isFinite(ch.terrainHeight) ? ch.terrainHeight : 0;
      });
      // Hide per-tile fills so the canvas shows through
      this.toggleBaseTileVisibility(false);
      try {
        this.c._biomeCanvas.paint(biomeKey, heights, null);
      } catch (pe) {
        logger.warn('Biome painter paint() failed', { context: 'BiomeShadingController.applyToBaseGrid', biome: biomeKey, error: pe?.message, stack: pe?.stack });
        throw pe;
      }

      this.c.gameManager.gridContainer.children.forEach(child => {
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
        } catch (_) { /* ignore */ }

        child.clear();
        child.lineStyle(1, borderColor, borderAlpha);
        // Draw only the border path; leave unfilled to let the biome canvas be visible
        traceDiamondPath(child, this.c.gameManager.tileWidth, this.c.gameManager.tileHeight);

        if (typeof child.baseIsoY === 'number') child.y = child.baseIsoY;
        if (h !== TERRAIN_CONFIG.DEFAULT_HEIGHT) this.c.addVisualElevationEffect(child, h);
      });
      logger.debug('Applied biome palette to base grid', { context: 'BiomeShadingController.applyToBaseGrid', biome: biomeKey }, LOG_CATEGORY.USER);
    } catch (e) {
      // Downgraded to DEBUG to avoid noisy repeats; inner paint() warns on real failures
      logger.debug('Biome palette application encountered an error', { context: 'BiomeShadingController.applyToBaseGrid', biome: biomeKey, error: e?.message, stack: e?.stack });
    } finally {
      this.c._currentColorEvalX = undefined;
      this.c._currentColorEvalY = undefined;
    }
  }

  /** Show or hide the base tile fills (keeping borders) */
  toggleBaseTileVisibility(show) {
    try {
      this.c.gameManager.gridContainer.children.forEach(child => {
        if (!child?.isGridTile) return;
        child.clear();
        child.lineStyle(1, GRID_CONFIG.TILE_BORDER_COLOR, GRID_CONFIG.TILE_BORDER_ALPHA);
        if (show) {
          child.beginFill(GRID_CONFIG.TILE_COLOR, 1.0);
        }
        traceDiamondPath(child, this.c.gameManager.tileWidth, this.c.gameManager.tileHeight);
        if (show) child.endFill();
      });
    } catch (_) { /* ignore */ }
  }

  /** Determine base tile color when not editing: biome palette if selected, else neutral. */
  getBiomeOrBaseColor(height, gx = 0, gy = 0) {
    try {
      if (!this.c.isTerrainModeActive && typeof window !== 'undefined' && window.selectedBiome) {
        const mapFreq = (typeof window !== 'undefined' && window.richShadingSettings?.mapFreq) || 0.05;
        const seed = (this.c._biomeSeed ?? 1337) >>> 0;
        const hex = getBiomeColorHex(window.selectedBiome, height, gx, gy, { moisture: 0.5, slope: 0, aspectRad: 0, seed, mapFreq });
        return hex;
      }
    } catch (_) { /* ignore */ }
    return GRID_CONFIG.TILE_COLOR;
  }
}
