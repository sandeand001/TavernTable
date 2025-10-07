import { reprojectAll } from '../../src/utils/ProjectionUtils.js';

function makeGameManager() {
  return {
    cols: 20,
    rows: 20,
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

function makeToken(gridX, gridY) {
  const sprite = { x: 0, y: 0 };
  const token = {
    gridX,
    gridY,
    footprint: { w: 1, h: 1 },
    creature: { sprite },
  };
  sprite.x = (gridX - gridY) * (64 / 2);
  sprite.y = (gridX + gridY) * (32 / 2);
  sprite.baseIsoY = sprite.y;
  return token;
}

describe('ProjectionTokensPosition', () => {
  test('token x/y roundtrip without elevation offset', () => {
    const gm = makeGameManager();
    const token = makeToken(7, 5);
    gm.placedTokens.push(token);

    const originalX = token.creature.sprite.x;
    const originalY = token.creature.sprite.y;

    reprojectAll(gm, 'topdown');
    reprojectAll(gm, 'isometric');

    expect(token.creature.sprite.x).toBe(originalX);
    expect(token.creature.sprite.y).toBe(originalY);
  });
});
