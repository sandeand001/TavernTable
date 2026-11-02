import { Group } from 'three';
import { Token3DAdapter } from '../../../../../src/scene/Token3DAdapter.js';
import { TerrainEngine } from '../../../../../src/terrain/TerrainEngine.js';
import { CharacterLibrary } from '../../../../../src/entities/characters/CharacterLibrary.js';
import CombatSession from '../../../../../src/entities/characters/CombatSession.js';
import { linkTokenCharacter } from '../../../../../src/entities/creatures/TokenMovement.js';
import FallingController from '../../../../../src/ui/characters/FallingController.js';
import { getTokenCharacter } from '../../../../../src/ui/characters/characterServices.js';
import { rollDiceExpression } from '../../../../../src/systems/dice/dice.js';

jest.mock('../../../../../src/systems/dice/dice.js', () => ({
  rollDiceExpression: jest.fn(async ({ expression }) => ({
    expression,
    total: 4,
    text: '1d6 = 4',
  })),
}));

beforeEach(() => rollDiceExpression.mockClear());

function fixture() {
  localStorage.clear();
  const engine = new TerrainEngine(10, 5);
  engine.addVolume({
    id: 'bridge',
    layerId: 'bridge',
    bounds: { min: { x: 25, y: 8, z: 5 }, max: { x: 45, y: 9, z: 15 } },
  });
  for (let i = 0; i < 6; i++)
    engine.addVolume({
      id: `step-${i}`,
      layerId: 'bridge',
      bounds: {
        min: { x: i * 5, y: 0, z: 5 },
        max: { x: (i + 1) * 5, y: (i + 1) * 1.5, z: 10 },
      },
    });
  const token = {
    id: 'token-1',
    type: 'mannequin',
    gridX: 0,
    gridY: 0,
    facingAngle: 0,
    world: { x: 0.5, y: 0, z: 0.5 },
    __threeMesh: new Group(),
  };
  const gm = {
    cols: 10,
    rows: 5,
    terrainEngine: engine,
    placedTokens: [token],
    is3DModeActive: () => true,
    getTerrainHeight: (x, y) => engine.getHeightAt(x, y),
    spatial: {
      tileWorldSize: 1,
      elevationUnit: 0.5,
      gridToWorld: (x, z, height) => ({ x, y: height * 0.5, z }),
      worldToGrid: (x, z) => ({ gridX: Math.floor(x), gridY: Math.floor(z) }),
    },
  };
  const library = new CharacterLibrary({ ruleset: '2014', catalog: [], storage: localStorage });
  const id = library.create('Bridge Scout');
  library.edit(id, { speed: 100 });
  linkTokenCharacter(token, library, id);
  const adapter = new Token3DAdapter(gm);
  gm.token3DAdapter = adapter;
  const combat = new CombatSession({
    library,
    isMoving: (entry) => adapter.isMovementInProgress(entry),
  });
  gm.characterServices = { library, combat };
  const action = { getClip: () => ({ duration: 1, tracks: [] }), isScheduled: () => false };
  adapter._tokenAnimationData.set(token, {
    actions: { idle: action, walk: action, run: action },
    profile: { walkSpeed: 2, runSpeed: 4 },
  });
  adapter._setAnimation = jest.fn();
  combat.startTurn(token);
  return { gm, engine, token, adapter, combat };
}

function finish({ token, adapter }) {
  for (let frame = 0; frame < 3600 && adapter.isMovementInProgress(token); frame++) {
    adapter._updateForwardMovements(1 / 60);
    adapter._updatePlannedMovements();
  }
  expect(adapter.isMovementInProgress(token)).toBe(false);
}

test('a live creature walks the approved stair route, spends its cost and saves upper-floor support', () => {
  const context = fixture();
  const { token, adapter, combat } = context;
  try {
    const request = adapter.requestMoveToSurface(token, {
      kind: 'floor',
      point: { x: 6.5, y: 1.8, z: 2.5 },
      normal: { x: 0, y: 1, z: 0 },
      surfaceId: 'bridge',
    });
    expect(request?.cost).toBeGreaterThan(0);
    finish(context);
    expect(token.world).toEqual({ x: 6.5, y: 1.8, z: 2.5 });
    expect(token.flightActive).not.toBe(true);
    expect(combat.status(token).movement.spent).toBe(request.cost);
    expect(adapter.getStablePlacement(token).pose).toMatchObject({
      kind: 'ground',
      surfaceId: 'bridge',
      world: { y: 1.8 },
    });
  } finally {
    adapter.disposeMovementRange();
  }
});

