import { Group } from 'three';
import { Token3DAdapter } from '../../../../../src/scene/Token3DAdapter.js';
import { CharacterLibrary } from '../../../../../src/entities/characters/CharacterLibrary.js';
import CombatSession from '../../../../../src/entities/characters/CombatSession.js';
import FallingController from '../../../../../src/ui/characters/FallingController.js';
import {
  getTokenConditions,
  linkTokenCharacter,
  unlinkTokenCharacter,
} from '../../../../../src/entities/creatures/TokenMovement.js';
import { getTokenCharacter } from '../../../../../src/ui/characters/characterServices.js';
import { applyTokenCommand } from '../../../../../src/core/game-manager/internals/tokenCommands.js';
import { rollDiceExpression } from '../../../../../src/systems/dice/dice.js';

jest.mock('../../../../../src/systems/dice/dice.js', () => ({
  rollDiceExpression: jest.fn(),
}));

function fixture({
  getHeight = () => 0,
  ruleset = '2014',
  clear = true,
  tileSize = 1,
  elevationUnit = 0.5,
} = {}) {
  if (clear) localStorage.clear();
  const token = {
    id: 'token-1',
    type: 'mannequin',
    gridX: 2,
    gridY: 2,
    facingAngle: 0,
    world: { x: 2.5 * tileSize, y: getHeight(2, 2) * elevationUnit, z: 2.5 * tileSize },
    __threeMesh: new Group(),
  };
  token.__threeMesh.userData.__ttBillboard = false;
  const gm = {
    cols: 14,
    rows: 8,
    placedTokens: [token],
    is3DModeActive: () => true,
    getTerrainHeight: getHeight,
    spatial: {
      tileWorldSize: tileSize,
      elevationUnit,
      gridToWorld: (x, z, height) => ({
        x: x * tileSize,
        y: height * elevationUnit,
        z: z * tileSize,
      }),
      worldToGrid: (x, z) => ({ gridX: Math.floor(x / tileSize), gridY: Math.floor(z / tileSize) }),
    },
  };
  const library = new CharacterLibrary({ ruleset, catalog: [], storage: localStorage });
  const id = library.create('Flyer');
  library.edit(id, { fallTraits: { flySpeed: 60 } });
  linkTokenCharacter(token, library, id);
  const adapter = new Token3DAdapter(gm);
  gm.token3DAdapter = adapter;
  const combat = new CombatSession({
    library,
    isMoving: (entry) => adapter.isMovementInProgress(entry),
  });
  gm.characterServices = { library, combat };
  gm.characterServices.falling = new FallingController({
    gameManager: gm,
    library,
    combat,
    getCharacter: (entry) => getTokenCharacter(gm, entry, gm.characterServices),
    onChanged: jest.fn(),
  });
  const keys = [
    'idle',
    'walk',
    'run',
    'hover',
    'fly',
    'fall',
    'fallLoop',
    'proneLanding',
    'prone',
    'standUp',
  ];
  const data = {
    actions: Object.fromEntries(
      keys.map((key) => [
        key,
        {
          time: 0,
          paused: false,
          getClip: () => ({ duration: 0.8, tracks: [] }),
          isScheduled: () => false,
        },
      ])
    ),
    clips: Object.fromEntries(keys.map((key) => [key, 0.8])),
    profile: { walkSpeed: 2, runSpeed: 4 },
    landingContactTimes: { fall: 0.15, proneLanding: 0 },
    current: 'idle',
  };
  adapter._tokenAnimationData.set(token, data);
  adapter._setAnimation = jest.fn((entry, key) => {
    data.current = key === 'idle' && getTokenConditions(entry).includes('prone') ? 'prone' : key;
  });
  combat.startTurn(token);
  return { token, gm, library, combat, adapter, data };
}

async function finish({ adapter, token }) {
  for (let frame = 0; frame < 2400 && adapter.isMovementInProgress(token); frame++) {
    adapter._updateForwardMovements(1 / 60);
    adapter._updatePlannedMovements();
    await Promise.resolve();
  }
  expect(adapter.isMovementInProgress(token)).toBe(false);
}

beforeEach(() => {
  rollDiceExpression.mockReset();
  rollDiceExpression.mockImplementation(async ({ expression }) => ({
    expression,
    total: expression === '0' ? 0 : 7,
    text: expression === '0' ? '0' : '2d6 [3, 4] = 7',
  }));
});

