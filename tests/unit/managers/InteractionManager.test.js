import { InteractionManager } from '../../../src/managers/InteractionManager.js';

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

  test('a real 3D miss does not fall back to legacy 2D grid conversion', () => {
    const manager = new InteractionManager({
      is3DModeActive: () => true,
      pickingService: { pickGroundSync: () => null },
    });
    manager.getMousePosition = jest.fn(() => ({ mouseX: 5, mouseY: 6 }));
    manager.convertToLocalCoordinates = jest.fn(() => ({ localX: 1, localY: 2 }));
    manager.pickTopmostGridCellAt = jest.fn(() => ({ gridX: 1, gridY: 2 }));
    manager.isValidGridPosition = jest.fn(() => true);
    expect(manager.getGridCoordinatesFromClick({ clientX: 20, clientY: 30 })).toBeNull();
    expect(manager.getMousePosition).not.toHaveBeenCalled();
  });

  test.each(['async', 'sync'])(
    'a %s 3D pointer miss cannot revive through sprite or grid fallbacks',
    async (mode) => {
      const pickingService = { pickGroundSync: () => null };
      if (mode === 'async') pickingService.pickGround = async () => null;
      const manager = new InteractionManager({
        is3DModeActive: () => true,
        pickingService,
      });
      manager.getGridCoordinatesFromClick = jest.fn(() => ({ gridX: 0, gridY: 0 }));
      expect(await manager._resolvePointerTarget({ clientX: 20, clientY: 30 })).toEqual({
        gridX: null,
        gridY: null,
        token: null,
      });
      expect(manager.getGridCoordinatesFromClick).not.toHaveBeenCalled();
      expect(manager._tryCaptureRadialTrigger({ clientX: 20, clientY: 30 })).toBe(false);
    }
  );

  test('clicking empty 3D background keeps selection and does not request movement', async () => {
    const token = { id: 'selected' };
    const adapter = {
      getSelectedToken: () => token,
      requestMoveToGrid: jest.fn(),
      setSelectedToken: jest.fn(),
    };
    const gm = {
      is3DModeActive: () => true,
      token3DAdapter: adapter,
      terrainCoordinator: { getSelectedPlaceable: () => null },
      handleTokenInteraction: jest.fn(),
    };
    const manager = new InteractionManager(gm);
    manager._resolvePointerTarget = jest.fn(async () => ({
      gridX: null,
      gridY: null,
      token: null,
    }));
    manager.handleLeftClick({ button: 0, clientX: 20, clientY: 30 });
    await Promise.resolve();
    await Promise.resolve();
    expect(adapter.requestMoveToGrid).not.toHaveBeenCalled();
    expect(adapter.setSelectedToken).not.toHaveBeenCalled();
    expect(gm.handleTokenInteraction).not.toHaveBeenCalled();
  });

  test('Remove uses the clicked 3D creature rather than a different tile projected behind it', async () => {
    const token = { id: 'token-2', gridX: 14, gridY: 10 };
    const gm = {
      selectedTokenType: 'remove',
      terrainCoordinator: { getSelectedPlaceable: () => null },
      removeToken: jest.fn(),
      handleTokenInteraction: jest.fn(),
    };
    const manager = new InteractionManager(gm);
    manager._resolvePointerTarget = jest.fn(async () => ({
      token,
      gridX: 12,
      gridY: 7,
    }));

    manager.handleLeftClick({ button: 0, clientX: 500, clientY: 300 });
    await Promise.resolve();
    await Promise.resolve();

    expect(gm.removeToken).toHaveBeenCalledWith(token);
    expect(gm.handleTokenInteraction).not.toHaveBeenCalled();
  });

  test('an out-of-range click is ignored without clearing the selected creature', async () => {
    const token = { id: 'token-1' };
    const adapter = {
      getSelectedToken: () => token,
      requestMoveToGrid: jest.fn(() => null),
      navigateToGrid: jest.fn(),
      setSelectedToken: jest.fn(),
    };
    const gm = {
      selectedTokenType: 'mannequin',
      is3DModeActive: () => true,
      token3DAdapter: adapter,
      terrainCoordinator: { getSelectedPlaceable: () => null },
    };
    const manager = new InteractionManager(gm);
    manager._resolvePointerTarget = jest.fn(async () => ({ gridX: 20, gridY: 4, token: null }));
    manager.handleLeftClick({ button: 0, clientX: 500, clientY: 300 });
    await Promise.resolve();
    await Promise.resolve();

    expect(adapter.requestMoveToGrid).toHaveBeenCalledWith(token, 20, 4);
    expect(adapter.navigateToGrid).not.toHaveBeenCalled();
    expect(adapter.setSelectedToken).not.toHaveBeenCalled();
  });

  test('a vertical face click uses constrained wall movement, not a destination on its top', async () => {
    const token = { id: 'token-1' };
    const wallSurface = {
      kind: 'wall',
      point: { x: 3, y: 4, z: 4.5 },
      normal: { x: -1, y: 0, z: 0 },
    };
    const adapter = {
      getSelectedToken: () => token,
      requestMoveToGrid: jest.fn(),
      requestMoveToSurface: jest.fn(() => null),
      setSelectedToken: jest.fn(),
    };
    const manager = new InteractionManager({
      selectedTokenType: 'mannequin',
      is3DModeActive: () => true,
      token3DAdapter: adapter,
      terrainCoordinator: { getSelectedPlaceable: () => null },
    });
    manager._resolvePointerTarget = jest.fn(async () => ({
      gridX: 3,
      gridY: 4,
      token: null,
      wallSurface,
    }));
    manager.handleLeftClick({ button: 0, clientX: 500, clientY: 300 });
    await Promise.resolve();
    await Promise.resolve();
    expect(adapter.requestMoveToSurface).toHaveBeenCalledWith(token, wallSurface);
    expect(adapter.requestMoveToGrid).not.toHaveBeenCalled();
    expect(adapter.setSelectedToken).not.toHaveBeenCalled();
  });

  test('clicking a wall below a creature does not select the creature standing on top', async () => {
    const token = { id: 'on-top', gridX: 3, gridY: 4 };
    const wallSurface = {
      kind: 'wall',
      point: { x: 3, y: 4, z: 4.5 },
      normal: { x: -1, y: 0, z: 0 },
    };
    const pick = { grid: { gx: 3, gy: 4 }, token: null, surface: wallSurface };
    const gm = {
      is3DModeActive: () => true,
      placedTokens: [token],
      tokenManager: { findExistingTokenAt: jest.fn(() => token) },
      pickingService: {
        pickGroundSync: () => pick,
        pickGround: async () => pick,
      },
    };
    const manager = new InteractionManager(gm);
    const result = await manager._resolvePointerTarget({ clientX: 500, clientY: 300 });
    expect(result).toMatchObject({ gridX: 3, gridY: 4, token: null, wallSurface });
    expect(manager._tryCaptureRadialTrigger({ clientX: 500, clientY: 300 })).toBe(false);
  });

  test('the ground below a hanging creature remains a destination, not a grid-based creature hit', async () => {
    const token = {
      id: 'hanging',
      gridX: 3,
      gridY: 4,
      world: { x: 3.5, y: 4, z: 4.5 },
    };
    const pick = { grid: { gx: 3, gy: 4 }, world: { x: 3.5, y: 0, z: 4.5 }, token: null };
    const gm = {
      is3DModeActive: () => true,
      placedTokens: [token],
      spatial: { tileWorldSize: 1 },
      tokenManager: { findExistingTokenAt: () => token },
      token3DAdapter: { isWallAttached: () => true },
      pickingService: {
        pickGroundSync: () => pick,
        pickGround: async () => pick,
      },
    };
    const manager = new InteractionManager(gm);
    const result = await manager._resolvePointerTarget({ clientX: 500, clientY: 300 });
    expect(result).toMatchObject({ gridX: 3, gridY: 4, token: null });
    expect(manager._tryCaptureRadialTrigger({ clientX: 500, clientY: 300 })).toBe(false);
  });

  test('keyboard creature movement, turning, and shift control are disabled at the input boundary', () => {
    const adapter = {
      getSelectedToken: () => ({ id: 'token-1' }),
      beginForwardMovement: jest.fn(),
      beginBackwardMovement: jest.fn(),
      beginRotation: jest.fn(),
      setShiftModifier: jest.fn(),
    };
    const manager = new InteractionManager({ tokenManager: {}, token3DAdapter: adapter });
    manager.setupKeyboardInteractions();
    for (const code of ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'ArrowUp', 'ArrowDown', 'ShiftLeft']) {
      document.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
      document.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
    }
    expect(adapter.beginForwardMovement).not.toHaveBeenCalled();
    expect(adapter.beginBackwardMovement).not.toHaveBeenCalled();
    expect(adapter.beginRotation).not.toHaveBeenCalled();
    expect(adapter.setShiftModifier).not.toHaveBeenCalled();
  });
});
