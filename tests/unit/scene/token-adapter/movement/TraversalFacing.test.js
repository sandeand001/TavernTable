import * as three from 'three';
import { CHARACTER_DEFINITIONS } from '../../../../../src/config/CharacterCatalog.js';
import { setTokenMovementSettings } from '../../../../../src/entities/creatures/TokenMovement.js';
import {
  createHumanoidFixture,
  finishHumanoid,
  handPositions,
  humanoidBounds,
  installHumanoidAssetFiles,
} from '../../../../helpers/humanoid-fixture.js';

const directions = [
  { side: 'east', dx: 1, dz: 0 },
  { side: 'south', dx: 0, dz: 1 },
  { side: 'west', dx: -1, dz: 0 },
  { side: 'north', dx: 0, dz: -1 },
];
const cases = CHARACTER_DEFINITIONS.map(({ id }) => id).flatMap((type) =>
  directions.map((direction) => ({ type, ...direction }))
);
let restoreFiles;
let fixtures;
beforeAll(() => {
  restoreFiles = installHumanoidAssetFiles();
});
beforeEach(() => {
  fixtures = [];
});
afterEach(() => {
  for (const f of fixtures) f.adapter.disposeMovementRange();
});
afterAll(() => restoreFiles());

async function fixture({ type, dx, dz }, height, high = false) {
  const f = await createHumanoidFixture({ type, height: 0, warmupFrames: 0 });
  fixtures.push(f);
  f.gm.getTerrainHeight = (x, y) => (dx * (x - 5) + dz * (y - 4) >= 1 ? height : 0);
  f.gm.spatial.elevationUnit = height === 1 ? 0.402 : 0.3;
  if (high) {
    f.token.gridX = 5 + dx;
    f.token.gridY = 4 + dz;
    f.adapter._syncTokenAndMeshWorld(
      { token: f.token, mesh: f.mesh },
      {
        x: f.token.gridX + 0.5,
        y: height * f.gm.spatial.elevationUnit,
        z: f.token.gridY + 0.5,
      }
    );
  }
  f.token.facingAngle = -Math.PI / 2;
  f.adapter.updateTokenOrientation(f.token);
  setTokenMovementSettings(f.token, { mode: 'walk', speed: 50 });
  return f;
}

function assertFacing(f, dx, dz) {
  f.mesh.updateMatrixWorld(true);
  const forward = new three.Vector3(0, 0, 1).transformDirection(f.mesh.matrixWorld);
  expect(forward.x * dx + forward.z * dz).toBeCloseTo(1, 7);
}

const surface = (dx, dz, y) => ({
  point: { x: 5.5 + dx * 0.5, y, z: 4.5 + dz * 0.5 },
  normal: { x: -dx, y: 0, z: -dz },
});

test.each(
  cases.flatMap((item) =>
    [
      { descending: false, mode: 'walk', travel: 'ascending', sign: 1, kind: 'climb-low' },
      { descending: true, mode: 'walk', travel: 'descending', sign: 1, kind: 'lower-low' },
      { descending: true, mode: 'run', travel: 'hopping down', sign: -1, kind: 'hop-down' },
    ].map((travel) => ({ ...item, ...travel }))
  )
)(
  '$type short traversal $side faces correctly while $travel',
  async (item) => {
    const f = await fixture(item, 1, item.descending);
    setTokenMovementSettings(f.token, { mode: item.mode });
    const goal = { x: item.descending ? 5 : 5 + item.dx, z: item.descending ? 4 : 4 + item.dz };
    expect(f.adapter.requestMoveToGrid(f.token, goal.x, goal.z)).toBeTruthy();
    expect(f.adapter._movementStates.get(f.token).traversal.kind).toBe(item.kind);
    let samples = 0;
    finishHumanoid(f, () => {
      const motion = f.adapter._movementStates.get(f.token)?.traversal;
      if (
        motion &&
        motion.turnTime >= motion.turnDuration - 1e-8 &&
        motion.phases[motion.index]?.key
      ) {
        samples++;
        assertFacing(f, item.dx * item.sign, item.dz * item.sign);
      }
    });
    expect(samples).toBeGreaterThan(30);
    expect(f.token.world).toEqual({
      x: goal.x + 0.5,
      y: item.descending ? 0 : 0.402,
      z: goal.z + 0.5,
    });
  },
  30000
);

