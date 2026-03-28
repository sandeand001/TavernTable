import { Graphics } from '../../../utils/stubs/PixiStub.js';
import { logger, LOG_CATEGORY } from '../../../utils/logger/Logger.js';
import { TERRAIN_CONFIG } from '../../../config/terrain/TerrainConstants.js';
import { TerrainHeightUtils } from '../../../utils/terrain/TerrainHeightUtils.js';

export function ensurePreviewLayerOnTop(mgr) {
  try {
    if (!mgr.gameManager?.gridContainer || !mgr.previewContainer) return;
    const parent = mgr.gameManager.gridContainer;
    // Keep zIndex higher than terrain overlay so resorting doesn't bury the preview.
    // Tokens/placeables may be raised above this value when editing.
    const desired = (mgr.terrainContainer?.zIndex || 100000) + 10;
    if (mgr.previewContainer.zIndex !== desired) {
      mgr.previewContainer.zIndex = desired;
    }
    // Keep container alive and visible; order among siblings is handled by child zIndex
    // Also nudge to the end as a safety net for environments not using zIndex sorting
    if (typeof parent.setChildIndex === 'function') {
      parent.setChildIndex(mgr.previewContainer, Math.max(0, parent.children.length - 1));
    } else {
      // Fallback: remove and re-add
      try {
        parent.removeChild(mgr.previewContainer);
      } catch {
        /* ignore */
      }
      parent.addChild(mgr.previewContainer);
    }
    // If the parent sorts by zIndex, apply ordering now
    try {
      if (parent.sortableChildren && typeof parent.sortChildren === 'function') {
        parent.sortChildren();
      }
    } catch {
      /* ignore */
    }
    mgr.previewContainer.visible = true;
    // Parent container uses children zIndex to interleave; parent zIndex is not forced here.
  } catch (_) {
    /* best-effort */
  }
}

