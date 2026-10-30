import { ActivationHelpers } from '../../../../src/coordinators/terrain-coordinator/ActivationHelpers.js';
import * as three from 'three';
import { TerrainDataStore } from '../../../../src/terrain/TerrainDataStore.js';
import { TerrainMeshBuilder } from '../../../../src/scene/terrain/TerrainMeshBuilder.js';
import { TerrainRebuilder } from '../../../../src/scene/terrain/TerrainRebuilder.js';
import {
  applyTerrainModeGridTint,
  restoreTerrainModeGridTint,
} from '../../../../src/coordinators/terrain-coordinator/internals/rendering/gridTint.js';

describe('ActivationHelpers.disableTerrainMode', () => {
  test('clears flags, applies base integration, resets UI, and repaints biome', () => {
    const c = {
      isTerrainModeActive: true,
      isDragging: true,
      lastModifiedCell: '0,0',
      gameManager: {},
      applyTerrainToBaseGrid: jest.fn(),
      resetHeightIndicator: jest.fn(),
      applyBiomePaletteToBaseGrid: jest.fn(),
    };

    global.window = global.window || {};
    window.selectedBiome = 'forest';

    const helpers = new ActivationHelpers(c);
    helpers.disableTerrainMode();

    // Flags cleared
    expect(c.isTerrainModeActive).toBe(false);
    expect(c.isDragging).toBe(false);
    expect(c.lastModifiedCell).toBeNull();

    // Base integration
    expect(c.applyTerrainToBaseGrid).toHaveBeenCalled();

    // UI reset
    expect(c.resetHeightIndicator).toHaveBeenCalled();

    // Biome repaint called when a biome is selected and terrain mode is off
    expect(c.applyBiomePaletteToBaseGrid).toHaveBeenCalled();
  });
});

describe('terrain editing color lifecycle', () => {
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
    const dataStore = new TerrainDataStore(1, 1);
    const gm = {
      cols: 1,
      rows: 1,
      threeSceneManager: {
        scene: new three.Scene(),
        three,
        setTerrainMeshOpacity: jest.fn(),
      },
    };
    const c = {
      gameManager: gm,
      dataStore,
      isTerrainModeActive: false,
      applyTerrainToBaseGrid: () => dataStore.applyWorkingToBase(),
      applyBiomePaletteToBaseGrid: jest.fn(),
      resetHeightIndicator: jest.fn(),
      applyTerrainModeGridTint: () => applyTerrainModeGridTint(c),
      restoreTerrainModeGridTint: () => restoreTerrainModeGridTint(c),
    };
    gm.terrainCoordinator = c;
    gm.getTerrainHeight = (x, y) =>
      c.isTerrainModeActive ? dataStore.get(x, y) : dataStore.base[y][x];
    const rebuilder = new TerrainRebuilder({
      gameManager: gm,
      builder: new TerrainMeshBuilder({ forceAdvanced: true, hardEdges: true }),
      debounceMs: 120,
    });
    gm.terrainRebuilder = rebuilder;
    gm.notifyTerrainHeightsChanged = () => rebuilder.request({ three });
    rebuilder.rebuild({ three });
    const color = () =>
      Array.from(
        gm.threeSceneManager.scene
          .getObjectByName('TerrainMesh')
          .geometry.getAttribute('color')
          .array.slice(0, 3)
      );
    const height = () =>
      gm.threeSceneManager.scene
        .getObjectByName('TerrainMesh')
        .geometry.getAttribute('position')
        .getY(0);
    return { c, gm, color, height };
  }

  test.each([
    { level: 3, delay: 0 },
    { level: 3, delay: 1000 },
    { level: -4, delay: 0 },
    { level: -4, delay: 1000 },
  ])(
    'editing level $level then leaving after $delay ms restores color without losing mesh heights',
    ({ level, delay }) => {
      const { c, gm, color, height } = fixture();
      const original = color();
      c.isTerrainModeActive = true;
      c.applyTerrainModeGridTint();
      c.dataStore.set(0, 0, level);
      gm.notifyTerrainHeightsChanged();
      jest.runOnlyPendingTimers();
      expect(color()).not.toEqual(original);
      jest.advanceTimersByTime(delay);

      new ActivationHelpers(c).disableTerrainMode();
      jest.runOnlyPendingTimers();

      expect(c.dataStore.base[0][0]).toBe(level);
      expect(c.isTerrainModeActive).toBe(false);
      expect(color()).toEqual(original);
      expect(height()).toBeCloseTo(level * 0.5);
    }
  );

  test('entering and leaving Terrain Mode refreshes colors even without a height edit', () => {
    const { c, color } = fixture();
    const original = color();
    c.isTerrainModeActive = true;
    c.applyTerrainModeGridTint();
    jest.runOnlyPendingTimers();
    expect(color()).not.toEqual(original);

    new ActivationHelpers(c).disableTerrainMode();
    jest.runOnlyPendingTimers();
    expect(color()).toEqual(original);
  });

  test('leaving Terrain Mode restores the selected biome rather than a neutral override', () => {
    window.selectedBiome = 'forest';
    window.__TT_USER_SELECTED_BIOME__ = true;
    const { c, gm, color, height } = fixture();
    c.dataStore.set(0, 0, 3);
    c.applyTerrainToBaseGrid();
    gm.terrainRebuilder.rebuild({ three });
    const original = color();

    c.isTerrainModeActive = true;
    c.applyTerrainModeGridTint();
    jest.runOnlyPendingTimers();
    expect(color()).not.toEqual(original);
    new ActivationHelpers(c).disableTerrainMode();
    jest.runOnlyPendingTimers();

    expect(color()).toEqual(original);
    expect(height()).toBeCloseTo(1.5);
  });
});
