import CampaignStore from '../../../src/campaigns/CampaignStore.js';
import CampaignCharacters from '../../../src/campaigns/CampaignCharacters.js';
import CampaignWorld from '../../../src/campaigns/CampaignWorld.js';
import CampaignAutosave from '../../../src/campaigns/CampaignAutosave.js';
import { decodeScene, encodeScene } from '../../../src/campaigns/CampaignScene.js';
import { attachHostSessionUpdates } from '../../../src/ui/sessions/HostSessionUpdates.js';
import { testIndexedDB } from '../../helpers/indexedDB.js';
import { sceneState } from '../../helpers/sceneState.js';
import { installHumanoidAssetFiles } from '../../helpers/humanoid-fixture.js';
import { sceneActorPlacement } from '../../../src/scene/token-adapter/SavedPlacements.js';
import {
  createConnectedTravelBoard,
  disposeConnectedTravelBoard,
} from '../../helpers/connectedTravelBoard.js';

async function fixture({ startAutosave = true, extraActor = false } = {}) {
  const store = new CampaignStore({
    indexedDB: testIndexedDB(),
    packs: [{ id: 'srd-2014', ruleset: '2014', version: '5.1', core: true }],
  });
  store.storageInfo = { kind: 'host' };
  const campaign = await store.create({ name: 'Shared movement', ruleset: '2014' });
  const catalog = { ruleset: '2014', entries: [], classes: [], enabledEntryIds: [] };
  const library = await CampaignCharacters.open({ store, campaignId: campaign.id, catalog });
  const characterId = await library.create('Scout');
  const extraCharacterId = extraActor ? await library.create('Guard') : null;
  const saved = sceneState({ characterId, name: 'Scout' });
  saved.terrain.heights = Array.from({ length: 5 }, () => Array(5).fill(0));
  if (extraActor) {
    saved.creatures.push({
      ...JSON.parse(JSON.stringify(saved.creatures[0])),
      id: 'token-2',
      instanceNumber: 2,
      name: 'Guard',
      characterId: extraCharacterId,
      gridX: 3,
      pose: { kind: 'ground', world: { x: 3.5, y: 0, z: 1.5 } },
    });
    saved.tokenCounters = { nextId: 2, types: [[saved.creatures[0].type, 2]] };
  }
  const world = CampaignWorld.fromScene(saved, {
    ruleset: '2014',
    library,
  });
  const gm = await createConnectedTravelBoard({ library, scene: world.save() });
  const autosave = new CampaignAutosave({
    gameManager: gm,
    library,
    combat: gm.characterServices.combat,
  });
  if (startAutosave) await autosave.start();
  let notice;
  const services = {
    campaign,
    library,
    autosave,
    workspace: {
      store: {
        identity: { id: 'host' },
        readCharacters: (id) => store.readCharacters(id),
        subscribeChanges: (listener) => {
          notice = listener;
          return () => {};
        },
      },
    },
  };
  const parent = document.createElement('section');
  document.body.append(parent);
  const dispose = attachHostSessionUpdates({ gameManager: gm, services, parent });
  return {
    store,
    campaign,
    catalog,
    library,
    gm,
    autosave,
    parent,
    services,
    notice: (event) => notice(event),
    close: () => {
      dispose();
      autosave.dispose();
      disposeConnectedTravelBoard(gm);
      store.close();
      parent.remove();
    },
  };
}

test('the initial live connection does not abort native campaign startup or its first saved checkpoint', async () => {
  const { gm, autosave, parent, notice, close } = await fixture({ startAutosave: false });
  try {
    notice({ type: 'connected' });
    await expect(autosave.start()).resolves.toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(autosave.status.state).toBe('saved');
    expect(gm.campaignMapFailure).toBeFalsy();
    expect(parent.textContent).toMatch(/up to date/i);
  } finally {
    close();
  }
});

