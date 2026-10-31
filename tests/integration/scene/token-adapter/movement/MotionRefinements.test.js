import { setTokenMovementSettings } from '../../../../../src/entities/creatures/TokenMovement.js';
import { CHARACTER_DEFINITIONS } from '../../../../../src/config/CharacterCatalog.js';
import {
  createHumanoidFixture,
  finishHumanoid,
  installHumanoidAssetFiles,
  stepHumanoid,
} from '../../../../helpers/humanoid-fixture.js';

let restoreFiles;
const fixtures = [];
beforeAll(() => {
  restoreFiles = installHumanoidAssetFiles();
});
afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.adapter.disposeMovementRange();
});
afterAll(() => restoreFiles());

async function fixture(options) {
  const created = await createHumanoidFixture(options);
  fixtures.push(created);
  return created;
}

test('a 4.38-foot Run drop at the captured height scale has an airborne phase', async () => {
  const f = await fixture({ height: 2, high: true, elevationUnit: 0.438 });
  setTokenMovementSettings(f.token, { mode: 'run', speed: 50 });
  expect(f.adapter.requestMoveToGrid(f.token, 5, 4)).toBeTruthy();
  const phases = new Set();
  finishHumanoid(f, () => phases.add(f.adapter._movementStates.get(f.token)?.phase));
  expect(phases.has('fall')).toBe(true);
  expect(f.token.world).toEqual({ x: 5.5, y: 0, z: 4.5 });
});

test.each([false, true])('a small step is continuous when descending=%s', async (high) => {
  const f = await fixture({ height: 1, high, elevationUnit: 0.1 });
  setTokenMovementSettings(f.token, { mode: 'run', speed: 50 });
  let previousY = f.mesh.position.y;
  let maxJump = 0;
  expect(f.adapter.requestMoveToGrid(f.token, high ? 5 : 6, 4)).toBeTruthy();
  finishHumanoid(f, () => {
    maxJump = Math.max(maxJump, Math.abs(f.mesh.position.y - previousY));
    previousY = f.mesh.position.y;
  });
  expect(maxJump).toBeLessThan(0.02);
  expect(f.token.world.y).toBeCloseTo(high ? 0 : 0.1);
});

test('changing to Walk before a queued vault uses controlled up/down traversal instead', async () => {
  const f = await fixture({ height: 0, elevationUnit: 0.438 });
  f.gm.getTerrainHeight = (x) => (x === 6 ? 1 : 0);
  f.token.gridX = 3;
  f.adapter._syncTokenAndMeshWorld({ token: f.token, mesh: f.mesh }, { x: 3.5, y: 0, z: 4.5 });
  setTokenMovementSettings(f.token, { mode: 'run', speed: 50 });
  expect(f.adapter.requestMoveToGrid(f.token, 7, 4)).toBeTruthy();
  for (let frame = 0; frame < 10; frame++) stepHumanoid(f);
  setTokenMovementSettings(f.token, { mode: 'walk' });
  f.adapter.applyMovementStyle(f.token);
  const kinds = new Set();
  finishHumanoid(f, () => {
    const kind = f.adapter._movementStates.get(f.token)?.traversal?.kind;
    if (kind) kinds.add(kind);
  });
  expect(kinds.has('vault')).toBe(false);
  expect(kinds.has('climb-low')).toBe(true);
  expect(kinds.has('lower-low')).toBe(true);
  expect(f.token.world).toEqual({ x: 7.5, y: 0, z: 4.5 });
});

test('a committed vault completes safely after a live switch to Walk', async () => {
  const f = await fixture({ height: 0, elevationUnit: 0.438 });
  f.gm.getTerrainHeight = (x) => (x === 6 ? 1 : 0);
  setTokenMovementSettings(f.token, { mode: 'run', speed: 50 });
  f.adapter.requestMoveToGrid(f.token, 7, 4);
  for (let frame = 0; frame < 40; frame++) stepHumanoid(f);
  setTokenMovementSettings(f.token, { mode: 'walk' });
  f.adapter.applyMovementStyle(f.token);
  expect(f.adapter._movementStates.get(f.token).traversal.kind).toBe('vault');
  expect(f.adapter.requestMoveToGrid(f.token, 4, 4)).toBeNull();
  finishHumanoid(f);
  expect(f.token.world).toEqual({ x: 7.5, y: 0, z: 4.5 });
  expect(f.token.__ttWorldLock).toBeUndefined();
});

