import * as three from 'three';
import GameManager from '../../../src/core/GameManager.js';
import { TerrainMeshBuilder } from '../../../src/scene/terrain/TerrainMeshBuilder.js';
import { TerrainRebuilder } from '../../../src/scene/terrain/TerrainRebuilder.js';

test('committed engine heights reach the real terrain mesh without a GPU or legacy coordinator store', () => {
  jest.useFakeTimers();
  const gm = new GameManager({ cols: 5, rows: 5 });
  const canvas = document.createElement('canvas');
  gm.threeSceneManager = {
    canvas,
    three,
    scene: new three.Scene(),
    setTerrainBrushPreview: jest.fn(),
    clearTerrainBrushPreview: jest.fn(),
  };
  gm.is3DModeActive = () => true;
  const builder = new TerrainMeshBuilder({
    tileWorldSize: 1,
    elevationUnit: 0.5,
    hardEdges: true,
  });
  gm.terrainRebuilder = new TerrainRebuilder({ gameManager: gm, builder });
  gm.terrainCoordinator.attachScene();
  try {
    const request = jest.spyOn(gm.terrainRebuilder, 'request');
    gm.terrainEngine.setHeightAt(1, 1, 4);
    expect(request).toHaveBeenCalled();
    jest.runOnlyPendingTimers();
    const mesh = gm.threeSceneManager.scene.getObjectByName('TerrainMesh');
    expect(mesh).toBeDefined();
    const positions = mesh.geometry.getAttribute('position');
    const heights = Array.from({ length: positions.count }, (_, index) => positions.getY(index));
    expect(Math.max(...heights)).toBe(2);
    gm.terrainEngine.undo();
    jest.runOnlyPendingTimers();
    const restored = mesh.geometry.getAttribute('position');
    expect(
      Array.from({ length: restored.count }, (_, index) => restored.getY(index)).every(
        (height) => height === 0
      )
    ).toBe(true);
  } finally {
    gm.terrainCoordinator.dispose();
    jest.useRealTimers();
  }
});
