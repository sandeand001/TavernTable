/* eslint-disable prettier/prettier */
import { ThreeSceneManager } from '../../../src/scene/ThreeSceneManager.js';
import * as three from 'three';
import { BIOME_GROUPS } from '../../../src/config/biome/BiomeConstants.js';

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

  test.each(BIOME_GROUPS.Underground.map(({ key }) => key))(
    '%s uses a stable local profile regardless of outdoor sun and restores it on exit',
    (biomeKey) => {
      const manager = new ThreeSceneManager({});
      manager._sunLight = new three.DirectionalLight();
      manager._ambientLight = new three.AmbientLight();
      manager._hemisphereLight = new three.HemisphereLight();
      const geometry = new three.BufferGeometry();
      geometry.setAttribute('color', new three.Float32BufferAttribute([0.4, 0.6, 0.8], 3));
      const pool = { applyLightingProfile: jest.fn() };
      manager.registerPlaceablePool(pool);
      manager.setSceneLightingBiome(biomeKey);
      manager.registerTerrainGeometryBasis(geometry);
      manager.setSunTimeMinutes(60, { immediate: true });
      const snapshot = () => ({
        sunVisible: manager._sunLight.visible,
        ambient: [manager._ambientLight.intensity, ...manager._ambientLight.color.toArray()],
        hemisphere: [
          manager._hemisphereLight.intensity,
          ...manager._hemisphereLight.color.toArray(),
          ...manager._hemisphereLight.groundColor.toArray(),
        ],
        terrain: [...geometry.getAttribute('color').array],
        placeables: pool.applyLightingProfile.mock.lastCall[0],
      });
      const night = snapshot();
      manager.setSunTimeMinutes(720, { immediate: true });
      expect(snapshot()).toEqual(night);
      expect(night.sunVisible).toBe(false);
      expect(night.ambient[0]).toBeGreaterThan(0);
      const latePool = { applyLightingProfile: jest.fn() };
      manager.registerPlaceablePool(latePool);
      expect(latePool.applyLightingProfile).toHaveBeenLastCalledWith(night.placeables);
      manager.setSceneLightingBiome('grassland');
      expect(manager._sunLight.visible).toBe(true);
      expect(manager._ambientLight.intensity).toBeCloseTo(
        manager.getTimeOfDayProfile(720).lighting.ambientIntensity
      );
      geometry.dispose();
    }
  );

  test('local lights follow current placements, stay bounded, and disappear on an outdoor map', () => {
    const manager = new ThreeSceneManager({ cols: 20, rows: 20, spatial: { tileWorldSize: 1 } });
    manager.scene = new three.Scene();
    manager.three = three;
    const entries = new Map(
      Array.from({ length: 12 }, (_, index) => [
        index,
        {
          source: { modelKey: 'source-dungeon-torch', gridX: index, gridY: 2 },
          position: { x: index + 0.5, y: 0, z: 2.5 },
          scale: { x: 1, y: 1, z: 1 },
        },
      ])
    );
    const pool = {
      _revision: 0,
      _metadata: new Map([['source-dungeon-torch', entries]]),
      applyLightingProfile: jest.fn(),
    };
    manager.registerPlaceablePool(pool);
    manager.setSceneLightingBiome('dungeon');
    manager.refreshLocalLighting();
    const lights = () => manager.scene.getObjectByName('UndergroundLocalLights')?.children || [];
    expect(lights()).toHaveLength(8);
    expect(lights().every((light) => light.isPointLight && !light.castShadow)).toBe(true);
    const priorPositions = lights().map((light) => light.position.x);
    entries.clear();
    entries.set(20, {
      source: { modelKey: 'source-dungeon-torch', gridX: 15, gridY: 2 },
      position: { x: 15.5, y: 1, z: 2.5 },
      scale: { x: 1, y: 1, z: 1 },
    });

    pool._revision++;
    manager.refreshLocalLighting();
    expect(lights()).toHaveLength(1);
    expect(lights()[0].position.x).toBe(15.5);
    expect(lights()[0].position.y).toBeGreaterThan(1);
    expect(priorPositions).not.toContain(15.5);
    manager.setSceneLightingBiome('grassland');
    expect(lights()).toHaveLength(0);
  });

  test('tinted crystal formations emit local light without making ordinary cavern rocks glow', () => {
    const manager = new ThreeSceneManager({ spatial: { tileWorldSize: 1 } });
    manager.scene = new three.Scene();
    manager.three = three;
    const key = 'source-cave-stalagmite';
    const entries = new Map([
      [
        0,
        {
          source: { modelKey: key },
          position: { x: 2.5, y: -4, z: 2.5 },
          scale: { x: 0.5, y: 1.5, z: 0.5 },
        },
      ],
    ]);
    const pool = {
      _revision: 0,
      _metadata: new Map([[key, entries]]),
      _groups: new Map([[key, { appearance: { tint: 0x79cfdd } }]]),
      applyLightingProfile: jest.fn(),
    };
    manager.registerPlaceablePool(pool);
    manager.setSceneLightingBiome('crystalSpires');
    manager.refreshLocalLighting();
    const lights = () => manager.scene.getObjectByName('UndergroundLocalLights')?.children || [];
    expect(lights()).toHaveLength(1);
    expect(lights()[0].userData.kind).toBe('crystal');
    entries.get(0).source.modelKey = 'pure-poly-crystal-cluster-01-red';
    pool._groups.get(key).appearance = null;
    pool._revision++;
    manager.setSceneLightingBiome('crystalFields');
    manager.refreshLocalLighting();
    expect(lights()[0].color.getHex()).toBe(0xff725e);
    manager.setSceneLightingBiome('cavern');
    manager.refreshLocalLighting();
    expect(lights()).toHaveLength(0);
    manager.disposeLocalLighting();
  });

  test('purchased cave formations receive a local fill that disappears with the scenery', () => {
    const manager = new ThreeSceneManager({ spatial: { tileWorldSize: 1 } });
    manager.scene = new three.Scene();
    manager.three = three;
    const key = 'pure-poly-stalagmite-05';
    const entries = new Map([
      [
        0,
        {
          source: { modelKey: key },
          position: { x: 2.5, y: -4, z: 2.5 },
          scale: { x: 1, y: 1, z: 1 },
        },
      ],
    ]);
    const pool = {
      _revision: 0,
      _metadata: new Map([[key, entries]]),
      applyLightingProfile: jest.fn(),
    };
    manager.registerPlaceablePool(pool);
    manager.setSceneLightingBiome('cavern');
    manager.refreshLocalLighting();
    const lights = manager.scene.getObjectByName('UndergroundLocalLights');
    expect(lights.children).toHaveLength(1);
    expect(lights.children[0]).toMatchObject({
      isDirectionalLight: true,
      intensity: 0.8,
      castShadow: false,
      userData: { renderOnly: true, kind: 'cave-fill' },
    });
    const torches = new Map(
      Array.from({ length: 10 }, (_, index) => [
        index,
        {
          source: { modelKey: 'source-dungeon-torch' },
          position: { x: index + 0.5, y: -4, z: 2.5 },
          scale: { x: 1, y: 1, z: 1 },
        },
      ])
    );
    pool._metadata.set('source-dungeon-torch', torches);
    pool._revision++;
    manager.refreshLocalLighting();
    expect(manager.scene.getObjectByName('UndergroundLocalLights').children).toHaveLength(8);
    entries.clear();
    torches.clear();
    pool._revision++;
    manager.refreshLocalLighting();
    expect(manager.scene.getObjectByName('UndergroundLocalLights').children).toHaveLength(0);
    manager.disposeLocalLighting();
  });

  test('a manually placed protected lantern adds and removes its local light', () => {
    const manager = new ThreeSceneManager({ spatial: { tileWorldSize: 1 } });
    manager.scene = new three.Scene();
    manager.three = three;
    const key = 'pure-poly-lantern-01-iron';
    const entries = new Map([
      [
        0,
        {
          source: { modelKey: key },
          position: { x: 2.5, y: -4, z: 2.5 },
          scale: { x: 1, y: 1, z: 1 },
        },
      ],
    ]);
    const pool = {
      _revision: 0,
      _metadata: new Map([[key, entries]]),
      applyLightingProfile: jest.fn(),
    };
    manager.registerPlaceablePool(pool);
    manager.setSceneLightingBiome('cavern');
    manager.refreshLocalLighting();
    const lights = manager.scene.getObjectByName('UndergroundLocalLights');
    expect(lights.children).toHaveLength(1);
    expect(lights.children[0]).toMatchObject({
      isPointLight: true,
      castShadow: false,
      userData: { renderOnly: true, kind: 'lantern' },
    });
    entries.clear();
    pool._revision++;
    manager.refreshLocalLighting();
    expect(manager.scene.getObjectByName('UndergroundLocalLights').children).toHaveLength(0);
    manager.disposeLocalLighting();
  });

  test('an underground profile applies to lights created after the biome was selected', () => {
    const manager = new ThreeSceneManager({});
    manager.setSceneLightingBiome('dungeon');
    manager._sunLight = new three.DirectionalLight();
    manager._ambientLight = new three.AmbientLight();
    manager._hemisphereLight = new three.HemisphereLight();
    manager.setSceneLightingBiome('dungeon');
    expect(manager._sunLight.visible).toBe(false);
    expect(manager._ambientLight.intensity).toBe(
      manager.getSceneLightingProfile().lighting.ambientIntensity
    );
    expect(manager._hemisphereLight.intensity).toBe(
      manager.getSceneLightingProfile().lighting.hemisphereIntensity
    );
  });

  test('fungal sources are local to the viewed map and are cleared immediately on a map switch', () => {
    const gm = { cols: 20, rows: 20, spatial: { tileWorldSize: 1 }, campaignMapId: 'first' };
    const manager = new ThreeSceneManager(gm);
    manager.scene = new three.Scene();
    manager.three = three;
    const entries = new Map([
      [
        0,
        {
          source: { modelKey: 'mushroom-common' },
          position: { x: 2.5, y: -2, z: 2.5 },
          scale: { x: 1, y: 1, z: 1 },
        },
      ],
    ]);
    const pool = {
      _revision: 0,
      _metadata: new Map([['mushroom-common', entries]]),
      applyLightingProfile: jest.fn(),
    };
    manager.registerPlaceablePool(pool);
    manager.setSceneLightingBiome('fungalGrove');
    manager.refreshLocalLighting();
    expect(manager.scene.getObjectByName('UndergroundLocalLights').children[0].userData.kind).toBe(
      'fungus'
    );
    gm.campaignMapId = 'second';
    manager.setSceneLightingBiome('fungalGrove');
    expect(manager.scene.getObjectByName('UndergroundLocalLights')).toBeUndefined();
    entries.clear();
    pool._revision++;
    manager.refreshLocalLighting();
    expect(manager.scene.getObjectByName('UndergroundLocalLights').children).toHaveLength(0);
  });
});
