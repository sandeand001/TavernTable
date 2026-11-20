import {
  createHumanoidFixture,
  installHumanoidAssetFiles,
  stepHumanoid,
} from '../../helpers/humanoid-fixture.js';
import { CharacterLibrary } from '../../../src/entities/characters/CharacterLibrary.js';
import {
  linkTokenCharacter,
  facingAngleFromDirection,
} from '../../../src/entities/creatures/TokenMovement.js';
import CombatSession from '../../../src/entities/characters/CombatSession.js';
import CampaignWorld from '../../../src/campaigns/CampaignWorld.js';
import { createTwoFloorTravelScene } from '../../../src/campaigns/examples/ConnectedTravelExample.js';
import { sceneActorPlacement } from '../../../src/scene/token-adapter/SavedPlacements.js';
import {
  executePlayerCommand,
  playerCommandReceipt,
} from '../../../src/campaigns/ServerGameplay.js';

let restoreFiles;
beforeAll(() => {
  restoreFiles = installHumanoidAssetFiles();
});
afterAll(() => restoreFiles());

test('approved visible cosmetics animate a projected floor creature without granting off-map manual control', async () => {
  const f = await createHumanoidFixture({ height: 0 });
  try {
    const library = new CharacterLibrary({ ruleset: '2014', catalog: [], storage: localStorage });
    const characters = ['Outside', 'Inside', 'Upstairs'].map((name) =>
      library.get(library.create(name))
    );
    const scene = createTwoFloorTravelScene({ ruleset: '2014', characters });
    f.gm.campaignWorld = CampaignWorld.fromScene(scene, { ruleset: '2014', library });
    f.gm.campaignMapId = 'map-main';
    const actor = scene.creatures[1];
    f.token.id = actor.id;
    f.token.mapId = actor.mapId;
    const placement = sceneActorPlacement(scene, actor);
    await f.adapter.restoreStablePlacement(f.token, placement);
    await expect(f.adapter.playTokenAction(f.token, 'action-wave')).rejects.toThrow(/own map/i);
    await f.adapter.playApprovedVisual(f.token, {
      commandId: '00000000-0000-4000-8000-000000000701',
      tokenId: actor.id,
      kind: 'emote',
      actionId: 'action-wave',
      animationKey: 'actionWave',
      placement,
    });
    expect(f.data.current).toBe('actionWave');
    expect(f.token.world).toEqual(placement.pose.world);
    expect(f.gm.campaignMapId).toBe('map-main');
  } finally {
    f.adapter.disposeMovementRange();
  }
}, 30000);

test('approved Cover on a differently scaled projected floor matches canonical source-map units', async () => {
  const f = await createHumanoidFixture({ height: 0 });
  try {
    const library = new CharacterLibrary({ ruleset: '2014', catalog: [], storage: localStorage });
    const characters = ['Outside', 'Inside', 'Upstairs'].map((name) =>
      library.get(library.create(name))
    );
    const scene = createTwoFloorTravelScene({ ruleset: '2014', characters });
    const floor = scene.maps.find((map) => map.id === 'ground-floor');
    floor.grid.tileWorldSize = 2;
    floor.terrain.worldElevationUnit = 0.6;
    floor.terrain.heights = floor.terrain.heights.map((row) => row.map((_, x) => (x >= 6 ? 4 : 0)));
    const actor = scene.creatures[1];
    Object.assign(actor, {
      gridX: 5,
      gridY: 4,
      pose: { kind: 'ground', world: { x: 11, y: 0, z: 9 } },
    });
    f.gm.campaignWorld = CampaignWorld.fromScene(scene, { ruleset: '2014', library });
    f.gm.campaignMapId = 'map-main';
    f.token.id = actor.id;
    f.token.mapId = actor.mapId;
    const accepted = await executePlayerCommand(
      scene,
      library,
      {
        kind: 'emote',
        tokenId: actor.id,
        payload: { actionId: 'action-cover' },
      },
      { ownedIds: [actor.characterId] }
    );
    const receipt = playerCommandReceipt(accepted, scene, library);
    await f.adapter.restoreStablePlacement(f.token, receipt.placement);
    await f.adapter.playApprovedVisual(f.token, {
      commandId: '00000000-0000-4000-8000-000000000702',
      tokenId: actor.id,
      kind: 'emote',
      actionId: 'action-cover',
      animationKey: receipt.animationKey,
      from: receipt.from,
      placement: receipt.placement,
    });
    for (let frame = 0; frame < 3000 && f.adapter.isMovementInProgress(f.token); frame++)
      stepHumanoid(f, 1 / 120);
    expect(f.adapter.isMovementInProgress(f.token)).toBe(false);
    for (const axis of ['x', 'y', 'z'])
      expect(f.token.world[axis]).toBeCloseTo(receipt.placement.pose.world[axis], 6);
    expect(f.token.facingAngle).toBeCloseTo(receipt.placement.facingAngle, 6);
    expect(f.gm.campaignMapId).toBe('map-main');
  } finally {
    f.adapter.disposeMovementRange();
  }
}, 30000);

