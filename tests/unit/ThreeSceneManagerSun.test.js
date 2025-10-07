/* eslint-disable prettier/prettier */
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

  test('time-of-day profile warms terrain during sunrise and cools it at night', () => {
    const manager = new ThreeSceneManager({});
    const sunrise = manager.getTimeOfDayProfile(360); // 6:00 AM
    const midday = manager.getTimeOfDayProfile(780); // 1:00 PM
    const night = manager.getTimeOfDayProfile(60); // 1:00 AM
    expect(sunrise.phase).toBe('sunrise');
    expect(sunrise.terrain.warmMix).toBeGreaterThan(sunrise.terrain.coolMix);
    expect(sunrise.placeables.plant.warmMix).toBeGreaterThan(sunrise.placeables.structure.warmMix);
    expect(midday.phase).toBe('day');
    expect(midday.terrain.warmMix).toBeLessThan(0.05);
    expect(midday.terrain.coolMix).toBeLessThan(0.05);
    expect(midday.placeables.plant.warmMix).toBeLessThan(0.06);
    expect(midday.placeables.plant.coolMix).toBeLessThan(0.06);
    expect(night.phase).toBe('night');
    expect(night.terrain.coolMix).toBeGreaterThan(night.terrain.warmMix);
    expect(night.placeables.plant.coolMix).toBeGreaterThan(night.placeables.plant.warmMix);
  });

  test('lighting intensity increases with daylight', () => {
    const manager = new ThreeSceneManager({});
    const nightProfile = manager.getTimeOfDayProfile(120); // 2:00 AM
    const dayProfile = manager.getTimeOfDayProfile(780); // 1:00 PM
    expect(dayProfile.lighting.sunIntensity).toBeGreaterThan(nightProfile.lighting.sunIntensity);
    expect(dayProfile.lighting.ambientIntensity).toBeGreaterThan(
      nightProfile.lighting.ambientIntensity
    );
    expect(dayProfile.lighting.hemisphereIntensity).toBeGreaterThan(
      nightProfile.lighting.hemisphereIntensity
    );
  });
});
