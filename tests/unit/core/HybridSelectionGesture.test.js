import { enableHybridRender } from '../../../src/core/game-manager/internals/init.js';

jest.mock('../../../src/scene/Token3DAdapter.js', () => ({
  Token3DAdapter: jest.fn(function () {
    this.attach = jest.fn();
    this.setHoverToken = jest.fn();
    this.setSelectedToken = jest.fn(async () => {});
  }),
}));

const settle = async () => {
  for (let count = 0; count < 20; count++) await Promise.resolve();
};

test('an asynchronous sprite pick completing after pointer-up cannot start mouse-following placement', async () => {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  let finishPick;
  const picking = new Promise((resolve) => {
    finishPick = resolve;
  });
  const token = { id: 'existing', gridX: 2, gridY: 2 };
  const gm = {
    renderMode: '2d',
    cols: 5,
    rows: 5,
    is3DModeActive() {
      return this.renderMode === '3d';
    },
    spatial: { gridToWorld: (x, z) => ({ x, y: 0, z }), tileWorldSize: 1, elevationUnit: 0.3 },
    threeSceneManager: { degraded: false, canvas, scene: {}, setLegacyGridVisible: jest.fn() },
    terrainRebuilder: { rebuild: jest.fn() },
    terrainCoordinator: { attachScene: jest.fn() },
    pickingService: { pickGround: jest.fn(() => picking) },
    features: { instancedPlaceables: false },
    startTokenDragByGrid: jest.fn(),
    commitTokenDrag: jest.fn(),
    updateTokenDragToGrid: jest.fn(),
  };
  try {
    await enableHybridRender(gm);
    canvas.dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true }));
    canvas.dispatchEvent(new MouseEvent('pointerup', { button: 0, bubbles: true }));
    finishPick({ token });
    await settle();
    expect(gm.startTokenDragByGrid).not.toHaveBeenCalled();
    expect(gm._draggingToken).toBeUndefined();
  } finally {
    canvas.remove();
    delete window.requestTerrain3DRebuild;
  }
});