test('a server-approved ground segment animates the actual sprite without reserving or spending local combat movement', async () => {
  const f = await createHumanoidFixture({ height: 0, animationKeys: ['idle', 'walk'] });
  const library = new CharacterLibrary({ ruleset: '2014', catalog: [], storage: localStorage });
  linkTokenCharacter(f.token, library, library.create('Scout'));
  const combat = new CombatSession({ library, hasToken: (token) => token === f.token });
  f.gm.characterServices = { library, combat };
  f.token.mapId = 'main';
  combat.startTurn(f.token);
  const before = combat.status(f.token).movement;
  const from = {
    mapId: 'main',
    gridX: f.token.gridX,
    gridY: f.token.gridY,
    facingAngle: f.token.facingAngle,
    pose: { kind: 'ground', world: { ...f.token.world } },
  };
  const target = {
    ...from,
    gridX: from.gridX + 1,
    pose: { kind: 'ground', world: { ...from.pose.world, x: from.pose.world.x + 1 } },
  };
  const id = f.token.id;
  const finished = f.adapter.playApprovedMovement(f.token, {
    commandId: '00000000-0000-4000-8000-000000000101',
    from,
    route: [target],
  });
  for (let tick = 0; tick < 4; tick++) await Promise.resolve();
  expect(f.adapter.isMovementInProgress(f.token)).toBe(true);
  f.adapter.advanceApprovedMovement(0.1);
  stepHumanoid(f, 0.1);
  expect(f.token.world.x).toBeGreaterThan(from.pose.world.x);
  expect(f.token.world.x).toBeLessThan(target.pose.world.x);
  for (let frame = 0; frame < 120 && f.adapter.isMovementInProgress(f.token); frame++) {
    f.adapter.advanceApprovedMovement(1 / 60);
    stepHumanoid(f, 1 / 60);
  }
  await finished;
  expect(f.token.id).toBe(id);
  expect(f.token.world).toEqual(target.pose.world);
  expect(f.token.gridX).toBe(target.gridX);
  expect(combat.status(f.token).movement).toEqual(before);
  f.adapter.disposeMovementRange();
});

test('a continued approved route appends while the previous checkpoint is still animating', async () => {
  const f = await createHumanoidFixture({ height: 0, animationKeys: ['idle', 'walk'] });
  try {
    f.token.mapId = 'main';
    const from = {
      mapId: 'main',
      gridX: f.token.gridX,
      gridY: f.token.gridY,
      facingAngle: f.token.facingAngle,
      pose: { kind: 'ground', world: { ...f.token.world } },
    };
    const first = {
      ...from,
      gridX: from.gridX + 1,
      facingAngle: 0,
      pose: { kind: 'ground', world: { ...from.pose.world, x: from.pose.world.x + 1 } },
    };
    const second = {
      ...first,
      gridX: first.gridX + 1,
      pose: { kind: 'ground', world: { ...first.pose.world, x: first.pose.world.x + 1 } },
    };
    const finished = f.adapter.playApprovedMovement(f.token, {
      commandId: '00000000-0000-4000-8000-000000000102',
      from,
      route: [first],
    });
    for (let tick = 0; tick < 4; tick++) await Promise.resolve();
    f.adapter.advanceApprovedMovement(0.1);
    const continued = f.adapter.playApprovedMovement(f.token, {
      commandId: '00000000-0000-4000-8000-000000000103',
      from: first,
      route: [second],
    });
    for (let frame = 0; frame < 240 && f.adapter.isMovementInProgress(f.token); frame++) {
      f.adapter.advanceApprovedMovement(1 / 60);
      stepHumanoid(f, 1 / 60);
    }
    await Promise.all([finished, continued]);
    expect(f.token.world).toEqual(second.pose.world);
    expect(f.token.gridX).toBe(second.gridX);
  } finally {
    f.adapter.disposeMovementRange();
  }
});

