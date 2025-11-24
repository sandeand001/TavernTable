// TerrainBrushController.js - Encapsulates terrain tool, brush size, and modifications
// Extracts input-driven terrain editing logic from TerrainCoordinator

import { LOG_LEVEL, LOG_CATEGORY, logger } from '../utils/Logger.js';
import { TERRAIN_CONFIG } from '../config/TerrainConstants.js';
import {
  normalizeBrushSize,
  computeBrushFootprint,
} from './brush/BrushCommon.js';

export class TerrainBrushController {
  constructor(dataStore) {
    this.dataStore = dataStore; // TerrainDataStore
    this.tool = 'raise'; // 'raise' | 'lower'
    this.brushSize = normalizeBrushSize(TERRAIN_CONFIG.DEFAULT_BRUSH_SIZE || 1);
    this.heightStep = 1;
  }

  setTool(tool) {
    this.tool = tool === 'lower' ? 'lower' : 'raise';
  }

  increaseBrush() {
    this.brushSize = normalizeBrushSize(this.brushSize + 1);
  }

  decreaseBrush() {
    this.brushSize = normalizeBrushSize(this.brushSize - 1);
  }

  /**
   * Get the set of grid cells affected by the current brush at a center position.
   * This is a non-mutating helper used for hover/preview rendering.
   * @param {number} gridX
   * @param {number} gridY
   * @returns {Array<{x:number,y:number}>}
   */
  getFootprintCells(gridX, gridY) {
    return computeBrushFootprint(gridX, gridY, this.brushSize, this._getBounds());
  }

  applyAt(gridX, gridY) {
    const footprint = computeBrushFootprint(gridX, gridY, this.brushSize, this._getBounds());
    let modifiedCount = 0;
    for (const cell of footprint) {
      if (this._modifyCell(cell.x, cell.y)) modifiedCount += 1;
    }
    // Aggregate logging instead of per-cell to reduce overhead (perf optimization)
    if (modifiedCount > 0) {
      // Detailed per-cell tracing can be re-enabled by setting global/window.DEBUG_TERRAIN_TRACE
      // Avoid direct Node globals for browser lint; guard process usage.
      const wantsTrace = typeof window !== 'undefined' && window.DEBUG_TERRAIN_TRACE;
      const level = wantsTrace ? LOG_LEVEL.TRACE : LOG_LEVEL.DEBUG;
      logger.log(level, 'Terrain brush stroke', LOG_CATEGORY.USER, {
        tool: this.tool,
        brushSize: this.brushSize,
        heightStep: this.heightStep,
        modifiedCells: modifiedCount,
        center: { x: gridX, y: gridY },
      });
    }
    return modifiedCount > 0; // signal to callers whether a terrain change occurred
  }

  _modifyCell(x, y) {
    if (x < 0 || y < 0 || y >= this.dataStore.rows || x >= this.dataStore.cols) return;
    const current = this.dataStore.get(x, y);
    let next = current;
    if (this.tool === 'raise')
      next = Math.min(current + this.heightStep, TERRAIN_CONFIG.MAX_HEIGHT);
    if (this.tool === 'lower')
      next = Math.max(current - this.heightStep, TERRAIN_CONFIG.MIN_HEIGHT);
    if (next !== current) {
      this.dataStore.set(x, y, next);
      return true; // signal modification took place
    }
    return false;
  }

  _getBounds() {
    const cols = Number.isFinite(this.dataStore?.cols) ? this.dataStore.cols : undefined;
    const rows = Number.isFinite(this.dataStore?.rows) ? this.dataStore.rows : undefined;
    return { cols, rows, minX: 0, minY: 0 };
  }
}