test('a stair route accepts a new destination and changes course on the next supported step', () => {
  const context = fixture();
  const { token, adapter, combat } = context;
  try {
    expect(
      adapter.requestMoveToSurface(token, {
        point: { x: 6.5, y: 1.8, z: 2.5 },
        normal: { x: 0, y: 1, z: 0 },
        surfaceId: 'bridge',
      })
    ).toBeTruthy();
    for (let frame = 0; frame < 1200 && token.world.z <= 0.6; frame++) {
      adapter._updateForwardMovements(1 / 60);
      adapter._updatePlannedMovements();
    }
    expect(token.world.z).toBeGreaterThan(0.6);
    expect(adapter.requestMoveToGrid(token, 0, 3)).toBeTruthy();
    finish(context);
    expect(token.world).toEqual({ x: 0.5, y: 0, z: 3.5 });
    expect(combat.status(token).movement.spent).toBe(15);
    expect(combat.moves.size).toBe(0);
  } finally {
    adapter.disposeMovementRange();
  }
});

test('Drop lands on the next floor, charges no movement and applies damage for only that drop', async () => {
  const context = fixture();
  const { gm, token, adapter, combat } = context;
  const library = gm.characterServices.library;
  library.edit(token.characterSheetId, {
    hp: { max: 40, current: 40 },
    fallTraits: { flySpeed: 60 },
  });
  gm.characterServices.falling = new FallingController({
    gameManager: gm,
    library,
    combat,
    getCharacter: (entry) => getTokenCharacter(gm, entry, gm.characterServices),
    onChanged: jest.fn(),
  });
  const data = adapter._tokenAnimationData.get(token);
  for (const key of ['hover', 'fly', 'fall', 'fallLoop', 'proneLanding', 'prone']) {
    data.actions[key] = {
      time: 0,
      paused: false,
      isScheduled: () => false,
      getClip: () => ({ duration: 0.8, tracks: [] }),
    };
  }
  data.clips = Object.fromEntries(Object.keys(data.actions).map((key) => [key, 0.8]));
  data.landingContactTimes = { fall: 0.15, proneLanding: 0 };
  data.current = 'hover';
  token.gridX = 6;
  token.gridY = 2;
  token.world = { x: 6.5, y: 4, z: 2.5 };
  token.flightActive = true;
  try {
    adapter.recordStablePlacement(token);
    await adapter.applyFlightCommand(token, 'drop');
    for (let frame = 0; frame < 3600 && adapter.isMovementInProgress(token); frame++) {
      adapter._updateForwardMovements(1 / 60);
      adapter._updatePlannedMovements();
      await Promise.resolve();
    }
    expect(adapter.isMovementInProgress(token)).toBe(false);
    expect(token.world.y).toBeCloseTo(1.8);
    expect(rollDiceExpression).toHaveBeenLastCalledWith(
      expect.objectContaining({ expression: '1d6' })
    );
    expect(library.get(token.characterSheetId).hp.current).toBe(36);
    expect(library.get(token.characterSheetId).conditions).toContain('prone');
    expect(combat.status(token).movement.spent).toBe(0);
    expect(adapter.getStablePlacement(token).pose.surfaceId).toBe('bridge');
  } finally {
    adapter.disposeMovementRange();
  }
});

