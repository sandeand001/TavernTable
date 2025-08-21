/**
 * TerrainHeightUtils.js - Centralized height array management and calculations
 * 
 * Provides utilities for creating, managing, and validating terrain height data
 * structures. Eliminates duplication in height array initialization and provides
 * consistent height-related calculations.
 */

import { TERRAIN_CONFIG } from '../config/TerrainConstants.js';
import { logger, LOG_LEVEL, LOG_CATEGORY } from '../utils/Logger.js';

export class TerrainHeightUtils {
  // Runtime override for pixels-per-level. When null/undefined, falls back to config.
  static _elevationUnitOverride = undefined;

  /** Set the runtime elevation unit (pixels per level). Pass null/undefined to reset to default. */
  static setElevationUnit(unit) {
    if (Number.isFinite(unit) && unit >= 0) {
      this._elevationUnitOverride = unit;
    } else {
      this._elevationUnitOverride = undefined;
    }
  }

  /** Get the currently effective elevation unit (pixels per level). */
  static getElevationUnit() {
    return Number.isFinite(this._elevationUnitOverride) ? this._elevationUnitOverride : TERRAIN_CONFIG.ELEVATION_SHADOW_OFFSET;
  }
  /**
   * Create a new height array with specified dimensions and default height
   * @param {number} rows - Number of rows in the grid
   * @param {number} cols - Number of columns in the grid
   * @param {number} defaultHeight - Default height value for all cells
   * @returns {number[][]} 2D array of height values
   */
  static createHeightArray(rows, cols, defaultHeight = TERRAIN_CONFIG.DEFAULT_HEIGHT) {
    try {
      // Validate inputs
      if (!Number.isInteger(rows) || rows <= 0) {
        throw new Error(`Invalid rows parameter: ${rows}. Must be a positive integer.`);
      }
      if (!Number.isInteger(cols) || cols <= 0) {
        throw new Error(`Invalid cols parameter: ${cols}. Must be a positive integer.`);
      }
      if (!Number.isFinite(defaultHeight)) {
        throw new Error(`Invalid defaultHeight parameter: ${defaultHeight}. Must be a finite number.`);
      }

      // Validate height bounds
      if (!this.isValidHeight(defaultHeight)) {
        logger.log(LOG_LEVEL.WARN, 'Default height outside valid range, clamping', LOG_CATEGORY.SYSTEM, {
          context: 'TerrainHeightUtils.createHeightArray',
          requestedHeight: defaultHeight,
          minHeight: TERRAIN_CONFIG.MIN_HEIGHT,
          maxHeight: TERRAIN_CONFIG.MAX_HEIGHT
        });
        defaultHeight = this.clampHeight(defaultHeight);
      }

      // Create the 2D array
      const heightArray = Array(rows).fill(null).map(() => Array(cols).fill(defaultHeight));

      logger.log(LOG_LEVEL.DEBUG, 'Height array created', LOG_CATEGORY.SYSTEM, {
        context: 'TerrainHeightUtils.createHeightArray',
        dimensions: { rows, cols },
        defaultHeight,
        totalCells: rows * cols
      });

      return heightArray;
    } catch (error) {
      logger.log(LOG_LEVEL.ERROR, 'Error creating height array', LOG_CATEGORY.SYSTEM, {
        context: 'TerrainHeightUtils.createHeightArray',
        error: error.message,
        parameters: { rows, cols, defaultHeight }
      });
      throw error;
    }
  }

