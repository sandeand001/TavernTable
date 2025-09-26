import { ThreeSceneManager } from '../../src/scene/ThreeSceneManager.js';

describe('ThreeSceneManager metrics', () => {
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
});
