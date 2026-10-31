import {
  buildMovementRange,
  getMovementRoute,
  movementStepCost,
} from '../../../../src/entities/creatures/TokenMovement.js';

const range = (updates = {}) =>
  buildMovementRange({
    cols: 7,
    rows: 1,
    startGridX: 0,
    startGridY: 0,
    speed: 30,
    tileWorldSize: 1,
    elevationUnit: 0.3,
    getHeight: () => 0,
    prone: true,
    ...updates,
  });

test('crawling costs two feet of movement per foot traveled', () => {
  const crawl = range();
  expect(movementStepCost(0, 0, 1, 0.3, 'walk', Infinity, true)).toBe(10);
  expect(getMovementRoute(crawl, 3, 0).at(-1).cost).toBe(30);
  expect(getMovementRoute(crawl, 4, 0)).toBeNull();
  expect(getMovementRoute(range({ prone: false }), 6, 0).at(-1).cost).toBe(30);
});

test('prone blocks a standing climb or vault, while a downward ledge still falls', () => {
  expect(getMovementRoute(range({ getHeight: (x) => (x === 0 ? 0 : 10) }), 1, 0)).toBeNull();
  const downhill = range({ getHeight: (x) => (x === 0 ? 10 : 0), mode: 'walk' });
  expect(getMovementRoute(downhill, 1, 0).at(-1).cost).toBe(10);
  expect([...downhill.walls.values()].every((wall) => wall.bands.length === 0)).toBe(true);
  const obstacle = range({
    cols: 3,
    getHeight: (x) => (x === 1 ? 2 : 0),
    mode: 'run',
    maxVaultHeightDifference: 3,
  });
  expect(getMovementRoute(obstacle, 2, 0)).toBeNull();
});

test('invalid prone movement flags do not silently create an ordinary range', () => {
  expect(() => range({ prone: 'yes' })).toThrow('valid grid');
});
