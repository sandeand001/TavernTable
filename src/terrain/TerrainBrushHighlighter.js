// TerrainBrushHighlighter.js
// Domain-level helper that builds a hover-only highlight descriptor for the terrain brush.
// Pure data, no PIXI/UI imports. App layer renders based on the returned descriptor.

import { logger, LOG_CATEGORY } from '../utils/Logger.js';
import {
  BRUSH_LAYER_HINT,
  BRUSH_COLORS,
  resolveHighlightStyle,
  getDefaultHighlightStyle,
} from './brush/BrushCommon.js';

/**
 * @typedef {Object} Brush
 * @property {'raise'|'lower'} tool
 * @property {number} brushSize
 * @property {(cx:number, cy:number) => Array<{x:number,y:number}>} getFootprintCells
 */

/**
 * @typedef {Object} HighlightStyle
 * @property {number} color - Hex color used for both fill and stroke
 * @property {number} fillAlpha - Opacity of the fill (0..1)
 * @property {number} lineAlpha - Opacity of the outline (0..1)
 * @property {number} lineWidth - Outline width in pixels
 */

/**
 * @typedef {Object} HighlightDescriptor
 * @property {Array<{x:number,y:number}>} cells - Cells to highlight
 * @property {HighlightStyle} style - Visual style to apply
 * @property {'aboveFacesBelowTokens'} zHint - Layering hint for renderer
 */

/**
 * Build a highlighter descriptor for the current brush hover.
 * The style intentionally differs from raise/lower colors to avoid conflating mechanics.
 *
 * Notes on layering: The renderer should place this preview above terrain faces and below tokens.
 * This function only returns data; it does not manipulate PIXI objects.
 *
 * @param {{ brush: Brush, center: {gridX:number, gridY:number}, terrainModeActive: boolean }} params
 * @returns {HighlightDescriptor}
 */
export function buildBrushHighlightDescriptor(params) {
  const { brush, center, terrainModeActive } = params || {};

  if (!terrainModeActive || !brush || typeof brush.getFootprintCells !== 'function' || !center) {
    return { cells: [], style: getDefaultHighlightStyle(), zHint: BRUSH_LAYER_HINT };
  }

  try {
    const cells = brush.getFootprintCells(center.gridX, center.gridY) || [];
    const style = /** @type {HighlightStyle} */ (
      resolveHighlightStyle({
        // Slightly brighter alpha than default to distinguish hover state.
        color: BRUSH_COLORS.preview,
        fillAlpha: 0.14,
        lineAlpha: 0.95,
        lineWidth: 2,
      })
    );
    return { cells, style, zHint: BRUSH_LAYER_HINT };
  } catch (error) {
    // Non-fatal: return empty descriptor
    logger.warn(
      'buildBrushHighlightDescriptor failed',
      { error: error?.message },
      LOG_CATEGORY.RENDERING
    );
    return { cells: [], style: getDefaultHighlightStyle(), zHint: BRUSH_LAYER_HINT };
  }
}

export default { buildBrushHighlightDescriptor };
