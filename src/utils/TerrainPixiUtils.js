/**
 * TerrainPixiUtils.js - Centralized PIXI object lifecycle management for terrain system
 * 
 * Provides consistent and safe PIXI object creation, cleanup, and container management
 * specifically for terrain tiles and their associated visual effects.
 * 
 * Eliminates code duplication in TerrainManager cleanup patterns.
 */

import { logger, LOG_LEVEL, LOG_CATEGORY } from '../utils/Logger.js';

export class TerrainPixiUtils {
  /**
   * Safely remove a child from a PIXI container with proper validation
   * @param {PIXI.DisplayObject} child - The child object to remove
   * @param {PIXI.Container} container - The container to remove from
   * @param {string} context - Context for logging/debugging
   * @returns {boolean} True if removal was successful
   */
  static safeRemoveFromContainer(child, container, context = 'TerrainPixiUtils') {
    try {
      if (!child || !container) {
        return false;
      }

      // Check if child is actually in the container
      if (container.children && container.children.includes(child)) {
        container.removeChild(child);
        return true;
      }

      return false;
    } catch (error) {
      logger.log(LOG_LEVEL.WARN, 'Error removing child from container', LOG_CATEGORY.SYSTEM, {
        context,
        error: error.message,
        hasChild: !!child,
        hasContainer: !!container
      });
      return false;
    }
  }

  /**
   * Safely destroy a PIXI object with proper validation
   * @param {PIXI.DisplayObject} pixiObject - The PIXI object to destroy
   * @param {string} context - Context for logging/debugging
   * @returns {boolean} True if destruction was successful
   */
  static safeDestroyPixiObject(pixiObject, context = 'TerrainPixiUtils') {
    try {
      if (!pixiObject) {
        return false;
      }

      // Check if object is already destroyed
      if (pixiObject.destroyed) {
        return true;
      }

      // Check if object has destroy method
      if (typeof pixiObject.destroy === 'function') {
        pixiObject.destroy();
        return true;
      }

      logger.log(LOG_LEVEL.WARN, 'PIXI object has no destroy method', LOG_CATEGORY.SYSTEM, {
        context,
        objectType: pixiObject.constructor?.name || 'unknown'
      });
      return false;
    } catch (error) {
      logger.log(LOG_LEVEL.WARN, 'Error destroying PIXI object', LOG_CATEGORY.SYSTEM, {
        context,
        error: error.message,
        objectType: pixiObject?.constructor?.name || 'unknown'
      });
      return false;
    }
  }

