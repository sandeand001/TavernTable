import { ThreeSceneManager } from '../../src/scene/ThreeSceneManager.js';

describe('ThreeSceneManager sun controls', () => {
  beforeEach(() => {
    if (typeof window === 'undefined') {
      global.window = {};
    }
    window.__TT_PENDING_SUN_AZIMUTH_DEG = undefined;
    window.__TT_PENDING_SUN_TIME_MINUTES = undefined;
  });

  test('setSunTimeMinutes updates azimuth, elevation, and persistence', () => {
    const manager = new ThreeSceneManager({ cols: 10, rows: 10 });
    manager.setSunTimeMinutes(720, { immediate: true });
    expect(manager.getSunTimeMinutes()).toBeCloseTo(720, 5);
    expect(manager.getSunAzimuthDegrees()).toBeCloseTo(140, 1);
    expect(manager._sunOffset.y).toBeCloseTo(manager._sunMaxElevation, 5);
    expect(window.__TT_PENDING_SUN_TIME_MINUTES).toBeCloseTo(720, 5);
    expect(window.__TT_PENDING_SUN_AZIMUTH_DEG).toBeCloseTo(140, 1);
  });

  test('setSunTimeMinutes can skip persistence while retaining state', () => {
    const manager = new ThreeSceneManager({});
    manager.setSunTimeMinutes(123, { immediate: true, skipPersist: true });
    expect(manager.getSunTimeMinutes()).toBeCloseTo(123, 5);
    expect(window.__TT_PENDING_SUN_TIME_MINUTES).toBeUndefined();
    expect(window.__TT_PENDING_SUN_AZIMUTH_DEG).toBeUndefined();
  });

  test('setSunAzimuthDegrees synchronizes derived time when not skipped', () => {
    const manager = new ThreeSceneManager({});
    const targetDeg = 90;
    manager.setSunAzimuthDegrees(targetDeg, { immediate: true });
    const expectedMinutes =
      ((((targetDeg - manager._sunAzimuthOffsetDeg) % 360) + 360) % 360) * (1440 / 360);
    expect(manager.getSunTimeMinutes()).toBeCloseTo(expectedMinutes, 5);
    expect(window.__TT_PENDING_SUN_TIME_MINUTES).toBeCloseTo(expectedMinutes, 5);
    expect(window.__TT_PENDING_SUN_AZIMUTH_DEG).toBeCloseTo(90, 5);
  });
});
