import * as three from 'three';
import { setTokenMovementSettings } from '../../../../../src/entities/creatures/TokenMovement.js';
import {
  createHumanoidFixture,
  finishHumanoid as finish,
  handPositions as hands,
  installHumanoidAssetFiles,
  stepHumanoid as step,
  wallSurface as surface,
} from '../../../../helpers/humanoid-fixture.js';

async function createWallFixture(height = 24, high = false, extraAnimations = []) {
  return createHumanoidFixture({
    height,
    high,
    warmupFrames: 0,
    animationKeys: [
      'idle',
      'walk',
      'climb',
      'climbWall',
      'climbWallDown',
      'climbRecover',
      ...extraAnimations,
    ],
  });
}

async function replayWall(deltas = [1 / 120], height = 24, legacy = false) {
  const fixture = await createWallFixture(height);
  const { adapter, token, bones, data } = fixture;
  const action = data.actions.climbWall;
  const animationChanges = jest.spyOn(adapter, '_setAnimation');
  expect(
    legacy ? adapter.navigateToGrid(token, 7, 4) : adapter.requestMoveToGrid(token, 7, 4)
  ).toBeTruthy();
  let previous = null;
  let cycles = 0;
  let maxHandStep = 0;
  let maxHandSpeed = 0;
  let minCycleWeight = 1;
  let maxClockError = 0;
  for (let frame = 0; frame < 12000 && adapter.isMovementInProgress(token); frame++) {
    const delta = deltas[frame % deltas.length];
    step(fixture, delta);
    const state = adapter._movementStates.get(token);
    const motion = state?.wallMotion;
    const onSurface = motion?.stage === 'surface' && motion.clip === 'climbWall';
    if (state?.phase !== 'climb-wall' && !onSurface) {
      previous = null;
      continue;
    }
    const current = {
      elapsed: onSurface
        ? ((motion.loopClock % motion.wallDuration) + motion.wallDuration) % motion.wallDuration
        : state.climbWallElapsed,
      time: action.time,
      hands: bones.map((bone) => bone.getWorldPosition(new three.Vector3())),
    };
    if (previous) {
      if (current.elapsed < previous.elapsed) cycles++;
      if (cycles > 0) {
        for (let i = 0; i < bones.length; i++) {
          const distance = current.hands[i].distanceTo(previous.hands[i]);
          maxHandStep = Math.max(maxHandStep, distance);
          maxHandSpeed = Math.max(maxHandSpeed, distance / delta);
        }
        minCycleWeight = Math.min(minCycleWeight, action.getEffectiveWeight());
        const period = action.getClip().duration;
        const difference = Math.abs(current.time - current.elapsed) % period;
        maxClockError = Math.max(maxClockError, Math.min(difference, period - difference));
      }
    }
    previous = current;
  }
  expect(adapter.isMovementInProgress(token)).toBe(false);
  adapter.disposeMovementRange();
  return {
    cycles,
    maxHandStep,
    maxHandSpeed,
    minCycleWeight,
    maxClockError,
    world: token.world,
    wallStarts: animationChanges.mock.calls.filter(([, key]) => key === 'climbWall').length,
  };
}

