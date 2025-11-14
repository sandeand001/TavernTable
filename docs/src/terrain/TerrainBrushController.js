// TerrainBrushController.js - Encapsulates terrain tool, brush size, and modifications
// Extracts input-driven terrain editing logic from TerrainCoordinator

import { LOG_LEVEL, LOG_CATEGORY, logger } from '../utils/Logger.js';
import { TERRAIN_CONFIG } from '../config/TerrainConstants.js';

const normalizeBrushSize = (value) => {
  const min = Number.isFinite(TERRAIN_CONFIG.MIN_BRUSH_SIZE) ? TERRAIN_CONFIG.MIN_BRUSH_SIZE : 1;
  const max = Number.isFinite(TERRAIN_CONFIG.MAX_BRUSH_SIZE) ? TERRAIN_CONFIG.MAX_BRUSH_SIZE : min;
  if (!Number.isFinite(value)) {
    return min;
  }
  const rounded = Math.round(value);
  return Math.max(min, Math.min(max, rounded));
};

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
    const negativeRadius = Math.floor((this.brushSize - 1) / 2);
    const positiveRadius = this.brushSize - negativeRadius - 1;
    const cells = [];
    for (let dy = -negativeRadius; dy <= positiveRadius; dy++) {
      for (let dx = -negativeRadius; dx <= positiveRadius; dx++) {
        const x = gridX + dx;
        const y = gridY + dy;
        if (x < 0 || y < 0 || y >= this.dataStore.rows || x >= this.dataStore.cols) continue;
        cells.push({ x, y });
      }
    }
    return cells;
  }

  applyAt(gridX, gridY) {
    const negativeRadius = Math.floor((this.brushSize - 1) / 2);
    const positiveRadius = this.brushSize - negativeRadius - 1;
    let modifiedCount = 0;
    for (let dy = -negativeRadius; dy <= positiveRadius; dy++) {
      for (let dx = -negativeRadius; dx <= positiveRadius; dx++) {
        const x = gridX + dx;
        const y = gridY + dy;
        if (this._modifyCell(x, y)) modifiedCount++;
      }
    }
    if (modifiedCount > 0) {
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
    return modifiedCount > 0;
  }

  _modifyCell(x, y) {
    if (x < 0 || y < 0 || y >= this.dataStore.rows || x >= this.dataStore.cols) return false;
    const current = this.dataStore.get(x, y);
    let next = current;
    if (this.tool === 'raise')
      next = Math.min(current + this.heightStep, TERRAIN_CONFIG.MAX_HEIGHT);
    if (this.tool === 'lower')
      next = Math.max(current - this.heightStep, TERRAIN_CONFIG.MIN_HEIGHT);
    if (next !== current) {
      this.dataStore.set(x, y, next);
      return true;
    }
    return false;
  }
}