  /**
   * Comprehensive cleanup of a terrain tile and all its visual effects
   * @param {PIXI.Graphics} tile - The terrain tile to clean up
   * @param {PIXI.Container} container - The container holding the tile
   * @param {string} tileKey - The tile key for logging (optional)
   * @param {string} context - Context for logging/debugging
   * @returns {boolean} True if cleanup was successful
   */
  static cleanupTerrainTile(tile, container, tileKey = 'unknown', context = 'TerrainPixiUtils') {
    try {
      if (!tile) {
        return true; // Nothing to clean up
      }

      let cleanupSuccess = true;

      // Clean up sibling faces (overlay/base) that were added to the container behind the tile
      if (tile.sideFaces) {
        const facesRemoved = this.safeRemoveFromContainer(tile.sideFaces, container, `${context}.sideFacesCleanup`)
          || this.safeRemoveFromContainer(tile.sideFaces, tile.parent, `${context}.sideFacesCleanup`);
        const facesDestroyed = this.safeDestroyPixiObject(tile.sideFaces, `${context}.sideFacesCleanup`);
        tile.sideFaces = null;
        if (!facesRemoved || !facesDestroyed) {
          logger.log(LOG_LEVEL.WARN, 'Partial sideFaces cleanup', LOG_CATEGORY.SYSTEM, {
            context,
            tileKey,
            facesRemoved,
            facesDestroyed
          });
          cleanupSuccess = false;
        }
      }
      if (tile.baseSideFaces) {
        const baseFacesRemoved = this.safeRemoveFromContainer(tile.baseSideFaces, container, `${context}.baseFacesCleanup`)
          || this.safeRemoveFromContainer(tile.baseSideFaces, tile.parent, `${context}.baseFacesCleanup`);
        const baseFacesDestroyed = this.safeDestroyPixiObject(tile.baseSideFaces, `${context}.baseFacesCleanup`);
        tile.baseSideFaces = null;
        if (!baseFacesRemoved || !baseFacesDestroyed) {
          logger.log(LOG_LEVEL.WARN, 'Partial baseSideFaces cleanup', LOG_CATEGORY.SYSTEM, {
            context,
            tileKey,
            baseFacesRemoved,
            baseFacesDestroyed
          });
          cleanupSuccess = false;
        }
      }

      // Clean up shadow tile if present
      if (tile.shadowTile) {
        const shadowRemoved = this.safeRemoveFromContainer(tile.shadowTile, container, `${context}.shadowCleanup`);
        const shadowDestroyed = this.safeDestroyPixiObject(tile.shadowTile, `${context}.shadowCleanup`);
        
        if (!shadowRemoved || !shadowDestroyed) {
          logger.log(LOG_LEVEL.WARN, 'Partial shadow tile cleanup', LOG_CATEGORY.SYSTEM, {
            context,
            tileKey,
            shadowRemoved,
            shadowDestroyed
          });
          cleanupSuccess = false;
        }
      }

      // Clean up depression overlay if present
      if (tile.depressionOverlay) {
        const overlayRemoved = this.safeRemoveFromContainer(tile.depressionOverlay, tile, `${context}.overlayCleanup`);
        const overlayDestroyed = this.safeDestroyPixiObject(tile.depressionOverlay, `${context}.overlayCleanup`);
        
        if (!overlayRemoved || !overlayDestroyed) {
          logger.log(LOG_LEVEL.WARN, 'Partial depression overlay cleanup', LOG_CATEGORY.SYSTEM, {
            context,
            tileKey,
            overlayRemoved,
            overlayDestroyed
          });
          cleanupSuccess = false;
        }
      }

      // Clean up any other child effects
      if (tile.children && tile.children.length > 0) {
        const childrenCopy = [...tile.children]; // Copy to avoid modification during iteration
        for (const child of childrenCopy) {
          this.safeRemoveFromContainer(child, tile, `${context}.childCleanup`);
          this.safeDestroyPixiObject(child, `${context}.childCleanup`);
        }
      }

      // Remove and destroy the main tile
      const tileRemoved = this.safeRemoveFromContainer(tile, container, `${context}.tileCleanup`);
      const tileDestroyed = this.safeDestroyPixiObject(tile, `${context}.tileCleanup`);

      if (!tileRemoved || !tileDestroyed) {
        logger.log(LOG_LEVEL.WARN, 'Partial main tile cleanup', LOG_CATEGORY.SYSTEM, {
          context,
          tileKey,
          tileRemoved,
          tileDestroyed
        });
        cleanupSuccess = false;
      }

      if (cleanupSuccess) {
        logger.log(LOG_LEVEL.DEBUG, 'Terrain tile cleaned up successfully', LOG_CATEGORY.SYSTEM, {
          context,
          tileKey
        });
      }

      return cleanupSuccess;
    } catch (error) {
      logger.log(LOG_LEVEL.ERROR, 'Error during terrain tile cleanup', LOG_CATEGORY.SYSTEM, {
        context,
        tileKey,
        error: error.message
      });
      
      // Still try to clean up the main tile as a fallback
      try {
        this.safeRemoveFromContainer(tile, container, `${context}.fallback`);
        this.safeDestroyPixiObject(tile, `${context}.fallback`);
      } catch (fallbackError) {
        logger.log(LOG_LEVEL.ERROR, 'Fallback cleanup also failed', LOG_CATEGORY.SYSTEM, {
          context,
          tileKey,
          fallbackError: fallbackError.message
        });
      }

      return false;
    }
  }

