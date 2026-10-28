import { ThreeSceneManager } from '../../../src/scene/ThreeSceneManager.js';

describe('ThreeSceneManager (bootstrap)', () => {
  test('constructs and initializes safely (degraded or ready)', async () => {
    const gm = { renderMode: '2d-iso' };
    const tsm = new ThreeSceneManager(gm);
    expect(tsm.initialized).toBe(false);
    await tsm.initialize();
    // After initialize, either we have a scene & camera or degraded mode flagged.
    if (tsm.degraded) {
      expect(tsm.scene).not.toBeNull();
    } else {
      expect(tsm.initialized).toBe(true);
      expect(tsm.scene).toBeTruthy();
      expect(tsm.camera).toBeTruthy();
    }
    // Ensure idempotency
    await tsm.initialize();
  });
});

describe('ThreeSceneManager WebGL capability policy', () => {
  let context;
  let workerId;
  let testMode;

  beforeEach(() => {
    workerId = process.env.JEST_WORKER_ID;
    testMode = process.env.TT_TEST_MODE;
    delete process.env.JEST_WORKER_ID;
    delete process.env.TT_TEST_MODE;
    context = jest.spyOn(HTMLCanvasElement.prototype, 'getContext');
  });

  afterEach(() => {
    context.mockRestore();
    if (workerId === undefined) delete process.env.JEST_WORKER_ID;
    else process.env.JEST_WORKER_ID = workerId;
    if (testMode === undefined) delete process.env.TT_TEST_MODE;
    else process.env.TT_TEST_MODE = testMode;
  });

  test('accepts a real software-backed context supported by the renderer', () => {
    const loseContext = jest.fn();
    const gl = { getExtension: jest.fn(() => ({ loseContext })) };
    context.mockImplementation((api, attributes) =>
      attributes?.failIfMajorPerformanceCaveat ? null : gl
    );
    const manager = new ThreeSceneManager({});

    expect(manager._hasUsableWebGLContext()).toBe(true);
    expect(context).toHaveBeenCalledWith(
      'webgl2',
      expect.objectContaining({ failIfMajorPerformanceCaveat: false })
    );
    expect(loseContext).toHaveBeenCalledTimes(1);
  });

  test('still rejects browsers that cannot create any WebGL context', () => {
    context.mockReturnValue(null);
    expect(new ThreeSceneManager({})._hasUsableWebGLContext()).toBe(false);
  });
});
