import { placeNewToken } from '../../src/managers/token-manager/internals/placement.js';
import { CoordinateUtils } from '../../src/utils/CoordinateUtils.js';
import { TerrainHeightUtils } from '../../src/utils/TerrainHeightUtils.js';

describe('placeNewToken', () => {
  test('creates creature, positions with elevation, sets zIndex, adds to container, and tracks in collection', () => {
    const gridX = 3,
      gridY = 2;
    const tileWidth = 64,
      tileHeight = 32;
    const height = 1;

    const addedChildren = [];
    const gridContainer = {
      addChild: jest.fn((child) => {
        addedChildren.push(child);
      }),
      sortChildren: jest.fn(),
    };

    // tokenManager-like context
    const c = {
      selectedTokenType: 'goblin',
      gameManager: {
        tileWidth,
        tileHeight,
        terrainCoordinator: {
          dataStore: {
            get: jest.fn(() => height),
          },
        },
      },
      addTokenToCollection: jest.fn(),
      createCreatureByType: jest.fn(() => ({ sprite: { x: 0, y: 0, zIndex: 0 } })),
    };

    placeNewToken(c, gridX, gridY, gridContainer);

    // ensure creature was created with selected type
    expect(c.createCreatureByType).toHaveBeenCalledWith('goblin');

    // verify position and elevation
    const iso = CoordinateUtils.gridToIsometric(gridX, gridY, tileWidth, tileHeight);
    const elev = TerrainHeightUtils.calculateElevationOffset(height);
    const sprite = addedChildren[0];

    expect(sprite.x).toBe(iso.x);
    expect(sprite.y).toBe(iso.y + elev);
    // depth now uses simplified band: depth*100 + 70 (token band)
    expect(sprite.zIndex).toBe((gridX + gridY) * 100 + 70);

    // container interactions
    expect(gridContainer.addChild).toHaveBeenCalledWith(sprite);
    expect(gridContainer.sortChildren).toHaveBeenCalled();

    // collection tracking
    expect(c.addTokenToCollection).toHaveBeenCalled();
    const callArgs = c.addTokenToCollection.mock.calls[0];
    expect(callArgs[1]).toBe(gridX);
    expect(callArgs[2]).toBe(gridY);
  });

  test('returns early when creature creation fails', () => {
    const c = {
      selectedTokenType: 'dragon',
      gameManager: {
        tileWidth: 64,
        tileHeight: 32,
        terrainCoordinator: { dataStore: { get: jest.fn(() => 0) } },
      },
      addTokenToCollection: jest.fn(),
      createCreatureByType: jest.fn(() => null),
    };

    const gridContainer = { addChild: jest.fn(), sortChildren: jest.fn() };

    placeNewToken(c, 0, 0, gridContainer);

    expect(c.addTokenToCollection).not.toHaveBeenCalled();
    expect(gridContainer.addChild).not.toHaveBeenCalled();
  });
});