test('the DM live-notice path reconciles an accepted player move without requiring a reopen or overwriting its canonical pose', async () => {
  const { store, campaign, library, gm, autosave, parent, notice, close } = await fixture();
  try {
    const before = await store.readCharacters(campaign.id);
    const next = decodeScene(before.scene, { ruleset: library.ruleset, library });
    next.creatures[0].gridX = 2;
    next.creatures[0].pose.world.x = 2.5;
    await store.commitScene(campaign.id, {
      ruleset: library.ruleset,
      revision: before.sceneRevision,
      charactersRevision: before.revision,
      scene: encodeScene(next, { ruleset: library.ruleset, library }),
    });
    notice({ type: 'campaign', campaignId: campaign.id, actorId: 'player', kind: 'playerCommand' });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(parent.textContent).not.toMatch(/reopen/i);
    expect(gm.placedTokens[0].world.x).toBe(2.5);
    autosave.changed('camera');
    await autosave.flush();
    expect(
      decodeScene((await store.readScene(campaign.id)).scene, {
        ruleset: library.ruleset,
        library,
      }).creatures[0].pose.world.x
    ).toBe(2.5);
  } finally {
    close();
  }
});

test('the DM starts a player movement presentation before its full shared snapshot read finishes', async () => {
  const { store, campaign, library, gm, autosave, services, notice, close } = await fixture();
  let releaseRead;
  try {
    const before = await store.readCharacters(campaign.id);
    const next = decodeScene(before.scene, { ruleset: library.ruleset, library });
    const actor = next.creatures[0];
    const from = {
      mapId: actor.mapId ?? 'map-main',
      gridX: actor.gridX,
      gridY: actor.gridY,
      facingAngle: actor.facingAngle,
      pose: structuredClone(actor.pose),
    };
    actor.gridX = 2;
    actor.pose.world.x = 2.5;
    const destination = {
      ...from,
      gridX: actor.gridX,
      pose: structuredClone(actor.pose),
    };
    await store.commitScene(campaign.id, {
      ruleset: library.ruleset,
      revision: before.sceneRevision,
      charactersRevision: before.revision,
      scene: encodeScene(next, { ruleset: library.ruleset, library }),
    });
    const canonical = await store.readCharacters(campaign.id);
    const originalRead = services.workspace.store.readCharacters;
    services.workspace.store.readCharacters = () =>
      new Promise((resolve) => {
        releaseRead = () => resolve(canonical);
      });
    const play = jest
      .spyOn(gm.token3DAdapter, 'playApprovedMovement')
      .mockResolvedValue({ completed: true });
    notice({
      type: 'campaign',
      campaignId: campaign.id,
      actorId: 'player-session',
      kind: 'playerCommand',
      version: 1,
      sceneRevision: canonical.sceneRevision,
      charactersRevision: canonical.revision,
      hasPresentations: true,
      presentations: [
        {
          commandId: 'player-live-motion-1',
          tokenId: actor.id,
          kind: 'move',
          motion: {
            kind: 'walk',
            completed: true,
            from,
            route: [destination],
          },
          sceneRevision: canonical.sceneRevision,
          charactersRevision: canonical.revision,
        },
      ],
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(play).toHaveBeenCalledTimes(1);
    expect(play.mock.calls[0][1]).toMatchObject({
      tokenId: actor.id,
      from,
      route: [destination],
    });
    releaseRead();
    services.workspace.store.readCharacters = originalRead;
    await new Promise((resolve) => setTimeout(resolve, 30));
    play.mockRestore();
    expect(autosave.sharedConflict).toBeFalsy();
  } finally {
    releaseRead?.();
    close();
  }
});

test('the DM renders one copy of a route delivered as live and canonical notices', async () => {
  const { store, campaign, library, gm, services, notice, close } = await fixture();
  let releaseRead;
  try {
    const before = await store.readCharacters(campaign.id);
    const next = decodeScene(before.scene, { ruleset: library.ruleset, library });
    const actor = next.creatures[0];
    const from = {
      mapId: actor.mapId ?? 'map-main',
      gridX: actor.gridX,
      gridY: actor.gridY,
      facingAngle: actor.facingAngle,
      pose: structuredClone(actor.pose),
    };
    actor.gridX = 2;
    actor.pose.world.x = 2.5;
    const destination = {
      ...from,
      gridX: actor.gridX,
      pose: structuredClone(actor.pose),
    };
    await store.commitScene(campaign.id, {
      ruleset: library.ruleset,
      revision: before.sceneRevision,
      charactersRevision: before.revision,
      scene: encodeScene(next, { ruleset: library.ruleset, library }),
    });
    const canonical = await store.readCharacters(campaign.id);
    services.workspace.store.readCharacters = () =>
      new Promise((resolve) => {
        releaseRead = () => resolve(canonical);
      });
    const play = jest
      .spyOn(gm.token3DAdapter, 'playApprovedMovement')
      .mockResolvedValue({ completed: true });
    const entry = {
      commandId: 'duplicate-player-route-1',
      tokenId: actor.id,
      kind: 'move',
      motion: {
        kind: 'walk',
        completed: true,
        from,
        route: [destination],
      },
    };
    notice({
      type: 'live-presentations',
      campaignId: campaign.id,
      actorId: 'player-session',
      presentations: [entry],
    });
    notice({
      type: 'campaign',
      campaignId: campaign.id,
      actorId: 'player-session',
      kind: 'playerCommand',
      version: 1,
      sceneRevision: canonical.sceneRevision,
      charactersRevision: canonical.revision,
      hasPresentations: true,
      presentations: [
        {
          ...entry,
          sceneRevision: canonical.sceneRevision,
          charactersRevision: canonical.revision,
        },
      ],
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(play).toHaveBeenCalledTimes(1);
    releaseRead();
    await new Promise((resolve) => setTimeout(resolve, 30));
    play.mockRestore();
  } finally {
    releaseRead?.();
    close();
  }
});

test('a local DM movement rebases over a simultaneous player move on a different actor', async () => {
  const { store, campaign, library, gm, autosave, parent, notice, close } = await fixture({
    extraActor: true,
  });
  try {
    const local = gm.placedTokens[1];
    local.gridX = 4;
    local.world = { x: 4.5, y: 0, z: 1.5 };
    gm.token3DAdapter.recordStablePlacement(local);
    expect(autosave.canRebaseSharedUpdate()).toBe(true);
    const before = await store.readCharacters(campaign.id);
    const canonical = decodeScene(before.scene, { ruleset: library.ruleset, library });
    canonical.creatures[0].gridX = 2;
    canonical.creatures[0].pose.world.x = 2.5;
    await store.commitScene(campaign.id, {
      ruleset: library.ruleset,
      revision: before.sceneRevision,
      charactersRevision: before.revision,
      scene: encodeScene(canonical, { ruleset: library.ruleset, library }),
    });
    notice({
      type: 'campaign',
      campaignId: campaign.id,
      actorId: 'player',
      kind: 'playerCommand',
    });
    for (
      let check = 0;
      check < 100 &&
      (gm.placedTokens[0].world.x !== 2.5 || !parent.textContent.includes('up to date'));
      check++
    )
      await new Promise((resolve) => setTimeout(resolve, 5));
    expect(parent.textContent).not.toMatch(/conflict|paused|reopen/i);
    expect(gm.placedTokens[0].world.x).toBe(2.5);
    expect(gm.placedTokens[1].world.x).toBe(4.5);
    await autosave.flush();
    const saved = decodeScene((await store.readScene(campaign.id)).scene, {
      ruleset: library.ruleset,
      library,
    });
    expect(saved.creatures.map(({ pose }) => pose.world.x)).toEqual([2.5, 4.5]);
  } finally {
    close();
  }
});

test('a local movement-cost patch merges independent combat state from a player actor', async () => {
  const { store, campaign, library, gm, autosave, parent, notice, close } = await fixture({
    extraActor: true,
  });
  try {
    const local = gm.placedTokens[1];
    const combat = gm.characterServices.combat;
    combat._state(local).movementSpent = 5;
    combat._publish();
    local.gridX = 4;
    local.world = { x: 4.5, y: 0, z: 1.5 };
    gm.token3DAdapter.recordStablePlacement(local);
    const before = await store.readCharacters(campaign.id);
    const canonical = decodeScene(before.scene, { ruleset: library.ruleset, library });
    canonical.creatures[0].gridX = 2;
    canonical.creatures[0].pose.world.x = 2.5;
    const localState = combat.snapshot().states.find(({ tokenId }) => tokenId === local.id);
    canonical.combat.states = [
      {
        ...JSON.parse(JSON.stringify(localState)),
        tokenId: canonical.creatures[0].id,
        characterId: canonical.creatures[0].characterId,
        movementSpent: 10,
      },
    ];
    await store.commitScene(campaign.id, {
      ruleset: library.ruleset,
      revision: before.sceneRevision,
      charactersRevision: before.revision,
      scene: encodeScene(canonical, { ruleset: library.ruleset, library }),
    });
    notice({
      type: 'campaign',
      campaignId: campaign.id,
      actorId: 'player',
      kind: 'playerCommand',
    });
    for (let check = 0; check < 100 && !parent.textContent.includes('up to date'); check++)
      await new Promise((resolve) => setTimeout(resolve, 5));
    expect(parent.textContent).not.toMatch(/conflict|paused|reopen/i);
    await autosave.flush();
    const saved = decodeScene((await store.readScene(campaign.id)).scene, {
      ruleset: library.ruleset,
      library,
    });
    expect(saved.creatures.map(({ pose }) => pose.world.x)).toEqual([2.5, 4.5]);
    expect(saved.combat.states).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tokenId: 'token-1', movementSpent: 10 }),
        expect.objectContaining({ tokenId: 'token-2', movementSpent: 5 }),
      ])
    );
  } finally {
    close();
  }
});

