/**
 * CoordinateUtils.js - Utility functions for coordinate transformations
 * 
 * Provides isometric coordinate conversion utilities extracted from GameManager
 * Following the single responsibility principle and separation of concerns
 */

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
    // Apply -0.5 offset to both coordinates for center positioning
    const offsetGridX = gridX - 0.5;
    const offsetGridY = gridY - 0.5;
    
    // Convert to isometric coordinates
    const x = (offsetGridX - offsetGridY) * (tileWidth / 2) + (tileWidth / 2);
    const y = (offsetGridX + offsetGridY) * (tileHeight / 2) + (tileHeight / 2);
    
    return { x, y };
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
    // Account for tile centering offset - subtract half tile dimensions
    const adjustedX = x - (tileWidth / 2);
    const adjustedY = y - (tileHeight / 2);
    
    // Convert back to grid coordinates using adjusted coordinates  
    const gridX = Math.round((adjustedX / (tileWidth / 2) + adjustedY / (tileHeight / 2)) / 2);
    const gridY = Math.round((adjustedY / (tileHeight / 2) - adjustedX / (tileWidth / 2)) / 2);
    
    return { gridX, gridY };
  }
  
  /**
   * Convert screen coordinates to local container coordinates
   * @param {number} clientX - Mouse client X position
   * @param {number} clientY - Mouse client Y position
   * @param {PIXI.Container} container - PIXI container
   * @param {HTMLElement} canvasElement - Canvas DOM element
   * @returns {Object} Object with localX, localY coordinates
   */
  static screenToLocal(clientX, clientY, container, canvasElement) {
    const rect = canvasElement.getBoundingClientRect();
    const mouseX = clientX - rect.left;
    const mouseY = clientY - rect.top;
    
    // Account for container position and scale
    const localX = (mouseX - container.x) / container.scale.x;
    const localY = (mouseY - container.y) / container.scale.y;
    
    return { localX, localY };
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
    const clampedX = Math.max(0, Math.min(maxCols - 1, gridX));
    const clampedY = Math.max(0, Math.min(maxRows - 1, gridY));
    
    return { gridX: clampedX, gridY: clampedY };
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
    return gridX >= 0 && gridX < maxCols && gridY >= 0 && gridY < maxRows;
  }
  
  /**
   * Calculate distance between two grid positions
   * @param {number} x1 - First position X
   * @param {number} y1 - First position Y
   * @param {number} x2 - Second position X
   * @param {number} y2 - Second position Y
   * @returns {number} Distance between positions
   */
  static gridDistance(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
  }
}
