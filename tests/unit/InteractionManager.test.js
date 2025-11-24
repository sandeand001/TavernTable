import { InteractionManager } from '../../src/managers/InteractionManager.js';

describe('InteractionManager.getGridCoordinatesFromClick', () => {
  test('prefers picking service when 3D mode active', () => {
    const gm = {
      is3DModeActive: jest.fn(() => true),
      pickingService: {
        pickGroundSync: jest.fn(() => ({ grid: { gx: 2.2, gy: 3.8 } })),
      },
    };

    const manager = new InteractionManager(gm);
    manager.isValidGridPosition = jest.fn(() => true);
    manager.getMousePosition = jest.fn(() => {
      throw new Error('2D fallback should not run when picking succeeds');
    });

    const result = manager.getGridCoordinatesFromClick({ clientX: 10, clientY: 15 });

    expect(result).toEqual({ gridX: 2, gridY: 4 });
    expect(gm.pickingService.pickGroundSync).toHaveBeenCalledWith(10, 15, null);
    expect(manager.getMousePosition).not.toHaveBeenCalled();
  });

  test('falls back to 2D conversion when picking unavailable', () => {
    const gm = {
      is3DModeActive: jest.fn(() => true),
      pickingService: {
        pickGroundSync: jest.fn(() => null),
      },
    };

    const manager = new InteractionManager(gm);
    manager.getMousePosition = jest.fn(() => ({ mouseX: 5, mouseY: 6 }));
    manager.convertToLocalCoordinates = jest.fn(() => ({ localX: 1, localY: 2 }));
    manager.pickTopmostGridCellAt = jest.fn(() => ({ gridX: 1, gridY: 2 }));
    manager.isValidGridPosition = jest.fn(() => true);

    const result = manager.getGridCoordinatesFromClick({ clientX: 20, clientY: 30 });

    expect(manager.getMousePosition).toHaveBeenCalled();
    expect(manager.convertToLocalCoordinates).toHaveBeenCalledWith({ mouseX: 5, mouseY: 6 });
    expect(manager.pickTopmostGridCellAt).toHaveBeenCalledWith(1, 2);
    expect(result).toEqual({ gridX: 1, gridY: 2 });
  });
});
