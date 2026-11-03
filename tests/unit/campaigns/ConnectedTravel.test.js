import {
  captureCampaignScene,
  changeCampaignView,
  travelCampaignConnection,
} from '../../../src/campaigns/SceneWorld.js';
import {
  createConnectedTravelBoard as fixture,
  disposeConnectedTravelBoard as dispose,
} from '../../helpers/connectedTravelBoard.js';
import CampaignStore from '../../../src/campaigns/CampaignStore.js';
import CampaignCharacters from '../../../src/campaigns/CampaignCharacters.js';
import CampaignAutosave from '../../../src/campaigns/CampaignAutosave.js';
import { decodeScene } from '../../../src/campaigns/CampaignScene.js';
import { testIndexedDB } from '../../helpers/indexedDB.js';
import classic from '../../../assets/data/resources/srd-2014-5.1-seed.1.json';
import { createOpeningsTravelScene } from '../../../src/campaigns/examples/ConnectedOpeningsExample.js';
import { getConnectionTravelOption } from '../../../src/campaigns/CampaignTravel.js';

const savedCatalog = {
  ...classic,
  entries: classic.entries.map((entry) => ({ ...entry, sourcePack: 'srd-2014' })),
  enabledEntryIds: classic.entries.map((entry) => entry.id),
};

test('focusing an interior waits for an in-flight character save rather than rejecting or hanging the view', async () => {
  const store = new CampaignStore({
    indexedDB: testIndexedDB(),
    packs: [{ id: 'srd-2014', ruleset: '2014', version: '5.1', core: true }],
  });
  let gm, release;
  try {
    const campaign = await store.create({ name: 'Focus during save', ruleset: '2014' });
    const library = await CampaignCharacters.open({
      store,
      campaignId: campaign.id,
      catalog: savedCatalog,
    });
    gm = await fixture({ library });
    const autosave = new CampaignAutosave({
      gameManager: gm,
      library,
      combat: gm.characterServices.combat,
    });
    await autosave.start();
    const commit = store.commitCharacters.bind(store);
    let writing;
    const started = new Promise((resolve) => {
      writing = resolve;
    });
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    jest.spyOn(store, 'commitCharacters').mockImplementationOnce(async (...args) => {
      writing();
      await gate;
      return commit(...args);
    });
    const saving = library.edit(gm.placedTokens[0].characterSheetId, {
      name: 'Saved during focus',
    });
    await started;
    expect(library.isSaving).toBe(true);
    const focused = gm.placedTokens[1];
    const changing = changeCampaignView(gm, { focusTokenId: focused.id });
    release();
    await Promise.all([saving, changing]);
    await autosave.flush();
    expect(gm.campaignMapId).toBe(focused.mapId);
    expect(gm.token3DAdapter.getSelectedToken()).toBe(focused);
    expect(gm.campaignViewBusy).toBe(false);
    expect(autosave.status.state).toBe('saved');
    expect(
      decodeScene((await store.readScene(campaign.id)).scene, {
        ruleset: '2014',
        library,
      }).view.mapId
    ).toBe(focused.mapId);
  } finally {
    release?.();
    if (gm) dispose(gm);
    store.close();
  }
});

test('an unsupported stationary checkpoint reports the save problem without latching Changing map', async () => {
  const gm = await fixture();
  const error = new Error('Waiting for a supported floor');
  gm.sceneAutosave = {
    ready: true,
    flush: jest.fn().mockRejectedValue(error),
    dispose: () => {},
    changed: () => {},
  };
  try {
    await expect(changeCampaignView(gm, { mapId: 'ground-floor' })).rejects.toBe(error);
    expect(gm.sceneAutosave.flush).toHaveBeenCalledWith({ waitForScene: false });
    expect(gm.campaignViewBusy).toBe(false);
    expect(gm.campaignMapTransition).not.toBe(true);
    expect(gm.campaignMapId).toBe('map-main');
  } finally {
    dispose(gm);
  }
});

test('an empty landing override cannot save a partially changed map', async () => {
  const gm = await fixture();
  try {
    gm.campaignMapTransition = true;
    await expect(
      captureCampaignScene(gm, gm.characterServices.library, {
        placements: new Map(),
      })
    ).rejects.toThrow(/waiting for the map view/i);
  } finally {
    gm.campaignMapTransition = false;
    dispose(gm);
  }
});