  /**
   * Validate that a PIXI container is in a usable state
   * @param {PIXI.Container} container - The container to validate
   * @param {string} containerName - Name of the container for logging
   * @param {string} context - Context for logging/debugging
   * @returns {boolean} True if container is valid
   */
  static validatePixiContainer(container, containerName = 'container', context = 'TerrainPixiUtils') {
    try {
      if (!container) {
        logger.log(LOG_LEVEL.ERROR, `${containerName} is null or undefined`, LOG_CATEGORY.SYSTEM, {
          context
        });
        return false;
      }

      if (container.destroyed) {
        logger.log(LOG_LEVEL.ERROR, `${containerName} has been destroyed`, LOG_CATEGORY.SYSTEM, {
          context,
          containerName
        });
        return false;
      }

      if (!container.children) {
        logger.log(LOG_LEVEL.ERROR, `${containerName} has no children array`, LOG_CATEGORY.SYSTEM, {
          context,
          containerName
        });
        return false;
      }

      return true;
    } catch (error) {
      logger.log(LOG_LEVEL.ERROR, `Error validating ${containerName}`, LOG_CATEGORY.SYSTEM, {
        context,
        containerName,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Batch cleanup of multiple terrain tiles with error isolation
   * @param {Map} terrainTiles - Map of terrain tiles to clean up
   * @param {PIXI.Container} container - The container holding the tiles
   * @param {string} context - Context for logging/debugging
   * @returns {Object} Cleanup results with success/failure counts
   */
  static batchCleanupTerrainTiles(terrainTiles, container, context = 'TerrainPixiUtils') {
    const results = {
      total: 0,
      successful: 0,
      failed: 0,
      errors: []
    };

    try {
      if (!terrainTiles || terrainTiles.size === 0) {
        logger.log(LOG_LEVEL.DEBUG, 'No terrain tiles to clean up', LOG_CATEGORY.SYSTEM, { context });
        return results;
      }

      results.total = terrainTiles.size;

      terrainTiles.forEach((tile, tileKey) => {
        try {
          const success = this.cleanupTerrainTile(tile, container, tileKey, `${context}.batch`);
          if (success) {
            results.successful++;
          } else {
            results.failed++;
            results.errors.push(`Failed to cleanup tile ${tileKey}`);
          }
        } catch (tileError) {
          results.failed++;
          results.errors.push(`Error cleaning tile ${tileKey}: ${tileError.message}`);
          
          logger.log(LOG_LEVEL.ERROR, 'Individual tile cleanup failed', LOG_CATEGORY.SYSTEM, {
            context: `${context}.batch`,
            tileKey,
            error: tileError.message
          });
        }
      });

      logger.log(LOG_LEVEL.INFO, 'Batch terrain tile cleanup completed', LOG_CATEGORY.SYSTEM, {
        context,
        total: results.total,
        successful: results.successful,
        failed: results.failed
      });

      return results;
    } catch (error) {
      logger.log(LOG_LEVEL.ERROR, 'Batch cleanup process failed', LOG_CATEGORY.SYSTEM, {
        context,
        error: error.message
      });
      
      results.errors.push(`Batch process error: ${error.message}`);
      return results;
    }
  }

  /**
   * Reset a container by clearing all children safely
   * @param {PIXI.Container} container - The container to reset
   * @param {string} containerName - Name of the container for logging
   * @param {string} context - Context for logging/debugging
   * @returns {boolean} True if reset was successful
   */
  static resetContainer(container, containerName = 'container', context = 'TerrainPixiUtils') {
    try {
      if (!this.validatePixiContainer(container, containerName, context)) {
        return false;
      }

      const childCount = container.children.length;
      
      if (childCount === 0) {
        logger.log(LOG_LEVEL.DEBUG, `${containerName} is already empty`, LOG_CATEGORY.SYSTEM, { context });
        return true;
      }

      // Create a copy to avoid modification during iteration
      const children = [...container.children];
      let successfulRemovals = 0;

      for (const child of children) {
        const removed = this.safeRemoveFromContainer(child, container, `${context}.reset`);
        const destroyed = this.safeDestroyPixiObject(child, `${context}.reset`);
        
        if (removed && destroyed) {
          successfulRemovals++;
        }
      }

      const success = successfulRemovals === childCount;
      
      logger.log(LOG_LEVEL.INFO, 'Container reset completed', LOG_CATEGORY.SYSTEM, {
        context,
        containerName,
        childCount,
        successfulRemovals,
        success
      });

      return success;
    } catch (error) {
      logger.log(LOG_LEVEL.ERROR, `Error resetting ${containerName}`, LOG_CATEGORY.SYSTEM, {
        context,
        containerName,
        error: error.message
      });
      return false;
    }
  }
}
