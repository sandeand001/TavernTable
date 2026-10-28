import { ThreeSceneManager } from '../../../src/scene/ThreeSceneManager.js';

jest.mock('three', () => {
  const actual = jest.requireActual('three');
  return {
    ...actual,
    WebGLRenderer: jest.fn(function ({ canvas }) {
      this.domElement = canvas;
      this.shadowMap = {};
      this.setPixelRatio = jest.fn();
      this.setSize = jest.fn((width, height) => {
        canvas.width = width;
        canvas.height = height;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
      });
      this.render = jest.fn();
      this.dispose = jest.fn();
    }),
  };
});

test('initial renderer size uses the mounted map viewport rather than extending under the sidebar', async () => {
  const container = document.createElement('div');
  container.id = 'game-container';
  Object.defineProperties(container, {
    clientWidth: { value: 800 },
    clientHeight: { value: 600 },
  });
  document.body.appendChild(container);
  const manager = new ThreeSceneManager({
    cols: 25,
    rows: 25,
    spatial: { tileWorldSize: 1, elevationUnit: 0.3 },
  });
  jest.spyOn(manager, '_hasUsableWebGLContext').mockImplementation(() => {
    manager._testMode = false;
    return true;
  });
  try {
    await manager.initialize();
    expect(manager.initialized).toBe(true);
    expect(manager.canvas.parentElement).toBe(container);
    expect(manager.renderer.setSize).toHaveBeenLastCalledWith(800, 600, true);
    expect(manager.canvas.style.width).toBe('800px');
    expect(manager.canvas.style.height).toBe('600px');
    expect(manager.camera.aspect).toBeCloseTo(800 / 600);
  } finally {
    manager.dispose();
    container.remove();
    jest.restoreAllMocks();
  }
});