test('flight travel rate completes fifteen feet within 0.85 seconds without changing its cost', async () => {
  const context = fixture();
  const { adapter, token, combat } = context;
  await adapter.applyFlightCommand(token, 'takeoff');
  await finish(context);
  expect(adapter.requestMoveToGrid(token, 5, 2).cost).toBe(15);
  let frames = 0;
  while (frames < 240 && adapter.isMovementInProgress(token)) {
    adapter._updateForwardMovements(1 / 60);
    adapter._updatePlannedMovements();
    frames++;
  }
  expect(adapter.isMovementInProgress(token)).toBe(false);
  expect(frames / 60).toBeLessThanOrEqual(0.85);
  expect(token.world).toEqual({ x: 5.5, y: 1, z: 2.5 });
  expect(combat.status(token).movement.spent).toBe(20);
});

test('Take flight rises exactly five feet and shares prior ground movement without changing base speed', async () => {
  const context = fixture();
  const { adapter, token, combat, library, gm } = context;
  expect(adapter.requestMoveToGrid(token, 4, 2).cost).toBe(10);
  await finish(context);
  expect(await applyTokenCommand(gm, token, 'take-flight')).toBe(true);
  expect(combat.status(token).movement).toMatchObject({ base: 60, spent: 15, remaining: 45 });
  await finish(context);
  expect(token.world.y).toBeCloseTo(1, 8);
  expect(token.flightActive).toBe(true);
  expect(library.get(token.characterSheetId).speed).toBe(30);
  expect(token.quickCommand).toBeUndefined();
  expect(adapter.isMovementInProgress(token)).toBe(false);
});

test.each([5, 10, 15, 20])(
  'Raise and Lower %i feet move and charge the chosen physical distance',
  async (feet) => {
    const context = fixture();
    const { adapter, token, combat } = context;
    await adapter.applyFlightCommand(token, 'takeoff');
    await finish(context);
    await adapter.applyFlightCommand(token, 'raise', 20);
    await finish(context);
    await adapter.applyFlightCommand(token, 'lower', feet);
    await finish(context);
    expect(token.world.y * 5).toBeCloseTo(25 - feet, 7);
    expect(combat.status(token).movement.spent).toBe(25 + feet);
  }
);

test('Lower to the ground lands without damage or resetting spent movement', async () => {
  const context = fixture();
  const { adapter, token, combat } = context;
  await adapter.applyFlightCommand(token, 'takeoff');
  await finish(context);
  expect(adapter.getFlightCommandAvailability(token, 'lower', 10).allowed).toBe(false);
  await adapter.applyFlightCommand(token, 'lower', 5);
  await finish(context);
  expect(token.world.y).toBe(0);
  expect(token.flightActive).toBeUndefined();
  expect(combat.status(token).movement).toMatchObject({ base: 30, spent: 10, remaining: 20 });
  expect(rollDiceExpression).not.toHaveBeenCalled();
});

test.each(['2014', '2024'])(
  '%s Drop costs no movement, rolls fall damage and persists Prone despite available flight',
  async (ruleset) => {
    const context = fixture({ ruleset });
    const { adapter, token, combat, library } = context;
    await adapter.applyFlightCommand(token, 'takeoff');
    await finish(context);
    await adapter.applyFlightCommand(token, 'raise', 20);
    await finish(context);
    expect(adapter.requestMoveToGrid(token, 9, 2).cost).toBe(35);
    await finish(context);
    expect(combat.status(token).movement.remaining).toBe(0);
    expect(adapter.getFlightCommandAvailability(token, 'raise', 5).allowed).toBe(false);
    expect(adapter.getFlightCommandAvailability(token, 'drop')).toMatchObject({
      allowed: true,
      cost: 0,
    });
    await adapter.applyFlightCommand(token, 'drop');
    await finish(context);
    expect(rollDiceExpression).toHaveBeenCalledWith(expect.objectContaining({ expression: '2d6' }));
    expect(token.world.y).toBe(0);
    expect(token.flightActive).toBeUndefined();
    expect(combat.status(token).movement.spent).toBe(60);
    expect(library.get(token.characterSheetId)).toMatchObject({
      hp: { current: 3 },
      conditions: ['prone'],
      fallTraits: { flySpeed: 60 },
      lastFall: { damage: 7, prone: true },
    });
    expect(adapter.getStablePlacement(token).pose.kind).toBe('ground');
  }
);

