import { logger, LOG_CATEGORY } from '../../../utils/Logger.js';
import { TerrainPixiUtils } from '../../../utils/TerrainPixiUtils.js';

/**
 * Prepare base grid tiles for editing overlay: reset elevation visuals and remove faces/shadows.
 * Mirrors TerrainCoordinator._prepareBaseGridForEditing
 */
export function prepareBaseGridForEditing(c) {
  try {
    // Ensure any biome canvas is cleared and base tiles restored when entering terrain mode
    try {
      if (c._biomeCanvas) {
        c._biomeCanvas.clear(() => c._toggleBaseTileVisibility(true));
      }
    } catch (_) {
      /* ignore */
    }

    if (c.gameManager?.gridContainer?.children) {
      c.gameManager.gridContainer.children.forEach((child) => {
        if (child && child.isGridTile) {
          // Reset tile Y to baseline to avoid double elevation with overlay
          if (typeof child.baseIsoY === 'number') {
            child.y = child.baseIsoY;
          }

          // Remove any existing shadow tiles
          if (child.shadowTile && child.parent?.children?.includes(child.shadowTile)) {
            child.parent.removeChild(child.shadowTile);
            if (typeof child.shadowTile.destroy === 'function' && !child.shadowTile.destroyed) {
              child.shadowTile.destroy();
            }
            child.shadowTile = null;
          }

          // Remove any depression overlays mistakenly attached to base tiles
          if (child.depressionOverlay) {
            try {
              if (child.children?.includes(child.depressionOverlay)) {
                child.removeChild(child.depressionOverlay);
              }
              if (
                typeof child.depressionOverlay.destroy === 'function' &&
                !child.depressionOverlay.destroyed
              ) {
                child.depressionOverlay.destroy();
              }
            } catch (_) {
              /* best-effort */
            }
            child.depressionOverlay = null;
          }

          // Remove any existing base 3D faces
          if (child.baseSideFaces && child.parent?.children?.includes(child.baseSideFaces)) {
            child.parent.removeChild(child.baseSideFaces);
            if (
              typeof child.baseSideFaces.destroy === 'function' &&
              !child.baseSideFaces.destroyed
            ) {
              child.baseSideFaces.destroy();
            }
            child.baseSideFaces = null;
          }

          // Remove any overlay side faces accidentally lingering on base tiles
          if (child.sideFaces && child.parent?.children?.includes(child.sideFaces)) {
            child.parent.removeChild(child.sideFaces);
            if (typeof child.sideFaces.destroy === 'function' && !child.sideFaces.destroyed) {
              child.sideFaces.destroy();
            }
            child.sideFaces = null;
          }

          // Remove any rich shading layers (paintLayer/mask) attached to base tiles
          if (child.paintLayer) {
            try {
              child.removeChild(child.paintLayer);
            } catch (_) {
              /* ignore remove error */
            }
            if (typeof child.paintLayer.destroy === 'function' && !child.paintLayer.destroyed) {
              child.paintLayer.destroy({ children: true });
            }
            child.paintLayer = null;
          }
          if (child.paintMask) {
            try {
              child.removeChild(child.paintMask);
            } catch (_) {
              /* ignore remove error */
            }
            if (typeof child.paintMask.destroy === 'function' && !child.paintMask.destroyed) {
              child.paintMask.destroy();
            }
            child.paintMask = null;
          }
        }
      });
    }
  } catch (error) {
    logger.debug(
      'Error preparing base grid for editing',
      {
        context: 'container.prepareBaseGridForEditing',
        error: error.message,
      },
      LOG_CATEGORY.RENDERING
    );
  }
}

/**
 * Reset terrain container safely before reuse. Mirrors _resetTerrainContainerSafely
 */
export function resetTerrainContainerSafely(c) {
  if (c.terrainManager?.terrainContainer) {
    logger.debug(
      'Resetting terrain container for safe reuse',
      {
        context: 'container.resetTerrainContainerSafely',
        containerChildrenBefore: c.terrainManager.terrainContainer.children.length,
        tilesMapSizeBefore: c.terrainManager.terrainTiles.size,
      },
      LOG_CATEGORY.SYSTEM
    );

    try {
      // Preserve existing placeable sprites so they are not destroyed by a full container reset.
      // Remove them from the container temporarily and reattach after the reset.
      const preservedPlaceables = [];
      try {
        const placeablesMap = c.terrainManager.placeables;
        if (placeablesMap && placeablesMap.size) {
          for (const [, arr] of placeablesMap) {
            for (const sprite of arr) {
              try {
                // Remove from container without destroying so resetContainer won't touch it
                if (sprite && sprite.parent === c.terrainManager.terrainContainer) {
                  c.terrainManager.terrainContainer.removeChild(sprite);
                }
                preservedPlaceables.push(sprite);
              } catch (_) {
                /* best-effort */
              }
            }
          }
        }
      } catch (_) {
        /* best-effort preserve */
      }

      TerrainPixiUtils.resetContainer(
        c.terrainManager.terrainContainer,
        'terrainContainer',
        'container.reset'
      );
      // Rebuild placeables map and reattach preserved sprites
      try {
        c.terrainManager.placeables = new Map();
        for (const sprite of preservedPlaceables) {
          try {
            if (!sprite) continue;
            // Ensure container still exists
            if (
              c.terrainManager.terrainContainer &&
              !c.terrainManager.terrainContainer.children.includes(sprite)
            ) {
              c.terrainManager.terrainContainer.addChild(sprite);
            }
            const key = `${sprite.gridX},${sprite.gridY}`;
            if (!c.terrainManager.placeables.has(key)) c.terrainManager.placeables.set(key, []);
            c.terrainManager.placeables.get(key).push(sprite);
          } catch (_) {
            /* continue */
          }
        }
      } catch (_) {
        /* best-effort rebuild */
      }
    } catch (containerError) {
      logger.warn('Error during container reset, continuing', {
        context: 'container.resetTerrainContainerSafely',
        error: containerError.message,
      });
    }

    // Clear manager state
    c.terrainManager.terrainTiles.clear();
    c.terrainManager.updateQueue.clear();
    c.terrainManager.isUpdating = false;
  }
}

/**
 * Ensure terrain overlay container and grid container are in a valid state.
 * Mirrors _validateContainerIntegrity
 */
export function validateContainerIntegrity(c) {
  if (c.gameManager.gridContainer?.destroyed) {
    throw new Error('Grid container corrupted - requires application reload');
  }

  if (c.terrainManager?.terrainContainer?.destroyed) {
    logger.warn('Terrain container was destroyed, recreating', {
      context: 'container.validateContainerIntegrity',
    });
    // Recreate terrain container
    c.terrainManager.terrainContainer = new PIXI.Container();
    c.gameManager.gridContainer.addChild(c.terrainManager.terrainContainer);
  }

  // Ensure terrain overlay container is on top of base tiles
  try {
    const parent = c.gameManager.gridContainer;
    const overlay = c.terrainManager?.terrainContainer;
    if (parent && overlay && parent.children?.length) {
      const topIndex = parent.children.length - 1;
      if (typeof parent.setChildIndex === 'function') {
        parent.setChildIndex(overlay, topIndex);
      } else {
        // Fallback: remove and re-add to bring to front
        if (parent.children.includes(overlay)) {
          parent.removeChild(overlay);
        }
        parent.addChild(overlay);
      }
    }
  } catch (zErr) {
    logger.warn(
      'Failed to raise terrain overlay container to top',
      {
        context: 'container.validateContainerIntegrity',
        error: zErr.message,
      },
      LOG_CATEGORY.RENDERING
    );
  }
}