test.each([false, true])(
  'walking off an upper platform resolves falling before any redirect (%s)',
  async (redirect) => {
    const context = fixture();
    const { gm, engine, token, adapter, combat } = context;
    const library = gm.characterServices.library;
    library.edit(token.characterSheetId, { hp: { max: 40, current: 40 } });
    engine.addVolume({
      id: 'high-platform',
      layerId: 'upper',
      bounds: { min: { x: 40, y: 19, z: 10 }, max: { x: 45, y: 20, z: 15 } },
    });
    gm.characterServices.falling = new FallingController({
      gameManager: gm,
      library,
      combat,
      getCharacter: (entry) => getTokenCharacter(gm, entry, gm.characterServices),
      onChanged: jest.fn(),
    });
    const data = adapter._tokenAnimationData.get(token);
    for (const key of ['fall', 'fallLoop', 'proneLanding', 'prone']) {
      data.actions[key] = {
        time: 0,
        paused: false,
        isScheduled: () => false,
        getClip: () => ({ duration: 0.8, tracks: [] }),
      };
    }
    data.clips = Object.fromEntries(Object.keys(data.actions).map((key) => [key, 0.8]));
    data.landingContactTimes = { fall: 0.15, proneLanding: 0 };
    data.current = 'idle';
    token.gridX = 8;
    token.gridY = 2;
    token.world = { x: 8.5, y: 4, z: 2.5 };
    try {
      const request = adapter.requestMoveToGrid(token, 9, 2);
      expect(request?.cost).toBe(5);
      if (redirect) {
        for (
          let frame = 0;
          frame < 1800 && adapter._movementStates.get(token)?.phase !== 'fall';
          frame++
        ) {
          adapter._updateForwardMovements(1 / 60);
          adapter._updatePlannedMovements();
          await Promise.resolve();
        }
        expect(adapter._movementStates.get(token)?.phase).toBe('fall');
        expect(adapter.requestMoveToGrid(token, 9, 4)).toMatchObject({ queued: true });
        expect(token.world.y).toBeGreaterThan(0);
      }
      for (let frame = 0; frame < 3600 && adapter.isMovementInProgress(token); frame++) {
        adapter._updateForwardMovements(1 / 60);
        adapter._updatePlannedMovements();
        await Promise.resolve();
      }
      expect(adapter.isMovementInProgress(token)).toBe(false);
      expect(rollDiceExpression).toHaveBeenLastCalledWith(
        expect.objectContaining({ expression: '2d6' })
      );
      expect(library.get(token.characterSheetId).hp.current).toBe(36);
      expect(library.get(token.characterSheetId).conditions).toContain('prone');
      expect(combat.status(token).movement.spent).toBe(redirect ? 25 : 5);
      expect(token.world).toEqual({ x: 9.5, y: 0, z: redirect ? 4.5 : 2.5 });
    } finally {
      adapter.disposeMovementRange();
    }
  }
);

test('a hidden solid with no support below flight altitude blocks its cell without breaking the whole range', () => {
  const { gm, engine, token, adapter } = fixture();
  gm.characterServices.library.edit(token.characterSheetId, { fallTraits: { flySpeed: 60 } });
  engine.addVolume({
    id: 'solid-tower',
    layerId: 'roof',
    bounds: { min: { x: 5, y: 0, z: 0 }, max: { x: 10, y: 30, z: 5 } },
  });
  engine.setVisibleLayers(['ground']);
  token.flightActive = true;
  token.world.y = 1;
  try {
    const range = adapter.getTokenFlightRange(token);
    expect(range.tiles.has('1,0')).toBe(false);
    expect(range.tiles.has('0,1')).toBe(true);
    expect(range.flightWorldY).toBe(1);
  } finally {
    adapter.disposeMovementRange();
  }
});

test('a changed destination stops at the previous safe floor and refunds the untraveled route', () => {
  const { engine, token, adapter, combat } = fixture();
  token.gridX = 6;
  token.gridY = 2;
  token.world = { x: 6.5, y: 1.8, z: 2.5 };
  try {
    expect(
      adapter.requestMoveToSurface(token, {
        kind: 'floor',
        point: { x: 7.5, y: 1.8, z: 2.5 },
        normal: { x: 0, y: 1, z: 0 },
        surfaceId: 'bridge',
      }).cost
    ).toBe(5);
    engine.addVolume(
      {
        id: 'removed-destination',
        layerId: 'bridge',
        bounds: { min: { x: 35, y: 8, z: 10 }, max: { x: 40, y: 10, z: 15 } },
      },
      'subtract'
    );
    adapter._updateForwardMovements(1 / 60);
    adapter._updatePlannedMovements();
    expect(adapter.isMovementInProgress(token)).toBe(false);
    expect(token.world).toEqual({ x: 6.5, y: 1.8, z: 2.5 });
    expect(combat.status(token).movement.spent).toBe(0);
  } finally {
    adapter.disposeMovementRange();
  }
});
