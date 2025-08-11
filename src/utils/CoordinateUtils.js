/**
 * CoordinateUtils.js - Utility functions for coordinate transformations
 * 
 * Provides isometric coordinate conversion utilities extracted from GameManager
 * Following the single responsibility principle and separation of concerns
 * 
 * Features:
 * - Coordinate transformation between grid and isometric space
 * - Input validation and error handling with structured logging
 * - Boundary checking and coordinate clamping
 * - Performance monitoring for coordinate operations
 * 
 * @author TavernTable Development Team
 * @version 2.0.0
 */

import { logger, LOG_CATEGORY } from './Logger.js';
import { ErrorHandler, ERROR_SEVERITY, ERROR_CATEGORY } from './ErrorHandler.js';

/**
 * Coordinate transformation utilities for isometric grid systems
 */
export class CoordinateUtils {
  
  /**
   * Convert grid coordinates to isometric pixel coordinates
   * @param {number} gridX - Grid X coordinate
   * @param {number} gridY - Grid Y coordinate
   * @param {number} tileWidth - Width of tile in pixels
   * @param {number} tileHeight - Height of tile in pixels
   * @returns {Object} Object with x, y pixel coordinates
   */
  static gridToIsometric(gridX, gridY, tileWidth, tileHeight) {
    try {
      if (!Number.isFinite(gridX) || !Number.isFinite(gridY)) {
        throw new Error(`Invalid grid coordinates: gridX=${gridX}, gridY=${gridY}`);
      }
      if (!Number.isFinite(tileWidth) || tileWidth <= 0 || !Number.isFinite(tileHeight) || tileHeight <= 0) {
        throw new Error(`Invalid tile dimensions: width=${tileWidth}, height=${tileHeight}`);
      }
      // Restore -0.5 offset for center positioning
      const offsetGridX = gridX - 0.5;
      const offsetGridY = gridY - 0.5;
      const x = (offsetGridX - offsetGridY) * (tileWidth / 2) + (tileWidth / 2);
      const y = (offsetGridX + offsetGridY) * (tileHeight / 2) + (tileHeight / 2);
      return { x, y };
    } catch (error) {
      const errorHandler = new ErrorHandler();
      errorHandler.handle(error, ERROR_SEVERITY.ERROR, ERROR_CATEGORY.COORDINATE, {
        operation: 'gridToIsometric',
        input: { gridX, gridY, tileWidth, tileHeight }
      });
      throw error;
    }
  }
  
