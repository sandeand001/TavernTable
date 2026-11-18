import { ThreeSceneManager } from '../../../src/scene/ThreeSceneManager.js';

describe('ThreeSceneManager metrics', () => {
  test('disposal releases the overlay frame loop before a viewer is recreated', async () => {
    const manager = new ThreeSceneManager({});
    await manager.initialize();
    const overlay = document.getElementById('three-debug-overlay');
    const handle = manager._debugAnimationHandle;
    const cancel = jest.spyOn(globalThis, 'cancelAnimationFrame');
    manager.dispose();
    expect(cancel).toHaveBeenCalledWith(handle);
    expect(overlay.isConnected).toBe(false);
    const replacement = new ThreeSceneManager({});
    await replacement.initialize();
    expect(document.getElementById('three-debug-overlay')).not.toBe(overlay);
    replacement.dispose();
    cancel.mockRestore();
  });

  test('the metrics overlay cannot intercept sidebar pointer input', async () => {
    const manager = new ThreeSceneManager({});
    await manager.initialize();
    const overlay = document.getElementById('three-debug-overlay');
    expect(overlay).not.toBeNull();
    expect(overlay.style.pointerEvents).toBe('none');
    manager.dispose();
  });

  test('getRenderStats returns expected shape pre/post init', async () => {
    const tsm = new ThreeSceneManager({});
    let stats = tsm.getRenderStats();
    expect(stats.initialized).toBe(false);
    await tsm.initialize();
    stats = tsm.getRenderStats();
    expect(stats).toHaveProperty('frameCount');
    expect(stats).toHaveProperty('averageFrameMs');
    expect(stats).toHaveProperty('degraded');
    if (stats.degraded) {
      // In a Jest (non-browser or headless) env we may degrade; initialized may remain false.
      expect(stats.initialized).toBe(false);
    } else {
      expect(stats.initialized).toBe(true);
      expect(stats.degraded).toBe(false);
    }
  });

  test('coalesces per-frame metrics exports while publishing the first sample immediately', () => {
    const manager = new ThreeSceneManager({});
    manager.renderer = { render: jest.fn() };
    manager.camera = {};
    const frames = [];
    const requestFrame = jest
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        frames.push(callback);
        return frames.length;
      });
    const stats = jest.spyOn(manager, 'getRenderStats');
    const previousMetrics = window.__TT_METRICS__;
    window.__TT_METRICS__ = {};
    try {
      manager._loop();
      const advance = (timestamp) => frames.shift()(timestamp);
      for (let timestamp = 0; timestamp < 500; timestamp += 16) advance(timestamp);

      expect(stats).toHaveBeenCalledTimes(1);
      expect(window.__TT_METRICS__.three.frameCount).toBe(1);

      advance(500);

      expect(stats).toHaveBeenCalledTimes(2);
      expect(window.__TT_METRICS__.three.frameCount).toBeGreaterThan(1);
    } finally {
      requestFrame.mockRestore();
      if (previousMetrics === undefined) delete window.__TT_METRICS__;
      else window.__TT_METRICS__ = previousMetrics;
    }
  });
});