test('a player move applies while a different DM movement is still animating', async () => {
  const { store, campaign, library, gm, autosave, parent, notice, close } = await fixture({
    extraActor: true,
  });
  const local = gm.placedTokens[1];
  try {
    gm.token3DAdapter._movementRoutes.set(local, {
      token: local,
      spent: 0,
      segmentCharged: true,
    });
    gm.characterServices.combat.syncMovementStatus();
    local.gridX = 4;
    local.world = { x: 4.5, y: 0, z: 1.5 };
    gm.token3DAdapter.recordStablePlacement(local);
    expect(gm.token3DAdapter.isMovementInProgress(local)).toBe(true);
    const before = await store.readCharacters(campaign.id);
    const canonical = decodeScene(before.scene, { ruleset: library.ruleset, library });
    canonical.creatures[0].gridX = 2;
    canonical.creatures[0].pose.world.x = 2.5;
    await store.commitScene(campaign.id, {
      ruleset: library.ruleset,
      revision: before.sceneRevision,
      charactersRevision: before.revision,
      scene: encodeScene(canonical, { ruleset: library.ruleset, library }),
    });
    notice({
      type: 'campaign',
      campaignId: campaign.id,
      actorId: 'player',
      kind: 'playerCommand',
    });
    for (
      let check = 0;
      check < 30 &&
      (gm.placedTokens[0].world.x !== 2.5 || !parent.textContent.includes('up to date'));
      check++
    )
      await new Promise((resolve) => setTimeout(resolve, 5));
    expect(parent.textContent).not.toMatch(/waiting|conflict|paused|reopen/i);
    expect(gm.placedTokens[0].world.x).toBe(2.5);
    expect(local.world.x).toBe(4.5);
    expect(gm.token3DAdapter.isMovementInProgress(local)).toBe(true);
    expect(autosave.dirty).toBe(true);
  } finally {
    gm.token3DAdapter._movementRoutes.delete(local);
    gm.characterServices.combat.syncMovementStatus();
    close();
  }
});