test('streamed tile checkpoints do not idle while the next segment is arriving', async () => {
  const f = await createHumanoidFixture({ height: 0, animationKeys: ['idle', 'walk'] });
  try {
    f.token.mapId = 'main';
    const from = {
      mapId: 'main',
      gridX: f.token.gridX,
      gridY: f.token.gridY,
      facingAngle: f.token.facingAngle,
      pose: { kind: 'ground', world: { ...f.token.world } },
    };
    const first = {
      ...from,
      gridX: from.gridX + 1,
      facingAngle: 0,
      pose: { kind: 'ground', world: { ...from.pose.world, x: from.pose.world.x + 1 } },
    };
    const second = {
      ...first,
      gridX: first.gridX + 1,
      pose: { kind: 'ground', world: { ...first.pose.world, x: first.pose.world.x + 1 } },
    };
    const finished = f.adapter.playApprovedMovement(f.token, {
      commandId: '00000000-0000-4000-8000-000000000105',
      from,
      route: [first],
      continuing: true,
    });
    for (let tick = 0; tick < 4; tick++) await Promise.resolve();
    for (let frame = 0; frame < 600 && f.token.world.x < first.pose.world.x - 1e-6; frame++) {
      f.adapter.advanceApprovedMovement(1 / 60);
      stepHumanoid(f, 1 / 60);
    }
    expect(f.adapter.isMovementInProgress(f.token)).toBe(true);
    expect(f.adapter._tokenAnimationData.get(f.token).current).not.toBe('idle');
    const continued = f.adapter.playApprovedMovement(f.token, {
      commandId: '00000000-0000-4000-8000-000000000106',
      from: first,
      route: [second],
    });
    for (let frame = 0; frame < 600 && f.adapter.isMovementInProgress(f.token); frame++) {
      f.adapter.advanceApprovedMovement(1 / 60);
      stepHumanoid(f, 1 / 60);
    }
    await Promise.all([finished, continued]);
    expect(f.token.world).toEqual(second.pose.world);
  } finally {
    f.adapter.disposeMovementRange();
  }
});

test('a later authoritative facing reconciles onto an in-flight movement endpoint', async () => {
  const f = await createHumanoidFixture({ height: 0, animationKeys: ['idle', 'walk'] });
  try {
    f.token.mapId = 'main';
    const from = {
      mapId: 'main',
      gridX: f.token.gridX,
      gridY: f.token.gridY,
      facingAngle: f.token.facingAngle,
      pose: { kind: 'ground', world: { ...f.token.world } },
    };
    const target = {
      ...from,
      gridX: from.gridX + 1,
      facingAngle: 0,
      pose: { kind: 'ground', world: { ...from.pose.world, x: from.pose.world.x + 1 } },
    };
    const finished = f.adapter.playApprovedMovement(f.token, {
      commandId: '00000000-0000-4000-8000-000000000104',
      from,
      route: [target],
    });
    for (let tick = 0; tick < 4; tick++) await Promise.resolve();
    expect(
      f.adapter.reconcileApprovedMovement(f.token, { ...target, facingAngle: Math.PI / 2 })
    ).toBe(true);
    for (let frame = 0; frame < 240 && f.adapter.isMovementInProgress(f.token); frame++) {
      f.adapter.advanceApprovedMovement(1 / 60);
      stepHumanoid(f, 1 / 60);
    }
    await finished;
    expect(f.token.facingAngle).toBeCloseTo(Math.PI / 2);
  } finally {
    f.adapter.disposeMovementRange();
  }
});

