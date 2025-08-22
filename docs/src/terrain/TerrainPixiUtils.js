
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
                cleanupSuccess = cleanupSuccess && facesRemoved;
            }

            // Clean up overlays
            if (tile.overlay) {
                const overlayRemoved = this.safeRemoveFromContainer(tile.overlay, container, `${context}.overlayCleanup`);
                cleanupSuccess = cleanupSuccess && overlayRemoved;
            }

            // Destroy the tile itself
            const tileDestroyed = this.safeDestroyPixiObject(tile, `${context}.tileDestroy`);
            cleanupSuccess = cleanupSuccess && tileDestroyed;

            return cleanupSuccess;
        } catch (error) {
            logger.log(LOG_LEVEL.WARN, 'Error cleaning up terrain tile', LOG_CATEGORY.SYSTEM, {
                context,
                error: error.message,
                tileKey
            });
            return false;
        }
    }
}
