import { snapTokenToGrid } from '../../src/managers/token-manager/internals/positioning.js';
import { CoordinateUtils } from '../../src/utils/CoordinateUtils.js';
import { TerrainHeightUtils } from '../../src/utils/TerrainHeightUtils.js';

describe('snapTokenToGrid', () => {
  test('uses topmost picker and applies elevation offset', () => {
    const height = 2;
    const token = { x: 0, y: 0, zIndex: 0 };
    const placedEntry = { creature: { sprite: token }, gridX: 0, gridY: 0 };

    const c = {
      gameManager: {
        tileWidth: 64,
        tileHeight: 32,
        cols: 10,
        rows: 10,
        interactionManager: {
          pickTopmostGridCellAt: jest.fn(() => ({ gridX: 2, gridY: 1 })),
        },
        terrainCoordinator: {
          dataStore: {
            get: jest.fn(() => height),
          },
        },
      },
      placedTokens: [placedEntry],
    };

    const pointerLocalX = 100;
    const pointerLocalY = 80;

    snapTokenToGrid(c, token, pointerLocalX, pointerLocalY);

    const iso = CoordinateUtils.gridToIsometric(
      2,
      1,
      c.gameManager.tileWidth,
      c.gameManager.tileHeight
    );
    const elev = TerrainHeightUtils.calculateElevationOffset(height);

    expect(token.x).toBe(iso.x);
    expect(token.y).toBe(iso.y + elev);
    // simplified depth band: depth*100 + 70
    expect(token.zIndex).toBe((2 + 1) * 100 + 70);

    expect(placedEntry.gridX).toBe(2);
    expect(placedEntry.gridY).toBe(1);
    expect(c.gameManager.interactionManager.pickTopmostGridCellAt).toHaveBeenCalledWith(
      pointerLocalX,
      pointerLocalY
    );
  });

  test('falls back to coarse mapping when no picker is available', () => {
    const height = -1;
    const token = { x: 0, y: 0, zIndex: 0 };
    const placedEntry = { creature: { sprite: token }, gridX: 0, gridY: 0 };

    const c = {
      gameManager: {
        tileWidth: 64,
        tileHeight: 32,
        cols: 20,
        rows: 20,
        interactionManager: null,
        terrainCoordinator: {
          dataStore: {
            get: jest.fn(() => height),
          },
        },
      },
      placedTokens: [placedEntry],
    };

    const targetGX = 4,
      targetGY = 5;
    const point = CoordinateUtils.gridToIsometric(
      targetGX,
      targetGY,
      c.gameManager.tileWidth,
      c.gameManager.tileHeight
    );

    snapTokenToGrid(c, token, point.x, point.y);

    const iso = CoordinateUtils.gridToIsometric(
      targetGX,
      targetGY,
      c.gameManager.tileWidth,
      c.gameManager.tileHeight
    );
    const elev = TerrainHeightUtils.calculateElevationOffset(height);

    expect(token.x).toBe(iso.x);
    expect(token.y).toBe(iso.y + elev);
    // simplified depth band: depth*100 + 70
    expect(token.zIndex).toBe((targetGX + targetGY) * 100 + 70);

    expect(placedEntry.gridX).toBe(targetGX);
    expect(placedEntry.gridY).toBe(targetGY);
  });

  test('preserves existing world snapshot when world lock is active', () => {
    const token = { x: 0, y: 0, zIndex: 0 };
    const originalWorld = { x: 0.25, y: 1, z: -0.25 };
    const placedEntry = {
      creature: { sprite: token },
      gridX: 1,
      gridY: 1,
      world: { ...originalWorld },
      __ttWorldLock: 1,
    };

    const gm = {
      tileWidth: 64,
      tileHeight: 32,
      cols: 10,
      rows: 10,
      interactionManager: {
        pickTopmostGridCellAt: jest.fn(() => ({ gridX: 3, gridY: 4 })),
      },
      terrainCoordinator: {
        dataStore: {
          get: jest.fn(() => 0),
        },
      },
      spatial: {
        gridToWorld: jest.fn(() => ({ x: 3.5, y: 0.5, z: 4.5 })),
      },
    };

    snapTokenToGrid({ gameManager: gm, placedTokens: [placedEntry] }, token, 10, 20);

    expect(gm.spatial.gridToWorld).not.toHaveBeenCalled();
    expect(placedEntry.world).toEqual(originalWorld);
  });
});
