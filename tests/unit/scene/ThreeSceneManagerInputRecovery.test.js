import { ThreeSceneManager } from '../../../src/scene/ThreeSceneManager.js';
import { InteractionManager } from '../../../src/managers/InteractionManager.js';

describe('Input bindings after 3D renderer recovery', () => {
  let scene;
  let controls;
  let fallback;
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    container.id = 'game-container';
    document.body.appendChild(container);
    const gm = {
      cols: 25,
      rows: 25,
      spatial: { tileWorldSize: 1, elevationUnit: 0.5 },
      getViewMode: () => 'isometric',
    };
    scene = new ThreeSceneManager(gm);
    gm.threeSceneManager = scene;
    gm.getEventCanvas = () => scene.canvas;
    scene.degraded = true;
    scene.ensureFallbackSurface();
    fallback = scene.canvas;
    controls = new InteractionManager(gm);
    gm.interactionManager = controls;
    jest.spyOn(controls, '_tryCaptureRadialTrigger').mockReturnValue(false);
    controls.setupContextMenu();
    controls.setupMouseInteractions();
    controls.setupZoomInteraction();
  });

  afterEach(() => {
    controls._removeGlobalDragListeners();
    scene.dispose();
    container.remove();
  });

  async function recover() {
    scene.degraded = false;
    await scene.initialize();
    expect(scene.initialized).toBe(true);
  }

  test('retains the fallback canvas with its existing input listeners', async () => {
    await recover();
    expect(scene.canvas).toBe(fallback);
    expect(scene.canvas.parentElement).toBe(container);
  });

  test('right-drag changes yaw and pitch after recovery and releases the drag', async () => {
    await recover();
    const yaw = scene._isoYaw;
    const pitch = scene._isoPitch;
    const down = new MouseEvent('mousedown', {
      button: 2,
      buttons: 2,
      clientX: 40,
      clientY: 40,
      bubbles: true,
      cancelable: true,
    });
    scene.canvas.dispatchEvent(down);
    scene.canvas.dispatchEvent(
      new MouseEvent('mousemove', {
        buttons: 2,
        clientX: 80,
        clientY: 50,
        bubbles: true,
      })
    );
    scene.canvas.dispatchEvent(new MouseEvent('mouseup', { button: 2, buttons: 0, bubbles: true }));

    expect(scene._isoYaw).toBeCloseTo(yaw + (20 * Math.PI) / 180);
    expect(scene._isoPitch).toBeCloseTo(pitch + (3.5 * Math.PI) / 180);
    expect(down.defaultPrevented).toBe(true);
    expect(controls.isRotating3D).toBe(false);
    expect(controls._activeDragButton).toBeNull();
  });

  test('handles one wheel event once instead of also applying the container fallback', async () => {
    await recover();
    scene.canvas.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: -100,
        clientX: 200,
        clientY: 150,
        bubbles: true,
        cancelable: true,
      })
    );

    expect(scene._zoom).toBeCloseTo(1.1);
    expect(scene._targetZoom).toBeCloseTo(1.1);
  });

  test('keeps the container wheel fallback for events not handled by canvas controls', async () => {
    await recover();
    container.dispatchEvent(
      new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true })
    );
    expect(scene._targetZoom).toBeCloseTo(Math.exp(0.2));
  });
});