test('a queued ground destination keeps its physical position after a lower-floor landing changes map frames', async () => {
  const gm = await fixture({ mapId: 'ground-floor', position: { x: 6.5, y: 0, z: 8.5 } });
  const actor = gm.placedTokens[0],
    adapter = gm.token3DAdapter;
  const range = { layered: true };
  jest.spyOn(adapter, 'getTokenMovementRange').mockReturnValue(range);
  const move = jest
    .spyOn(adapter, '_requestSurfaceMovement')
    .mockReturnValue({ goal: actor.world });
  try {
    adapter._requestPlannedMovement(actor, {
      frameMapId: 'upper-floor',
      surface: {
        point: { x: 5.5, y: -2, z: 8.5 },
        normal: { x: 0, y: 1, z: 0 },
      },
    });
    expect(move).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({
        frameMapId: 'ground-floor',
        surface: expect.objectContaining({
          point: { x: 5.5, y: 0, z: 8.5 },
          normal: { x: 0, y: 1, z: 0 },
        }),
      }),
      range
    );
  } finally {
    dispose(gm);
  }
});

test('a prone creature must stand before climbing through a window', async () => {
  const gm = await fixture({
    sceneFactory: createOpeningsTravelScene,
    mapId: 'ground-floor',
    position: { x: 0.5, y: 0, z: 2.5 },
  });
  const actor = gm.placedTokens[0];
  try {
    await gm.characterServices.library.edit(actor.characterSheetId, { conditions: ['prone'] });
    expect(getConnectionTravelOption(gm, actor, 'ground-window')).toMatchObject({
      allowed: false,
      reason: expect.stringMatching(/stand.*climb/i),
    });
  } finally {
    dispose(gm);
  }
});

test('free-play standing debt survives a zero-distance map switch and clears only after physical travel', async () => {
  const store = new CampaignStore({
    indexedDB: testIndexedDB(),
    packs: [{ id: 'srd-2014', ruleset: '2014', version: '5.1', core: true }],
  });
  let gm;
  try {
    const campaign = await store.create({ name: 'Standing and travel', ruleset: '2014' });
    const library = await CampaignCharacters.open({
      store,
      campaignId: campaign.id,
      catalog: savedCatalog,
    });
    gm = await fixture({ library, position: { x: 11.5, y: 0, z: 10.5 } });
    const actor = gm.placedTokens[0];
    const session = gm.characterServices.combat;
    const scene = gm.campaignWorld.save();
    scene.connections[0].ends[0].positionFeet.x = 57.5;
    gm.campaignWorld.acceptCheckpoint(scene);
    const autosave = new CampaignAutosave({ gameManager: gm, library, combat: session });
    await autosave.start();
    await library.edit(actor.characterSheetId, { conditions: ['prone'] });
    await session.standUp(actor);
    expect(session.freeMovementAllowance(actor)).toBe(15);
    const unchanged = await travelCampaignConnection(gm, actor, 'building-door');
    expect(unchanged.costFeet).toBe(0);
    expect(session.freeMovementAllowance(actor)).toBe(15);
    let saved = decodeScene(library.savedScene, { ruleset: '2014', library });
    expect(saved.combat.states.find((state) => state.tokenId === actor.id).movementSpent).toBe(15);
    const physical = gm.campaignWorld.save();
    physical.connections[0].ends[0].positionFeet.x = 52.5;
    gm.campaignWorld.acceptCheckpoint(physical);
    autosave.changed('physical doorway');
    const travelled = await travelCampaignConnection(gm, actor, 'building-door');
    expect(travelled.costFeet).toBe(5);
    expect(session.freeMovementAllowance(actor)).toBe(30);
    saved = decodeScene(library.savedScene, { ruleset: '2014', library });
    expect(saved.combat.states.find((state) => state.tokenId === actor.id).movementSpent).toBe(0);
    expect(saved.creatures[0].mapId).toBe('map-main');
  } finally {
    if (gm) dispose(gm);
    store.close();
  }
});

