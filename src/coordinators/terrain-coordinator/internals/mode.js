import { GameErrors } from '../../../utils/ErrorHandler.js';

/** Activate terrain mode state */
export function activateTerrainMode(c) {
  c.isTerrainModeActive = true;
}

/** Load terrain state into working buffer and display overlay */
export function loadTerrainStateAndDisplay(c) {
  // Load current base terrain state into working terrain heights
  c.loadBaseTerrainIntoWorkingState();

  // Show terrain tiles for current state with clean container
  if (c.terrainManager) {
    c.terrainManager.showAllTerrainTiles();
    // Ensure preview exists and is positioned relative to overlay
    try {
      c.terrainManager.ensurePreviewLayerOnTop?.();
    } catch (_) {
      /* ignore */
    }
    // Reposition placeables and raise above preview layer
    try {
      c.terrainManager.repositionAllPlaceables?.();
    } catch (_) {
      /* ignore */
    }
    // Raise all existing tokens above preview/elevation overlay as well
    try {
      const tm = c.terrainManager;
      const parent = c.gameManager?.gridContainer;
      const previewZ = tm?.previewContainer?.zIndex;
      const overlayZ = tm?.terrainContainer?.zIndex;
      const desired = Number.isFinite(previewZ)
        ? previewZ + 1
        : Number.isFinite(overlayZ)
          ? overlayZ + 11
          : null;
      if (Number.isFinite(desired) && Array.isArray(c.gameManager?.placedTokens)) {
        for (const t of c.gameManager.placedTokens) {
          const sprite = t?.creature?.sprite;
          if (!sprite) continue;
          if (!Number.isFinite(sprite.zIndex) || sprite.zIndex < desired) {
            sprite.zIndex = desired;
          }
        }
        if (parent) {
          parent.sortableChildren = true;
          try {
            parent.sortChildren?.();
          } catch (_) {
            /* ignore */
          }
        }
      }
    } catch (_) {
      /* ignore */
    }
  }
}

/** Handle errors during terrain mode activation with enriched context, then rethrow. */
export function handleTerrainModeActivationError(c, error) {
  // Reset terrain mode state on error
  c.isTerrainModeActive = false;

  // Enhanced error information for debugging
  const errorContext = {
    stage: 'enableTerrainMode',
    context: 'TerrainCoordinator.enableTerrainMode',
    terrainManagerReady: !!c.terrainManager,
    gridContainerReady: !!c.gameManager?.gridContainer,
    gridContainerDestroyed: c.gameManager?.gridContainer?.destroyed,
    terrainContainerReady: !!c.terrainManager?.terrainContainer,
    terrainContainerDestroyed: c.terrainManager?.terrainContainer?.destroyed,
    dataStructures: {
      terrainHeights: !!c.dataStore?.working,
      baseTerrainHeights: !!c.dataStore?.base,
    },
  };

  GameErrors.gameState(error, errorContext);
  throw error;
}
