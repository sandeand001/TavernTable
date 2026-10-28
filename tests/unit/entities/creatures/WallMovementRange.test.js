import {
  buildMovementRange,
  getMovementRoute,
  getWallMovementTarget,
  movementStepCost,
} from '../../../../src/entities/creatures/TokenMovement.js';

const faceId = '0,0>1,0';
const face = {
  id: faceId,
  low: { gridX: 0, gridY: 0, height: 0 },
  high: { gridX: 1, gridY: 0, height: 10 },
};

function range(options = {}) {
  return buildMovementRange({
    cols: 2,
    rows: 1,
    startGridX: 0,
    startGridY: 0,
    speed: 50,
    tileWorldSize: 1,
    elevationUnit: 1,
    getHeight: (x) => (x === 1 ? 10 : 0),
    maxDiagonalHeightDifference: 1,
    ...options,
  });
}

describe('Vertical wall movement allowance', () => {
  test('charges exactly double the climbing distance, not rounded whole-height chunks', () => {
    expect(movementStepCost(0, 1.2, 1, 1)).toBeCloseTo(17);
    expect(movementStepCost(1.2, 0, 1, 1, 'walk')).toBeCloseTo(17);
    expect(movementStepCost(1.2, 0, 1, 1, 'run')).toBe(5);
    expect(movementStepCost(0, 0.3, 1, 1)).toBe(5);
  });

  test('outlines a partial wall even when its top is unreachable', () => {
    const result = range();
    expect(result.tiles.has('1,0')).toBe(false);
    expect(result.walls.get(faceId).bands).toEqual([
      expect.objectContaining({ minHeight: 0, maxHeight: 4.5, baseCost: 5 }),
    ]);
    expect(getWallMovementTarget(result, faceId, 5)).toBeNull();
    expect(getWallMovementTarget(result, faceId, 4.5)).toMatchObject({
      height: 4.5,
      cost: 50,
    });
  });

  test('prefers five-foot heights without changing the raw out-of-range rule', () => {
    const result = range();
    expect(getWallMovementTarget(result, faceId, 2.94)).toMatchObject({
      height: 3,
      cost: 35,
    });
    expect(getWallMovementTarget(result, faceId, 4.5001)).toBeNull();
  });

  test('a hanging creature with 50 feet can climb exactly 25 vertical feet', () => {
    const result = range({ wallStart: { face, height: 2 } });
    expect(getWallMovementTarget(result, faceId, 7)).toMatchObject({
      height: 7,
      cost: 50,
      entryKey: result.startKey,
    });
    expect(getWallMovementTarget(result, faceId, 7.001)).toBeNull();
    expect(getMovementRoute(result, 0, 0)).toEqual([
      expect.objectContaining({ wallExit: 'low', cost: 20 }),
    ]);
  });

  test('Walk can descend to a reachable hanging point, not instantly reach the ground', () => {
    const result = range({ startGridX: 1, mode: 'walk' });
    expect(result.tiles.has('0,0')).toBe(false);
    expect(getWallMovementTarget(result, faceId, 6)).toMatchObject({
      height: 6,
      cost: 45,
    });
    expect(getWallMovementTarget(result, faceId, 5)).toBeNull();
  });

  test('Run falls freely but does not offer downward mid-air stopping points', () => {
    const result = range({ wallStart: { face, height: 8 }, mode: 'run' });
    expect(getMovementRoute(result, 0, 0)).toEqual([
      expect.objectContaining({ wallExit: 'low', cost: 0 }),
    ]);
    expect(getWallMovementTarget(result, faceId, 7)).toBeNull();
    expect(getWallMovementTarget(result, faceId, 9)).toMatchObject({
      height: 9,
      cost: 10,
    });
    expect(range({ startGridX: 1, mode: 'run' }).tiles.get('0,0').cost).toBe(5);
  });

  test('an attached creature can finish the climb and spend only the remaining budget on ground', () => {
    const result = range({
      cols: 8,
      wallStart: { face, height: 8 },
      getHeight: (x) => (x ? 10 : 0),
    });
    expect(getMovementRoute(result, 1, 0)[0]).toMatchObject({
      wallExit: 'high',
      cost: 20,
    });
    expect(result.tiles.get('7,0').cost).toBe(50);
  });

  test('does not allow lateral movement directly between wall faces', () => {
    const result = range({
      rows: 2,
      wallStart: { face, height: 5 },
      getHeight: (x) => (x ? 10 : 0),
    });
    expect(getWallMovementTarget(result, '0,1>1,1', 5)).toBeNull();
    expect(getMovementRoute(result, 0, 1)).toBeNull();
  });

  test('a wall slot occupied by another creature cannot be entered from above', () => {
    const result = range({ startGridX: 1, blocked: new Set(['0,0']) });
    expect(getWallMovementTarget(result, faceId, 8)).toBeNull();
  });

  test('the reachable upper wall resolves to a stable ledge hang instead of a partial mantle', () => {
    const result = range({ startGridX: 1, getWallRestHeight: () => 8 });
    expect(result.walls.get(faceId).bands).toEqual([
      expect.objectContaining({ minHeight: 5.5, maxHeight: 10 }),
    ]);
    expect(getWallMovementTarget(result, faceId, 9)).toMatchObject({
      height: 8,
      cost: 25,
      ledgeHang: true,
    });
    expect(getWallMovementTarget(result, faceId, 8)).toMatchObject({
      height: 8,
      cost: 25,
      ledgeHang: true,
    });
  });

  test('insufficient allowance to complete ledge entry offers no partial crouching destination', () => {
    const result = range({ startGridX: 1, speed: 10, getWallRestHeight: () => 8 });
    expect(result.walls.get(faceId).bands).toHaveLength(0);
    expect(getWallMovementTarget(result, faceId, 9.5)).toBeNull();
    expect(result.tiles.get('1,0').cost).toBe(0);
  });

  test('the exact minimum allowance can reach the stable wall boundary', () => {
    const result = range({ startGridX: 1, speed: 25, getWallRestHeight: () => 8 });
    expect(getWallMovementTarget(result, faceId, 8)).toMatchObject({
      height: 8,
      cost: 25,
      ledgeHang: true,
    });
    expect(getWallMovementTarget(result, faceId, 10)).toMatchObject({
      height: 8,
      cost: 25,
      ledgeHang: true,
    });
  });

  test('hanging at the lip and standing on top remain separate costed destinations', () => {
    const result = range({ wallStart: { face, height: 7 }, getWallRestHeight: () => 8 });
    expect(getWallMovementTarget(result, faceId, 9)).toMatchObject({
      height: 8,
      cost: 10,
      ledgeHang: true,
    });
    expect(getWallMovementTarget(result, faceId, 8)).toMatchObject({
      height: 8,
      cost: 10,
      ledgeHang: true,
    });
    expect(getMovementRoute(result, 1, 0)[0]).toMatchObject({ wallExit: 'high', cost: 30 });
  });

  test('rejects invalid authored wall-rest heights instead of silently drawing an unsafe range', () => {
    expect(() => range({ getWallRestHeight: () => 11 })).toThrow(/wall/i);
    expect(() => range({ getWallRestHeight: () => NaN })).toThrow(/wall/i);
  });

  test('validates a hanging start against live terrain instead of assuming ground level', () => {
    expect(() => range({ wallStart: { face, height: 12 } })).toThrow(/wall/i);
    expect(() => range({ wallStart: { face, height: 2 }, getHeight: () => 0 })).toThrow(/wall/i);
  });
});