test('ordinary five-foot stair landing cells cost twenty feet and retain a reachable upstairs exit', async () => {
  const gm = await fixture({
    mapId: 'ground-floor',
    position: { x: 6.5, y: 0, z: 8.5 },
  });
  const actor = gm.placedTokens[0];
  const session = gm.characterServices.combat;
  session.startTurn(actor);
  session.adjustMovement(actor, 30);
  try {
    const result = await travelCampaignConnection(gm, actor, 'main-stairs');
    expect(result.costFeet).toBe(20);
    expect(actor.world).toEqual({ x: 6.5, y: 0, z: 4.5 });
    const range = gm.token3DAdapter.getTokenMovementRange(actor);
    expect([...range.tiles.values()]).toContainEqual(
      expect.objectContaining({ gridX: 5, gridY: 4, cost: 5 })
    );
  } finally {
    dispose(gm);
  }
});

test('a rejected destination save restores the source, refunds movement and can retry saving safely', async () => {
  const store = new CampaignStore({
    indexedDB: testIndexedDB(),
    packs: [{ id: 'srd-2014', ruleset: '2014', version: '5.1', core: true }],
  });
  let gm, failure;
  try {
    const campaign = await store.create({ name: 'Failed travel save', ruleset: '2014' });
    const library = await CampaignCharacters.open({
      store,
      campaignId: campaign.id,
      catalog: savedCatalog,
    });
    gm = await fixture({ library });
    const actor = gm.placedTokens[0];
    const session = gm.characterServices.combat;
    const autosave = new CampaignAutosave({ gameManager: gm, library, combat: session });
    await autosave.start();
    session.startTurn(actor);
    session.adjustMovement(actor, 30);
    await autosave.flush();
    const before = session.snapshot();
    const commit = store.commitScene.bind(store);
    failure = jest.spyOn(store, 'commitScene').mockImplementation((id, change) => {
      const scene = decodeScene(change.scene, { ruleset: '2014', library });
      if (scene.creatures[0].mapId === 'ground-floor')
        return Promise.reject(new Error('Destination save storage is full'));
      return commit(id, change);
    });
    await expect(travelCampaignConnection(gm, actor, 'building-door')).rejects.toThrow(
      'Destination save storage is full'
    );
    expect(actor.mapId).toBe('map-main');
    expect(actor.world).toEqual({ x: 10.5, y: 0, z: 10.5 });
    expect(gm.campaignMapId).toBe('map-main');
    expect(gm.campaignViewBusy).toBe(false);
    expect(gm.campaignMapFailure).toBeUndefined();
    expect(session.snapshot()).toEqual(before);
    expect(session.moves.size).toBe(0);
    expect(autosave.status.state).toBe('error');
    const reopened = await CampaignCharacters.open({
      store,
      campaignId: campaign.id,
      catalog: savedCatalog,
    });
    const saved = decodeScene(reopened.savedScene, { ruleset: '2014', library: reopened });
    expect(saved.creatures[0].mapId).toBe('map-main');
    expect(saved.combat.states.find((state) => state.tokenId === actor.id).movementSpent).toBe(0);
    failure.mockRestore();
    await autosave.retry();
    expect(autosave.status.state).toBe('saved');
    await travelCampaignConnection(gm, actor, 'building-door');
    expect(actor.mapId).toBe('ground-floor');
    expect(session.status(actor).movement.remaining).toBe(25);
  } finally {
    failure?.mockRestore();
    if (gm) dispose(gm);
    store.close();
  }
});

