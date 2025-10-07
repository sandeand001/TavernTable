import { ThreeSceneManager } from '../../src/scene/ThreeSceneManager.js';

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
