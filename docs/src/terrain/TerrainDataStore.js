// TerrainDataStore.js - Manages terrain height arrays and related operations
// Keeps TerrainCoordinator lean by extracting data concerns

import { TERRAIN_CONFIG } from '../config/TerrainConstants.js';
import { TerrainHeightUtils } from '../utils/TerrainHeightUtils.js';
import { logger, LOG_LEVEL, LOG_CATEGORY } from '../utils/Logger.js';

export class TerrainDataStore {
  constructor(cols, rows, baseTerrainHeights = null) {
    // Defensive fallback if constructed before GameManager sets dimensions
    const validCols = Number.isInteger(cols) && cols > 0 ? cols : TERRAIN_CONFIG.FALLBACK_COLS || 1;
    const validRows = Number.isInteger(rows) && rows > 0 ? rows : TERRAIN_CONFIG.FALLBACK_ROWS || 1;
    if (validCols !== cols || validRows !== rows) {
      logger.log(
        LOG_LEVEL.WARN,
        'TerrainDataStore constructed with invalid dimensions; using fallback',
        LOG_CATEGORY.SYSTEM,
        {
          context: 'TerrainDataStore.constructor',
          provided: { cols, rows },
          fallback: { cols: validCols, rows: validRows },
        }
      );
    }
    this.cols = validCols;
    this.rows = validRows;
    this.base =
      baseTerrainHeights ||
      TerrainHeightUtils.createHeightArray(validRows, validCols, TERRAIN_CONFIG.DEFAULT_HEIGHT);
    this.working = TerrainHeightUtils.createHeightArray(
      validRows,
      validCols,
      TERRAIN_CONFIG.DEFAULT_HEIGHT
    );
  }

  resize(cols, rows) {
    const oldBase = this.base;
    const newBase = TerrainHeightUtils.createHeightArray(rows, cols, TERRAIN_CONFIG.DEFAULT_HEIGHT);
    const newWorking = TerrainHeightUtils.createHeightArray(
      rows,
      cols,
      TERRAIN_CONFIG.DEFAULT_HEIGHT
    );

    const copyRows = Math.min(rows, oldBase.length);
    const copyCols = Math.min(cols, oldBase[0]?.length || 0);

    for (let y = 0; y < copyRows; y++) {
      for (let x = 0; x < copyCols; x++) {
        newBase[y][x] = oldBase[y][x];
        newWorking[y][x] = oldBase[y][x];
      }
    }

    this.cols = cols;
    this.rows = rows;
    this.base = newBase;
    this.working = newWorking;
  }

  get(gridX, gridY) {
    if (!Number.isInteger(gridX) || !Number.isInteger(gridY)) return TERRAIN_CONFIG.DEFAULT_HEIGHT;
    if (gridY < 0 || gridY >= this.working.length) return TERRAIN_CONFIG.DEFAULT_HEIGHT;
    const row = this.working[gridY];
    if (!Array.isArray(row)) return TERRAIN_CONFIG.DEFAULT_HEIGHT;
    if (gridX < 0 || gridX >= row.length) return TERRAIN_CONFIG.DEFAULT_HEIGHT;
    return row[gridX];
  }

  set(gridX, gridY, height) {
    if (gridY >= 0 && gridY < this.rows && gridX >= 0 && gridX < this.cols) {
      this.working[gridY][gridX] = height;
    }
  }

  applyWorkingToBase() {
    this.base = this.working.map((row) => [...row]);
  }

  loadBaseIntoWorking() {
    this.working = this.base.map((row) => [...row]);
  }

  resetAll(height = TERRAIN_CONFIG.DEFAULT_HEIGHT) {
    const rows = Number.isInteger(this.rows) && this.rows > 0 ? this.rows : 0;
    const cols = Number.isInteger(this.cols) && this.cols > 0 ? this.cols : 0;
    const value = Number.isFinite(height) ? height : TERRAIN_CONFIG.DEFAULT_HEIGHT;
    if (!rows || !cols) {
      const fallbackRows = Array.isArray(this.base) ? this.base.length : 0;
      const fallbackCols = Array.isArray(this.base?.[0]) ? this.base[0].length : 0;
      if (fallbackRows > 0 && fallbackCols > 0) {
        this.rows = fallbackRows;
        this.cols = fallbackCols;
        return this.resetAll(value);
      }
      this.rows = TERRAIN_CONFIG.FALLBACK_ROWS || 1;
      this.cols = TERRAIN_CONFIG.FALLBACK_COLS || 1;
      return this.resetAll(value);
    }

    this.base = TerrainHeightUtils.createHeightArray(rows, cols, value);
    this.working = TerrainHeightUtils.createHeightArray(rows, cols, value);
  }

  isConsistent() {
    const r = this.rows,
      c = this.cols;
    return (
      Array.isArray(this.base) &&
      Array.isArray(this.working) &&
      this.base.length === r &&
      this.working.length === r &&
      this.base.every((row) => Array.isArray(row) && row.length === c) &&
      this.working.every((row) => Array.isArray(row) && row.length === c)
    );
  }
}
