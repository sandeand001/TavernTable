import {
  buildMovementRange,
  facingAngleFromDirection,
  getMovementRoute,
  getTokenMovementSettings,
  movementStepCost,
  setTokenMovementSettings,
} from '../../../../src/entities/creatures/TokenMovement.js';

describe('shared facing convention', () => {
  test.each(Array.from({ length: 8 }, (_, index) => (index * Math.PI) / 4))(
    'world heading %s maps to rendered +Z-forward facing without reflection',
    (heading) => {
      const x = Math.cos(heading) * 3;
      const z = Math.sin(heading) * 3;
      const angle = facingAngleFromDirection(x, z);
      expect(Math.cos(angle)).toBeCloseTo(x / 3, 10);
      expect(-Math.sin(angle)).toBeCloseTo(z / 3, 10);
    }
  );
  test.each([
    [0, 0],
    [NaN, 1],
    [1, Infinity],
    [undefined, 1],
  ])('rejects an invalid facing direction (%s, %s)', (x, z) =>
    expect(() => facingAngleFromDirection(x, z)).toThrow('finite, non-zero')
  );
});

function range(options = {}) {
  return buildMovementRange({
    cols: 25,
    rows: 25,
    startGridX: 12,
    startGridY: 12,
    speed: 50,
    tileWorldSize: 1,
    elevationUnit: 1,
    getHeight: () => 0,
    ...options,
  });
}

describe('Character movement settings and range', () => {
  test('defaults to 50 feet, Walk, Default and stores settings per token', () => {
    const first = {};
    const second = {};
    expect(getTokenMovementSettings(first)).toEqual({ speed: 50, mode: 'walk', type: 'default' });
    setTokenMovementSettings(first, { speed: 25, mode: 'run', type: 'drunk' });
    expect(getTokenMovementSettings(first)).toEqual({ speed: 25, mode: 'run', type: 'drunk' });
    expect(getTokenMovementSettings(second).speed).toBe(50);
  });

  test.each([
    { speed: -1 },
    { speed: NaN },
    { speed: Infinity },
    { speed: '50' },
    { mode: 'sprint' },
    { type: 'random' },
  ])('rejects invalid settings without changing the token: %p', (settings) => {
    const token = {};
    expect(() => setTokenMovementSettings(token, settings)).toThrow();
    expect(token.movementSettings).toBeUndefined();
  });

  test('50 feet includes exactly ten straight or diagonal steps, not eleven', () => {
    const result = range();
    expect(result.tiles.get('22,12').cost).toBe(50);
    expect(result.tiles.get('22,22').cost).toBe(50);
    expect(result.tiles.has('23,12')).toBe(false);
    expect(result.tiles.has('23,23')).toBe(false);
    expect(result.tiles.size).toBe(21 * 21);
    expect(getMovementRoute(result, 22, 22)).toHaveLength(10);
    expect(getMovementRoute(result, 23, 23)).toBeNull();
  });

  test('zero allowance highlights only the starting cell', () => {
    expect(range({ speed: 0 }).tiles.size).toBe(1);
  });

  test('charges double vertical distance for climbing, but not small steps or Run falls', () => {
    expect(movementStepCost(0, 0.3, 1, 1)).toBe(5);
    expect(movementStepCost(0, 0.99, 1, 1)).toBeCloseTo(14.9);
    expect(movementStepCost(0, 1, 1, 1)).toBe(15);
    expect(movementStepCost(0, 2, 1, 1)).toBe(25);
    expect(movementStepCost(2, 0, 1, 1)).toBe(25);
    expect(movementStepCost(2, 0, 1, 1, 'run')).toBe(5);
    expect(movementStepCost(0, 2, 2, 1)).toBe(15);
  });

  test('counts all intermediate climbs rather than just the target height', () => {
    const result = range({
      cols: 5,
      rows: 1,
      startGridX: 0,
      startGridY: 0,
      speed: 55,
      getHeight: (x) => [0, 2, 0, 2, 0][x],
    });
    expect(result.tiles.get('1,0').cost).toBe(25);
    expect(result.tiles.get('2,0').cost).toBe(50);
    expect(result.tiles.has('3,0')).toBe(false);
  });

  test('finds a cheaper reachable route around a costly ridge and returns that same route', () => {
    const result = range({
      cols: 5,
      rows: 3,
      startGridX: 0,
      startGridY: 1,
      speed: 20,
      getHeight: (x, y) => (x === 2 && y === 1 ? 10 : 0),
    });
    const route = getMovementRoute(result, 4, 1);
    expect(route).not.toBeNull();
    expect(route.at(-1).cost).toBe(20);
    expect(route.some((cell) => cell.gridX === 2 && cell.gridY === 1)).toBe(false);
  });

  test('cannot cut through occupied corners or climb across a cliff corner', () => {
    const blocked = range({
      cols: 2,
      rows: 2,
      startGridX: 0,
      startGridY: 0,
      blocked: new Set(['1,0', '0,1']),
    });
    expect(blocked.tiles.has('1,1')).toBe(false);
    const cliff = range({
      cols: 2,
      rows: 2,
      startGridX: 0,
      startGridY: 0,
      speed: 20,
      elevationUnit: 0.25,
      getHeight: (x, y) => (x === 1 && y === 1 ? 4 : 0),
      maxDiagonalHeightDifference: 4,
    });
    expect(getMovementRoute(cliff, 1, 1)).toHaveLength(2);
    expect(cliff.tiles.get('1,1').cost).toBe(20);
  });

  test('uses board bounds and supports non-unit tiles and elevation scales', () => {
    const result = range({
      cols: 2,
      rows: 1,
      startGridX: 0,
      startGridY: 0,
      speed: 15,
      tileWorldSize: 2,
      elevationUnit: 0.5,
      getHeight: (x) => x * 4,
    });
    expect(result.tiles.size).toBe(2);
    expect(result.tiles.get('1,0').cost).toBe(15);
  });
});
