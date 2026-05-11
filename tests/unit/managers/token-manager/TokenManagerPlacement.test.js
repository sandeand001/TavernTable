import { placeNewToken } from '../../../../src/managers/token-manager/internals/placement.js';
import { CoordinateUtils } from '../../../../src/utils/coordinates/CoordinateUtils.js';
import { TerrainHeightUtils } from '../../../../src/utils/terrain/TerrainHeightUtils.js';

describe('placeNewToken', () => {
  test('creates creature, positions with elevation, and tracks in collection', () => {
    const gridX = 3,
      gridY = 2;
    const tileWidth = 64,
      tileHeight = 32;
    const height = 1;

    const c = {
      selectedTokenType: 'mannequin',
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

    placeNewToken(c, gridX, gridY, null);

    // ensure creature was created with selected type
    expect(c.createCreatureByType).toHaveBeenCalledWith('mannequin');

    // verify position and elevation applied to sprite
    const iso = CoordinateUtils.gridToIsometric(gridX, gridY, tileWidth, tileHeight);
    const elev = TerrainHeightUtils.calculateElevationOffset(height);
    const sprite = c.createCreatureByType.mock.results[0].value.sprite;
    expect(sprite.x).toBe(iso.x);
    expect(sprite.y).toBe(iso.y + elev);

    // collection tracking
    expect(c.addTokenToCollection).toHaveBeenCalled();
    const callArgs = c.addTokenToCollection.mock.calls[0];
    expect(callArgs[1]).toBe(gridX);
    expect(callArgs[2]).toBe(gridY);
  });

  test('returns early when creature creation fails', () => {
    const c = {
      selectedTokenType: 'mannequin',
      gameManager: {
        tileWidth: 64,
        tileHeight: 32,
        terrainCoordinator: { dataStore: { get: jest.fn(() => 0) } },
      },
      addTokenToCollection: jest.fn(),
      createCreatureByType: jest.fn(() => null),
    };

    placeNewToken(c, 0, 0, null);

    expect(c.addTokenToCollection).not.toHaveBeenCalled();
  });
});