test('Drop retains Feather Fall and a short drop causes neither damage nor Prone', async () => {
  const context = fixture();
  const { adapter, token, library, combat } = context;
  library.edit(token.characterSheetId, { fallTraits: { featherFall: true } });
  await adapter.applyFlightCommand(token, 'takeoff');
  await finish(context);
  await adapter.applyFlightCommand(token, 'drop');
  await finish(context);
  expect(library.get(token.characterSheetId)).toMatchObject({
    hp: { current: 10 },
    conditions: [],
    fallTraits: { flySpeed: 60, featherFall: false },
  });
  expect(combat.status(token).movement.spent).toBe(5);
});

test('horizontal flight keeps absolute altitude over hills, blocks equal-height cliffs and blends hover/travel roles', async () => {
  const context = fixture({ getHeight: (x) => (x === 3 ? 1 : x === 5 ? 2 : 0) });
  const { adapter, token } = context;
  await adapter.applyFlightCommand(token, 'takeoff');
  await finish(context);
  expect(adapter.requestMoveToGrid(token, 4, 2).cost).toBe(10);
  expect(adapter._setAnimation).toHaveBeenLastCalledWith(
    token,
    'fly',
    expect.objectContaining({ fadeIn: 0.25 })
  );
  await finish(context);
  expect(token.world.y).toBeCloseTo(1, 8);
  expect(adapter._setAnimation).toHaveBeenLastCalledWith(
    token,
    'hover',
    expect.objectContaining({ fadeOut: 0.25 })
  );
  expect(adapter.getTokenMovementRange(token).tiles.has('5,2')).toBe(false);
  adapter.resyncHeights();
  expect(token.world.y).toBeCloseTo(1, 8);
});

test('ground creatures can be overflown but overlapping airborne creatures block both routes and vertical sweeps', async () => {
  const context = fixture();
  const { adapter, token, gm } = context;
  await adapter.applyFlightCommand(token, 'takeoff');
  await finish(context);
  const other = { id: 'other', gridX: 4, gridY: 2, world: { x: 4.5, y: 0, z: 2.5 } };
  gm.placedTokens.push(other);
  expect(adapter.getTokenMovementRange(token).tiles.has('4,2')).toBe(true);
  other.world.y = 1;
  expect(adapter.getTokenMovementRange(token).tiles.has('4,2')).toBe(false);
  other.gridX = token.gridX;
  other.world.y = 3.5;
  expect(adapter.getFlightCommandAvailability(token, 'raise', 20).allowed).toBe(false);
  expect(adapter.getFlightCommandAvailability(token, 'raise', 5).allowed).toBe(true);
});

test('flight checkpoint restore retains altitude and completed movement, not unfinished route or animation frames', async () => {
  const first = fixture();
  await first.adapter.applyFlightCommand(first.token, 'takeoff');
  await finish(first);
  first.adapter.requestMoveToGrid(first.token, 7, 2);
  for (let frame = 0; frame < 240; frame++) {
    first.adapter._updateForwardMovements(1 / 60);
    first.adapter._updatePlannedMovements();
    if (
      first.adapter._movementRoutes.get(first.token)?.spent === 5 &&
      first.token.world.x > 3.5 + 1e-5
    )
      break;
  }
  const saved = first.adapter.getStablePlacement(first.token);
  expect(saved.pose.kind).toBe('flight');
  expect(saved.pose.world.x).toBeCloseTo(3.5, 7);
  expect(first.token.world.x).toBeGreaterThan(saved.pose.world.x);
  const snapshot = first.combat.snapshot({
    movementCosts: first.adapter.getCheckpointMovementCosts(),
  });
  const second = fixture({ clear: false });
  linkTokenCharacter(second.token, first.library, first.token.characterSheetId);
  await second.adapter.restoreStablePlacement(second.token, saved);
  const reopened = new CombatSession({ library: first.library });
  reopened.restore(snapshot, [second.token]);
  expect(second.token.world).toEqual(saved.pose.world);
  expect(second.token.flightActive).toBe(true);
  expect(second.adapter.isMovementInProgress(second.token)).toBe(false);
  expect(reopened.status(second.token).movement).toMatchObject({
    base: 60,
    spent: 10,
    remaining: 50,
  });
  expect(second.adapter._movementRoutes.size).toBe(0);
});

