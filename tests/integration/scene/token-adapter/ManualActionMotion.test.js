import { CHARACTER_DEFINITIONS } from '../../../../src/config/CharacterCatalog.js';
import { CharacterLibrary } from '../../../../src/entities/characters/CharacterLibrary.js';
import {
  executePlayerCommand,
  playerCommandReceipt,
} from '../../../../src/campaigns/ServerGameplay.js';
import { sceneState } from '../../../helpers/sceneState.js';
import {
  createHumanoidFixture,
  finishHumanoid,
  humanoidBounds,
  installHumanoidAssetFiles,
  stepHumanoid,
} from '../../../helpers/humanoid-fixture.js';

let restoreFiles;
const fixtures = [];
beforeAll(() => {
  restoreFiles = installHumanoidAssetFiles();
});
afterEach(() => {
  for (const f of fixtures.splice(0)) f.adapter.disposeMovementRange();
});
afterAll(() => restoreFiles());
async function fixture(type, height) {
  const f = await createHumanoidFixture({ type, height });
  fixtures.push(f);
  return f;
}

describe.each(CHARACTER_DEFINITIONS.map(({ id }) => id))('%s natural manual motion', (type) => {
  test('an approved Cover replays from its authorized origin instead of snapping to or moving past its committed stance', async () => {
    const f = await fixture(type, 24);
    const library = new CharacterLibrary({ ruleset: '2014', catalog: [], storage: localStorage });
    const characterId = library.create('Approved cover scout');
    const scene = sceneState({ characterId, name: 'Approved cover scout' });
    scene.grid = { cols: 12, rows: 8, tileWorldSize: 1 };
    scene.terrain.heights = Array.from({ length: 8 }, () =>
      Array.from({ length: 12 }, (_, x) => (x >= 6 ? 24 : 0))
    );
    const actor = scene.creatures[0];
    Object.assign(actor, {
      type,
      gridX: f.token.gridX,
      gridY: f.token.gridY,
      facingAngle: f.token.facingAngle,
      pose: { kind: 'ground', world: { ...f.token.world } },
    });
    scene.tokenCounters.types = [[type, 1]];
    const accepted = await executePlayerCommand(
      scene,
      library,
      {
        kind: 'emote',
        tokenId: actor.id,
        payload: { actionId: 'action-cover' },
      },
      { ownedIds: [characterId] }
    );
    const receipt = playerCommandReceipt(accepted, scene, library);
    expect(receipt.from?.pose.world).toEqual(actor.pose.world);
    const entry = {
      commandId: '00000000-0000-4000-8000-000000000601',
      tokenId: f.token.id,
      kind: 'emote',
      actionId: 'action-cover',
      animationKey: receipt.animationKey,
      from: receipt.from,
      placement: receipt.placement,
    };
    f.token.mapId = 'map-main';
    await f.adapter.restoreStablePlacement(f.token, receipt.placement);
    await f.adapter.playApprovedVisual(f.token, entry);
    expect(f.token.world).toEqual(receipt.from.pose.world);
    let interpolated = false;
    finishHumanoid(f, () => {
      if (
        f.token.world.x > receipt.from.pose.world.x &&
        f.token.world.x < receipt.placement.pose.world.x
      )
        interpolated = true;
    });
    expect(interpolated).toBe(true);
    for (const axis of ['x', 'y', 'z'])
      expect(f.token.world[axis]).toBeCloseTo(receipt.placement.pose.world[axis], 6);
    expect(f.token.facingAngle).toBeCloseTo(receipt.placement.facingAngle, 6);
    expect(f.data.current).toBe('actionCoverHold');
  });

  test('removing the supporting cover wall releases the held crouch', async () => {
    const f = await fixture(type, 24);
    await f.adapter.playTokenAction(f.token, 'action-cover');
    finishHumanoid(f);
    f.gm.getTerrainHeight = () => 0;
    for (let frame = 0; frame < 40; frame++) stepHumanoid(f);
    expect(f.data.current).toBe('idle');
    expect(f.adapter._getManualAnimationState(f.token)).toBeNull();
  });

  test('Dodge visibly travels outward and walks back without changing its logical position', async () => {
    const f = await fixture(type, 0);
    const world = { ...f.token.world };
    const root = f.adapter._rootBones.get(f.token)[0].bone;
    const before = root.matrixWorld.clone();
    await f.adapter.playTokenAction(f.token, 'action-dodge');
    let distance = 0;
    finishHumanoid(f, () => {
      f.mesh.updateMatrixWorld(true);
      distance = Math.max(
        distance,
        Math.hypot(
          root.matrixWorld.elements[12] - before.elements[12],
          root.matrixWorld.elements[14] - before.elements[14]
        )
      );
      expect(f.token.world).toEqual(world);
    });
    expect(distance).toBeGreaterThan(0.5);
    expect(f.data.current).toBe('idle');
    expect(f.token.world).toEqual(world);
    expect(
      Math.hypot(
        root.matrixWorld.elements[12] - before.elements[12],
        root.matrixWorld.elements[14] - before.elements[14]
      )
    ).toBeLessThan(0.02);
  });

  test('server-approved Cover matches the exact native final pose and preserves all rule costs', async () => {
    const f = await fixture(type, 24);
    const library = new CharacterLibrary({ ruleset: '2014', catalog: [], storage: localStorage });
    const characterId = library.create('Native cover scout');
    const scene = sceneState({ characterId, name: 'Native cover scout' });
    scene.grid = { cols: 12, rows: 8, tileWorldSize: 1 };
    scene.terrain.heights = Array.from({ length: 8 }, () =>
      Array.from({ length: 12 }, (_, x) => (x >= 6 ? 24 : 0))
    );
    const actor = scene.creatures[0];
    Object.assign(actor, {
      type,
      gridX: f.token.gridX,
      gridY: f.token.gridY,
      facingAngle: f.token.facingAngle,
      pose: { kind: 'ground', world: { ...f.token.world } },
    });
    scene.tokenCounters.types = [[type, 1]];
    const before = JSON.parse(JSON.stringify(library.get(characterId)));
    const accepted = await executePlayerCommand(
      scene,
      library,
      {
        kind: 'emote',
        tokenId: actor.id,
        payload: { actionId: 'action-cover' },
      },
      { ownedIds: [characterId] }
    );
    await f.adapter.playTokenAction(f.token, 'action-cover');
    finishHumanoid(f);
    const committed = accepted.scene.creatures.find((entry) => entry.id === actor.id);
    for (const axis of ['x', 'y', 'z'])
      expect(committed.pose.world[axis]).toBeCloseTo(f.token.world[axis], 6);
    expect(committed.facingAngle).toBeCloseTo(f.token.facingAngle, 6);
    expect(accepted.scene.combat).toEqual(scene.combat);
    expect(library.get(characterId)).toEqual(before);
  });

  test('Cover rejects a scene with no adjacent wall', async () => {
    const f = await fixture(type, 0);
    expect(f.adapter.getManualActionAvailability(f.token, 'action-cover').allowed).toBe(false);
    await expect(f.adapter.playTokenAction(f.token, 'action-cover')).rejects.toThrow(
      /adjacent wall/
    );
    expect(f.data.current).toBe('idle');
  });

  test('Cover smoothly aligns the crouched body with a valid wall and preserves its cell', async () => {
    const f = await fixture(type, 24);
    await f.adapter.playTokenAction(f.token, 'action-cover');
    finishHumanoid(f);
    expect(f.data.current).toBe('actionCoverHold');
    expect([f.token.gridX, f.token.gridY]).toEqual([5, 4]);
    expect(f.token.world.y).toBe(0);
    const bounds = humanoidBounds(f);
    expect(bounds.max.x).toBeCloseTo(5.98, 2);
    expect(Math.abs(bounds.min.y)).toBeLessThan(0.03);
    expect(Math.abs(f.token.facingAngle)).toBeCloseTo(Math.PI);
    const held = { ...f.token.world };
    for (let frame = 0; frame < 60; frame++) stepHumanoid(f);
    expect(f.token.world).toEqual(held);
    f.adapter.releaseManualActionForFacing(f.token);
    for (let frame = 0; frame < 40; frame++) stepHumanoid(f);
    expect(f.data.current).toBe('idle');
    expect(f.token.world).toEqual(held);
  });
});