  /**
   * Convert isometric pixel coordinates to grid coordinates
   * @param {number} x - Pixel X coordinate (relative to grid container)
   * @param {number} y - Pixel Y coordinate (relative to grid container)
   * @param {number} tileWidth - Width of tile in pixels
   * @param {number} tileHeight - Height of tile in pixels
   * @returns {Object} Object with gridX, gridY coordinates
   */
  static isometricToGrid(x, y, tileWidth, tileHeight) {
    try {
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error(`Invalid pixel coordinates: x=${x}, y=${y}`);
      }
      if (!Number.isFinite(tileWidth) || tileWidth <= 0 || !Number.isFinite(tileHeight) || tileHeight <= 0) {
        throw new Error(`Invalid tile dimensions: width=${tileWidth}, height=${tileHeight}`);
      }
      // Subtract half tile dimensions for centering
      const adjustedX = x - (tileWidth / 2);
      const adjustedY = y - (tileHeight / 2);
      // Reverse the -0.5 offset
      const gridX = ((adjustedX / (tileWidth / 2) + adjustedY / (tileHeight / 2)) / 2) + 0.5;
      const gridY = ((adjustedY / (tileHeight / 2) - adjustedX / (tileWidth / 2)) / 2) + 0.5;
      return { gridX: Math.round(gridX), gridY: Math.round(gridY) };
    } catch (error) {
      const errorHandler = new ErrorHandler();
      errorHandler.handle(error, ERROR_SEVERITY.ERROR, ERROR_CATEGORY.COORDINATE, {
        operation: 'isometricToGrid',
        input: { x, y, tileWidth, tileHeight }
      });
      throw error;
    }
  }
  // Static test utility for round-trip validation
  static testRoundTrip(gridX, gridY, tileWidth, tileHeight) {
    const iso = CoordinateUtils.gridToIsometric(gridX, gridY, tileWidth, tileHeight);
    const grid = CoordinateUtils.isometricToGrid(iso.x, iso.y, tileWidth, tileHeight);
    return { input: { gridX, gridY }, iso, grid };
  }
  
  /**
   * Clamp grid coordinates to valid bounds
   * @param {number} gridX - Grid X coordinate
   * @param {number} gridY - Grid Y coordinate
   * @param {number} maxCols - Maximum columns
   * @param {number} maxRows - Maximum rows
   * @returns {Object} Object with clamped gridX, gridY coordinates
   */
  static clampToGrid(gridX, gridY, maxCols, maxRows) {
    try {
      // Validate input parameters
      if (!Number.isFinite(gridX) || !Number.isFinite(gridY)) {
        throw new Error(`Invalid grid coordinates: gridX=${gridX}, gridY=${gridY}`);
      }
      
      if (!Number.isInteger(maxCols) || maxCols <= 0 || !Number.isInteger(maxRows) || maxRows <= 0) {
        throw new Error(`Invalid grid bounds: maxCols=${maxCols}, maxRows=${maxRows}`);
      }

      logger.trace('Clamping coordinates to grid bounds', {
        input: { gridX, gridY, maxCols, maxRows }
      }, LOG_CATEGORY.SYSTEM);

      const clampedX = Math.max(0, Math.min(maxCols - 1, gridX));
      const clampedY = Math.max(0, Math.min(maxRows - 1, gridY));
      
      const result = { gridX: clampedX, gridY: clampedY };
      
      if (clampedX !== gridX || clampedY !== gridY) {
        logger.debug('Coordinates clamped to grid bounds', {
          original: { gridX, gridY },
          clamped: result,
          bounds: { maxCols, maxRows }
        }, LOG_CATEGORY.SYSTEM);
      }

      return result;
    } catch (error) {
      const errorHandler = new ErrorHandler();
      errorHandler.handle(error, ERROR_SEVERITY.WARNING, ERROR_CATEGORY.COORDINATE, {
        operation: 'clampToGrid',
        input: { gridX, gridY, maxCols, maxRows }
      });
      // Return safe default coordinates
      return { gridX: 0, gridY: 0 };
    }
  }
  
  /**
   * Check if grid coordinates are within valid bounds
   * @param {number} gridX - Grid X coordinate
   * @param {number} gridY - Grid Y coordinate
   * @param {number} maxCols - Maximum columns
   * @param {number} maxRows - Maximum rows
   * @returns {boolean} True if coordinates are valid
   */
  static isValidGridPosition(gridX, gridY, maxCols, maxRows) {
    try {
      // Validate input parameters
      if (!Number.isFinite(gridX) || !Number.isFinite(gridY)) {
        logger.debug('Invalid grid coordinates for bounds check', {
          gridX, gridY, maxCols, maxRows
        }, LOG_CATEGORY.SYSTEM);
        return false;
      }
      
      if (!Number.isInteger(maxCols) || maxCols <= 0 || !Number.isInteger(maxRows) || maxRows <= 0) {
        logger.debug('Invalid grid bounds for position check', {
          gridX, gridY, maxCols, maxRows
        }, LOG_CATEGORY.SYSTEM);
        return false;
      }

      const isValid = gridX >= 0 && gridX < maxCols && gridY >= 0 && gridY < maxRows;
      
      logger.trace('Grid position validation completed', {
        coordinates: { gridX, gridY },
        bounds: { maxCols, maxRows },
        isValid
      }, LOG_CATEGORY.SYSTEM);

      return isValid;
    } catch (error) {
      const errorHandler = new ErrorHandler();
      errorHandler.handle(error, ERROR_SEVERITY.WARNING, ERROR_CATEGORY.COORDINATE, {
        operation: 'isValidGridPosition',
        input: { gridX, gridY, maxCols, maxRows }
      });
      return false;
    }
  }
}