test('a DM checkpoint saves the committed player destination while its sprite is still moving', async () => {
  const { store, campaign, library, gm, autosave, parent, notice, close } = await fixture({
    extraActor: true,
  });
  const restoreFiles = installHumanoidAssetFiles();
  const [player, local] = gm.placedTokens;
  const adapter = gm.token3DAdapter;
  const waitFor = async (condition, message) => {
    const deadline = Date.now() + 5000;
    while (!condition()) {
      if (Date.now() >= deadline) throw new Error(message);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };
  const context = { ruleset: library.ruleset, library };
  try {
    delete gm.__threeTestDouble;
    adapter.releaseTokenVisual(player);
    await adapter.onTokenAdded(player);
    await player.__threeMeshPromise;

    local.gridX = 4;
    local.world = { x: 4.5, y: 0, z: 1.5 };
    adapter.recordStablePlacement(local);
    const before = await store.readCharacters(campaign.id);
    const canonical = decodeScene(before.scene, context);
    const actor = canonical.creatures[0];
    const from = structuredClone(sceneActorPlacement(canonical, actor));
    actor.gridX = 2;
    actor.pose.world.x = 2.5;
    const destination = sceneActorPlacement(canonical, actor);
    const saved = await store.commitScene(campaign.id, {
      ruleset: library.ruleset,
      revision: before.sceneRevision,
      charactersRevision: before.revision,
      scene: encodeScene(canonical, context),
    });
    notice({
      type: 'campaign',
      campaignId: campaign.id,
      actorId: 'player',
      kind: 'playerCommand',
      presentations: [
        {
          commandId: 'player-move-before-dm-checkpoint',
          tokenId: player.id,
          kind: 'move',
          sceneRevision: saved.revision,
          charactersRevision: before.revision,
          motion: { kind: 'walk', completed: true, from, route: [destination] },
        },
      ],
    });
    await waitFor(
      () => library.sceneRevision >= saved.revision && autosave.ready,
      'The DM did not reconcile the player move'
    );
    expect(parent.textContent).not.toMatch(/conflict|error/i);
    expect(player.world.x).toBe(from.pose.world.x);
    expect(adapter.isMovementInProgress(player)).toBe(true);

    // Keep the DM's animation clock paused until after its own background checkpoint.
    await waitFor(
      () => library.sceneRevision > saved.revision && !autosave.writing,
      'The DM did not save its independent movement'
    );
    expect(player.world.x).toBe(from.pose.world.x);
    const checkpoint = decodeScene((await store.readScene(campaign.id)).scene, context);
    expect(checkpoint.creatures.map(({ pose }) => pose.world.x)).toEqual([2.5, 4.5]);
  } finally {
    close();
    restoreFiles();
  }
}, 15000);

test('a clean DM animation does not delay an unrelated player move', async () => {
  const { store, campaign, library, gm, autosave, parent, notice, close } = await fixture({
    extraActor: true,
  });
  const local = gm.placedTokens[1];
  try {
    gm.token3DAdapter._movementRoutes.set(local, {
      token: local,
      spent: 0,
      segmentCharged: true,
    });
    gm.characterServices.combat.syncMovementStatus();
    expect(autosave.dirty).toBe(false);
    const before = await store.readCharacters(campaign.id);
    const canonical = decodeScene(before.scene, { ruleset: library.ruleset, library });
    canonical.creatures[0].gridX = 2;
    canonical.creatures[0].pose.world.x = 2.5;
    await store.commitScene(campaign.id, {
      ruleset: library.ruleset,
      revision: before.sceneRevision,
      charactersRevision: before.revision,
      scene: encodeScene(canonical, { ruleset: library.ruleset, library }),
    });
    notice({
      type: 'campaign',
      campaignId: campaign.id,
      actorId: 'player',
      kind: 'playerCommand',
    });
    for (
      let check = 0;
      check < 30 &&
      (gm.placedTokens[0].world.x !== 2.5 || !parent.textContent.includes('up to date'));
      check++
    )
      await new Promise((resolve) => setTimeout(resolve, 5));
    expect(parent.textContent).not.toMatch(/waiting|conflict|paused|reopen/i);
    expect(gm.placedTokens[0].world.x).toBe(2.5);
    expect(gm.token3DAdapter.isMovementInProgress(local)).toBe(true);
    expect(autosave.dirty).toBe(false);
  } finally {
    gm.token3DAdapter._movementRoutes.delete(local);
    gm.characterServices.combat.syncMovementStatus();
    close();
  }
});

test('a player move on the actor currently moving in the DM window remains an explicit conflict', async () => {
  const { store, campaign, library, gm, autosave, parent, notice, close } = await fixture();
  const local = gm.placedTokens[0];
  try {
    gm.token3DAdapter._movementRoutes.set(local, {
      token: local,
      spent: 0,
      segmentCharged: true,
    });
    gm.characterServices.combat.syncMovementStatus();
    const before = await store.readCharacters(campaign.id);
    const canonical = decodeScene(before.scene, { ruleset: library.ruleset, library });
    canonical.creatures[0].gridX = 2;
    canonical.creatures[0].pose.world.x = 2.5;
    await store.commitScene(campaign.id, {
      ruleset: library.ruleset,
      revision: before.sceneRevision,
      charactersRevision: before.revision,
      scene: encodeScene(canonical, { ruleset: library.ruleset, library }),
    });
    notice({
      type: 'campaign',
      campaignId: campaign.id,
      actorId: 'player',
      kind: 'playerCommand',
    });
    for (let check = 0; check < 30 && !parent.textContent.match(/conflict|paused/i); check++)
      await new Promise((resolve) => setTimeout(resolve, 5));
    expect(parent.textContent).toMatch(/conflict|paused/i);
    expect(local.world.x).toBe(1.5);
    expect(gm.token3DAdapter.isMovementInProgress(local)).toBe(true);
    expect(autosave.sharedConflict).toBeTruthy();
  } finally {
    gm.token3DAdapter._movementRoutes.delete(local);
    gm.characterServices.combat.syncMovementStatus();
    close();
  }
});

test('a local DM facing change rebases over a simultaneous player move on another actor', async () => {
  const { store, campaign, library, gm, autosave, parent, notice, close } = await fixture({
    extraActor: true,
  });
  try {
    const local = gm.placedTokens[1];
    local.facingAngle = Math.PI / 2;
    gm.token3DAdapter.recordStablePlacement(local);
    expect(autosave.canRebaseSharedUpdate()).toBe(true);
    const before = await store.readCharacters(campaign.id);
    const canonical = decodeScene(before.scene, { ruleset: library.ruleset, library });
    canonical.creatures[0].gridX = 2;
    canonical.creatures[0].pose.world.x = 2.5;
    await store.commitScene(campaign.id, {
      ruleset: library.ruleset,
      revision: before.sceneRevision,
      charactersRevision: before.revision,
      scene: encodeScene(canonical, { ruleset: library.ruleset, library }),
    });
    notice({
      type: 'campaign',
      campaignId: campaign.id,
      actorId: 'player',
      kind: 'playerCommand',
    });
    for (
      let check = 0;
      check < 100 &&
      (gm.placedTokens[0].world.x !== 2.5 || !parent.textContent.includes('up to date'));
      check++
    )
      await new Promise((resolve) => setTimeout(resolve, 5));
    expect(parent.textContent).not.toMatch(/conflict|paused|reopen/i);
    expect(gm.placedTokens[0].world.x).toBe(2.5);
    expect(gm.placedTokens[1].facingAngle).toBe(Math.PI / 2);
    await autosave.flush();
    const saved = decodeScene((await store.readScene(campaign.id)).scene, {
      ruleset: library.ruleset,
      library,
    });
    expect(saved.creatures[1].facingAngle).toBe(Math.PI / 2);
  } finally {
    close();
  }
});

test('a simultaneous local and shared change to the same actor remains a recoverable conflict', async () => {
  const { store, campaign, library, gm, autosave, parent, notice, close } = await fixture();
  try {
    const local = gm.placedTokens[0];
    local.gridX = 3;
    local.world = { x: 3.5, y: 0, z: 1.5 };
    gm.token3DAdapter.recordStablePlacement(local);
    const before = await store.readCharacters(campaign.id);
    const canonical = decodeScene(before.scene, { ruleset: library.ruleset, library });
    canonical.creatures[0].gridX = 2;
    canonical.creatures[0].pose.world.x = 2.5;
    await store.commitScene(campaign.id, {
      ruleset: library.ruleset,
      revision: before.sceneRevision,
      charactersRevision: before.revision,
      scene: encodeScene(canonical, { ruleset: library.ruleset, library }),
    });
    notice({
      type: 'campaign',
      campaignId: campaign.id,
      actorId: 'player',
      kind: 'playerCommand',
    });
    for (
      let check = 0;
      check < 100 && !parent.textContent.match(/shared|conflict|paused/i);
      check++
    )
      await new Promise((resolve) => setTimeout(resolve, 5));
    expect(parent.textContent).toMatch(/shared|conflict|paused/i);
    expect(gm.placedTokens[0].world.x).toBe(3.5);
    await expect(autosave.flush()).rejects.toThrow(/shared|conflict|discard/i);
    const saved = decodeScene((await store.readScene(campaign.id)).scene, {
      ruleset: library.ruleset,
      library,
    });
    expect(saved.creatures[0].pose.world.x).toBe(2.5);
  } finally {
    close();
  }
});

test('the paused DM update offers explicit discard confirmation instead of silently replacing local work', async () => {
  const { store, campaign, library, gm, autosave, parent, notice, close } = await fixture();
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
  try {
    const before = await store.readCharacters(campaign.id);
    const canonical = decodeScene(before.scene, { ruleset: library.ruleset, library });
    canonical.creatures[0].gridX = 2;
    canonical.creatures[0].pose.world.x = 2.5;
    await store.commitScene(campaign.id, {
      ruleset: library.ruleset,
      revision: before.sceneRevision,
      charactersRevision: before.revision,
      scene: encodeScene(canonical, { ruleset: library.ruleset, library }),
    });
    const actor = gm.placedTokens[0];
    actor.gridX = 3;
    actor.world = { x: 3.5, y: 0, z: 1.5 };
    gm.token3DAdapter.recordStablePlacement(actor);
    autosave.changed('local draft');
    notice({ type: 'campaign', campaignId: campaign.id, actorId: 'player', kind: 'playerCommand' });
    const button = parent.querySelector('[data-discard-shared-draft]');
    expect(button).not.toBeNull();
    expect(button.hidden).toBe(false);
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(actor.world.x).toBe(3.5);
    expect(autosave.dirty).toBe(true);
    confirm.mockReturnValue(true);
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(gm.placedTokens[0]).toBe(actor);
    expect(actor.world.x).toBe(2.5);
    expect(autosave.status.state).toBe('saved');
    expect(button.hidden).toBe(true);
  } finally {
    confirm.mockRestore();
    close();
  }
});

test('a canonical resource update arriving during a DM draft stays paused without rebasing revisions or overwriting either side', async () => {
  const { store, campaign, catalog, library, gm, autosave, parent, services, notice, close } =
    await fixture();
  try {
    const revision = library.revision;
    const remote = await CampaignCharacters.open({ store, campaignId: campaign.id, catalog });
    await remote.edit(remote.list()[0].id, { speed: 40 });
    const incoming = await store.readCharacters(campaign.id);
    expect(incoming.sceneRevision).toBe(library.sceneRevision);
    let release;
    services.workspace.store.readCharacters = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    notice({ type: 'campaign', campaignId: campaign.id, actorId: 'player', kind: 'playerCommit' });
    await Promise.resolve();
    const actor = gm.placedTokens[0];
    actor.world = { x: 3.5, y: 0, z: 1.5 };
    actor.gridX = 3;
    gm.token3DAdapter.recordStablePlacement(actor);
    autosave.changed('DM draft');
    release(incoming);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(library.revision).toBe(revision);
    expect(actor.world.x).toBe(3.5);
    expect(parent.textContent).toMatch(/paused|conflict/i);
    await expect(autosave.flush()).rejects.toThrow(/shared|conflict|discard/i);
    const saved = await store.readCharacters(campaign.id);
    const authoritative = decodeScene(saved.scene, { ruleset: library.ruleset, library });
    expect(authoritative.creatures[0].pose.world.x).toBe(1.5);
    expect(saved.revision).toBe(incoming.revision);
  } finally {
    close();
  }
});
