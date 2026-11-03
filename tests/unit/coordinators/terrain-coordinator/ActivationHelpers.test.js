import * as three from 'three';
import { TerrainMeshBuilder } from '../../../../src/scene/terrain/TerrainMeshBuilder.js';
import { TerrainRebuilder } from '../../../../src/scene/terrain/TerrainRebuilder.js';
import { createTerrainWorld } from '../../../helpers/terrainWorld.js';

describe('Terrain editing color lifecycle through the authoritative engine', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    delete window.selectedBiome;
    window.__TT_USER_SELECTED_BIOME__ = false;
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    delete window.selectedBiome;
    delete window.__TT_USER_SELECTED_BIOME__;
  });

  function fixture() {
    const world = createTerrainWorld(1, 1, null);
    const gm = world.gm;
    gm.threeSceneManager.scene = new three.Scene();
    gm.threeSceneManager.three = three;
    gm.terrainRebuilder = new TerrainRebuilder({
      gameManager: gm,
      builder: new TerrainMeshBuilder({ forceAdvanced: true, hardEdges: true }),
      debounceMs: 120,
    });
    gm.notifyTerrainHeightsChanged = () => gm.terrainRebuilder.request({ three });
    gm.terrainRebuilder.rebuild({ three });
    const geometry = () => gm.threeSceneManager.scene.getObjectByName('TerrainMesh').geometry;
    return {
      ...world,
      color: () => Array.from(geometry().getAttribute('color').array.slice(0, 3)),
      height: () => geometry().getAttribute('position').getY(0),
    };
  }

  test.each([
    { level: 3, delay: 0 },
    { level: 3, delay: 1000 },
    { level: -4, delay: 0 },
    { level: -4, delay: 1000 },
  ])(
    'editing level $level then leaving after $delay ms restores color without losing heights',
    ({ level, delay }) => {
      const world = fixture();
      try {
        const original = world.color();
        world.engine.activate();
        world.engine.setHeightAt(0, 0, level);
        jest.runOnlyPendingTimers();
        expect(world.color()).not.toEqual(original);
        jest.advanceTimersByTime(delay);
        world.engine.deactivate();
        jest.runOnlyPendingTimers();
        expect(world.engine.save().heights[0][0]).toBe(level);
        expect(world.engine.isActive).toBe(false);
        expect(world.color()).toEqual(original);
        expect(world.height()).toBeCloseTo(level * 0.5);
      } finally {
        world.dispose();
      }
    }
  );

  test('entering and leaving Terrain Mode refreshes colors without a height edit', () => {
    const world = fixture();
    try {
      const original = world.color();
      world.engine.activate();
      jest.runOnlyPendingTimers();
      expect(world.color()).not.toEqual(original);
      world.engine.deactivate();
      jest.runOnlyPendingTimers();
      expect(world.color()).toEqual(original);
    } finally {
      world.dispose();
    }
  });

  test('leaving Terrain Mode restores the selected biome instead of a neutral override', () => {
    const world = fixture();
    try {
      world.engine.setHeightAt(0, 0, 3);
      world.engine.setBiome('forest', { generateIfFlat: false });
      jest.runOnlyPendingTimers();
      const original = world.color();
      world.engine.activate();
      jest.runOnlyPendingTimers();
      expect(world.color()).not.toEqual(original);
      world.engine.deactivate();
      jest.runOnlyPendingTimers();
      expect(world.color()).toEqual(original);
      expect(world.height()).toBeCloseTo(1.5);
    } finally {
      world.dispose();
    }
  });
});
