import { TerrainEngine } from '../../../src/terrain/TerrainEngine.js';
import { createTerrainWorld } from '../../helpers/terrainWorld.js';

describe('Placeable removal mode', () => {
  test('enabling removal clears the selected placeable and prevents placement selection', () => {
    const e = new TerrainEngine(5, 5);
    e.setSelectedPlaceable('tree-green-deciduous');
    e.setPlaceableRemovalMode(true);
    expect(e.isPlaceableRemovalMode()).toBe(true);
    expect(e.getSelectedPlaceable()).toBeNull();
    expect(e.setSelectedPlaceable('tree-green-conifer')).toBe(false);
    e.setPlaceableRemovalMode(false);
    expect(e.setSelectedPlaceable('tree-green-conifer')).toBe(true);
  });

  test('a removal click reaches the 3D plant-removal interface, not a deleted sprite manager', () => {
    const pool = { removePlantsAt: jest.fn() };
    const world = createTerrainWorld(5, 5, pool);
    const input = world.gm.terrainCoordinator.input;
    try {
      world.engine.activate();
      world.engine.setPlaceableRemovalMode(true);
      input.getGridCoordinatesFromEvent = () => ({ gridX: 2, gridY: 3 });
      input.handleMouseDown({
        button: 0,
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
      });
      expect(pool.removePlantsAt).toHaveBeenCalledTimes(1);
      expect(pool.removePlantsAt).toHaveBeenCalledWith(2, 3);
      expect(
        world.engine
          .save()
          .heights.flat()
          .every((height) => height === 0)
      ).toBe(true);
    } finally {
      world.dispose();
    }
  });
});