export function renderBrushPreview(mgr, cells, options = {}) {
  try {
    const threeMgr = mgr.gameManager?.threeSceneManager;
    const use3DPreview = mgr.gameManager?.is3DModeActive?.() && threeMgr?.setTerrainBrushPreview;
    const terrainModeActive = !!mgr.terrainCoordinator?.isTerrainModeActive;
    const hasCells = Array.isArray(cells) && cells.length > 0;
    const shouldShow3D = use3DPreview && terrainModeActive && hasCells;

    let previewCells3D = cells;
    let previewStyle3D = options;
    if (shouldShow3D && Array.isArray(cells) && cells.length) {
      const brush = mgr.terrainCoordinator?.brush;
      const getHeight = mgr.terrainCoordinator?.getTerrainHeight?.bind?.(mgr.terrainCoordinator);
      if (brush && typeof getHeight === 'function') {
        const maxH = Number.isFinite(TERRAIN_CONFIG?.MAX_HEIGHT)
          ? TERRAIN_CONFIG.MAX_HEIGHT
          : Infinity;
        const minH = Number.isFinite(TERRAIN_CONFIG?.MIN_HEIGHT)
          ? TERRAIN_CONFIG.MIN_HEIGHT
          : -Infinity;
        const stepRaw = Number.isFinite(brush.heightStep) ? Math.abs(brush.heightStep) : 1;
        const delta = stepRaw > 0 ? stepRaw : 1;
        const isLower = brush.tool === 'lower';
        previewCells3D = cells.map((cell) => {
          const cx = cell?.x ?? cell?.gridX ?? 0;
          const cy = cell?.y ?? cell?.gridY ?? 0;
          const currentHeight = getHeight(cx, cy) ?? 0;
          let previewHeight = currentHeight;
          if (isLower) {
            previewHeight = Math.max(currentHeight - delta, minH);
          } else {
            previewHeight = Math.min(currentHeight + delta, maxH);
          }
          return {
            x: cx,
            y: cy,
            currentHeight,
            previewHeight,
          };
        });
        previewStyle3D = {
          ...options,
          previewMode: 'terrain-height',
          brushTool: brush.tool || 'raise',
          heightStep: delta,
        };
      }
    }

    if (!hasCells || !terrainModeActive) {
      if (use3DPreview) threeMgr?.clearTerrainBrushPreview?.();
    } else if (use3DPreview) {
      try {
        threeMgr.setTerrainBrushPreview(previewCells3D, previewStyle3D);
      } catch (_) {
        /* ignore */
      }
    }

    if (!mgr.previewContainer || !terrainModeActive) return;
    // Ensure the preview layer is on top and visible before drawing
    ensurePreviewLayerOnTop(mgr);
    // Clear previous preview before drawing new (preserve 3D overlay when redrawing)
    clearBrushPreview(mgr, { include3D: !shouldShow3D });
    try {
      if (mgr.previewContainer && mgr.previewContainer.visible === false) {
        mgr.previewContainer.visible = true;
      }
      const parent = mgr.gameManager?.gridContainer;
      if (parent && !parent.children?.includes(mgr.previewContainer)) {
        parent.addChild(mgr.previewContainer);
      }
    } catch {
      /* ignore */
    }
    if (!Array.isArray(cells) || cells.length === 0) return;

    const w = mgr.gameManager.tileWidth;
    const h = mgr.gameManager.tileHeight;
    const color = typeof options.color === 'number' ? options.color : 0xffff00;
    const lineWidth = typeof options.lineWidth === 'number' ? options.lineWidth : 2;
    const fillAlpha = typeof options.fillAlpha === 'number' ? options.fillAlpha : 0.12;
    const lineAlpha = typeof options.lineAlpha === 'number' ? options.lineAlpha : 0.9;

    for (const { x, y } of cells) {
      const g = new Graphics();
      // Semi-transparent outline to avoid altering underlying colors
      g.lineStyle(lineWidth, color, lineAlpha);
      g.beginFill(color, fillAlpha);
      g.moveTo(0, h / 2);
      g.lineTo(w / 2, 0);
      g.lineTo(w, h / 2);
      g.lineTo(w / 2, h);
      g.closePath();
      g.endFill();

      // Position in iso space, reusing the same transform logic as tiles
      g.x = (x - y) * (w / 2);
      g.y = (x + y) * (h / 2);

      // Elevation offset so outline sits on the tile using the same scale util
      try {
        const height = mgr.terrainCoordinator.getTerrainHeight(x, y);
        const offset =
          typeof TerrainHeightUtils?.calculateElevationOffset === 'function'
            ? TerrainHeightUtils.calculateElevationOffset(height)
            : (height || 0) * (mgr.gameManager.tileHeight * 0.1);
        g.y += offset;
      } catch {
        /* best-effort */
      }

      // Depth-sort preview strictly BETWEEN tile top (depth*100) and tokens (depth*100 + 1)
      // and ensure it isn't hidden by overlay container resorting.
      g.zIndex = (x + y) * 100 + 0.5;

      mgr.previewContainer.addChild(g);
      mgr.previewCache.set(`${x},${y}`, g);
    }
    try {
      mgr.previewContainer.sortChildren?.();
    } catch {
      /* no-op */
    }
  } catch (error) {
    logger.warn(
      'Failed to render brush preview',
      {
        error: error.message,
        cellsCount: Array.isArray(cells) ? cells.length : 0,
      },
      LOG_CATEGORY.RENDERING
    );
  }
}

export function clearBrushPreview(mgr, options = {}) {
  const { include3D = true } = options;
  if (include3D) {
    try {
      mgr.gameManager?.threeSceneManager?.clearTerrainBrushPreview?.();
    } catch (_) {
      /* ignore */
    }
  }
  try {
    if (!mgr.previewContainer) return;
    for (const [, g] of mgr.previewCache) {
      try {
        if (g.parent) g.parent.removeChild(g);
      } catch {
        /* ignore */
      }
      try {
        if (typeof g.destroy === 'function' && !g.destroyed) g.destroy({ children: true });
      } catch {
        /* ignore */
      }
    }
    mgr.previewCache.clear();
    // Also remove any stray children just in case
    if (typeof mgr.previewContainer.removeChildren === 'function') {
      mgr.previewContainer.removeChildren();
    }
  } catch (error) {
    logger.warn('Failed to clear brush preview', { error: error.message }, LOG_CATEGORY.RENDERING);
  }
}