test.each([
  ['flying', 'fly', { x: 6.5, y: 2, z: 4.5 }, 'flight', 'fly'],
  ['changing flight elevation', 'fly', { x: 5.5, y: 3, z: 4.5 }, 'flight', 'hover'],
  ['falling', 'fall', { x: 5.5, y: 0, z: 4.5 }, 'ground', 'fallLoop'],
])(
  'multiplayer regression: approved %s interpolates all axes with its locomotion clip and no local rules costs',
  async (_label, kind, destination, poseKind, clip) => {
    const f = await createHumanoidFixture({
      height: 0,
      animationKeys: ['idle', 'walk', 'fly', 'hover', 'fall', 'fallLoop'],
    });
    try {
      f.token.mapId = 'main';
      f.token.flightActive = true;
      f.token.world = { x: 5.5, y: 2, z: 4.5 };
      const from = {
        mapId: 'main',
        gridX: 5,
        gridY: 4,
        facingAngle: 0,
        pose: { kind: 'flight', world: { ...f.token.world } },
      };
      const target = {
        ...from,
        gridX: Math.floor(destination.x),
        pose: { kind: poseKind, world: destination },
      };
      let outcome;
      const finished = f.adapter
        .playApprovedMovement(f.token, { kind, completed: true, from, route: [target] })
        .then(
          (value) => {
            outcome = { value };
          },
          (error) => {
            outcome = { error };
          }
        );
      for (let tick = 0; tick < 100 && !outcome && !f.adapter.isMovementInProgress(f.token); tick++)
        await new Promise((resolve) => setTimeout(resolve, 0));
      if (outcome?.error) throw outcome.error;
      expect(f.adapter.isMovementInProgress(f.token)).toBe(true);
      expect(f.data.current).toBe(clip);
      f.adapter.advanceApprovedMovement(0.05);
      stepHumanoid(f, 0.05);
      const axis = destination.x !== from.pose.world.x ? 'x' : 'y';
      expect(f.token.world[axis]).not.toBe(from.pose.world[axis]);
      expect(f.token.world[axis]).not.toBe(destination[axis]);
      for (let frame = 0; frame < 600 && f.adapter.isMovementInProgress(f.token); frame++) {
        f.adapter.advanceApprovedMovement(1 / 120);
        stepHumanoid(f, 1 / 120);
      }
      await finished;
      if (outcome.error) throw outcome.error;
      expect(outcome.value.completed).toBe(true);
      expect(f.token.world).toEqual(destination);
      expect(f.token.flightActive === true).toBe(poseKind === 'flight');
      expect(f.adapter._movementRoutes.size).toBe(0);
    } finally {
      f.adapter.disposeMovementRange();
    }
  }
);

test('multiplayer regression: replacement during flight animation loading cannot start an obsolete approved route', async () => {
  const f = await createHumanoidFixture({
    height: 0,
    animationKeys: ['idle', 'walk', 'hover', 'fly'],
  });
  await f.adapter._ensureFlightAnimations(f.token);
  let release;
  const loading = jest.spyOn(f.adapter, '_ensureFlightAnimations').mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      })
  );
  let pending;
  let outcome;
  try {
    f.token.mapId = 'main';
    const from = {
      mapId: 'main',
      gridX: f.token.gridX,
      gridY: f.token.gridY,
      facingAngle: 0,
      pose: { kind: 'ground', world: { ...f.token.world } },
    };
    const target = { ...from, pose: { kind: 'flight', world: { ...f.token.world, y: 1 } } };
    pending = f.adapter
      .playApprovedMovement(f.token, {
        kind: 'fly',
        completed: true,
        from,
        route: [target],
      })
      .then(
        (value) => {
          outcome = { value };
        },
        (error) => {
          outcome = { error };
        }
      );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(loading).toHaveBeenCalledTimes(1);
    f.adapter.cancelApprovedMovement(f.token);
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(f.adapter.isMovementInProgress(f.token)).toBe(false);
    await pending;
    if (outcome.error) throw outcome.error;
    expect(outcome.value).toMatchObject({ completed: false });
    expect(f.token.world).toEqual(from.pose.world);
  } finally {
    release?.();
    f.adapter.cancelApprovedMovement(f.token);
    if (pending) await pending;
    loading.mockRestore();
    f.adapter.disposeMovementRange();
  }
});

