import { Group } from 'three';
import { Token3DAdapter } from '../../../../../src/scene/Token3DAdapter.js';
import { MANNEQUIN_MODEL } from '../../../../../src/config/token-adapter/MannequinConfig.js';

function createCliffFixture(x = 5.5, height = 8, elevationUnit = 0.3, tileSize = 1) {
  const mesh = new Group();
  mesh.userData.__ttBillboard = false;
  const world = { x: x * tileSize, y: x >= 6 ? height * elevationUnit : 0, z: 4.5 * tileSize };
  mesh.position.set(world.x, world.y, world.z);
  const token = {
    gridX: Math.floor(x),
    gridY: 4,
    facingAngle: 0,
    world,
    __threeMesh: mesh,
  };
  const adapter = new Token3DAdapter({
    cols: 12,
    rows: 8,
    placedTokens: [token],
    is3DModeActive: () => true,
    getTerrainHeight: (gridX) => (gridX >= 6 ? height : 0),
    spatial: {
      tileWorldSize: tileSize,
      elevationUnit,
      gridToWorld: (gridX, gridY, elevation) => ({
        x: gridX * tileSize,
        y: elevation * elevationUnit,
        z: gridY * tileSize,
      }),
      worldToGrid: (worldX, worldZ) => ({
        gridX: Math.floor(worldX / tileSize),
        gridY: Math.floor(worldZ / tileSize),
      }),
    },
  });
  const action = (duration) => ({ getClip: () => ({ duration }) });
  adapter._tokenAnimationData.set(token, {
    actions: {
      idle: action(6),
      walk: action(1),
      climb: action(3.8),
      climbWall: action(2),
      climbRecover: action(0.6),
      fall: action(1.06),
      fallLoop: action(1),
      hardLanding: action(2),
      fallToRoll: action(1.4),
    },
    profile: { walkSpeed: 1 },
    landingContactTimes: { fall: 8 / 30, hardLanding: 3 / 30, fallToRoll: 2 / 30 },
    current: 'walk',
  });
  adapter._setAnimation = jest.fn();
  const state = adapter._ensureMovementState(token);
  state.phase = 'walk';
  state.movementSign = 1;
  state.lastMoveSign = 1;
  state.intentHold = true;
  state.forwardKeys.add('ArrowUp');
  return { adapter, token, mesh, state };
}

function enterFall(feet = 36, elevationUnit = 0.3, options = {}) {
  const tileSize = options.tileSize ?? 1;
  const fixture = createCliffFixture(
    6.5,
    (feet * tileSize) / 5 / elevationUnit,
    elevationUnit,
    tileSize
  );
  const { adapter, token, mesh, state } = fixture;
  const data = adapter._tokenAnimationData.get(token);
  if (options.disableLoop) delete data.actions.fallLoop;
  data.profile = { ...MANNEQUIN_MODEL.movementProfile, walkSpeed: 1 };
  state.profile = data.profile;
  token.facingAngle = Math.PI;
  if (options.airborneRelease) {
    const startWorld = { ...token.world };
    const targetWorld = { x: 5.5 * tileSize, y: 0, z: 4.5 * tileSize };
    state.activeStep = {
      tokenEntry: token,
      mesh,
      startWorld,
      targetWorld,
      startPosition: { ...startWorld },
      targetPosition: { ...targetWorld },
      totalDistance: Math.hypot(tileSize, startWorld.y),
      horizontalDistance: tileSize,
      traveled: 0,
      horizontalTraveled: 0,
      requiresFall: true,
      fallTriggered: false,
      fallTriggerProgress: 0.66,
      heightDrop: startWorld.y / elevationUnit,
      gridTargetX: 5,
      gridTargetY: 4,
    };
  } else {
    state.activeStep = adapter._createForwardMovementStep(token, mesh);
  }
  state.activeStep.landingVariant = options.landingKey || 'hardLanding';
  state.stepFinalized = false;
  adapter._advanceMovementStep(state, 0.67 * tileSize);
  expect(state.phase).toBe('fall');
  return fixture;
}

