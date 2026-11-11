import * as three from 'three';
import CombatSession from '../../src/entities/characters/CombatSession.js';
import { TokenManager } from '../../src/managers/TokenManager.js';
import { Token3DAdapter } from '../../src/scene/Token3DAdapter.js';
import { TerrainEngine } from '../../src/terrain/TerrainEngine.js';
import { sceneState } from './sceneState.js';

export function createCampaignBoard(library) {
  let camera = sceneState().camera;
  const frames = new Set();
  const gm = {
    cols: 5,
    rows: 5,
    __threeTestDouble: three,
    terrainEngine: new TerrainEngine(5, 5),
    is3DModeActive: () => true,
    threeSceneManager: {
      scene: new three.Scene(),
      three,
      addAnimationCallback: (callback) => frames.add(callback),
      removeAnimationCallback: (callback) => frames.delete(callback),
      snapshotView: () => camera,
      restoreView: (view) => {
        camera = JSON.parse(JSON.stringify(view));
      },
    },
    stateCoordinator: { setViewMode: () => {} },
    spatial: {
      tileWorldSize: 1,
      elevationUnit: 0.3,
      gridToWorld(x, z, level = 0) {
        return {
          x: x * this.tileWorldSize,
          y: level * this.elevationUnit,
          z: z * this.tileWorldSize,
        };
      },
      worldToGrid(x, z) {
        return {
          gridX: Math.floor(x / this.tileWorldSize),
          gridY: Math.floor(z / this.tileWorldSize),
        };
      },
    },
    ensureInstancing: () => null,
  };
  gm.getTerrainHeight = (x, y) => gm.terrainEngine.getHeightAt(x, y);
  gm.resizeGrid = (cols, rows) => {
    gm.cols = cols;
    gm.rows = rows;
    gm.terrainEngine.resize(cols, rows);
  };
  gm.tokenManager = new TokenManager(gm);
  Object.defineProperty(gm, 'placedTokens', { get: () => gm.tokenManager.placedTokens });
  gm.token3DAdapter = new Token3DAdapter(gm);
  gm.notifyTerrainHeightsChanged = () => gm.token3DAdapter.resyncHeights();
  gm.characterServices = { library, combat: new CombatSession({ library }) };
  gm.advanceFrame = (delta = 0) => {
    for (const callback of frames) callback(delta);
  };
  return gm;
}
