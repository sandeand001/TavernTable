import { getGridCoordinatesFromEvent } from '../../src/coordinators/terrain-coordinator/internals/inputs.js';

describe('TerrainCoordinator getGridCoordinatesFromEvent (3D picking)', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('uses pickGroundSync when 3D mode is active and pick succeeds', () => {
    const pickGroundSync = jest.fn().mockReturnValue({
      world: { x: 1, y: 0, z: 2 },
      grid: { gx: 4, gy: 5 },
    });
    const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }) };
    const coordinator = {
      gameManager: {
        is3DModeActive: () => true,
        pickingService: { pickGroundSync },
        threeSceneManager: { canvas },
        app: { view: {} },
      },
      isValidGridPosition: jest.fn(() => true),
    };
    const event = { clientX: 32, clientY: 64 };

    const result = getGridCoordinatesFromEvent(coordinator, event);

    expect(pickGroundSync).toHaveBeenCalledWith(32, 64, canvas);
    expect(coordinator.isValidGridPosition).toHaveBeenCalledWith(4, 5);
    expect(result).toEqual({ gridX: 4, gridY: 5 });
  });

  test('falls back to interaction manager when pickGroundSync returns null', () => {
    const pickGroundSync = jest.fn(() => null);
    const fallback = jest.fn(() => ({ gridX: 7, gridY: 3 }));
    const coordinator = {
      gameManager: {
        is3DModeActive: () => true,
        pickingService: { pickGroundSync },
        interactionManager: { getGridCoordinatesFromClick: fallback },
      },
      isValidGridPosition: jest.fn(() => true),
    };
    const event = { clientX: 10, clientY: 20 };

    const result = getGridCoordinatesFromEvent(coordinator, event);

    expect(pickGroundSync).toHaveBeenCalledWith(10, 20, null);
    expect(fallback).toHaveBeenCalledWith(event);
    expect(result).toEqual({ gridX: 7, gridY: 3 });
  });
});