function airborneDuration({ adapter, token, state }, deltas = [1 / 120]) {
  let elapsed = 0;
  let frame = 0;
  while (token.world.y > 1e-6 && elapsed < 60) {
    const delta = deltas[frame++ % deltas.length];
    adapter._advanceFallPhase(state, delta);
    elapsed += delta;
  }
  return elapsed;
}

describe('Mannequin cliff traversal', () => {
  test.each([20, 36, 60])(
    'a %s-foot drop reaches ground at gravitational speed, independently of landing recovery',
    (feet) => {
      const fixture = enterFall(feet);
      const delta = 1 / 120;
      const elapsed = airborneDuration(fixture, [delta]);
      const expected = Math.sqrt((2 * feet) / 32.174);
      expect(elapsed).toBeGreaterThanOrEqual(expected - 1e-6);
      expect(elapsed).toBeLessThan(expected + delta + 1e-6);
      expect(fixture.token.world.y).toBe(0);
    }
  );

  test('the creature accelerates downward rather than drifting at a constant speed', () => {
    const { adapter, token, state } = enterFall();
    const startY = token.world.y;
    adapter._advanceFallPhase(state, 0.25);
    const firstDrop = startY - token.world.y;
    adapter._advanceFallPhase(state, 0.25);
    const secondDrop = startY - firstDrop - token.world.y;
    expect(firstDrop).toBeCloseTo((0.5 * 32.174 * 0.25 ** 2) / 5, 6);
    expect(secondDrop).toBeCloseTo(firstDrop * 3, 6);
  });

  test('equal physical heights have the same airtime at different terrain elevation scales', () => {
    const durations = [0.15, 0.3, 0.5].map((unit) => airborneDuration(enterFall(36, unit)));
    expect(Math.max(...durations) - Math.min(...durations)).toBeLessThan(1 / 120);
  });

  test('airborne travel is separate from the length of the landing recovery clip', () => {
    const short = enterFall();
    const long = enterFall();
    long.state.fallLandingDuration = 12;
    long.adapter._tokenAnimationData.get(long.token).actions.hardLanding = {
      getClip: () => ({ duration: 12 }),
    };
    expect(airborneDuration(long)).toBeCloseTo(airborneDuration(short), 6);
  });

  test.each([0.5, 2, 3])('world tiles sized %s retain the same physical fall time', (tileSize) => {
    const elapsed = airborneDuration(enterFall(36, 0.3, { tileSize }));
    expect(elapsed).toBeCloseTo(Math.ceil(Math.sqrt(72 / 32.174) * 120) / 120, 6);
  });

  test.each([
    ['30 FPS', [1 / 30]],
    ['60 FPS', [1 / 60]],
    ['120 FPS', [1 / 120]],
    ['uneven frames', [0.011, 0.023, 0.017, 0.031]],
  ])('airtime and landing contact remain aligned at %s', (_, deltas) => {
    const { adapter, token, state } = enterFall();
    const duration = state.fallTrajectory.duration;
    const cue = duration - 0.1;
    let elapsed = 0;
    let frame = 0;
    while (state.fallMode === 'loop') {
      const delta = deltas[frame++ % deltas.length];
      elapsed += delta;
      adapter._advanceFallPhase(state, delta);
      expect(frame).toBeLessThan(300);
    }
    expect(elapsed).toBeGreaterThanOrEqual(cue);
    const action = adapter._tokenAnimationData.get(token).actions.hardLanding;
    expect(action.time).toBeCloseTo(elapsed - cue, 6);
    const rest = airborneDuration({ adapter, token, state }, deltas);
    const arrival = elapsed + rest;
    expect(arrival).toBeGreaterThanOrEqual(duration - 1e-9);
    expect(arrival).toBeLessThanOrEqual(duration + Math.max(...deltas) + 1e-9);
    expect(state.phase).toBe('fall');
  });

  test('a short drop skips excess pre-contact frames instead of hanging in the air', () => {
    const { adapter, token, state } = enterFall(0.3, 0.01, {
      landingKey: 'fall',
      airborneRelease: true,
    });
    const duration = Math.sqrt(0.6 / 32.174);
    const action = adapter._tokenAnimationData.get(token).actions.fall;
    expect(state.fallMode).toBe('landing');
    expect(action.time).toBeCloseTo(8 / 30 - duration, 6);
    expect(airborneDuration({ adapter, token, state })).toBeLessThan(duration + 1 / 120);
  });

  test('a missing fall loop holds the landing intro until its contact cue', () => {
    const { adapter, token, state } = enterFall(36, 0.3, { disableLoop: true });
    const action = adapter._tokenAnimationData.get(token).actions.hardLanding;
    expect(action.paused).toBe(true);
    adapter._advanceFallPhase(state, 0.5);
    expect(action.paused).toBe(true);
    expect(token.world.y).toBeGreaterThan(0);
    adapter._advanceFallPhase(state, state.fallTrajectory.duration - 0.5);
    expect(action.paused).toBe(false);
    expect(action.time).toBeCloseTo(0.1);
    expect(token.world.y).toBe(0);
  });

  test('horizontal travel stays steady while the vertical fall accelerates', () => {
    const { adapter, token, state } = enterFall();
    const start = { ...token.world };
    const goal = state.activeStep.targetWorld;
    adapter._advanceFallPhase(state, state.fallTrajectory.duration * 0.5);
    expect(token.world.x).toBeCloseTo((start.x + goal.x) * 0.5, 6);
    expect(token.world.y).toBeCloseTo(start.y * 0.75, 6);
  });

  test('does not turn the arrival tolerance into an oversized final movement', () => {
    const { adapter, token, state } = createCliffFixture(0.7);
    state.pathActive = true;
    state.pathTolerance = 0.35;
    state.pathGoal = { gridX: 1, gridY: 4, world: { x: 1, y: 0, z: 4.5 } };

    adapter._advanceFreeMovement(state, 0.016);

    expect(token.world.x).toBeCloseTo(0.716);
    expect(state.pathReached).toBe(false);
    expect(token.gridX).toBe(0);
  });

  test('detects a cliff from physical position even after traveling several stored grid cells', () => {
    const { adapter, token, mesh } = createCliffFixture(6.5);
    token.gridX = 8;
    token.facingAngle = Math.PI;

    const step = adapter._createForwardMovementStep(token, mesh);

    expect(step.requiresFall).toBe(true);
    expect(step.gridStartX).toBe(6);
    expect(step.gridTargetX).toBe(5);
    expect(step.heightDrop).toBe(8);
  });

  test('keeps walking speed horizontal until the feet leave the cliff', () => {
    const { adapter, token, mesh, state } = createCliffFixture(6.5);
    token.facingAngle = Math.PI;
    state.activeStep = adapter._createForwardMovementStep(token, mesh);
    state.stepFinalized = false;

    adapter._advanceMovementStep(state, 0.016);

    expect(token.world.x).toBeCloseTo(6.484);
    expect(token.world.y).toBeCloseTo(2.4);
    expect(state.phase).toBe('walk');
  });

  test('starts the fall trajectory at the edge instead of reusing the consumed approach', () => {
    const { adapter, token, mesh, state } = createCliffFixture(6.5);
    token.facingAngle = Math.PI;
    state.activeStep = adapter._createForwardMovementStep(token, mesh);
    state.stepFinalized = false;
    adapter._advanceMovementStep(state, 0.67);
    const step = state.activeStep;
    const startY = token.world.y;

    expect(state.phase).toBe('fall');
    expect(step.startWorld.x).toBeCloseTo(token.world.x);
    expect(step.traveled).toBe(0);
    adapter._advanceFallPhase(state, state.fallDuration * 0.1);

    expect(token.world.y).toBeCloseTo(startY * 0.99);
  });

  test('does not resume a held movement that was released while airborne', () => {
    const { adapter, state } = createCliffFixture();
    state.phase = 'fall';
    state.__fallResumeContext = { intentHold: true, movementSign: 1, pathActive: false };
    state.forwardKeys.clear();

    expect(adapter._resumeMovementAfterFall(state)).toBe(false);
  });

  test.each([
    [0.15, 'fall', 8 / 30],
    [0.3, 'hardLanding', 3 / 30],
    [0.5, 'fallToRoll', 2 / 30],
  ])(
    'times the landing from contact frames at elevation unit %s',
    (elevationUnit, expectedLanding, contactTime) => {
      const { adapter, token, mesh, state } = createCliffFixture(6.5, 8, elevationUnit);
      token.facingAngle = Math.PI;
      state.activeStep = adapter._createForwardMovementStep(token, mesh);
      state.stepFinalized = false;
      adapter._advanceMovementStep(state, 0.67);
      const speed = state.fallSpeed;
      const step = state.activeStep;
      const trajectory = state.fallTrajectory;
      const cue = Math.max(trajectory.duration - contactTime, 0);
      expect(state.fallLandingThreshold).toBeCloseTo(
        step.startWorld.y - step.targetWorld.y - 0.5 * trajectory.gravity * cue ** 2
      );
      adapter._transitionFallToLanding(state);
      expect(state.fallSpeed).toBe(speed);
      expect(state.fallLandingKey).toBe(expectedLanding);
    }
  );

  test('preserves the authored roll distance even when the airborne segment is short', () => {
    const { adapter } = createCliffFixture();

    const offset = adapter._sanitizeLandingRootOffset(
      { horizontalDistance: 0.25 },
      { x: 1.5, y: -0.1, z: 0 },
      'fallToRoll'
    );

    expect(offset).toEqual({ x: 1.5, y: 0, z: 0 });
  });

  test('uses a braced landing when there is not enough terrain for the roll', () => {
    const { adapter, token, mesh, state } = createCliffFixture(6.5, 10);
    token.facingAngle = Math.PI;
    state.activeStep = adapter._createForwardMovementStep(token, mesh);
    state.stepFinalized = false;
    adapter._hasLandingRollClearance = jest.fn().mockReturnValue(false);

    adapter._advanceMovementStep(state, 0.67);

    expect(state.fallLandingKey).toBe('hardLanding');
    expect(state.activeStep.landingVariant).toBe('hardLanding');
  });

  test('locates the actual cliff plane for an off-center diagonal approach', () => {
    const { adapter } = createCliffFixture(7.4);

    const edge = adapter._findTerrainTransition(
      { x: 7.4, y: 2.4, z: 4.2 },
      { x: 5.3, y: 0, z: 5.6 },
      (fromHeight, toHeight) => fromHeight - toHeight > 3
    );

    expect(edge.world.x).toBeCloseTo(6);
    expect(edge.world.z).toBeCloseTo(5.133333);
    expect(edge.fromGrid).toEqual({ gridX: 6, gridY: 5 });
    expect(edge.toGrid).toEqual({ gridX: 5, gridY: 5 });
  });

  test('finishes wall motion continuously instead of jumping half a segment', () => {
    const { adapter, token, state } = createCliffFixture();
    Object.assign(state, {
      phase: 'climb-wall',
      climbWallActive: true,
      climbWallElapsed: 1.98,
      climbWallDuration: 2,
      climbWallStartWorld: { x: 5.84, y: 0, z: 4.5 },
      climbWallTargetWorld: { x: 5.84, y: 1.2, z: 4.5 },
    });
    adapter._startNextClimbWallSegment = jest.fn();

    adapter._advanceClimbWallPhase(state, 0.01);
    const before = token.world.y;
    adapter._advanceClimbWallPhase(state, 0.01);

    expect(token.world.y).toBeCloseTo(1.2);
    expect(token.world.y - before).toBeLessThan(0.02);
  });

  test('anchors recovery at the ledge without adding an artificial crouch drop', () => {
    const { adapter, token, state } = createCliffFixture();
    state.climbLastWorld = { x: 6.04, y: 2.4, z: 4.5 };
    state.climbTargetWorld = { ...state.climbLastWorld };
    state.climbFinalWorld = { x: 6.5, y: 2.4, z: 4.5 };

    adapter._startClimbRecoverPhase(state);
    adapter._advanceClimbRecoverPhase(state, 0.2);

    expect(token.world).toEqual({ x: 6.04, y: 2.4, z: 4.5 });
    expect(state.phase).toBe('climb-recover');
  });

  test.each(['climb-wall', 'fall'])('defers rotation during %s', (phase) => {
    const { adapter, token, mesh, state } = createCliffFixture();
    mesh.userData.__tt3DToken = true;
    state.phase = phase;
    state.activeStep = null;
    token.facingAngle = Math.PI / 2;

    adapter.updateTokenOrientation(token);

    expect(mesh.rotation.y).toBe(0);
    expect(state.pendingFacingAngle).toBeCloseTo(Math.PI / 2);
  });

  test('wall-to-mantle and ledge advance preserve a requested post-climb turn', () => {
    const { adapter, token, state } = createCliffFixture();
    state.phase = 'climb-wall';
    state.pendingFacingAngle = Math.PI / 2;
    token.facingAngle = Math.PI / 2;
    const foot = { x: 5.84, y: 1.2, z: 4.5 };
    const final = { x: 6.5, y: 2.4, z: 4.5 };

    adapter._startClimbPhase(
      state,
      { footWorld: foot, edgeWorld: { ...foot, y: 2.4 }, finalWorld: final },
      { skipWallPlan: true }
    );
    expect(state.pendingFacingAngle).toBeCloseTo(Math.PI / 2);

    adapter._startClimbAdvancePhase(state, { x: 6.1, y: 2.4, z: 4.5 }, final);
    expect(state.pendingFacingAngle).toBeCloseTo(Math.PI / 2);
  });

  test('ledge advance completes without entering the generic stop phase', () => {
    const { adapter, state } = createCliffFixture();
    state.phase = 'climb-advance';
    state.intentHold = false;
    state.stepFinalized = false;
    state.activeStep = adapter._createClimbAdvanceStep(
      state,
      { x: 6.1, y: 2.4, z: 4.5 },
      { x: 6.5, y: 2.4, z: 4.5 }
    );
    adapter._triggerStop = jest.fn();

    expect(adapter._advanceMovementStep(state, 1)).toBe(true);
    expect(adapter._triggerStop).not.toHaveBeenCalled();
    expect(state.phase).toBe('climb-advance');
  });

  test('keyboard ascent enters the climb sequence and releasing the key does not interrupt it', () => {
    const { adapter, token, state } = createCliffFixture();
    const phases = [];
    let previousY = token.world.y;
    let largestRise = 0;
    for (let frame = 0; frame < 60; frame += 1) {
      adapter._updateForwardMovements(1 / 60);
      phases.push(state.phase);
      largestRise = Math.max(largestRise, token.world.y - previousY);
      previousY = token.world.y;
    }

    expect(phases).toContain('climb-wall');
    expect(largestRise).toBeLessThan(0.1);
    expect(state.forwardKeys.has('ArrowUp')).toBe(true);

    adapter.endForwardMovement(token, 'ArrowUp');
    adapter._updateForwardMovements(1 / 60);

    expect(state.phase).toBe('climb-wall');
    expect(state.forwardKeys.size).toBe(0);
  });
});
