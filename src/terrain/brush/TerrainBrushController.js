// TerrainBrushController.js - Encapsulates terrain tool, brush size, and modifications
// Extracts input-driven terrain editing logic from TerrainCoordinator

import { LOG_LEVEL, LOG_CATEGORY, logger } from '../../utils/logger/Logger.js';
import { TERRAIN_CONFIG } from '../../config/terrain/TerrainConstants.js';
import { normalizeBrushSize, computeBrushFootprint } from './BrushCommon.js';

// ── TerrainBrushController Class ───────────────────────
export class TerrainBrushController {
  constructor(dataStore) {
    this.dataStore = dataStore; // TerrainDataStore
    this.tool = 'raise'; // 'raise' | 'lower' | 'wall'
    this.brushSize = normalizeBrushSize(TERRAIN_CONFIG.DEFAULT_BRUSH_SIZE || 1);
    this.heightStep = 1;
    this.wallTopLevel = 3;
    this.wallFillMode = 'filled';
    this.wallStart = null;
  }

  setTool(tool) {
    this.cancelWallStroke();
    this.tool = ['lower', 'wall'].includes(tool) ? tool : 'raise';
  }

  setWallTopLevel(value) {
    if (
      !Number.isInteger(value) ||
      value < TERRAIN_CONFIG.MIN_HEIGHT ||
      value > TERRAIN_CONFIG.MAX_HEIGHT
    ) {
      throw new RangeError(
        `Wall top level must be an integer from ${TERRAIN_CONFIG.MIN_HEIGHT} to ${TERRAIN_CONFIG.MAX_HEIGHT}`
      );
    }
    this.wallTopLevel = value;
  }

  setWallFillMode(mode) {
    if (!['filled', 'outline'].includes(mode)) {
      throw new RangeError('Wall box style must be Filled or Outline');
    }
    this.wallFillMode = mode;
  }

  beginWallStroke(gridX, gridY) {
    if (this.tool !== 'wall' || !this._isValidCell(gridX, gridY)) {
      throw new Error('A wall stroke must begin on a valid cell with the Wall tool selected');
    }
    this.wallStart = { x: gridX, y: gridY };
  }

  cancelWallStroke() {
    this.wallStart = null;
  }

  // ── Brush Sizing ───────────────────────────────────────
  increaseBrush() {
    this.brushSize = normalizeBrushSize(this.brushSize + 1);
  }

  decreaseBrush() {
    this.brushSize = normalizeBrushSize(this.brushSize - 1);
  }

  // ── Footprint & Application ────────────────────────────
  /**
   * Get the set of grid cells affected by the current brush at a center position.
   * This is a non-mutating helper used for hover/preview rendering.
   * @param {number} gridX
   * @param {number} gridY
   * @returns {Array<{x:number,y:number}>}
   */
  getFootprintCells(gridX, gridY) {
    if (this.tool === 'wall') {
      if (!this._isValidCell(gridX, gridY)) return [];
      const start = this.wallStart || { x: gridX, y: gridY };
      const minX = Math.min(start.x, gridX);
      const maxX = Math.max(start.x, gridX);
      const minY = Math.min(start.y, gridY);
      const maxY = Math.max(start.y, gridY);
      const cells = [];
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          if (this.wallFillMode === 'outline' && x > minX && x < maxX && y > minY && y < maxY) {
            continue;
          }
          cells.push({ x, y });
        }
      }
      return cells;
    }
    return computeBrushFootprint(gridX, gridY, this.brushSize, this._getBounds());
  }

  getPreviewHeight(gridX, gridY) {
    const current = this.dataStore.get(gridX, gridY);
    if (this.tool === 'wall') return this.wallTopLevel;
    if (this.tool === 'lower')
      return Math.max(current - this.heightStep, TERRAIN_CONFIG.MIN_HEIGHT);
    return Math.min(current + this.heightStep, TERRAIN_CONFIG.MAX_HEIGHT);
  }

  applyAt(gridX, gridY) {
    const footprint = this.getFootprintCells(gridX, gridY);
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

  // ── Cell Modification ─────────────────────────────────
  _modifyCell(x, y) {
    if (x < 0 || y < 0 || y >= this.dataStore.rows || x >= this.dataStore.cols) return;
    const current = this.dataStore.get(x, y);
    const next = this.getPreviewHeight(x, y);
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

  _isValidCell(x, y) {
    return (
      Number.isInteger(x) &&
      Number.isInteger(y) &&
      x >= 0 &&
      y >= 0 &&
      x < this.dataStore.cols &&
      y < this.dataStore.rows
    );
  }
}