test('paid travel is acknowledged in IndexedDB and survives reopening and a campaign backup', async () => {
  const store = new CampaignStore({
    indexedDB: testIndexedDB(),
    packs: [{ id: 'srd-2014', ruleset: '2014', version: '5.1', core: true }],
  });
  let gm, restored;
  try {
    const campaign = await store.create({ name: 'Paid connected travel', ruleset: '2014' });
    const library = await CampaignCharacters.open({
      store,
      campaignId: campaign.id,
      catalog: savedCatalog,
    });
    gm = await fixture({ library });
    const actor = gm.placedTokens[0];
    const session = gm.characterServices.combat;
    const autosave = new CampaignAutosave({ gameManager: gm, library, combat: session });
    await autosave.start();
    session.startTurn(actor);
    session.adjustMovement(actor, 30);
    const turn = session.turn;
    await travelCampaignConnection(gm, actor, 'building-door');
    const reopened = await CampaignCharacters.open({
      store,
      campaignId: campaign.id,
      catalog: savedCatalog,
    });
    const scene = decodeScene(reopened.savedScene, { ruleset: '2014', library: reopened });
    expect(scene.creatures[0].mapId).toBe('ground-floor');
    expect(scene.combat.states.find((state) => state.tokenId === actor.id).movementSpent).toBe(5);
    expect(scene.combat.turn).toBe(turn);
    expect(scene.combat.activeTokenId).toBe(actor.id);
    restored = await fixture({ library: reopened, scene });
    expect(
      restored.characterServices.combat.status(restored.placedTokens[0]).movement.remaining
    ).toBe(25);
    expect(restored.placedTokens[0].characterSheetId).toBe(actor.characterSheetId);
    await autosave.flush();
    const imported = await store.importBackup(await store.exportBackup(campaign.id));
    const backupLibrary = await CampaignCharacters.open({
      store,
      campaignId: imported.id,
      catalog: savedCatalog,
    });
    const backup = decodeScene(backupLibrary.savedScene, {
      ruleset: '2014',
      library: backupLibrary,
    });
    expect(backup.creatures[0]).toEqual(scene.creatures[0]);
    expect(backup.connections).toEqual(scene.connections);
    expect(backup.combat).toEqual(scene.combat);
  } finally {
    if (gm) dispose(gm);
    if (restored) dispose(restored);
    store.close();
  }
});

test('Enter moves the original creature to the interior and spends five feet without restarting its turn', async () => {
  const gm = await fixture();
  const tokens = [...gm.placedTokens];
  const actor = tokens[0];
  const session = gm.characterServices.combat;
  session.startTurn(actor);
  session.adjustMovement(actor, 30);
  const turn = session.turn;
  const records = gm.characterServices.library
    .list()
    .map((entry) => gm.characterServices.library.get(entry.id));
  const otherView = gm.campaignWorld.createView({ focusTokenId: tokens[1].id });
  const otherCamera = otherView.snapshot();
  try {
    await travelCampaignConnection(gm, actor, 'building-door');
    expect(gm.placedTokens.every((token, i) => token === tokens[i])).toBe(true);
    expect(actor.mapId).toBe('ground-floor');
    expect(actor.world).toEqual({ x: 0.5, y: 0, z: 6.5 });
    expect(session.activeToken).toBe(actor);
    expect(session.turn).toBe(turn);
    expect(session.status(actor).movement.remaining).toBe(25);
    expect(session.moves.size).toBe(0);
    expect(gm.campaignMapId).toBe('ground-floor');
    expect(gm.campaignView.focusTokenId).toBe(actor.id);
    expect(gm.token3DAdapter.getSelectedToken()).toBe(actor);
    expect(otherView.snapshot()).toEqual(otherCamera);
    expect(
      gm.characterServices.library.list().map((entry) => gm.characterServices.library.get(entry.id))
    ).toEqual(records);
    const saved = await captureCampaignScene(gm, gm.characterServices.library);
    expect(saved.creatures[0].mapId).toBe('ground-floor');
    expect(saved.combat.states.find((state) => state.tokenId === actor.id).movementSpent).toBe(5);
  } finally {
    dispose(gm);
  }
});

test('stairs spend twenty feet per direction and never grant a free floor jump or new turn', async () => {
  const gm = await fixture({
    mapId: 'ground-floor',
    position: { x: 6.5, y: 0, z: 8.5 },
  });
  const actor = gm.placedTokens[0];
  const session = gm.characterServices.combat;
  session.startTurn(actor);
  session.adjustMovement(actor, 30);
  try {
    const turn = session.turn;
    await travelCampaignConnection(gm, actor, 'main-stairs');
    expect(actor.mapId).toBe('upper-floor');
    expect(actor.world).toEqual({ x: 6.5, y: 0, z: 4.5 });
    expect(session.status(actor).movement.remaining).toBe(10);
    expect(session.turn).toBe(turn);
    await expect(travelCampaignConnection(gm, actor, 'main-stairs')).rejects.toThrow(/20 ft/);
    expect(actor.mapId).toBe('upper-floor');
    session.endTurn();
    session.startTurn(actor);
    session.adjustMovement(actor, 30);
    const nextTurn = session.turn;
    await travelCampaignConnection(gm, actor, 'main-stairs');
    expect(actor.mapId).toBe('ground-floor');
    expect(actor.world).toEqual({ x: 6.5, y: 0, z: 8.5 });
    expect(session.status(actor).movement.remaining).toBe(10);
    expect(session.turn).toBe(nextTurn);
  } finally {
    dispose(gm);
  }
});