  /**
   * Create a deep copy of an existing height array
   * @param {number[][]} sourceArray - The source height array to copy
   * @returns {number[][]} Deep copy of the source array
   */
  static copyHeightArray(sourceArray) {
    try {
      if (!this.isValidHeightArray(sourceArray)) {
        throw new Error('Invalid source height array provided');
      }

      const rows = sourceArray.length;
      const cols = sourceArray[0].length;
      
      // Create deep copy
      const copiedArray = sourceArray.map(row => [...row]);

      logger.log(LOG_LEVEL.DEBUG, 'Height array copied', LOG_CATEGORY.SYSTEM, {
        context: 'TerrainHeightUtils.copyHeightArray',
        dimensions: { rows, cols }
      });

      return copiedArray;
    } catch (error) {
      logger.log(LOG_LEVEL.ERROR, 'Error copying height array', LOG_CATEGORY.SYSTEM, {
        context: 'TerrainHeightUtils.copyHeightArray',
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Validate that a height value is within acceptable bounds
   * @param {number} height - The height value to validate
   * @returns {boolean} True if height is valid
   */
  static isValidHeight(height) {
    return Number.isFinite(height) && 
           height >= TERRAIN_CONFIG.MIN_HEIGHT && 
           height <= TERRAIN_CONFIG.MAX_HEIGHT;
  }

  /**
   * Clamp a height value to the valid range
   * @param {number} height - The height value to clamp
   * @returns {number} Clamped height value
   */
  static clampHeight(height) {
    if (!Number.isFinite(height)) {
      return TERRAIN_CONFIG.DEFAULT_HEIGHT;
    }
    return Math.max(TERRAIN_CONFIG.MIN_HEIGHT, Math.min(TERRAIN_CONFIG.MAX_HEIGHT, height));
  }

  /**
   * Validate that an array is a valid height array structure
   * @param {any} array - The array to validate
   * @returns {boolean} True if array is a valid height array
   */
  static isValidHeightArray(array) {
    try {
      // Check if it's an array
      if (!Array.isArray(array)) {
        return false;
      }

      // Check if it has rows
      if (array.length === 0) {
        return false;
      }

      // Check if first row is an array
      if (!Array.isArray(array[0])) {
        return false;
      }

      const expectedCols = array[0].length;
      
      // Check if all rows have the same length and contain numbers
      for (let i = 0; i < array.length; i++) {
        const row = array[i];
        
        // Check if row is an array
        if (!Array.isArray(row)) {
          return false;
        }
        
        // Check if row has consistent length
        if (row.length !== expectedCols) {
          return false;
        }
        
        // Check if all values in row are finite numbers
        for (let j = 0; j < row.length; j++) {
          if (!Number.isFinite(row[j])) {
            return false;
          }
        }
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Calculate elevation offset for visual positioning
   * @param {number} height - The terrain height
   * @returns {number} Y-offset for visual elevation effect
   */
  static calculateElevationOffset(height) {
    if (!Number.isFinite(height)) {
      return 0;
    }
    
    // Positive heights: move UP (negative Y offset) to appear elevated
    // Negative heights: move DOWN (positive Y offset) to appear as depressions
    // Height 0: no offset (base reference level)
    const unit = this.getElevationUnit();
    return -height * unit;
  }

  /**
   * Get height difference between two positions
   * @param {number[][]} heightArray - The height array
   * @param {number} x1 - First position X coordinate
   * @param {number} y1 - First position Y coordinate
   * @param {number} x2 - Second position X coordinate
   * @param {number} y2 - Second position Y coordinate
   * @returns {number} Height difference (height2 - height1)
   */
  static getHeightDifference(heightArray, x1, y1, x2, y2) {
    try {
      if (!this.isValidHeightArray(heightArray)) {
        throw new Error('Invalid height array');
      }

      const rows = heightArray.length;
      const cols = heightArray[0].length;

      // Validate coordinates
      if (!this.isValidCoordinate(x1, y1, cols, rows) || 
          !this.isValidCoordinate(x2, y2, cols, rows)) {
        throw new Error('Invalid coordinates');
      }

      const height1 = heightArray[y1][x1];
      const height2 = heightArray[y2][x2];

      return height2 - height1;
    } catch (error) {
      logger.log(LOG_LEVEL.ERROR, 'Error calculating height difference', LOG_CATEGORY.SYSTEM, {
        context: 'TerrainHeightUtils.getHeightDifference',
        error: error.message,
        coordinates: { x1, y1, x2, y2 }
      });
      return 0;
    }
  }

  /**
   * Validate that coordinates are within array bounds
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   * @param {number} maxX - Maximum X value (exclusive)
   * @param {number} maxY - Maximum Y value (exclusive)
   * @returns {boolean} True if coordinates are valid
   */
  static isValidCoordinate(x, y, maxX, maxY) {
    return Number.isInteger(x) && Number.isInteger(y) &&
           x >= 0 && x < maxX &&
           y >= 0 && y < maxY;
  }

  /**
   * Get safe height value from array with bounds checking
   * @param {number[][]} heightArray - The height array
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   * @param {number} defaultValue - Default value if coordinates are invalid
   * @returns {number} Height value or default
   */
  static getSafeHeight(heightArray, x, y, defaultValue = TERRAIN_CONFIG.DEFAULT_HEIGHT) {
    try {
      if (!this.isValidHeightArray(heightArray)) {
        return defaultValue;
      }

      const rows = heightArray.length;
      const cols = heightArray[0].length;

      if (!this.isValidCoordinate(x, y, cols, rows)) {
        return defaultValue;
      }

      const height = heightArray[y][x];
      return Number.isFinite(height) ? height : defaultValue;
    } catch (error) {
      return defaultValue;
    }
  }

  /**
   * Set height value in array with bounds checking and validation
   * @param {number[][]} heightArray - The height array to modify
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   * @param {number} height - New height value
   * @returns {boolean} True if height was set successfully
   */
  static setSafeHeight(heightArray, x, y, height) {
    try {
      if (!this.isValidHeightArray(heightArray)) {
        return false;
      }

      const rows = heightArray.length;
      const cols = heightArray[0].length;

      if (!this.isValidCoordinate(x, y, cols, rows)) {
        return false;
      }

      if (!Number.isFinite(height)) {
        return false;
      }

      // Clamp height to valid range
      const clampedHeight = this.clampHeight(height);
      heightArray[y][x] = clampedHeight;

      return true;
    } catch (error) {
      logger.log(LOG_LEVEL.ERROR, 'Error setting height', LOG_CATEGORY.SYSTEM, {
        context: 'TerrainHeightUtils.setSafeHeight',
        error: error.message,
        coordinates: { x, y },
        requestedHeight: height
      });
      return false;
    }
  }

  /**
   * Calculate height statistics for an area
   * @param {number[][]} heightArray - The height array
   * @param {number} startX - Start X coordinate
   * @param {number} startY - Start Y coordinate
   * @param {number} endX - End X coordinate (inclusive)
   * @param {number} endY - End Y coordinate (inclusive)
   * @returns {Object} Statistics object with min, max, average, and count
   */
  static calculateAreaStats(heightArray, startX, startY, endX, endY) {
    const stats = {
      min: Infinity,
      max: -Infinity,
      average: 0,
      count: 0,
      valid: false
    };

    try {
      if (!this.isValidHeightArray(heightArray)) {
        return stats;
      }

      const rows = heightArray.length;
      const cols = heightArray[0].length;

      // Ensure coordinates are within bounds and properly ordered
      startX = Math.max(0, Math.min(startX, cols - 1));
      startY = Math.max(0, Math.min(startY, rows - 1));
      endX = Math.max(startX, Math.min(endX, cols - 1));
      endY = Math.max(startY, Math.min(endY, rows - 1));

      let sum = 0;
      let count = 0;

      for (let y = startY; y <= endY; y++) {
        for (let x = startX; x <= endX; x++) {
          const height = heightArray[y][x];
          if (Number.isFinite(height)) {
            stats.min = Math.min(stats.min, height);
            stats.max = Math.max(stats.max, height);
            sum += height;
            count++;
          }
        }
      }

      if (count > 0) {
        stats.average = sum / count;
        stats.count = count;
        stats.valid = true;
      }

      return stats;
    } catch (error) {
      logger.log(LOG_LEVEL.ERROR, 'Error calculating area stats', LOG_CATEGORY.SYSTEM, {
        context: 'TerrainHeightUtils.calculateAreaStats',
        error: error.message,
        area: { startX, startY, endX, endY }
      });
      return stats;
    }
  }

  /**
   * Reset an area of the height array to a specific value
   * @param {number[][]} heightArray - The height array to modify
   * @param {number} startX - Start X coordinate
   * @param {number} startY - Start Y coordinate
   * @param {number} endX - End X coordinate (inclusive)
   * @param {number} endY - End Y coordinate (inclusive)
   * @param {number} resetHeight - Height value to set
   * @returns {number} Number of cells reset
   */
  static resetArea(heightArray, startX, startY, endX, endY, resetHeight = TERRAIN_CONFIG.DEFAULT_HEIGHT) {
    try {
      if (!this.isValidHeightArray(heightArray)) {
        return 0;
      }

      const rows = heightArray.length;
      const cols = heightArray[0].length;

      // Ensure coordinates are within bounds and properly ordered
      startX = Math.max(0, Math.min(startX, cols - 1));
      startY = Math.max(0, Math.min(startY, rows - 1));
      endX = Math.max(startX, Math.min(endX, cols - 1));
      endY = Math.max(startY, Math.min(endY, rows - 1));

      // Validate and clamp reset height
      const clampedHeight = this.clampHeight(resetHeight);
      let resetCount = 0;

      for (let y = startY; y <= endY; y++) {
        for (let x = startX; x <= endX; x++) {
          heightArray[y][x] = clampedHeight;
          resetCount++;
        }
      }

      logger.log(LOG_LEVEL.DEBUG, 'Area reset completed', LOG_CATEGORY.SYSTEM, {
        context: 'TerrainHeightUtils.resetArea',
        area: { startX, startY, endX, endY },
        resetHeight: clampedHeight,
        cellsReset: resetCount
      });

      return resetCount;
    } catch (error) {
      logger.log(LOG_LEVEL.ERROR, 'Error resetting area', LOG_CATEGORY.SYSTEM, {
        context: 'TerrainHeightUtils.resetArea',
        error: error.message,
        area: { startX, startY, endX, endY }
      });
      return 0;
    }
  }
}
