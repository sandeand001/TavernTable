// GameManager token drag interaction tests (3D hybrid drag-to-move)

import { GameManager } from '../../src/core/GameManager.js';

function buildHybridGMWithToken() {
  const gm = new GameManager({ cols: 20, rows: 20 });
  gm.renderMode = '3d-hybrid';
  // Minimal spatial + height logic
  gm.spatial = {
    elevationUnit: 0.5,
    gridToWorld: (gx, gy) => ({ x: gx, y: 0, z: gy }),
  };
  gm.getTerrainHeight = () => 0;
  gm.threeSceneManager = { scene: {}, isReady: () => true };
  // Seed one token at (5,5)
  const token = {
    id: 't1',
    gridX: 5,
    gridY: 5,
    __threeMesh: {
      position: {
        set(x, y, z) {
          this.x = x;
          this.y = y;
          this.z = z;
        },
      },
    },
  };
  gm.tokenManager = {
    getPlacedTokens: () => [token],
  };
  gm.findExistingTokenAt = (gx, gy) => (gx === token.gridX && gy === token.gridY ? token : null);
  return { gm, token };
}

describe('GameManager token drag', () => {
  test('startTokenDragByGrid returns false if token not found', () => {
    const { gm } = buildHybridGMWithToken();
    expect(gm.startTokenDragByGrid(99, 99)).toBe(false);
  });

  test('successful drag start captures token and metrics', () => {
    const { gm } = buildHybridGMWithToken();
    const ok = gm.startTokenDragByGrid(5, 5);
    expect(ok).toBe(true);
    expect(gm._draggingToken).toBeTruthy();
    expect(gm._dragStart).toEqual({ gx: 5, gy: 5 });
    expect(window.__TT_METRICS__.interaction.dragActive).toBe(true);
  });

  test('updateTokenDragToGrid adjusts mesh position preview', () => {
    const { gm, token } = buildHybridGMWithToken();
    gm.startTokenDragByGrid(5, 5);
    const before = { x: token.__threeMesh.position.x, z: token.__threeMesh.position.z };
    gm.updateTokenDragToGrid(7, 4);
    expect(token.__threeMesh.position.x).not.toBe(before.x);
    expect(token.__threeMesh.position.z).not.toBe(before.z);
    expect(gm._dragLastPreview).toEqual({ gx: 7, gy: 4 });
  });

  test('commitTokenDrag applies new grid coordinates & metrics', () => {
    const { gm, token } = buildHybridGMWithToken();
    gm.startTokenDragByGrid(5, 5);
    gm.updateTokenDragToGrid(8, 9);
    gm.commitTokenDrag();
    expect(token.gridX).toBe(8);
    expect(token.gridY).toBe(9);
    expect(window.__TT_METRICS__.interaction.lastTokenDragGrid).toEqual({
      from: { gx: 5, gy: 5 },
      to: { gx: 8, gy: 9 },
    });
    expect(window.__TT_METRICS__.interaction.dragActive).toBe(false);
    expect(gm._draggingToken).toBeFalsy();
  });

  test('cancelTokenDrag reverts preview and does not change logical grid', () => {
    const { gm, token } = buildHybridGMWithToken();
    gm.startTokenDragByGrid(5, 5);
    gm.updateTokenDragToGrid(10, 2);
    gm.cancelTokenDrag();
    expect(token.gridX).toBe(5);
    expect(token.gridY).toBe(5);
    expect(gm._draggingToken).toBeFalsy();
    expect(window.__TT_METRICS__.interaction.dragActive).toBe(false);
  });
});