test('a failed travel rollback requires reload and cannot save a partially restored scene', async () => {
  const gm = await fixture();
  const actor = gm.placedTokens[0];
  const session = gm.characterServices.combat;
  session.startTurn(actor);
  gm.resizeGrid = () => {
    throw new Error('Renderer cannot restore either map');
  };
  try {
    await expect(travelCampaignConnection(gm, actor, 'building-door')).rejects.toThrow(/reload/i);
    expect(gm.campaignMapFailure).toBeInstanceOf(AggregateError);
    expect(gm.campaignViewBusy).toBe(false);
    expect(session.moves.size).toBe(0);
    await expect(captureCampaignScene(gm, gm.characterServices.library)).rejects.toBe(
      gm.campaignMapFailure
    );
    await expect(travelCampaignConnection(gm, actor, 'building-door')).rejects.toBe(
      gm.campaignMapFailure
    );
  } finally {
    dispose(gm);
  }
});

test('a failed destination load restores the source location and refunds the reserved movement', async () => {
  const gm = await fixture();
  const actor = gm.placedTokens[0];
  const session = gm.characterServices.combat;
  session.startTurn(actor);
  session.adjustMovement(actor, 30);
  const before = session.snapshot();
  const resize = gm.resizeGrid;
  gm.resizeGrid = (...args) => {
    if (gm.campaignMapId === 'ground-floor') throw new Error('Destination renderer unavailable');
    return resize(...args);
  };
  try {
    await expect(travelCampaignConnection(gm, actor, 'building-door')).rejects.toThrow(
      'Destination renderer unavailable'
    );
    expect(actor.mapId).toBe('map-main');
    expect(actor.world).toEqual({ x: 10.5, y: 0, z: 10.5 });
    expect(session.snapshot()).toEqual(before);
    expect(session.moves.size).toBe(0);
    expect(gm.campaignMapId).toBe('map-main');
    expect(gm.campaignViewBusy).toBe(false);
    expect(gm.campaignMapFailure).toBeUndefined();
  } finally {
    dispose(gm);
  }
});

test('free-play travel respects the per-move allowance and permits returning through the doorway', async () => {
  const gm = await fixture();
  const actor = gm.placedTokens[0];
  const session = gm.characterServices.combat;
  try {
    const allowance = session.freeMovementAllowance(actor);
    await travelCampaignConnection(gm, actor, 'building-door');
    expect(session.active).toBe(false);
    expect(session.freeMovementAllowance(actor)).toBe(allowance);
    expect(session.moves.size).toBe(0);
    await travelCampaignConnection(gm, actor, 'building-door');
    expect(actor.mapId).toBe('map-main');
    expect(actor.world).toEqual({ x: 10.5, y: 0, z: 10.5 });
    expect(session.freeMovementAllowance(actor)).toBe(allowance);
  } finally {
    dispose(gm);
  }
});

test('a view focused on another creature stays on its own floor and keeps its selection', async () => {
  const gm = await fixture({
    mapId: 'ground-floor',
    position: { x: 6.5, y: 0, z: 8.5 },
  });
  const [actor, observer] = gm.placedTokens;
  const session = gm.characterServices.combat;
  session.startTurn(actor);
  session.adjustMovement(actor, 30);
  await changeCampaignView(gm, { focusTokenId: observer.id });
  const camera = gm.threeSceneManager.snapshotView();
  try {
    await travelCampaignConnection(gm, actor, 'main-stairs');
    expect(actor.mapId).toBe('upper-floor');
    expect(gm.campaignMapId).toBe('ground-floor');
    expect(gm.campaignView.focusTokenId).toBe(observer.id);
    expect(gm.threeSceneManager.snapshotView()).toEqual(camera);
    expect(gm.token3DAdapter.getSelectedToken()).toBe(observer);
    expect(session.activeToken).toBe(actor);
    expect(session.status(actor).movement.remaining).toBe(10);
  } finally {
    dispose(gm);
  }
});
