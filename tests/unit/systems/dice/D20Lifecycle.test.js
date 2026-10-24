import * as three from 'three';
import { diceState } from '../../../../src/systems/dice/DiceState.js';
import {
  ensureBlueprint,
  ensureThreeNamespace,
  cloneDice,
  applyCriticalRollTint,
} from '../../../../src/systems/dice/DiceModelManager.js';
import { scheduleRollAnimation } from '../../../../src/systems/dice/DiceAnimationScheduler.js';
import { playD20RollOnGrid } from '../../../../src/systems/dice/dice3d.js';

jest.mock('../../../../src/systems/dice/DiceModelManager.js', () => ({
  ensureThreeNamespace: jest.fn(),
  ensureBlueprint: jest.fn(),
  cloneDice: jest.fn(),
  resetDiceMaterialColors: jest.fn(),
  applyCriticalRollTint: jest.fn(),
}));
jest.mock('../../../../src/systems/dice/DiceAnimationScheduler.js', () => ({
  scheduleRollAnimation: jest.fn(),
}));

describe('Physical d20 completion and cleanup', () => {
  let manager;
  let hooks;
  let controller;
  let material;

  beforeEach(() => {
    jest.clearAllMocks();
    diceState.activeDieState = null;
    diceState.threeNamespace = three;
    manager = {
      scene: new three.Scene(),
      gameManager: { cols: 25, rows: 25, spatial: { tileWorldSize: 1 } },
    };
    window.gameManager = { threeSceneManager: manager };
    ensureThreeNamespace.mockResolvedValue(three);
    ensureBlueprint.mockResolvedValue(new three.Group());
    cloneDice.mockImplementation(() => {
      const mesh = new three.Group();
      material = new three.MeshBasicMaterial();
      jest.spyOn(material, 'dispose');
      mesh.add(new three.Mesh(new three.IcosahedronGeometry(), material));
      return mesh;
    });
    scheduleRollAnimation.mockImplementation(async (_, mesh, __, options) => {
      hooks = options;
      controller = {
        dispose: jest.fn(() => {
          mesh.parent?.remove(mesh);
          options.onCancel?.({ mesh });
        }),
      };
      return controller;
    });
  });

  afterEach(() => {
    window.dispatchEvent(new Event('beforeunload'));
    delete window.gameManager;
  });

  async function start(options = {}) {
    const result = playD20RollOnGrid({ dismissOnClick: false, ...options });
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
    return { result };
  }

  test('publishes the exact settled value and retains the resting model', async () => {
    const { result } = await start();
    const mesh = diceState.activeDieState.mesh;
    hooks.onSettle({ mesh, faceInfo: { value: 17, faceIndex: 9 } });
    hooks.onSettle({ mesh, faceInfo: { value: 1, faceIndex: 35 } });

    expect((await result).value).toBe(17);
    expect(applyCriticalRollTint).toHaveBeenCalledTimes(1);
    expect(applyCriticalRollTint).toHaveBeenCalledWith(mesh, 17);
    expect(manager.scene.children).toContain(mesh);
  });

  test('cancellation resolves the pending roll rather than leaving controls waiting', async () => {
    const { result } = await start();

    window.dispatchEvent(new Event('beforeunload'));

    expect(await result).toEqual({ success: false, value: null, reason: 'cancelled' });
    expect(controller.dispose).toHaveBeenCalledTimes(1);
    expect(manager.scene.children).toHaveLength(0);
    expect(diceState.activeDieState).toBeNull();
  });

  test('a physics failure resolves explicitly and removes the failed model', async () => {
    const { result } = await start();
    const error = new Error('Physics failed');
    hooks.onError(error);

    expect(await result).toEqual({ success: false, value: null, reason: 'physics-error', error });
    expect(manager.scene.children).toHaveLength(0);
    expect(diceState.activeDieState).toBeNull();
  });

  test('retains a cocked die for inspection without publishing a number', async () => {
    const { result } = await start();
    const mesh = diceState.activeDieState.mesh;
    hooks.onCocked({ mesh });

    expect(await result).toEqual({ success: false, value: null, reason: 'cocked' });
    expect(manager.scene.children).toContain(mesh);
    expect(applyCriticalRollTint).not.toHaveBeenCalled();
  });

  test('failed physics loading does not publish a model or leak cloned materials', async () => {
    scheduleRollAnimation.mockRejectedValue(new Error('Physics module unavailable'));
    const { result } = await start();

    expect((await result).success).toBe(false);
    expect(manager.scene.children).toHaveLength(0);
    expect(material.dispose).toHaveBeenCalledTimes(1);
    expect(diceState.activeDieState).toBeNull();
  });

  test('click dismissal uses the active camera after switching lenses', async () => {
    const canvas = document.createElement('canvas');
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 });
    manager.renderer = { domElement: canvas };
    manager.camera = new three.PerspectiveCamera(40, 800 / 600, 0.1, 1000);
    manager.camera.position.set(20, 20, 40);
    manager.camera.lookAt(20, 0, 20);
    manager.camera.updateMatrixWorld(true);
    const { result } = await start({ dismissOnClick: true });

    manager.camera = new three.PerspectiveCamera(40, 800 / 600, 0.1, 1000);
    manager.camera.position.set(0, 12, 10);
    manager.camera.lookAt(0, 0, 0);
    manager.camera.updateMatrixWorld(true);
    manager.scene.updateMatrixWorld(true);
    canvas.dispatchEvent(
      new MouseEvent('pointerdown', { clientX: 400, clientY: 300, button: 0, bubbles: true })
    );

    expect(diceState.activeDieState).toBeNull();
    expect((await result).reason).toBe('cancelled');
  });
});
