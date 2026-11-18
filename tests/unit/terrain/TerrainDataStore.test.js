import { TerrainDataStore } from '../../../src/terrain/TerrainDataStore.js';

test('committing several terrain cells publishes one atomic store change', () => {
  const store = new TerrainDataStore(3, 2);
  const changed = jest.fn();
  store.subscribe(changed);

  store.setMany(
    [
      { x: 0, y: 0, height: 2 },
      { x: 2, y: 1, height: -1 },
    ],
    { commit: true }
  );

  expect(changed).toHaveBeenCalledTimes(1);
  expect(store.get(0, 0)).toBe(2);
  expect(store.get(2, 1)).toBe(-1);
  expect(store.base).toEqual(store.working);
});
