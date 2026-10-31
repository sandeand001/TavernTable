import { Group } from 'three';
import { Token3DAdapter } from '../../../../../src/scene/Token3DAdapter.js';
import {
  linkTokenCharacter,
  setTokenMovementSettings,
} from '../../../../../src/entities/creatures/TokenMovement.js';
import { CharacterLibrary } from '../../../../../src/entities/characters/CharacterLibrary.js';
import CombatSession from '../../../../../src/entities/characters/CombatSession.js';

function fixture(getHeight = () => 0) {
  const mesh = new Group();
  mesh.userData.__ttBillboard = false;
  mesh.userData.__tt3DToken = true;
  const token = {
    id: 'token-1',
    type: 'mannequin',
    gridX: 2,
    gridY: 4,
    facingAngle: 0,
    world: { x: 2.5, y: getHeight(2, 4) * 0.5, z: 4.5 },
    __threeMesh: mesh,
  };
  mesh.position.set(token.world.x, token.world.y, token.world.z);
  const gm = {
    cols: 30,
    rows: 12,
    placedTokens: [token],
    is3DModeActive: () => true,
    getTerrainHeight: getHeight,
    spatial: {
      tileWorldSize: 1,
      elevationUnit: 0.5,
      gridToWorld: (x, y, height) => ({ x, y: height * 0.5, z: y }),
      worldToGrid: (x, z) => ({ gridX: Math.floor(x), gridY: Math.floor(z) }),
    },
  };
  const adapter = new Token3DAdapter(gm);
  const action = (duration) => ({
    getClip: () => ({ duration, tracks: [] }),
    isRunning: () => false,
  });
  adapter._tokenAnimationData.set(token, {
    actions: Object.fromEntries(
      [
        'idle',
        'walk',
        'run',
        'sprint',
        'drunkWalk',
        'drunkRunForward',
        'climb',
        'climbWall',
        'ledgeHang',
        'climbRecover',
        'fall',
        'hardLanding',
        'fallToRoll',
        'fallLoop',
      ].map((key) => [key, action(key.startsWith('climb') ? 1 : 0.8)])
    ),
    profile: { walkSpeed: 2, runSpeed: 4, drunkWalkSpeed: 1.3, drunkRunSpeed: 3 },
    landingContactTimes: { fall: 8 / 30, hardLanding: 3 / 30, fallToRoll: 2 / 30 },
  });
  adapter._setAnimation = jest.fn();
  adapter._selectedToken = token;
  return { adapter, token, gm };
}

function finish(adapter, token, observe = () => {}) {
  for (let frame = 0; frame < 7200 && adapter.isMovementInProgress(token); frame++) {
    adapter._updateForwardMovements(1 / 60);
    adapter._updatePlannedMovements();
    observe();
  }
  expect(adapter.isMovementInProgress(token)).toBe(false);
}