describe.each(CHARACTER_DEFINITIONS.map(({ id }) => id))('%s traversal handoffs', (type) => {
  test('Run carries momentum straight into an already aligned vault', async () => {
    const f = await fixture({ type, height: 0, elevationUnit: 0.402 });
    f.gm.getTerrainHeight = (x) => (x === 6 ? 1 : 0);
    setTokenMovementSettings(f.token, { mode: 'run', speed: 50 });
    expect(f.adapter.requestMoveToGrid(f.token, 7, 4)).toBeTruthy();
    const initialX = f.token.world.x;
    for (let frame = 0; frame < 12; frame++) stepHumanoid(f);
    expect(f.token.world.x - initialX).toBeGreaterThan(0.03);
  });

  test('Run keeps moving through the approach, vault and continuing route', async () => {
    const f = await fixture({ type, height: 0, elevationUnit: 0.402 });
    f.gm.getTerrainHeight = (x) => (x === 6 ? 1 : 0);
    f.token.gridX = 3;
    f.adapter._syncTokenAndMeshWorld({ token: f.token, mesh: f.mesh }, { x: 3.5, y: 0, z: 4.5 });
    setTokenMovementSettings(f.token, { mode: 'run', speed: 50 });
    expect(f.adapter.requestMoveToGrid(f.token, 9, 4)).toBeTruthy();
    let previousX = f.token.world.x;
    let pause = 0;
    let longestPause = 0;
    finishHumanoid(f, () => {
      if (f.token.world.x > 4.5 && f.token.world.x < 8.5) {
        pause = Math.abs(f.token.world.x - previousX) < 1e-6 ? pause + 1 / 120 : 0;
        longestPause = Math.max(longestPause, pause);
      }
      previousX = f.token.world.x;
    });
    expect(longestPause).toBeLessThan(0.05);
    expect(f.token.world).toEqual({ x: 9.5, y: 0, z: 4.5 });
  });

  test('Walk does not slide its planted feet through the end of a ledge recovery', async () => {
    const f = await fixture({ type, height: 1, elevationUnit: 0.402 });
    setTokenMovementSettings(f.token, { mode: 'walk', speed: 50 });
    expect(f.adapter.requestMoveToGrid(f.token, 6, 4)).toBeTruthy();
    const held = [];
    finishHumanoid(f, () => {
      const motion = f.adapter._movementStates.get(f.token)?.traversal;
      const phase = motion?.phases[motion.index];
      if (
        phase?.key === 'recoverShort' &&
        motion.elapsed >= phase.duration - 0.25 &&
        motion.elapsed <= phase.duration - 0.025
      ) {
        held.push({
          local: motion.sample.feet.map((point) => ({ ...point })),
          world: f.adapter._rootBones.get(f.token)[0].footBones.map((bone) => ({
            x: bone.matrixWorld.elements[12],
            z: bone.matrixWorld.elements[14],
          })),
        });
      }
    });
    expect(held.length).toBeGreaterThan(10);
    const drift = (key) =>
      held[0][key].map((point, index) =>
        Math.hypot(held.at(-1)[key][index].x - point.x, held.at(-1)[key][index].z - point.z)
      );
    expect(Math.min(...drift('local'))).toBeLessThan(0.02);
    expect(Math.min(...drift('world'))).toBeLessThan(0.02);
  });

  test('Walk keeps a supported foot planted while crouching to lower from a ledge', async () => {
    const f = await fixture({ type, height: 1, high: true, elevationUnit: 0.402 });
    setTokenMovementSettings(f.token, { mode: 'walk', speed: 50 });
    expect(f.adapter.requestMoveToGrid(f.token, 5, 4)).toBeTruthy();
    let previous;
    let slip = 0;
    let contacts = 0;
    finishHumanoid(f, () => {
      const motion = f.adapter._movementStates.get(f.token)?.traversal;
      const phase = motion?.phases[motion.index];
      if (
        phase?.key !== 'recoverShort' ||
        motion.elapsed < 0.12 ||
        motion.elapsed > phase.duration - 0.025
      ) {
        previous = null;
        return;
      }
      const feet = f.adapter._rootBones.get(f.token)[0].footBones.map((bone) => ({
        x: bone.matrixWorld.elements[12],
        y: bone.matrixWorld.elements[13],
        z: bone.matrixWorld.elements[14],
      }));
      if (previous) {
        const distances = feet.map((point, index) =>
          point.y < 0.427 && previous[index].y < 0.427
            ? Math.hypot(point.x - previous[index].x, point.z - previous[index].z)
            : Infinity
        );
        const planted = Math.min(...distances);
        if (Number.isFinite(planted)) {
          slip += planted;
          contacts++;
        }
      }
      previous = feet;
    });
    expect(contacts).toBeGreaterThan(20);
    expect(slip).toBeLessThan(0.04);
  });

  test('a necessary turn consumes only its own time before traversal continues', async () => {
    const f = await fixture({ type, height: 1, high: true, elevationUnit: 0.402 });
    f.token.facingAngle = Math.PI;
    f.adapter._applyOrientationImmediate(f.token, Math.PI);
    setTokenMovementSettings(f.token, { mode: 'walk', speed: 50 });
    expect(f.adapter.requestMoveToGrid(f.token, 5, 4)).toBeTruthy();
    const initialX = f.token.world.x;
    const turn = f.adapter._movementStates.get(f.token).traversal;
    expect(turn.turnDuration).toBeCloseTo(0.18);
    stepHumanoid(f, 0.2);
    expect(f.token.facingAngle).toBeCloseTo(0);
    expect(f.token.world.x).toBeLessThan(initialX - 0.001);
  });

  test('Walk crosses a narrow obstacle with controlled, continuous up/down motion', async () => {
    const f = await fixture({ type, height: 0, elevationUnit: 0.402 });
    f.gm.getTerrainHeight = (x) => (x === 6 ? 1 : 0);
    setTokenMovementSettings(f.token, { mode: 'walk', speed: 50 });
    expect(f.adapter.requestMoveToGrid(f.token, 7, 4).cost).toBeCloseTo(18.04);
    const kinds = new Set();
    let previous = { ...f.token.world };
    let jump = 0;
    finishHumanoid(f, () => {
      const kind = f.adapter._movementStates.get(f.token)?.traversal?.kind;
      if (kind) kinds.add(kind);
      jump = Math.max(
        jump,
        Math.hypot(
          f.token.world.x - previous.x,
          f.token.world.y - previous.y,
          f.token.world.z - previous.z
        )
      );
      previous = { ...f.token.world };
      for (const foot of f.adapter._rootBones.get(f.token)[0].footBones) {
        const x = foot.matrixWorld.elements[12];
        if (x > 6.02 && x < 6.98)
          expect(foot.matrixWorld.elements[13]).toBeGreaterThanOrEqual(0.402 - 0.03);
      }
    });
    expect(kinds).toEqual(new Set(['climb-low', 'lower-low']));
    expect(jump).toBeLessThan(0.1);
    expect(f.token.world).toEqual({ x: 7.5, y: 0, z: 4.5 });
    expect(f.token.__ttWorldLock).toBeUndefined();
    expect(f.data.current).toBe('idle');
  });
});

