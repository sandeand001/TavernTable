import {
  buildMovementRange,
  getMovementRoute,
} from '../../../../src/entities/creatures/TokenMovement.js';

function range(overrides = {}) {
  return buildMovementRange({
    cols: 7,
    rows: 3,
    startGridX: 2,
    startGridY: 1,
    speed: 50,
    tileWorldSize: 1,
    elevationUnit: 0.438,
    mode: 'run',
    getHeight: (x) => (x === 3 ? 1 : 0),
    maxVaultHeightDifference: 2.5 / (0.438 * 5),
    ...overrides,
  });
}

test('Run can cross a one-cell waist-high barrier with horizontal plus double-rise cost', () => {
  const route = getMovementRoute(range(), 4, 1);
  expect(route).toHaveLength(1);
  expect(route[0].vault).toEqual({ gridX: 3, gridY: 1, height: 1, rise: 1 });
  expect(route[0].cost).toBeCloseTo(10 + 2 * 0.438 * 5);
});

test('clicking the top still ends on top without vaulting beyond the goal', () => {
  const route = getMovementRoute(range(), 3, 1);
  expect(route.at(-1)).toMatchObject({ gridX: 3, gridY: 1, height: 1 });
  expect(route.at(-1).vault).toBeUndefined();
});

test.each([
  ['Walk', { mode: 'walk' }],
  ['too high', { getHeight: (x) => (x === 3 ? 2 : 0) }],
  ['too wide', { getHeight: (x) => (x === 3 || x === 4 ? 1 : 0) }],
  ['uneven landing', { getHeight: (x) => (x === 3 ? 1 : x >= 4 ? -1 : 0) }],
])('%s does not produce a vault edge', (_, overrides) => {
  const route = getMovementRoute(range(overrides), 5, 1);
  expect(route.some((cell) => cell.vault)).toBe(false);
});

test('an occupied landing and insufficient allowance cannot produce a partial vault', () => {
  expect(getMovementRoute(range({ blocked: new Set(['4,1']) }), 4, 1)).toBeNull();
  expect(getMovementRoute(range({ speed: 14 }), 4, 1)).toBeNull();
});