describe('Distance-limited click navigation', () => {
  test('combat range and actual successive routes use the same remaining turn allowance', () => {
    localStorage.clear();
    const { adapter, token, gm } = fixture();
    const library = new CharacterLibrary({
      ruleset: '2014',
      storage: globalThis.localStorage,
      catalog: [],
    });
    linkTokenCharacter(token, library, library.create('Nora'));
    const combat = new CombatSession({
      library,
      isMoving: (entry) => adapter.isMovementInProgress(entry),
    });
    gm.characterServices = { library, combat };
    combat.startTurn(token);
    expect(adapter.requestMoveToGrid(token, 4, 4).cost).toBe(10);
    expect(combat.status(token).movement.remaining).toBe(20);
    finish(adapter, token);
    expect(adapter.requestMoveToGrid(token, 8, 4).cost).toBe(20);
    finish(adapter, token);
    expect(combat.status(token).movement.spent).toBe(30);
    expect(adapter.requestMoveToGrid(token, 9, 4)).toBeNull();
    expect(token.world.x).toBeCloseTo(8.5, 5);
    combat.endCombat();
    expect(adapter.requestMoveToGrid(token, 14, 4).cost).toBe(30);
    finish(adapter, token);
  });

  test('combat wall costs share the same pool and an off-turn creature has no requested movement', () => {
    localStorage.clear();
    const { adapter, token, gm } = fixture((x) => (x >= 3 ? 24 : 0));
    const library = new CharacterLibrary({
      ruleset: '2014',
      storage: globalThis.localStorage,
      catalog: [],
    });
    const id = library.create('Nora');
    library.edit(id, { speed: 50 });
    linkTokenCharacter(token, library, id);
    const combat = new CombatSession({
      library,
      isMoving: (entry) => adapter.isMovementInProgress(entry),
    });
    gm.characterServices = { library, combat };
    combat.startTurn(token);
    const surface = (y) => ({ point: { x: 3, y, z: 4.5 }, normal: { x: -1, y: 0, z: 0 } });
    expect(adapter.requestMoveToSurface(token, surface(4)).cost).toBe(45);
    finish(adapter, token);
    expect(combat.status(token).movement.remaining).toBe(5);
    expect(adapter.requestMoveToSurface(token, surface(9))).toBeNull();
    combat.endTurn();
    expect(adapter.getTokenMovementRange(token)).toBeNull();
    expect(adapter.requestMoveToSurface(token, surface(0))).toBeNull();
    combat.startTurn(token);
    expect(adapter.requestMoveToSurface(token, surface(9)).cost).toBe(50);
    finish(adapter, token);
    expect(combat.status(token).movement.remaining).toBe(0);
  });

  test('a committed Run drop includes approved straight runout and charges its full cost', () => {
    localStorage.clear();
    const { adapter, token, gm } = fixture((x) => (x < 3 ? 8 : 0));
    const library = new CharacterLibrary({
      ruleset: '2014',
      storage: globalThis.localStorage,
      catalog: [],
    });
    linkTokenCharacter(token, library, library.create('Nora'));
    setTokenMovementSettings(token, { mode: 'run' });
    const combat = new CombatSession({
      library,
      isMoving: (entry) => adapter.isMovementInProgress(entry),
    });
    gm.characterServices = { library, combat };
    combat.startTurn(token);
    expect(adapter.requestMoveToGrid(token, 8, 4).cost).toBe(30);
    const job = adapter._movementRoutes.get(token);
    const state = adapter._movementStates.get(token);
    for (let frame = 0; frame < 600 && state.phase !== 'fall'; frame++)
      adapter._updateForwardMovements(1 / 60);

    expect(state.phase).toBe('fall');
    expect(job.current).toMatchObject({ gridX: 8, gridY: 4 });
    expect(state.pathGoal).toMatchObject({ gridX: 8, gridY: 4 });
    expect(job.segmentCost).toBe(30);
    finish(adapter, token);
    expect(token.world).toEqual({ x: 8.5, y: 0, z: 4.5 });
    expect(job.spent).toBe(30);
    expect(combat.status(token).movement.spent).toBe(30);
    expect(adapter.requestMoveToGrid(token, 9, 4)).toBeNull();
  });

  test('a committed Run drop does not consume a turn after its landing', () => {
    const { adapter, token } = fixture((x) => (x < 3 ? 8 : 0));
    setTokenMovementSettings(token, { mode: 'run', speed: 30 });
    const request = adapter.requestMoveToGrid(token, 6, 6);
    expect(request).toBeTruthy();
    const job = adapter._movementRoutes.get(token);
    const state = adapter._movementStates.get(token);
    for (let frame = 0; frame < 600 && state.phase !== 'fall'; frame++)
      adapter._updateForwardMovements(1 / 60);

    expect(state.phase).toBe('fall');
    expect(job.current).toMatchObject({ gridX: 4, gridY: 4 });
    expect(job.points[job.index]).toMatchObject({ gridX: 6, gridY: 6 });
    finish(adapter, token);
    expect(token.world).toEqual({ x: 6.5, y: 0, z: 6.5 });
    expect(job.spent).toBe(request.cost);
  });

  test('a committed Run drop only extends across the same flat landing height', () => {
    const { adapter, token } = fixture((x) => (x < 3 ? 8 : x < 5 ? 0 : 1));
    setTokenMovementSettings(token, { mode: 'run', speed: 50 });
    const request = adapter.requestMoveToGrid(token, 8, 4);
    expect(request).toBeTruthy();
    const job = adapter._movementRoutes.get(token);
    const state = adapter._movementStates.get(token);
    for (let frame = 0; frame < 600 && state.phase !== 'fall'; frame++)
      adapter._updateForwardMovements(1 / 60);

    expect(state.phase).toBe('fall');
    expect(job.current).toMatchObject({ gridX: 4, gridY: 4, height: 0 });
    expect(job.segmentCost).toBe(10);
    finish(adapter, token);
    expect(token.world).toEqual({ x: 8.5, y: 0.5, z: 4.5 });
    expect(job.spent).toBe(request.cost);
  });

  test('rejects an eleven-square request before releasing emotes or changing movement state', () => {
    const { adapter, token } = fixture();
    const release = jest.spyOn(adapter, '_releaseManualAnimationForMovement');
    expect(adapter.requestMoveToGrid(token, 13, 4)).toBeNull();
    expect(token.world.x).toBe(2.5);
    expect(adapter._movementStates.size).toBe(0);
    expect(release).not.toHaveBeenCalled();
  });

  test('executes an exact 50-foot boundary move and grants a fresh allowance for the next click', () => {
    const { adapter, token } = fixture();
    expect(adapter.requestMoveToGrid(token, 12, 4).cost).toBe(50);
    expect(adapter._movementStates.get(token).pathSpeedMode).toBe('walk');
    finish(adapter, token);
    expect(token.world.x).toBeCloseTo(12.5, 5);
    expect(token.world.z).toBeCloseTo(4.5, 5);
    expect(adapter.requestMoveToGrid(token, 22, 4).cost).toBe(50);
    finish(adapter, token);
    expect(token.world.x).toBeCloseTo(22.5, 5);
  });

  test.each([
    ['walk', 'default', 'walk'],
    ['run', 'default', 'run'],
    ['walk', 'drunk', 'drunkWalk'],
    ['run', 'drunk', 'drunkRunForward'],
  ])(
    '%s / %s uses its actual animation without changing the distance allowance',
    (mode, type, key) => {
      const { adapter, token } = fixture();
      setTokenMovementSettings(token, { mode, type });
      expect(adapter.requestMoveToGrid(token, 6, 4).cost).toBe(20);
      const state = adapter._movementStates.get(token);
      expect(state.loopActionKey).toBe(key);
      expect(state.pathSpeedMode).toBe(mode);
      expect(state.isSprinting).toBe(false);
      finish(adapter, token);
      expect(token.world.x).toBeCloseTo(6.5, 5);
    }
  );

  test('ignores a new destination until the current action has finished', () => {
    const { adapter, token } = fixture();
    adapter.requestMoveToGrid(token, 12, 4);
    const state = adapter._movementStates.get(token);
    expect(adapter.requestMoveToGrid(token, 3, 4)).toBeNull();
    expect(state.lastRequestedGoal.gridX).toBe(12);
    finish(adapter, token);
    expect(token.gridX).toBe(12);
  });

  test('a wall click stops smoothly at a nearby five-foot height and remains attached', () => {
    const { adapter, token } = fixture((x) => (x >= 3 ? 24 : 0));
    const result = adapter.requestMoveToSurface(token, {
      point: { x: 3, y: 3.94, z: 4.5 },
      normal: { x: -1, y: 0, z: 0 },
    });
    expect(result.cost).toBe(45);
    let previous = token.world.y;
    let largestStep = 0;
    finish(adapter, token, () => {
      largestStep = Math.max(largestStep, Math.abs(token.world.y - previous));
      previous = token.world.y;
    });
    expect(largestStep).toBeLessThan(0.1);
    expect(token.world.y).toBeCloseTo(4);
    expect(adapter._movementStates.get(token).phase).toBe('climb-hold');
    adapter.resyncHeights();
    for (let frame = 0; frame < 120; frame++) {
      adapter._updateForwardMovements(1 / 60);
      adapter._updatePlannedMovements();
    }
    expect(token.world.y).toBeCloseTo(4);
    expect(token.__ttWorldLock).toBe(1);
  });

  test('a fresh hanging action can climb 25 feet, reverse, and stop without moving sideways', () => {
    const { adapter, token } = fixture((x) => (x >= 3 ? 24 : 0));
    const surface = (y) => ({
      point: { x: 3, y, z: 4.5 },
      normal: { x: -1, y: 0, z: 0 },
    });
    adapter.requestMoveToSurface(token, surface(4));
    finish(adapter, token);
    const x = token.world.x;
    expect(adapter.requestMoveToSurface(token, surface(9)).cost).toBe(50);
    finish(adapter, token);
    expect(token.world.y).toBeCloseTo(9);
    expect(token.world.x).toBe(x);
    expect(adapter.requestMoveToSurface(token, surface(4)).cost).toBe(50);
    finish(adapter, token);
    expect(token.world.y).toBeCloseTo(4);
    expect(token.world.x).toBe(x);
    expect(token.world.z).toBeCloseTo(4.5);
  });

  test('rejects wall clicks beyond the perimeter before releasing an emote', () => {
    const { adapter, token } = fixture((x) => (x >= 3 ? 24 : 0));
    const release = jest.spyOn(adapter, '_releaseManualAnimationForMovement');
    expect(
      adapter.requestMoveToSurface(token, {
        point: { x: 3, y: 4.51, z: 4.5 },
        normal: { x: -1, y: 0, z: 0 },
      })
    ).toBeNull();
    expect(adapter.requestMoveToGrid(token, 3, 4)).toBeNull();
    expect(release).not.toHaveBeenCalled();
    expect(token.world.y).toBe(0);
  });

  test('Walk descends partway; selecting Run does not release the hold until a ground click', () => {
    const { adapter, token } = fixture((x) => (x < 3 ? 24 : 0));
    expect(
      adapter.requestMoveToSurface(token, {
        point: { x: 3, y: 8, z: 4.5 },
        normal: { x: 1, y: 0, z: 0 },
      }).cost
    ).toBe(45);
    finish(adapter, token);
    expect(token.world.y).toBeCloseTo(8);
    setTokenMovementSettings(token, { mode: 'run' });
    adapter.applyMovementStyle(token);
    expect(adapter._movementStates.get(token).phase).toBe('climb-hold');
    expect(adapter.requestMoveToGrid(token, 3, 4).cost).toBe(0);
    finish(adapter, token);
    expect(token.world.y).toBe(0);
    expect(token.world.x).toBeCloseTo(3.5);
    expect(token.__ttWorldLock).toBeUndefined();
    expect(adapter._setAnimation).toHaveBeenCalledWith(token, 'fallLoop', expect.any(Object));
  });

  test('switching an active controlled descent to Run drops to ground rather than catching midair', () => {
    const { adapter, token } = fixture((x) => (x < 3 ? 24 : 0));
    adapter.requestMoveToSurface(token, {
      point: { x: 3, y: 8, z: 4.5 },
      normal: { x: 1, y: 0, z: 0 },
    });
    for (let frame = 0; frame < 360 && token.world.y >= 11; frame++) {
      adapter._updateForwardMovements(1 / 60);
      adapter._updatePlannedMovements();
    }
    expect(token.world.y).toBeGreaterThan(8);
    setTokenMovementSettings(token, { mode: 'run', type: 'drunk' });
    adapter.applyMovementStyle(token);
    finish(adapter, token);
    expect(token.world.y).toBe(0);
    expect(adapter._movementStates.get(token)).toBeUndefined();
  });

  test('removing a held wall releases the creature into a real fall instead of leaving it stuck', () => {
    let height = 24;
    const { adapter, token } = fixture((x) => (x >= 3 ? height : 0));
    adapter.requestMoveToSurface(token, {
      point: { x: 3, y: 4, z: 4.5 },
      normal: { x: -1, y: 0, z: 0 },
    });
    finish(adapter, token);
    height = 0;
    adapter.resyncHeights();
    expect(adapter.isMovementInProgress(token)).toBe(true);
    finish(adapter, token);
    expect(token.world.y).toBe(0);
    expect(token.__ttWorldLock).toBeUndefined();
  });

  test('a whole Walk descent pays double vertical cost and does not use a fall animation', () => {
    const { adapter, token } = fixture((x) => (x < 3 ? 10 : 0));
    setTokenMovementSettings(token, { speed: 54 });
    expect(adapter.requestMoveToGrid(token, 3, 4)).toBeNull();
    setTokenMovementSettings(token, { speed: 55 });
    expect(adapter.requestMoveToGrid(token, 3, 4).cost).toBe(55);
    finish(adapter, token);
    expect(token.world).toEqual({ x: 3.5, y: 0, z: 4.5 });
    expect(adapter._setAnimation.mock.calls.some(([, key]) => key.startsWith('fall'))).toBe(false);
    expect(token.__ttWorldLock).toBeUndefined();
  });

  test('switching Run to Walk before a fall uses only the remaining allowance and hangs', () => {
    const { adapter, token } = fixture((x) => (x < 3 ? 24 : 0));
    setTokenMovementSettings(token, { mode: 'run' });
    expect(adapter.requestMoveToGrid(token, 3, 4).cost).toBe(5);
    const job = adapter._movementRoutes.get(token);
    setTokenMovementSettings(token, { mode: 'walk' });
    adapter.applyMovementStyle(token);
    finish(adapter, token);
    expect(token.world.y).toBeCloseTo(7.5);
    expect(adapter._movementStates.get(token).phase).toBe('climb-hold');
    expect(job.spent).toBeCloseTo(50);
  });

  test('a reachable upper-wall click completes entry into a stable ledge hang', () => {
    const { adapter, token } = fixture((x) => (x < 3 ? 24 : 0));
    expect(
      adapter.requestMoveToSurface(token, {
        point: { x: 3, y: 11, z: 4.5 },
        normal: { x: 1, y: 0, z: 0 },
      }).cost
    ).toBe(25);
    finish(adapter, token);
    expect(token.world.y).toBe(10);
    expect(adapter._movementStates.get(token).wallMotion.clip).toBe('ledgeHang');
  });

  test('stopping exactly at the wall-loop boundary never freezes the mantle clip', () => {
    const { adapter, token } = fixture((x) => (x < 3 ? 24 : 0));
    expect(
      adapter.requestMoveToSurface(token, {
        point: { x: 3, y: 10, z: 4.5 },
        normal: { x: 1, y: 0, z: 0 },
      }).cost
    ).toBe(25);
    finish(adapter, token);
    expect(token.world.y).toBeCloseTo(10);
    expect(adapter._movementStates.get(token).wallMotion.clip).toBe('ledgeHang');
  });

  test('an existing wall hold at the lip can adopt the ledge pose without spending movement', () => {
    const { adapter, token } = fixture((x) => (x < 3 ? 24 : 0));
    adapter.requestMoveToSurface(token, {
      point: { x: 3, y: 11, z: 4.5 },
      normal: { x: 1, y: 0, z: 0 },
    });
    finish(adapter, token);
    adapter._movementStates.get(token).wallMotion.clip = 'climbWall';
    const before = { ...token.world };
    setTokenMovementSettings(token, { speed: 0 });
    expect(
      adapter.requestMoveToSurface(token, {
        point: { x: 3, y: 11.5, z: 4.5 },
        normal: { x: 1, y: 0, z: 0 },
      }).cost
    ).toBe(0);
    finish(adapter, token);
    expect(token.world).toEqual(before);
    expect(adapter._movementStates.get(token).wallMotion.clip).toBe('ledgeHang');
  });

  test('a live mode change with too little movement for ledge entry stops standing at the edge', () => {
    const { adapter, token } = fixture((x) => (x < 3 ? 24 : 0));
    setTokenMovementSettings(token, { mode: 'run', speed: 10 });
    expect(adapter.requestMoveToGrid(token, 3, 4).cost).toBe(5);
    const job = adapter._movementRoutes.get(token);
    setTokenMovementSettings(token, { mode: 'walk' });
    adapter.applyMovementStyle(token);
    finish(adapter, token);
    expect(token.world.y).toBe(12);
    expect(token.gridX).toBe(2);
    expect(token.world.x).toBeGreaterThan(2.5);
    expect(token.world.x).toBeLessThan(3);
    expect(adapter._movementStates.get(token)).toBeUndefined();
    expect(job.spent).toBe(5);
    expect(adapter._setAnimation.mock.calls.some(([, key]) => key.startsWith('climb'))).toBe(false);
  });

  test('an upward budget cap stops on the wall before beginning an unaffordable mantle', () => {
    const { adapter, token } = fixture((x) => (x < 3 ? 4 : x === 3 ? 0 : 8));
    setTokenMovementSettings(token, { mode: 'run', speed: 55 });
    expect(adapter.requestMoveToGrid(token, 4, 4).cost).toBe(50);
    const job = adapter._movementRoutes.get(token);
    setTokenMovementSettings(token, { mode: 'walk' });
    adapter.applyMovementStyle(token);
    finish(adapter, token);
    const state = adapter._movementStates.get(token);
    expect(token.world.y).toBeCloseTo(2);
    expect(token.gridX).toBe(3);
    expect(state.phase).toBe('climb-hold');
    expect(state.wallMotion.clip).toBe('ledgeHang');
    expect(job.spent).toBeCloseTo(50);
  });

  test('more expensive live descent also caps later ground waypoints at the original allowance', () => {
    const { adapter, token } = fixture((x) => (x < 3 ? 8 : 0));
    setTokenMovementSettings(token, { mode: 'run' });
    expect(adapter.requestMoveToGrid(token, 12, 4).cost).toBe(50);
    const job = adapter._movementRoutes.get(token);
    setTokenMovementSettings(token, { mode: 'walk' });
    adapter.applyMovementStyle(token);
    finish(adapter, token);
    expect(token.world).toEqual({ x: 4.5, y: 0, z: 4.5 });
    expect(job.spent).toBeCloseTo(50);
    expect(token.__ttWorldLock).toBeUndefined();
  });

  test('mode and type changes immediately alter locomotion without restarting the route', () => {
    const { adapter, token } = fixture();
    adapter.requestMoveToGrid(token, 12, 4);
    const state = adapter._movementStates.get(token);
    const job = adapter._movementRoutes.get(token);
    const goal = state.pathGoal;
    const navigate = jest.spyOn(adapter, 'navigateToGrid');
    const check = (updates, loop, speed) => {
      adapter._armResumeProbe(state, { goal: state.lastRequestedGoal });
      const before = { ...token.world };
      setTokenMovementSettings(token, updates);
      adapter.applyMovementStyle(token);
      expect(state.loopActionKey).toBe(loop);
      expect(state.activeSpeed).toBe(speed);
      expect(state.pathGoal).toBe(goal);
      expect(adapter._movementRoutes.get(token)).toBe(job);
      expect(state.__resumeProbe.goal.options).toMatchObject({
        __preferredSpeedMode: token.movementSettings.mode,
        movementType: token.movementSettings.type,
      });
      expect(token.world).toEqual(before);
      adapter._updateForwardMovements(0.1);
      expect(token.world.x - before.x).toBeCloseTo(speed * 0.1);
    };
    check({ mode: 'run' }, 'run', 4);
    check({ type: 'drunk' }, 'drunkRunForward', 3);
    check({ mode: 'walk' }, 'drunkWalk', 1.3);
    check({ type: 'default' }, 'walk', 2);
    expect(navigate).not.toHaveBeenCalled();
    finish(adapter, token);
    expect(token.world.x).toBeCloseTo(12.5, 5);
  });

  test('live style changes survive later waypoints and do not reset the accepted allowance', () => {
    const { adapter, token } = fixture((x, y) => (x === 3 && y === 4 ? 10 : 0));
    setTokenMovementSettings(token, { speed: 20 });
    adapter.requestMoveToGrid(token, 4, 4);
    setTokenMovementSettings(token, { speed: 0, mode: 'run', type: 'drunk' });
    adapter.applyMovementStyle(token);
    expect(adapter._movementRoutes.get(token).settings.speed).toBe(20);
    const loops = new Set();
    finish(adapter, token, () => {
      const state = adapter._movementStates.get(token);
      if (state?.phase === 'walk') loops.add(state.loopActionKey);
    });
    expect([...loops]).toEqual(['drunkRunForward']);
    expect(token.gridX).toBe(4);
    expect(token.gridY).toBe(4);
    expect(adapter.requestMoveToGrid(token, 5, 4)).toBeNull();
  });

  test('a style change during a climb preserves the climb and resumes in the new gait', () => {
    const { adapter, token } = fixture((x) => (x >= 3 ? 8 : 0));
    setTokenMovementSettings(token, { speed: 100 });
    adapter.requestMoveToGrid(token, 5, 4);
    let state = adapter._movementStates.get(token);
    for (let frame = 0; frame < 600 && state.wallMotion?.stage !== 'surface'; frame++) {
      adapter._updateForwardMovements(1 / 60);
      adapter._updatePlannedMovements();
      state = adapter._movementStates.get(token);
    }
    expect(state.phase.startsWith('climb')).toBe(true);
    const phase = state.phase;
    const calls = adapter._setAnimation.mock.calls.length;
    setTokenMovementSettings(token, { mode: 'run', type: 'drunk' });
    adapter.applyMovementStyle(token);
    expect(state.phase).toBe(phase);
    expect(adapter._setAnimation).toHaveBeenCalledTimes(calls);
    expect(state.lastRequestedGoal.options).toMatchObject({
      __preferredSpeedMode: 'run',
      movementType: 'drunk',
    });
    const loops = new Set();
    finish(adapter, token, () => {
      const live = adapter._movementStates.get(token);
      if (live?.phase === 'walk' && token.gridX >= 3) loops.add(live.loopActionKey);
    });
    expect([...loops]).toEqual(['drunkRunForward']);
    expect(token.world.x).toBeCloseTo(5.5, 4);
  });

  test('a style change during a fall updates the cached resumption without interrupting landing', () => {
    const { adapter, token } = fixture((x) => (x < 3 ? 10 : 0));
    setTokenMovementSettings(token, { mode: 'run' });
    adapter.requestMoveToGrid(token, 5, 4);
    let state = adapter._movementStates.get(token);
    for (let frame = 0; frame < 600 && state.phase !== 'fall'; frame++) {
      adapter._updateForwardMovements(1 / 60);
      adapter._updatePlannedMovements();
      state = adapter._movementStates.get(token);
    }
    expect(state.phase).toBe('fall');
    const calls = adapter._setAnimation.mock.calls.length;
    setTokenMovementSettings(token, { mode: 'run', type: 'drunk' });
    adapter.applyMovementStyle(token);
    expect(state.phase).toBe('fall');
    expect(adapter._setAnimation).toHaveBeenCalledTimes(calls);
    expect(state.__fallResumeContext).toMatchObject({
      pathSpeedMode: 'run',
      pathMovementType: 'drunk',
    });
    const loops = new Set();
    finish(adapter, token, () => {
      const live = adapter._movementStates.get(token);
      if (live?.phase === 'walk' && token.gridX >= 3) loops.add(live.loopActionKey);
    });
    expect([...loops]).toEqual(['drunkRunForward']);
    expect(token.world.x).toBeCloseTo(5.5, 4);
  });

  test('executes the cheaper highlighted route around a ridge instead of walking through it', () => {
    const { adapter, token } = fixture((x, y) => (x === 3 && y === 4 ? 10 : 0));
    setTokenMovementSettings(token, { speed: 20 });
    expect(adapter.requestMoveToGrid(token, 4, 4).cost).toBe(20);
    const visited = [];
    finish(adapter, token, () => visited.push([token.gridX, token.gridY]));
    expect(visited.some(([x, y]) => x === 3 && y === 4)).toBe(false);
    expect(token.gridX).toBe(4);
    expect(token.gridY).toBe(4);
  });

  test('charges the climb before starting and still completes the existing mantle sequence', () => {
    const { adapter, token } = fixture((x) => (x >= 3 ? 8 : 0));
    setTokenMovementSettings(token, { speed: 20 });
    expect(adapter.requestMoveToGrid(token, 3, 4)).toBeNull();
    setTokenMovementSettings(token, { speed: 45 });
    expect(adapter.requestMoveToGrid(token, 3, 4).cost).toBe(45);
    finish(adapter, token);
    expect(token.world.x).toBeCloseTo(3.5, 4);
    expect(token.world.y).toBeCloseTo(4, 4);
    expect(token.gridX).toBe(3);
    expect(token.gridY).toBe(4);
    expect(adapter._setAnimation).toHaveBeenLastCalledWith(token, 'idle', expect.any(Object));
  });

  test('a Run fall to a lower adjacent tile costs only the five-foot grid step', () => {
    const { adapter, token } = fixture((x) => (x < 3 ? 10 : 0));
    setTokenMovementSettings(token, { speed: 5, mode: 'run' });
    expect(adapter.requestMoveToGrid(token, 3, 4).cost).toBe(5);
    finish(adapter, token);
    expect(token.world.x).toBeCloseTo(3.5, 4);
    expect(token.world.y).toBeCloseTo(0, 4);
  });

  test('does not climb a wall beyond the approved destination tile', () => {
    const { adapter, token } = fixture((x) => (x >= 4 ? 8 : 0));
    setTokenMovementSettings(token, { speed: 5 });
    expect(adapter.requestMoveToGrid(token, 3, 4).cost).toBe(5);
    const phases = new Set();
    finish(adapter, token, () => {
      const phase = adapter._movementStates.get(token)?.phase;
      if (phase) phases.add(phase);
    });
    expect([...phases].some((phase) => phase.startsWith('climb'))).toBe(false);
    expect(token.world.x).toBeCloseTo(3.5, 4);
    expect(token.world.y).toBeCloseTo(0, 4);
  });
});
