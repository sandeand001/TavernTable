// TerrainBrushHighlighter.js (docs mirror)
// Domain-level helper that builds a hover-only highlight descriptor for the terrain brush.
// Pure data, no PIXI/UI imports. App layer renders based on the returned descriptor.

import { logger, LOG_CATEGORY } from '../utils/Logger.js';

export function buildBrushHighlightDescriptor(params) {
    const { brush, center, terrainModeActive } = params || {};
    if (!terrainModeActive || !brush || typeof brush.getFootprintCells !== 'function' || !center) {
        return { cells: [], style: defaultHighlightStyle(), zHint: 'aboveFacesBelowTokens' };
    }
    try {
        const cells = brush.getFootprintCells(center.gridX, center.gridY) || [];
        const style = { color: 0x22d3ee, fillAlpha: 0.14, lineAlpha: 0.95, lineWidth: 2 };
        return { cells, style, zHint: 'aboveFacesBelowTokens' };
    } catch (error) {
        logger.warn('buildBrushHighlightDescriptor failed', { error: error?.message }, LOG_CATEGORY.RENDERING);
        return { cells: [], style: defaultHighlightStyle(), zHint: 'aboveFacesBelowTokens' };
    }
}

function defaultHighlightStyle() {
    return { color: 0x22d3ee, fillAlpha: 0.12, lineAlpha: 0.9, lineWidth: 2 };
}

export default { buildBrushHighlightDescriptor };
