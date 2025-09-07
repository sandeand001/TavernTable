// TerrainBrushController.js - Encapsulates terrain tool, brush size, and modifications
// Extracts input-driven terrain editing logic from TerrainCoordinator

import { LOG_LEVEL, LOG_CATEGORY, logger } from '../utils/Logger.js';
import { TERRAIN_CONFIG } from '../config/TerrainConstants.js';

export class TerrainBrushController {
  constructor(dataStore) {
    this.dataStore = dataStore; // TerrainDataStore
    this.tool = 'raise'; // 'raise' | 'lower'
    this.brushSize = 1;
    this.heightStep = 1;
  }

  setTool(tool) {
    this.tool = tool === 'lower' ? 'lower' : 'raise';
  }

  increaseBrush() {
    this.brushSize = Math.min(this.brushSize + 1, TERRAIN_CONFIG.MAX_BRUSH_SIZE);
  }

  decreaseBrush() {
    this.brushSize = Math.max(this.brushSize - 1, TERRAIN_CONFIG.MIN_BRUSH_SIZE);
  }

  /**
   * Get the set of grid cells affected by the current brush at a center position.
   * This is a non-mutating helper used for hover/preview rendering.
   * @param {number} gridX
   * @param {number} gridY
   * @returns {Array<{x:number,y:number}>}
   */
  getFootprintCells(gridX, gridY) {
    const half = Math.floor(this.brushSize / 2);
    const cells = [];
    for (let dy = -half; dy <= half; dy++) {
      for (let dx = -half; dx <= half; dx++) {
        const x = gridX + dx;
        const y = gridY + dy;
        if (x < 0 || y < 0 || y >= this.dataStore.rows || x >= this.dataStore.cols) continue;
        cells.push({ x, y });
      }
    }
    return cells;
  }

  applyAt(gridX, gridY) {
    const half = Math.floor(this.brushSize / 2);
    for (let dy = -half; dy <= half; dy++) {
      for (let dx = -half; dx <= half; dx++) {
        const x = gridX + dx;
        const y = gridY + dy;
        this._modifyCell(x, y);
      }
    }
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
      logger.log(LOG_LEVEL.TRACE, 'Terrain height modified', LOG_CATEGORY.USER, {
        coordinates: { x, y },
        from: current,
        to: next,
        tool: this.tool,
        heightStep: this.heightStep,
      });
    }
  }
}
