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
      baseTerrainHeights: !!c.dataStore?.base
    }
  };

  GameErrors.gameState(error, errorContext);
  throw error;
}