describe.each(CHARACTER_DEFINITIONS.map(({ id }) => id))('%s short authored traversal', (type) => {
  test.each([
    [false, 'walk', 'climb-low'],
    [true, 'walk', 'lower-low'],
    [true, 'run', 'hop-down'],
  ])('uses the correct low-ledge motion from high=%s in %s', async (high, mode, kind) => {
    const f = await fixture({ type, height: 1, high, elevationUnit: 0.438 });
    setTokenMovementSettings(f.token, { mode, speed: 50 });
    const result = f.adapter.requestMoveToGrid(f.token, high ? 5 : 6, 4);
    expect(result.cost).toBeCloseTo(mode === 'run' ? 5 : 5 + 2 * 0.438 * 5);
    expect(f.adapter._movementStates.get(f.token).traversal.kind).toBe(kind);
    let previous = f.token.world.y;
    let jump = 0;
    finishHumanoid(f, () => {
      jump = Math.max(jump, Math.abs(f.token.world.y - previous));
      previous = f.token.world.y;
      for (const foot of f.adapter._rootBones.get(f.token)[0].footBones) {
        if (foot.matrixWorld.elements[12] > 6.02)
          expect(foot.matrixWorld.elements[13]).toBeGreaterThanOrEqual(0.438 - 0.03);
      }
    });
    expect(jump).toBeLessThan(0.06);
    expect(f.token.world).toEqual({ x: high ? 5.5 : 6.5, y: high ? 0 : 0.438, z: 4.5 });
    expect(f.token.__ttWorldLock).toBeUndefined();
    expect(f.data.current).toBe('idle');
  });

  test('vaults completely onto a clear landing without clipping its feet through the box', async () => {
    const f = await fixture({ type, height: 0, elevationUnit: 0.438 });
    f.gm.getTerrainHeight = (x) => (x === 6 ? 1 : 0);
    setTokenMovementSettings(f.token, { mode: 'run', speed: 50 });
    expect(f.adapter.requestMoveToGrid(f.token, 7, 4).cost).toBeCloseTo(14.38);
    expect(f.adapter._movementStates.get(f.token).traversal.kind).toBe('vault');
    let previous = { ...f.token.world };
    let maxJump = 0;
    for (let frame = 0; frame < 3000 && f.adapter.isMovementInProgress(f.token); frame++) {
      stepHumanoid(f);
      const stepDistance = Math.hypot(
        f.token.world.x - previous.x,
        f.token.world.y - previous.y,
        f.token.world.z - previous.z
      );
      maxJump = Math.max(maxJump, stepDistance);
      previous = { ...f.token.world };
      for (const foot of f.adapter._rootBones.get(f.token)[0].footBones) {
        const x = foot.matrixWorld.elements[12],
          y = foot.matrixWorld.elements[13];
        if (x > 6.02 && x < 6.98) expect(y).toBeGreaterThanOrEqual(0.438 - 0.025);
      }
    }
    expect(f.adapter.isMovementInProgress(f.token)).toBe(false);
    expect(maxJump).toBeLessThan(0.1);
    expect(f.token.world).toEqual({ x: 7.5, y: 0, z: 4.5 });
    expect(f.token.__ttWorldLock).toBeUndefined();
  });
});