describe('Actual-FBX wall-climb continuity', () => {
  let restoreFiles;

  beforeAll(() => {
    restoreFiles = installHumanoidAssetFiles();
  });

  afterAll(() => restoreFiles());

  test.each([
    ['30', [1 / 30]],
    ['60', [1 / 60]],
    ['120', [1 / 120]],
    ['uneven', [0.011, 0.023, 0.017, 0.031]],
  ])('wall-cycle poses and clocks remain continuous at %s FPS', async (_, deltas) => {
    const result = await replayWall(deltas);
    expect(result.cycles).toBeGreaterThan(1);
    expect(result.wallStarts).toBe(1);
    expect(result.maxHandSpeed).toBeLessThan(4);
    expect(result.minCycleWeight).toBeGreaterThan(0.99);
    expect(result.maxClockError).toBeLessThan(1e-5);
    expect(result.world.x).toBeCloseTo(7.5);
    expect(result.world.y).toBeCloseTo(7.2);
    expect(result.world.z).toBeCloseTo(4.5);
  });

  test('legacy navigation also retains continuous wall cycles with uneven frame timing', async () => {
    const result = await replayWall([0.011, 0.023, 0.017, 0.031], 24, true);
    expect(result.cycles).toBeGreaterThan(1);
    expect(result.wallStarts).toBe(1);
    expect(result.maxHandSpeed).toBeLessThan(4);
    expect(result.minCycleWeight).toBeGreaterThan(0.99);
    expect(result.maxClockError).toBeLessThan(1e-5);
  });

  test.each([
    ['30 FPS', [1 / 30]],
    ['120 FPS', [1 / 120]],
    ['uneven frames', [0.011, 0.023, 0.017, 0.031]],
  ])(
    'the downloaded downward clip plays forward continuously and holds/resumes at %s',
    async (_, deltas) => {
      const fixture = await createWallFixture(24, true);
      const { adapter, token, data } = fixture;
      expect(data.actions.climbWallDown?.getClip().duration).toBeCloseTo(2);
      expect(data.rootMotion.wallDown.displacementLocal.y).toBeLessThan(0);
      setTokenMovementSettings(token, { speed: 50 });
      const changes = jest.spyOn(adapter, '_setAnimation');
      let previous = null;
      let maxSpeed = 0;
      let lastClock = -Infinity;
      let cycles = 0;
      const descend = (height, expectedCost) => {
        expect(adapter.requestMoveToSurface(token, surface(height)).cost).toBeCloseTo(expectedCost);
        for (let frame = 0; frame < 12000 && adapter.isMovementInProgress(token); frame++) {
          const dt = deltas[frame % deltas.length];
          step(fixture, dt);
          const motion = adapter._movementStates.get(token)?.wallMotion;
          if (motion?.clip !== 'climbWallDown') {
            previous = null;
            continue;
          }
          expect(motion.loopClock).toBeGreaterThanOrEqual(lastClock);
          lastClock = motion.loopClock;
          cycles = Math.max(cycles, Math.floor(motion.loopClock / motion.wallDuration));
          const current = hands(fixture);
          if (previous) {
            for (let i = 0; i < current.length; i++)
              maxSpeed = Math.max(maxSpeed, current[i].distanceTo(previous[i]) / dt);
          }
          previous = current;
        }
        expect(adapter.isMovementInProgress(token)).toBe(false);
        for (let i = 0; i < 40; i++) step(fixture);
        expect(data.current).toBe('climbWallDown');
        expect(token.world.y).toBeCloseTo(height);
      };
      descend(4, 37);
      const held = hands(fixture);
      const time = data.actions.climbWallDown.time;
      for (let frame = 0; frame < 120; frame++) step(fixture);
      expect(data.actions.climbWallDown.time).toBe(time);
      expect(hands(fixture).every((hand, index) => hand.distanceTo(held[index]) < 1e-8)).toBe(true);
      previous = hands(fixture);
      descend(3, 10);
      expect(cycles).toBeGreaterThan(1);
      expect(maxSpeed).toBeLessThan(4);
      expect(data.actions.climbWallDown.getEffectiveWeight()).toBeGreaterThan(0.99);
      expect(changes.mock.calls.filter(([, key]) => key === 'climbWallDown')).toHaveLength(1);
      adapter.disposeMovementRange();
    }
  );

  test('actual hands hold still and resume with the corresponding upward or downward clip', async () => {
    const fixture = await createWallFixture();
    const { adapter, token, data } = fixture;
    setTokenMovementSettings(token, { speed: 50 });
    const changes = jest.spyOn(adapter, '_setAnimation');
    expect(adapter.requestMoveToSurface(token, surface(4)).cost).toBe(45);
    finish(fixture);
    const held = hands(fixture);
    const heldTime = data.actions.climbWall.time;
    for (let frame = 0; frame < 120; frame++) step(fixture);
    expect(data.actions.climbWall.time).toBe(heldTime);
    expect(hands(fixture).every((hand, index) => hand.distanceTo(held[index]) < 1e-8)).toBe(true);
    expect(token.world.y).toBeCloseTo(4);
    let maxSpeed = 0;
    for (const [height, cost, key] of [
      [5, 10, 'climbWall'],
      [3, 20, 'climbWallDown'],
    ]) {
      let previous = hands(fixture);
      expect(adapter.requestMoveToSurface(token, surface(height)).cost).toBeCloseTo(cost);
      finish(fixture, () => {
        const current = hands(fixture);
        for (let i = 0; i < current.length; i++)
          maxSpeed = Math.max(maxSpeed, current[i].distanceTo(previous[i]) * 120);
        previous = current;
      });
      expect(token.world.y).toBeCloseTo(height);
      expect(data.actions[key].getEffectiveWeight()).toBeCloseTo(1);
    }
    expect(maxSpeed).toBeLessThan(4);
    expect(changes.mock.calls.filter(([, key]) => key === 'climbWall')).toHaveLength(1);
    expect(adapter.requestMoveToGrid(token, 6, 4).cost).toBeCloseTo(42);
    finish(fixture);
    expect(token.world.x).toBeCloseTo(6.5);
    expect(token.gridX).toBe(6);
    expect(token.gridY).toBe(4);
    adapter.disposeMovementRange();
  });

  test('the upper wall remains selectable and finishes in a stable ledge-hanging pose', async () => {
    const fixture = await createWallFixture(24, true);
    const { adapter, token, data } = fixture;
    setTokenMovementSettings(token, { speed: 50 });
    const range = adapter.getTokenMovementRange(token);
    const face = range.walls.get('5,4>6,4');
    const ceiling = face.restHeight * fixture.gm.spatial.elevationUnit;
    expect(ceiling).toBeGreaterThan(5);
    expect(ceiling).toBeLessThan(6);
    expect(face.bands.some((band) => band.maxHeight === face.high.height)).toBe(true);
    expect(adapter.requestMoveToSurface(token, surface(7)).cost).toBeCloseTo(
      5 + (7.2 - ceiling) * 10
    );
    finish(fixture);
    expect(token.world.y).toBeCloseTo(ceiling);
    expect(data.current).toBe('ledgeHang');
    for (const hand of hands(fixture)) {
      expect(hand.x).toBeCloseTo(6, 2);
      expect(hand.y).toBeCloseTo(7.2, 2);
    }
    const held = hands(fixture);
    for (let frame = 0; frame < 120; frame++) step(fixture);
    expect(hands(fixture).every((hand, index) => hand.distanceTo(held[index]) < 1e-8)).toBe(true);
    expect(adapter.requestMoveToSurface(token, surface(4)).cost).toBeCloseTo((ceiling - 4) * 10);
    let previous = hands(fixture);
    let maxStep = 0;
    finish(fixture, () => {
      const current = hands(fixture);
      for (let i = 0; i < current.length; i++)
        maxStep = Math.max(maxStep, current[i].distanceTo(previous[i]));
      previous = current;
    });
    expect(maxStep).toBeLessThan(0.05);
    expect(token.world.y).toBeCloseTo(4);
    expect(data.current).toBe('climbWallDown');
    expect(adapter.requestMoveToGrid(token, 5, 4).cost).toBeCloseTo(40);
    finish(fixture);
    expect(token.world).toEqual({ x: 5.5, y: 0, z: 4.5 });
    expect(token.gridX).toBe(5);
    expect(token.__ttWorldLock).toBeUndefined();
    expect(data.current).toBe('idle');
    adapter.disposeMovementRange();
  });

  test('an unaffordable ledge entry ends standing at the edge, never paused in recovery', async () => {
    const fixture = await createWallFixture(24, true, ['run', 'fall', 'fallLoop', 'hardLanding']);
    const { adapter, token, data } = fixture;
    setTokenMovementSettings(token, { speed: 10, mode: 'run' });
    const changes = jest.spyOn(adapter, '_setAnimation');
    expect(adapter.requestMoveToGrid(token, 5, 4).cost).toBe(5);
    const job = adapter._movementRoutes.get(token);
    setTokenMovementSettings(token, { mode: 'walk' });
    adapter.applyMovementStyle(token);
    finish(fixture);
    expect(token.world.y).toBeCloseTo(7.2);
    expect(token.world.x).toBeGreaterThan(6);
    expect(token.world.x).toBeLessThan(6.5);
    expect(token.gridX).toBe(6);
    expect(data.current).toBe('idle');
    expect(changes.mock.calls.some(([, key]) => key.startsWith('climb'))).toBe(false);
    expect(job.spent).toBe(5);
    expect(token.__ttWorldLock).toBeUndefined();
    const box = new three.Box3().setFromObject(adapter._findFirstSkinnedMesh(fixture.mesh), true);
    expect(box.max.y - box.min.y).toBeGreaterThan(0.85);
    adapter.disposeMovementRange();
  });

  test('the held ring centers on the real posed body instead of the canonical feet', async () => {
    const fixture = await createWallFixture(24, true);
    const { adapter, token, mesh } = fixture;
    setTokenMovementSettings(token, { speed: 50 });
    expect(adapter.requestMoveToSurface(token, surface(4))).toBeTruthy();
    finish(fixture);
    adapter._selectedToken = token;
    await adapter._showSelectionIndicator(token);
    mesh.updateMatrixWorld(true);
    const ring = token.__ttSelectionIndicator;
    const bodyBounds = new three.Box3();
    mesh.traverseVisible((child) => {
      if (child.isMesh && child !== ring && child !== mesh.userData.__ttSelectionCollider)
        bodyBounds.union(new three.Box3().setFromObject(child, true));
    });
    const expected = bodyBounds.getCenter(new three.Vector3());
    const actual = ring.getWorldPosition(new three.Vector3());
    expect(actual.y).toBeCloseTo(expected.y, 5);
    expect(actual.z).toBeCloseTo(expected.z, 5);
    expect(actual.x).toBeCloseTo(5.98, 5);
    expect(actual.y).toBeGreaterThan(token.world.y + 0.1);
    adapter._discardSelectionIndicator(token);
    adapter.disposeMovementRange();
  });

  test.each([
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ])('edge-hang hands attach to the lip for wall direction (%s,%s)', async (dx, dz) => {
    const fixture = await createWallFixture(24, true);
    const { adapter, token, gm, mesh, data } = fixture;
    gm.getTerrainHeight = (x, y) => {
      const raised = dx ? (dx > 0 ? x >= 6 : x <= 4) : dz > 0 ? y >= 5 : y <= 3;
      return raised ? 24 : 0;
    };
    token.gridX = 5 + dx;
    token.gridY = 4 + dz;
    token.world = { x: token.gridX + 0.5, y: 7.2, z: token.gridY + 0.5 };
    mesh.position.set(token.world.x, token.world.y, token.world.z);
    const wall = { x: 5.5 + dx * 0.5, y: 7, z: 4.5 + dz * 0.5 };
    setTokenMovementSettings(token, { speed: 50 });
    expect(
      adapter.requestMoveToSurface(token, {
        point: wall,
        normal: { x: -dx, y: 0, z: -dz },
      })
    ).toBeTruthy();
    finish(fixture);
    expect(data.current).toBe('ledgeHang');
    expect(adapter._movementStates.get(token).wallMotion.holding).toBe(true);
    for (const hand of hands(fixture)) {
      expect(hand.y).toBeCloseTo(7.2, 2);
      expect((hand.x - wall.x) * dx + (hand.z - wall.z) * dz).toBeCloseTo(0, 2);
    }
    adapter.disposeMovementRange();
  });

  test('a climber can reach the upper edge from below, hang, then finish onto the platform', async () => {
    const fixture = await createWallFixture(24, false);
    const { adapter, token, data } = fixture;
    setTokenMovementSettings(token, { speed: 50 });
    expect(adapter.requestMoveToSurface(token, surface(4)).cost).toBe(45);
    finish(fixture);
    const face = adapter.getTokenMovementRange(token).walls.get('5,4>6,4');
    const anchor = face.restHeight * fixture.gm.spatial.elevationUnit;
    expect(adapter.requestMoveToSurface(token, surface(7.1)).cost).toBeCloseTo((anchor - 4) * 10);
    finish(fixture);
    expect(data.current).toBe('ledgeHang');
    for (const hand of hands(fixture)) expect(hand.y).toBeCloseTo(7.2, 2);
    expect(adapter.requestMoveToGrid(token, 6, 4).cost).toBeCloseTo((7.2 - anchor) * 10);
    finish(fixture);
    expect(token.world.x).toBeCloseTo(6.5);
    expect(token.world.y).toBeCloseTo(7.2);
    expect(token.gridX).toBe(6);
    expect(data.current).toBe('idle');
    expect(token.__ttWorldLock).toBeUndefined();
    adapter.disposeMovementRange();
  });

  test('Run releases the actual hanging pose and completes a free drop and landing', async () => {
    const fixture = await createWallFixture(24, true, ['run', 'fall', 'fallLoop', 'hardLanding']);
    const { adapter, token, data } = fixture;
    setTokenMovementSettings(token, { speed: 50 });
    expect(adapter.requestMoveToSurface(token, surface(4))).toBeTruthy();
    finish(fixture);
    setTokenMovementSettings(token, { mode: 'run' });
    adapter.applyMovementStyle(token);
    expect(adapter.requestMoveToSurface(token, surface(3))).toBeNull();
    expect(adapter.requestMoveToGrid(token, 5, 4).cost).toBe(0);
    for (
      let frame = 0;
      frame < 120 && adapter._movementStates.get(token)?.phase !== 'fall';
      frame++
    )
      step(fixture);
    expect(adapter._movementStates.get(token).phase).toBe('fall');
    setTokenMovementSettings(token, { mode: 'walk' });
    adapter.applyMovementStyle(token);
    expect(adapter._movementStates.get(token).phase).toBe('fall');
    let airborne = 0;
    while (token.world.y > 1e-8 && airborne < 5) {
      step(fixture);
      airborne += 1 / 120;
    }
    const expectedAirtime = Math.sqrt(40 / 32.174);
    expect(airborne).toBeGreaterThanOrEqual(expectedAirtime - 1e-9);
    expect(airborne).toBeLessThan(expectedAirtime + 1 / 120);
    finish(fixture);
    expect(token.world).toEqual({ x: 5.5, y: 0, z: 4.5 });
    expect(token.__ttWorldLock).toBeUndefined();
    expect(data.current).toBe('idle');
    adapter.disposeMovementRange();
  });

  test.each([
    ['30 FPS', [1 / 30]],
    ['120 FPS', [1 / 120]],
    ['uneven frames', [0.011, 0.023, 0.017, 0.031]],
  ])(
    'actual falling and landing clips retain physical airtime and contact at %s',
    async (_, deltas) => {
      const fixture = await createWallFixture(24, true, [
        'run',
        'fall',
        'fallLoop',
        'hardLanding',
        'fallToRoll',
      ]);
      const { adapter, token, data } = fixture;
      setTokenMovementSettings(token, { speed: 50, mode: 'run' });
      expect(adapter.requestMoveToGrid(token, 5, 4).cost).toBe(5);
      for (
        let frame = 0;
        frame < 600 && adapter._movementStates.get(token)?.phase !== 'fall';
        frame++
      )
        step(fixture, deltas[frame % deltas.length]);
      const state = adapter._movementStates.get(token);
      expect(state.phase).toBe('fall');
      const duration = Math.sqrt((2 * token.world.y * 5) / 32.174);
      const startY = token.world.y;
      let elapsed = 0;
      let frame = 0;
      while (token.world.y > 1e-8) {
        const delta = deltas[frame++ % deltas.length];
        elapsed += delta;
        step(fixture, delta);
        expect(frame).toBeLessThan(600);
        expect(token.world.y).toBeCloseTo(
          Math.max(startY - (0.5 * 32.174 * elapsed ** 2) / 5, 0),
          5
        );
      }
      expect(elapsed).toBeGreaterThanOrEqual(duration - 1e-9);
      expect(elapsed).toBeLessThan(duration + Math.max(...deltas) + 1e-9);
      expect(state.phase).toBe('fall');
      expect(state.fallMode).toBe('landing');
      const key = state.fallLandingKey;
      const contactTime = data.landingContactTimes[key];
      const action = data.actions[key];
      expect(action.time).toBeCloseTo(contactTime + elapsed - duration, 5);
      expect(action.getEffectiveTimeScale()).toBe(1);
      fixture.mesh.updateMatrixWorld(true);
      const feet = adapter._rootBones.get(token)[0].footBones;
      const lowestToe = Math.min(
        ...feet.map((bone) => bone.getWorldPosition(new three.Vector3()).y)
      );
      expect(lowestToe).toBeGreaterThan(-0.05);
      expect(lowestToe).toBeLessThan(0.1);
      finish(fixture);
      expect(data.current).toBe('idle');
      expect(token.gridX).toBe(5);
      expect(token.__ttWorldLock).toBeUndefined();
      adapter.disposeMovementRange();
    }
  );
});
