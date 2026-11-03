import { TerrainInputHandlers } from './terrain-coordinator/TerrainInputHandlers.js';
import { TerrainEngineSceneAdapter } from '../scene/terrain/TerrainEngineSceneAdapter.js';

export class TerrainCoordinator {
  constructor(gameManager) {
    if (!gameManager?.terrainEngine) {
      throw new Error('Terrain wiring requires the authoritative terrain engine');
    }
    this.gameManager = gameManager;
    this.input = new TerrainInputHandlers(gameManager);
    this.scene = null;
    this._unsubscribe = gameManager.terrainEngine.onResized(({ cols, rows }) => {
      gameManager.stateCoordinator.updateGridDimensions(cols, rows);
    });
  }

  initialize() {
    this.input.setup();
  }

  attachScene() {
    this.detachScene();
    const gm = this.gameManager;
    this.input.setup();
    this.scene = new TerrainEngineSceneAdapter({
      engine: gm.terrainEngine,
      gameManager: gm,
      threeSceneManager: gm.threeSceneManager,
    });
    this.scene.attach();
  }

  detachScene() {
    this.scene?.detach();
    this.scene = null;
  }

  dispose() {
    this.detachScene();
    this.input.dispose();
    this._unsubscribe();
  }
}
