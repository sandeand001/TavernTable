import { reprojectAll } from '../../src/utils/ProjectionUtils.js';

// Minimal game manager + token sprite stubs
function makeGameManager() {
  return {
    cols: 10,
    rows: 10,
    tileWidth: 64,
    tileHeight: 32,
    gridScale: 1,
    gridContainer: {
      children: [],
      addChild() {},
      sortChildren() {},
      x: 0,
      y: 0,
      scale: { set() {} },
    },
    placedTokens: [],
    renderCoordinator: { centerGrid() {} },
  };
}

function makeToken(gridX, gridY, elevationOffset = 20) {
  const sprite = { x: 0, y: 0 };
  const token = {
    gridX,
    gridY,
    footprint: { w: 1, h: 1 },
    creature: { sprite },
  };
  // Simulate initial iso projection
  sprite.x = (gridX - gridY) * (64 / 2);
  sprite.y = (gridX + gridY) * (32 / 2) - elevationOffset; // elevated above baseline
  sprite.baseIsoY = (gridX + gridY) * (32 / 2); // baseline without elevation
  return token;
}

describe('ProjectionTokensElevation', () => {
  test('token elevation offset and absolute iso Y preserved across projection cycles', () => {
    const gm = makeGameManager();
    const token = makeToken(3, 4, 30);
    gm.placedTokens.push(token);

    const originalIsoY = token.creature.sprite.y;
    const baselineIsoY = token.creature.sprite.baseIsoY;
    const originalOffset = originalIsoY - baselineIsoY;

    reprojectAll(gm, 'topdown');
    expect(typeof token.creature.sprite.y).toBe('number');

    reprojectAll(gm, 'isometric');
    const restoredIsoY = token.creature.sprite.y;
    expect(restoredIsoY - token.creature.sprite.baseIsoY).toBe(originalOffset);
    expect(Math.abs(restoredIsoY - originalIsoY)).toBeLessThan(0.0001);
  });
});