test('multiplayer regression: fine-grained waypoints retain locomotion speed and continuous animation phase', async () => {
  const f = await createHumanoidFixture({ height: 0, animationKeys: ['idle', 'walk'] });
  let finished;
  try {
    f.token.mapId = 'main';
    const from = {
      mapId: 'main',
      gridX: f.token.gridX,
      gridY: f.token.gridY,
      facingAngle: 0,
      pose: { kind: 'ground', world: { ...f.token.world } },
    };
    const route = Array.from({ length: 40 }, (_, index) => {
      const x = from.pose.world.x + (index + 1) / 40;
      return {
        ...from,
        gridX: Math.floor(x),
        pose: { kind: 'ground', world: { ...from.pose.world, x } },
      };
    });
    finished = f.adapter.playApprovedMovement(f.token, {
      kind: 'walk',
      completed: true,
      from,
      route,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const state = f.adapter._movementStates.get(f.token);
    const speed = state.activeSpeed;
    const duration = 1 / speed;
    const step = Math.min(0.1, duration / 4);
    const action = f.data.actions[state.loopActionKey];
    f.adapter.advanceApprovedMovement(step);
    stepHumanoid(f, step);
    const first = action.time;
    f.adapter.advanceApprovedMovement(step);
    stepHumanoid(f, step);
    expect(action.time).toBeGreaterThan(first);
    f.adapter.advanceApprovedMovement(duration - 2 * step + 1e-6);
    expect(f.adapter.isMovementInProgress(f.token)).toBe(false);
    await finished;
    expect(f.token.world.x).toBe(from.pose.world.x + 1);
  } finally {
    f.adapter.cancelApprovedMovement(f.token);
    if (finished) await finished;
    f.adapter.disposeMovementRange();
  }
});

test('multiplayer regression: approved locomotion replaces a viewer-local manual pose instead of sliding an idle sprite', async () => {
  const f = await createHumanoidFixture({ height: 0, animationKeys: ['idle', 'walk'] });
  let finished;
  try {
    f.token.mapId = 'main';
    f.adapter.playTokenAnimation(f.token, 'idle', {
      blocksMovement: true,
      movementLockMs: Infinity,
    });
    const from = {
      mapId: 'main',
      gridX: f.token.gridX,
      gridY: f.token.gridY,
      facingAngle: 0,
      pose: { kind: 'ground', world: { ...f.token.world } },
    };
    const target = {
      ...from,
      gridX: from.gridX + 1,
      pose: { kind: 'ground', world: { ...from.pose.world, x: from.pose.world.x + 1 } },
    };
    finished = f.adapter.playApprovedMovement(f.token, { from, route: [target] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(f.data.current).toBe('walk');
    expect(f.adapter._getManualAnimationState(f.token)).toBeNull();
    f.adapter.advanceApprovedMovement(2);
    await finished;
  } finally {
    f.adapter.cancelApprovedMovement(f.token);
    f.adapter._clearManualAnimationState(f.token);
    if (finished) await finished;
    f.adapter.disposeMovementRange();
  }
});

test('multiplayer regression: backward DM movement uses the native backward locomotion variant', async () => {
  const f = await createHumanoidFixture({ height: 0 });
  const variant = jest.spyOn(f.adapter, '_syncMovementVariant');
  let finished;
  try {
    f.token.mapId = 'main';
    const from = {
      mapId: 'main',
      gridX: f.token.gridX,
      gridY: f.token.gridY,
      facingAngle: facingAngleFromDirection(1, 0),
      pose: { kind: 'ground', world: { ...f.token.world } },
    };
    const target = {
      ...from,
      gridX: from.gridX - 1,
      pose: { kind: 'ground', world: { ...from.pose.world, x: from.pose.world.x - 1 } },
    };
    finished = f.adapter.playApprovedMovement(f.token, { from, route: [target] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(variant.mock.calls[0][1]).toBe(-1);
    const state = f.adapter._movementStates.get(f.token);
    expect(f.data.current).toBe(state.loopActionKey);
    expect(state.activeDirectionSign).toBe(-1);
    f.adapter.advanceApprovedMovement(2);
    await finished;
  } finally {
    f.adapter.cancelApprovedMovement(f.token);
    if (finished) await finished;
    variant.mockRestore();
    f.adapter.disposeMovementRange();
  }
});
