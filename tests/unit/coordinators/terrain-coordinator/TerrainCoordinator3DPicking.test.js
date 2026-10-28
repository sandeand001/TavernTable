import { getGridCoordinatesFromEvent } from '../../../../src/coordinators/terrain-coordinator/internals/brush/inputs.js';

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

  test('does not turn a 3D miss into a brush target through the interaction fallback', () => {
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
    expect(fallback).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  test('uses the interaction fallback when no 3D picking service is available', () => {
    const fallback = jest.fn(() => ({ gridX: 7, gridY: 3 }));
    const event = { clientX: 10, clientY: 20 };
    const coordinator = {
      gameManager: {
        is3DModeActive: () => true,
        interactionManager: { getGridCoordinatesFromClick: fallback },
      },
    };
    expect(getGridCoordinatesFromEvent(coordinator, event)).toEqual({ gridX: 7, gridY: 3 });
    expect(fallback).toHaveBeenCalledWith(event);
  });

  test('does not clamp an invalid 3D brush target to a boundary cell', () => {
    const coordinator = {
      gameManager: {
        cols: 4,
        rows: 4,
        is3DModeActive: () => true,
        pickingService: { pickGroundSync: () => ({ grid: { gx: -2, gy: 2 } }) },
      },
      isValidGridPosition: (x, y) => x >= 0 && y >= 0 && x < 4 && y < 4,
    };
    expect(getGridCoordinatesFromEvent(coordinator, { clientX: 10, clientY: 20 })).toBeNull();
  });
});
