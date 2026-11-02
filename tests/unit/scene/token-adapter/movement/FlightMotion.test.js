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
import {
  targetingAvailability,
  validateTargetSelection,
} from '../../../../../src/rules/targeting/assessment.js';
import classic from '../../../../../assets/data/resources/srd-2014-5.1-seed.1.json';
import revised from '../../../../../assets/data/resources/srd-2024-5.2.1-seed.1.json';

jest.mock('../../../../../src/systems/dice/dice.js', () => ({
  rollDiceExpression: jest.fn(),
}));

function fixture({
  getHeight = () => 0,
  ruleset = '2014',
  clear = true,
  tileSize = 1,
  elevationUnit = 0.5,
  withSpells = false,
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
  const spellData = ruleset === '2014' ? classic : revised;
  const library = new CharacterLibrary({
    ruleset,
    catalog: withSpells ? spellData.entries : [],
    ...(withSpells ? { classes: spellData.classes } : {}),
    storage: localStorage,
  });
  const id = library.create('Flyer');
  library.edit(id, {
    fallTraits: { flySpeed: withSpells ? 0 : 60 },
    ...(withSpells ? { classId: 'wizard', level: 10 } : {}),
  });
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

function castFly({ token, library, combat, gm }, recipients = [token], slotLevel = 3) {
  const owned = library.add(token.characterSheetId, 'spell:fly');
  library.prepare(token.characterSheetId, owned, true);
  const board = () => ({
    tokens: gm.placedTokens.map((entry) => ({
      id: entry.id,
      name: entry.name || entry.id,
      world: entry.world,
      allegiance: 'friendly',
      creatureType: 'humanoid',
      conditions: getTokenConditions(entry),
      abilities: {},
    })),
    tileSize: gm.spatial.tileWorldSize,
    clearPath: () => true,
  });
  combat.targeting = {
    beginQuery: () => {},
    hasTokenId: (id) => gm.placedTokens.some((entry) => entry.id === id),
    availability: (entry, action) => {
      const current = board();
      return targetingAvailability(
        current,
        current.tokens.find((row) => row.id === entry.id),
        action.targeting
      );
    },
    validate: (entry, action, selection) => {
      const current = board();
      return validateTargetSelection(
        current,
        current.tokens.find((row) => row.id === entry.id),
        action.targeting,
        selection
      );
    },
  };
  return combat.commitAction(
    combat.prepareAction(token, `spell:${owned}`, { slotLevel }),
    '',
    null,
    {
      targets: recipients.map((entry) => ({ tokenId: entry.id, count: 1 })),
      willingConfirmed: true,
    }
  );
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

test.each(['2014', '2024'])(
  '%s casting Fly enables real Take flight, elevation and horizontal movement with one shared 60-foot budget',
  async (ruleset) => {
    const context = fixture({ ruleset, withSpells: true });
    const { adapter, token, combat, library } = context;
    expect(adapter.getFlightCommandAvailability(token, 'takeoff').visible).toBe(false);
    castFly(context);
    expect(token.flightActive).toBeUndefined();
    expect(adapter.getFlightCommandAvailability(token, 'takeoff').allowed).toBe(true);
    await adapter.applyFlightCommand(token, 'takeoff');
    await finish(context);
    await adapter.applyFlightCommand(token, 'raise', 20);
    await finish(context);
    expect(adapter.requestMoveToGrid(token, 9, 2).cost).toBe(35);
    await finish(context);
    expect(combat.status(token).movement).toMatchObject({ base: 60, spent: 60, remaining: 0 });
    expect(combat.status(token).actions).toBe(0);
    expect(token.world).toEqual({ x: 9.5, y: 5, z: 2.5 });
    expect(library.get(token.characterSheetId).fallTraits.flySpeed).toBe(0);
    expect(library.get(token.characterSheetId).slotsUsed[2]).toBe(1);
    expect(rollDiceExpression).not.toHaveBeenCalled();
  }
);

test.each(['2014', '2024'])(
  '%s Fly holds a Prone recipient aloft until they choose to stand for half their flying speed',
  async (ruleset) => {
    const context = fixture({ ruleset, withSpells: true });
    const { adapter, token, combat, library, gm } = context;
    castFly(context);
    await adapter.applyFlightCommand(token, 'takeoff');
    await finish(context);
    await adapter.applyFlightCommand(token, 'raise', 20);
    await finish(context);
    library.edit(token.characterSheetId, { conditions: ['prone'] });
    adapter._updateForwardMovements(1 / 60);
    expect(token.flightActive).toBe(true);
    expect(token.world.y).toBe(5);
    expect(adapter.getFlightCommandAvailability(token, 'raise', 5).allowed).toBe(false);
    expect(combat.standingAvailability(token)).toMatchObject({ allowed: true, cost: 30 });
    await gm.characterServices.falling.stand(token);
    expect(combat.status(token).actions).toBe(0);
    expect(combat.status(token).movement.spent).toBe(55);
    expect(library.get(token.characterSheetId).conditions).toEqual([]);
    expect(token.flightActive).toBe(true);
    expect(rollDiceExpression).not.toHaveBeenCalled();
  }
);

test('ending Fly during a route stops at the last stable waypoint, refunds unused movement and resolves the fall', async () => {
  const context = fixture({ withSpells: true });
  const { adapter, token, combat, library } = context;
  castFly(context);
  await adapter.applyFlightCommand(token, 'takeoff');
  await finish(context);
  await adapter.applyFlightCommand(token, 'raise', 20);
  await finish(context);
  adapter.requestMoveToGrid(token, 5, 2);
  for (let frame = 0; frame < 240; frame++) {
    adapter._updateForwardMovements(1 / 60);
    if (adapter._movementRoutes.get(token)?.spent === 5 && token.world.x > 3.5 + 1e-5) break;
  }
  expect(adapter.getStablePlacement(token).pose.world.x).toBeCloseTo(3.5, 8);
  expect(token.world.x).toBeGreaterThan(3.5);
  library.endConcentration(token.characterSheetId);
  combat.syncEffects();
  adapter._updateForwardMovements(1 / 60);
  expect(combat.moves.size).toBe(0);
  expect(combat.status(token).movement.spent).toBe(30);
  await finish(context);
  expect(token.world).toEqual({ x: 3.5, y: 0, z: 2.5 });
  expect(token.flightActive).toBeUndefined();
  expect(library.get(token.characterSheetId)).toMatchObject({
    hp: { current: 3 },
    conditions: ['prone'],
    lastFall: { distanceFeet: 25, damage: 7, prone: true },
    fallTraits: { flySpeed: 0 },
  });
  expect(rollDiceExpression).toHaveBeenCalledWith(expect.objectContaining({ expression: '2d6' }));
});

test.each(['2014', '2024'])(
  '%s deliberate Drop while Fly is active applies normal falling without making the grant permanent',
  async (ruleset) => {
    const context = fixture({ ruleset, withSpells: true });
    const { adapter, token, combat, library } = context;
    const cast = castFly(context);
    await adapter.applyFlightCommand(token, 'takeoff');
    await finish(context);
    await adapter.applyFlightCommand(token, 'raise', 20);
    await finish(context);
    await adapter.applyFlightCommand(token, 'drop');
    await finish(context);
    expect(library.get(token.characterSheetId)).toMatchObject({
      conditions: ['prone'],
      fallTraits: { flySpeed: 0 },
      concentration: cast.spellId,
      lastFall: { damage: 7, prone: true },
    });
    expect(combat.effects).toHaveLength(1);
    expect(adapter.getFlightStatus(token).speed).toBe(60);
    expect(combat.status(token).movement.spent).toBe(25);
  }
);

test('ending Fly during takeoff refunds the unfinished segment without creating a fall from an unreached altitude', async () => {
  const context = fixture({ withSpells: true });
  const { adapter, token, combat, library } = context;
  castFly(context);
  await adapter.applyFlightCommand(token, 'takeoff');
  adapter._updateForwardMovements(1 / 60);
  library.endConcentration(token.characterSheetId);
  combat.syncEffects();
  await finish(context);
  expect(token.world.y).toBe(0);
  expect(token.flightActive).toBeUndefined();
  expect(combat.status(token).movement.spent).toBe(0);
  expect(rollDiceExpression).not.toHaveBeenCalled();
});

test('losing Fly while natural flight remains stops an over-budget route without dropping the creature', async () => {
  const context = fixture({ withSpells: true });
  const { adapter, token, combat, library } = context;
  library.edit(token.characterSheetId, { fallTraits: { flySpeed: 20 } });
  castFly(context);
  await adapter.applyFlightCommand(token, 'takeoff');
  await finish(context);
  await adapter.applyFlightCommand(token, 'raise', 5);
  await finish(context);
  adapter.requestMoveToGrid(token, 9, 2);
  for (let frame = 0; frame < 240; frame++) {
    adapter._updateForwardMovements(1 / 60);
    if (adapter._movementRoutes.get(token)?.spent === 5 && token.world.x > 3.5 + 1e-5) break;
  }
  library.endConcentration(token.characterSheetId);
  combat.syncEffects();
  await finish(context);
  expect(token.flightActive).toBe(true);
  expect(token.world).toEqual({ x: 3.5, y: 2, z: 2.5 });
  expect(combat.status(token).movement).toMatchObject({ base: 20, spent: 15, remaining: 5 });
  expect(rollDiceExpression).not.toHaveBeenCalled();
});

test('an airborne Fly checkpoint waits for scene effects to restore before checking flight support', async () => {
  const first = fixture({ withSpells: true });
  castFly(first);
  await first.adapter.applyFlightCommand(first.token, 'takeoff');
  await finish(first);
  const saved = first.adapter.getStablePlacement(first.token);
  const snapshot = first.combat.snapshot();
  const second = fixture({ withSpells: true, clear: false });
  second.gm.sceneAutosave = { ready: false, changed: jest.fn() };
  second.gm.characterServices.library = first.library;
  linkTokenCharacter(second.token, first.library, first.token.characterSheetId);
  await second.adapter.restoreStablePlacement(second.token, saved);
  second.adapter._updateForwardMovements(1 / 60);
  expect(second.token.flightActive).toBe(true);
  const reopened = new CombatSession({ library: first.library });
  reopened.restore(snapshot, [second.token]);
  second.gm.characterServices.combat = reopened;
  second.gm.characterServices.falling.library = first.library;
  second.gm.characterServices.falling.combat = reopened;
  second.gm.sceneAutosave.ready = true;
  second.adapter._updateForwardMovements(1 / 60);
  expect(second.token.world).toEqual(saved.pose.world);
  expect(second.token.flightActive).toBe(true);
  expect(reopened.status(second.token).movement).toMatchObject({
    base: 60,
    spent: 5,
    remaining: 55,
  });
  expect(rollDiceExpression).not.toHaveBeenCalled();
});

test('Fly works on an unlinked creature and opening its sheet copies only base flight', async () => {
  const context = fixture({ withSpells: true });
  const { adapter, gm, token, combat, library, data } = context;
  const recipient = {
    id: 'unlinked',
    type: token.type,
    gridX: 3,
    gridY: 2,
    world: { x: 3.5, y: 0, z: 2.5 },
    __threeMesh: new Group(),
  };
  recipient.__threeMesh.userData.__ttBillboard = false;
  gm.placedTokens.push(recipient);
  adapter._tokenAnimationData.set(recipient, data);
  castFly(context, [recipient]);
  combat.endCombat();
  expect(adapter.getFlightCommandAvailability(recipient, 'takeoff').allowed).toBe(true);
  await adapter.applyFlightCommand(recipient, 'takeoff');
  await finish({ adapter, token: recipient });
  expect(adapter.requestMoveToGrid(recipient, 8, 2).cost).toBe(25);
  await finish({ adapter, token: recipient });
  const character = await getTokenCharacter(gm, recipient, gm.characterServices);
  expect(character.fallTraits.flySpeed).toBe(0);
  expect(adapter.getFlightStatus(recipient).speed).toBe(60);
  expect(library.get(character.id).fallTraits.flySpeed).toBe(0);
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