test('takeoff is unavailable without flight, while Prone, off-turn or beyond budget, and duplicate requests spend once', async () => {
  const context = fixture();
  const { adapter, token, combat, library } = context;
  library.edit(token.characterSheetId, { fallTraits: { flySpeed: 0 } });
  expect(adapter.getFlightCommandAvailability(token, 'takeoff').visible).toBe(false);
  library.edit(token.characterSheetId, { fallTraits: { flySpeed: 60 }, conditions: ['prone'] });
  expect(adapter.getFlightCommandAvailability(token, 'takeoff').allowed).toBe(false);
  library.edit(token.characterSheetId, { conditions: [] });
  combat.endTurn();
  expect(adapter.getFlightCommandAvailability(token, 'takeoff').allowed).toBe(false);
  combat.startTurn(token);
  const results = await Promise.allSettled([
    adapter.applyFlightCommand(token, 'takeoff'),
    adapter.applyFlightCommand(token, 'takeoff'),
  ]);
  expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
  expect(combat.status(token).movement.spent).toBe(5);
  await finish(context);
});

test.each([
  [1, 0.5],
  [2, 0.25],
  [3, 0],
])(
  'physical takeoff/elevation and cost use tile size %s, terrain scale %s',
  async (tileSize, elevationUnit) => {
    const context = fixture({ tileSize, elevationUnit });
    const { adapter, token, combat } = context;
    await adapter.applyFlightCommand(token, 'takeoff');
    await finish(context);
    expect(token.world.y).toBeCloseTo(tileSize, 7);
    expect(adapter.getFlightStatus(token).heightFeet).toBeCloseTo(5, 7);
    await adapter.applyFlightCommand(token, 'raise', 15);
    await finish(context);
    expect(adapter.getFlightStatus(token).heightFeet).toBeCloseTo(20, 7);
    expect(combat.status(token).movement.spent).toBe(20);
  }
);

test('losing flight while hovering initiates the shared fall off-turn without charging movement', async () => {
  const context = fixture();
  const { adapter, token, library, combat } = context;
  await adapter.applyFlightCommand(token, 'takeoff');
  await finish(context);
  await adapter.applyFlightCommand(token, 'raise', 20);
  await finish(context);
  combat.endTurn();
  library.edit(token.characterSheetId, { fallTraits: { flySpeed: 0 } });
  adapter._updateForwardMovements(1 / 60);
  await finish(context);
  expect(token.flightActive).toBeUndefined();
  expect(token.world.y).toBe(0);
  expect(combat.status(token).movement.spent).toBe(25);
  expect(library.get(token.characterSheetId).conditions).toContain('prone');
});

test('free play retains a separate per-move flying allowance rather than a hidden combat turn', async () => {
  const context = fixture();
  const { adapter, token, combat } = context;
  combat.endCombat();
  await adapter.applyFlightCommand(token, 'takeoff');
  await finish(context);
  expect(combat.freeMovementAllowance(token)).toBe(60);
  await adapter.applyFlightCommand(token, 'raise', 20);
  await finish(context);
  expect(combat.freeMovementAllowance(token)).toBe(60);
  expect(combat.active).toBe(false);
  expect(combat.status(token).movement.spent).toBe(0);
});

test('an unlinked natural flyer retains its flight ability when a drop creates its saved character', async () => {
  const context = fixture();
  const { adapter, token, combat, library } = context;
  combat.endCombat();
  unlinkTokenCharacter(token, { speed: 50, mode: 'walk', type: 'default' });
  token.nameMode = 'custom';
  token.fallTraits = { flySpeed: 60 };
  await adapter.applyFlightCommand(token, 'takeoff');
  await finish(context);
  await adapter.applyFlightCommand(token, 'raise', 20);
  await finish(context);
  await adapter.applyFlightCommand(token, 'drop');
  await finish(context);
  expect(token.characterSheetId).toEqual(expect.any(String));
  expect(library.get(token.characterSheetId)).toMatchObject({
    fallTraits: { flySpeed: 60 },
    hp: { current: 3 },
    conditions: ['prone'],
  });
  expect(combat.status(token).movement.spent).toBe(0);
});