test.each(cases)(
  '$type forward vault faces $side throughout its authored motion',
  async (item) => {
    const f = await fixture(item, 1);
    f.gm.getTerrainHeight = (x, y) => (item.dx * (x - 5) + item.dz * (y - 4) === 1 ? 1 : 0);
    setTokenMovementSettings(f.token, { mode: 'run' });
    const x = 5 + item.dx * 2;
    const z = 4 + item.dz * 2;
    expect(f.adapter.requestMoveToGrid(f.token, x, z)).toBeTruthy();
    expect(f.adapter._movementStates.get(f.token).traversal.kind).toBe('vault');
    let samples = 0;
    finishHumanoid(f, () => {
      const motion = f.adapter._movementStates.get(f.token)?.traversal;
      if (
        motion &&
        motion.turnTime >= motion.turnDuration - 1e-8 &&
        motion.phases[motion.index]?.key
      ) {
        samples++;
        assertFacing(f, item.dx, item.dz);
      }
    });
    expect(samples).toBeGreaterThan(30);
    expect(f.token.world).toEqual({ x: x + 0.5, y: 0, z: z + 0.5 });
  },
  30000
);

test.each(cases)(
  '$type turns toward its $side climb after a perpendicular ground approach',
  async (item) => {
    const f = await fixture(item, 1);
    const x = 5 - item.dz * 2 + item.dx;
    const z = 4 + item.dx * 2 + item.dz;
    expect(f.adapter.requestMoveToGrid(f.token, x, z)).toBeTruthy();
    let samples = 0;
    finishHumanoid(f, () => {
      const motion = f.adapter._movementStates.get(f.token)?.traversal;
      if (
        motion &&
        motion.turnTime >= motion.turnDuration - 1e-8 &&
        motion.phases[motion.index]?.key
      ) {
        samples++;
        assertFacing(f, item.dx, item.dz);
      }
    });
    expect(samples).toBeGreaterThan(30);
    expect(f.token.world).toEqual({ x: x + 0.5, y: 0.402, z: z + 0.5 });
  },
  30000
);

test.each(cases)(
  '$type cover faces away from its $side support wall without clipping',
  async (item) => {
    const f = await fixture(item, 24);
    await f.adapter.playTokenAction(f.token, 'action-cover');
    finishHumanoid(f);
    assertFacing(f, -item.dx, -item.dz);
    expect(f.data.current).toBe('actionCoverHold');
    const bounds = humanoidBounds(f);
    const plane = item.dx ? 5.5 + item.dx * 0.5 : 4.5 + item.dz * 0.5;
    const back =
      item.dx > 0
        ? bounds.max.x
        : item.dx < 0
          ? bounds.min.x
          : item.dz > 0
            ? bounds.max.z
            : bounds.min.z;
    expect(back).toBeCloseTo(plane - (item.dx || item.dz) * 0.02, 2);
    expect(Math.abs(bounds.min.y)).toBeLessThan(0.03);
  },
  30000
);

test.each(cases)(
  '$type wall loop, downward loop, ledge and restored hold face $side',
  async (item) => {
    const f = await fixture(item, 24);
    expect(f.adapter.requestMoveToSurface(f.token, surface(item.dx, item.dz, 4))).toBeTruthy();
    finishHumanoid(f);
    assertFacing(f, item.dx, item.dz);
    expect(f.adapter.getStablePlacement(f.token).pose.wall.clip).toBe('climbWall');
    expect(f.adapter.requestMoveToSurface(f.token, surface(item.dx, item.dz, 3))).toBeTruthy();
    finishHumanoid(f);
    assertFacing(f, item.dx, item.dz);
    expect(f.adapter.getStablePlacement(f.token).pose.wall.clip).toBe('climbWallDown');
    expect(f.adapter.requestMoveToSurface(f.token, surface(item.dx, item.dz, 7))).toBeTruthy();
    finishHumanoid(f);
    assertFacing(f, item.dx, item.dz);
    const saved = f.adapter.getStablePlacement(f.token);
    expect(saved.pose.wall.clip).toBe('ledgeHang');
    const plane = item.dx ? 5.5 + item.dx * 0.5 : 4.5 + item.dz * 0.5;
    for (const hand of handPositions(f)) {
      expect(Math.abs((item.dx ? hand.x : hand.z) - plane)).toBeLessThan(0.02);
      expect(hand.y).toBeCloseTo(7.2, 2);
    }
    const restored = await fixture(item, 24);
    await restored.adapter.restoreStablePlacement(restored.token, saved);
    assertFacing(restored, item.dx, item.dz);
    expect(restored.token.world).toEqual(f.token.world);
    expect(restored.adapter.isMovementInProgress(restored.token)).toBe(false);
  },
  30000
);
