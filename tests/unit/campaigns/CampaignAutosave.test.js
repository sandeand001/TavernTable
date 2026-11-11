import CampaignAutosave from '../../../src/campaigns/CampaignAutosave.js';
import CampaignCharacters from '../../../src/campaigns/CampaignCharacters.js';
import CampaignStore from '../../../src/campaigns/CampaignStore.js';
import CampaignWorld from '../../../src/campaigns/CampaignWorld.js';
import { captureCampaignScene } from '../../../src/campaigns/SceneWorld.js';
import { decodeScene, encodeScene } from '../../../src/campaigns/CampaignScene.js';
import { SceneNotReadyError } from '../../../src/scene/token-adapter/SavedPlacements.js';
import {
  createConnectedTravelBoard,
  disposeConnectedTravelBoard,
} from '../../helpers/connectedTravelBoard.js';
import { sceneState } from '../../helpers/sceneState.js';
import { testIndexedDB } from '../../helpers/indexedDB.js';

let board;

async function fixture({ timers = false, shared = false } = {}) {
  const store = new CampaignStore({
    indexedDB: testIndexedDB(),
    packs: [{ id: 'srd-2014', ruleset: '2014', version: '5.1', core: true }],
  });
  board = { store };
  const campaign = await store.create({ name: 'Action-complete saves', ruleset: '2014' });
  if (shared) store.storageInfo = { kind: 'host' };
  const catalog = { ruleset: '2014', entries: [], classes: [], enabledEntryIds: [] };
  const library = await CampaignCharacters.open({ store, campaignId: campaign.id, catalog });
  const id = await library.create('Scout');
  const scene = sceneState({ characterId: id, name: 'Scout' });
  scene.grid.cols = 12;
  scene.terrain.heights = Array.from({ length: 5 }, () => Array(12).fill(0));
  const world = CampaignWorld.fromScene(scene, { ruleset: '2014', library });
  const gm = await createConnectedTravelBoard({ library, scene: world.save() });
  Object.assign(board, { gm, library, catalog, campaign });
  const combat = gm.characterServices.combat;
  const autosave = new CampaignAutosave({ gameManager: gm, library, combat });
  board.autosave = autosave;
  await autosave.start();
  const actor = gm.placedTokens[0];
  const adapter = gm.token3DAdapter;
  const writes = jest.spyOn(store, 'commitScene');
  const enqueues = jest.spyOn(library, 'saveScene');
  const begin = () => {
    adapter._movementRoutes.set(actor, {
      token: actor,
      spent: 0,
      segmentCharged: true,
    });
    combat.syncMovementStatus();
  };
  const checkpoint = (x) => {
    actor.world = { x: x + 0.5, y: 0, z: 1.5 };
    actor.gridX = x;
    adapter.recordStablePlacement(actor);
  };
  const finish = () => {
    adapter._movementRoutes.delete(actor);
    adapter.recordStablePlacement(actor);
    combat.syncMovementStatus();
  };
  if (timers) jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
  return { ...board, actor, adapter, combat, writes, enqueues, begin, checkpoint, finish };
}

afterEach(() => {
  board?.autosave?.dispose();
  if (board?.gm) disposeConnectedTravelBoard(board.gm);
  board?.store.close();
  board = null;
  jest.useRealTimers();
});

test('a saved external player step reconciles at an idle checkpoint and cannot be overwritten by the next DM autosave', async () => {
  const { autosave, gm, store, campaign, library, actor } = await fixture();
  const before = await store.readCharacters(campaign.id);
  const next = decodeScene(before.scene, { ruleset: library.ruleset, library });
  const savedActor = next.creatures.find(({ id }) => id === actor.id);
  savedActor.gridX = 2;
  savedActor.pose.world.x = 2.5;
  const camera = { ...gm.threeSceneManager.snapshotView(), zoom: 1.6 };
  gm.threeSceneManager.restoreView(camera);
  const visual = actor.__threeMesh;
  await store.commitScene(campaign.id, {
    ruleset: library.ruleset,
    revision: before.sceneRevision,
    charactersRevision: before.revision,
    scene: encodeScene(next, { ruleset: library.ruleset, library }),
  });
  const accepted = await store.readCharacters(campaign.id);
  await autosave.reconcile(accepted);
  expect(gm.placedTokens[0]).toBe(actor);
  expect(actor.__threeMesh).toBe(visual);
  expect(actor.world.x).toBe(2.5);
  expect(gm.threeSceneManager.snapshotView()).toEqual(camera);
  expect(library.sceneRevision).toBe(accepted.sceneRevision);
  autosave.changed('camera');
  await autosave.flush();
  const persisted = decodeScene((await store.readScene(campaign.id)).scene, {
    ruleset: library.ruleset,
    library,
  });
  expect(persisted.creatures.find(({ id }) => id === actor.id).pose.world.x).toBe(2.5);
});

test('a shared conflict preserves the DM draft until explicit discard against a fresh canonical base', async () => {
  const { autosave, gm, store, campaign, library, actor } = await fixture();
  const camera = { ...gm.threeSceneManager.snapshotView(), zoom: 1.8 };
  gm.threeSceneManager.restoreView(camera);
  actor.world = { x: 3.5, y: 0, z: 1.5 };
  actor.gridX = 3;
  gm.token3DAdapter.recordStablePlacement(actor);
  autosave.changed('local draft');
  autosave.pauseForSharedUpdate();
  const fresh = await store.readCharacters(campaign.id);
  await expect(autosave.retry()).rejects.toThrow(/shared|discard/i);
  expect(actor.world.x).toBe(3.5);
  await autosave.reconcile(fresh, {
    discardLocal: true,
    expectedGeneration: autosave.generation,
  });
  expect(gm.placedTokens[0]).toBe(actor);
  expect(actor.world.x).toBe(1.5);
  expect(gm.threeSceneManager.snapshotView()).toEqual(camera);
  expect(autosave.dirty).toBe(false);
  expect(autosave.status.state).toBe('saved');
  expect(gm.campaignMapFailure).toBeNull();
  expect(library.sceneRevision).toBe(fresh.sceneRevision);
});

test('safe checkpoints remain in memory without enqueuing scene writes before the deadline or route end', async () => {
  const {
    autosave,
    begin,
    checkpoint,
    finish,
    adapter,
    actor,
    enqueues,
    writes,
    store,
    campaign,
    library,
  } = await fixture();
  begin();
  for (const x of [2, 3, 4, 5, 6]) {
    checkpoint(x);
    expect(adapter.getStablePlacement(actor).pose.world.x).toBe(x + 0.5);
    expect(autosave.timer).not.toBeNull();
    await expect(autosave.flush({ waitForScene: false })).rejects.toBeInstanceOf(
      SceneNotReadyError
    );
  }
  expect(enqueues).not.toHaveBeenCalled();
  expect(writes).not.toHaveBeenCalled();
  expect(autosave.status).toMatchObject({
    state: 'saving',
    text: expect.stringMatching(/action.*finish/i),
  });
  finish();
  await autosave.flush();
  expect(writes).toHaveBeenCalledTimes(1);
  const saved = decodeScene((await store.readScene(campaign.id)).scene, {
    ruleset: '2014',
    library,
  });
  expect(saved.creatures[0].pose.world.x).toBe(6.5);
  expect(autosave.status.state).toBe('saved');
});

test('multiplayer regression: DM autosave sends the actual safe route separately from the persisted checkpoint and acknowledges its prefix', async () => {
  const { autosave, begin, checkpoint, finish, writes, actor } = await fixture({ shared: true });
  begin();
  for (const x of [2, 3, 4]) checkpoint(x);
  finish();
  await autosave.flush();
  const change = writes.mock.calls[0][1];
  expect(change.presentations).toHaveLength(1);
  expect(change.presentations[0]).toMatchObject({
    tokenId: actor.id,
    kind: 'move',
    motion: { kind: 'walk', completed: true, from: { gridX: 1 } },
  });
  expect(change.presentations[0].motion.route.map(({ gridX }) => gridX)).toEqual([2, 3, 4]);
  expect(JSON.parse(change.scene)).not.toHaveProperty('presentations');
  writes.mockClear();
  begin();
  checkpoint(5);
  finish();
  await autosave.flush();
  expect(writes.mock.calls[0][1].presentations[0].motion.from.gridX).toBe(4);
  expect(writes.mock.calls[0][1].presentations[0].motion.route.map(({ gridX }) => gridX)).toEqual([
    5,
  ]);
});

test('multiplayer regression: an atomic character-and-scene commit carries pending DM movement too', async () => {
  const { library, store, begin, checkpoint, finish } = await fixture({ shared: true });
  const writes = jest.spyOn(store, 'commitCharacters');
  begin();
  checkpoint(2);
  finish();
  await library.edit(library.list()[0].id, { notes: 'Changed during the completed move' });
  expect(writes.mock.calls[0][1].scene.presentations[0].motion.route[0].gridX).toBe(2);
});

test('multiplayer regression: a completed DM round trip is broadcast even when its saved endpoint is unchanged', async () => {
  const { autosave, begin, checkpoint, finish, writes } = await fixture({ shared: true });
  begin();
  checkpoint(2);
  checkpoint(1);
  finish();
  await autosave.flush();
  expect(writes).toHaveBeenCalledTimes(1);
  expect(writes.mock.calls[0][1].presentations[0].motion.route.map(({ gridX }) => gridX)).toEqual([
    2, 1,
  ]);
});
test('an explicit flush waits for action completion and saves a canceled action at its last safe checkpoint', async () => {
  const { autosave, begin, checkpoint, finish, writes, store, campaign, library } = await fixture();
  begin();
  checkpoint(3);
  let flushed = false;
  const flush = autosave.flush().then(() => {
    flushed = true;
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(flushed).toBe(false);
  expect(writes).not.toHaveBeenCalled();
  finish();
  await flush;
  expect(writes).toHaveBeenCalledTimes(1);
  const saved = decodeScene((await store.readScene(campaign.id)).scene, {
    ruleset: '2014',
    library,
  });
  expect(saved.creatures[0].pose.world.x).toBe(3.5);
});

test('a scene save queued while idle rechecks readiness before capturing a newly started action', async () => {
  const { autosave, library, begin, finish, writes } = await fixture();
  let release;
  library.queue = new Promise((resolve) => {
    release = resolve;
  });
  autosave.changed('camera');
  const saving = autosave._save();
  begin();
  release();
  await expect(saving).rejects.toBeInstanceOf(SceneNotReadyError);
  expect(writes).not.toHaveBeenCalled();
  expect(autosave.timer).not.toBeNull();
  finish();
  await autosave.flush();
  expect(autosave.status.state).toBe('saved');
});

test('action capture rechecks readiness after asynchronous renderer/asset settlement', async () => {
  const { autosave, gm, begin, finish, writes } = await fixture();
  let release;
  let entered;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  gm.placeableMeshPool = {
    whenSettled: () => {
      entered();
      return new Promise((resolve) => {
        release = resolve;
      });
    },
  };
  autosave.changed('camera');
  const saving = autosave._save();
  await started;
  begin();
  release();
  await expect(saving).rejects.toBeInstanceOf(SceneNotReadyError);
  expect(writes).not.toHaveBeenCalled();
  delete gm.placeableMeshPool;
  finish();
  await autosave.flush();
});

test('resource/damage commits still atomically save their safe scene even during movement', async () => {
  const { autosave, begin, checkpoint, finish, library, actor, store, campaign, writes, catalog } =
    await fixture();
  begin();
  checkpoint(2);
  await library.edit(actor.characterSheetId, { hp: { max: 30, current: 23 } });
  const reopened = await CampaignCharacters.open({ store, campaignId: campaign.id, catalog });
  expect(reopened.get(actor.characterSheetId).hp.current).toBe(23);
  expect(
    decodeScene(reopened.savedScene, { ruleset: '2014', library: reopened }).creatures[0].pose.world
      .x
  ).toBe(2.5);
  expect(writes).not.toHaveBeenCalled();
  checkpoint(4);
  finish();
  await autosave.flush();
  expect(writes).toHaveBeenCalledTimes(1);
});

test('pending actions defer background saves and releasing a failed/canceled action resumes them', async () => {
  const { autosave, combat, writes } = await fixture();
  combat.pending = {};
  autosave.changed('action');
  await expect(autosave.flush({ waitForScene: false })).rejects.toBeInstanceOf(SceneNotReadyError);
  expect(writes).not.toHaveBeenCalled();
  combat.pending = null;
  autosave.changed('action canceled');
  await autosave.flush();
  expect(autosave.status.state).toBe('saved');
});

test('completed-action storage failures remain explicit and retryable', async () => {
  const { autosave, begin, checkpoint, finish, writes } = await fixture();
  begin();
  checkpoint(4);
  finish();
  writes.mockRejectedValueOnce(new Error('Action storage unavailable'));
  await expect(autosave.flush()).rejects.toThrow('Action storage unavailable');
  expect(autosave.status).toMatchObject({
    state: 'error',
    text: expect.stringContaining('Action storage unavailable'),
  });
  await autosave.retry();
  expect(autosave.status.state).toBe('saved');
});

test('safe non-wall placement cells come from physical coordinates rather than a transient movement target', async () => {
  const { gm, adapter, actor, begin, library } = await fixture();
  begin();
  actor.gridX = 4;
  actor.world = { x: 3.999999999, y: 0, z: 1.5 };
  adapter.recordStablePlacement(actor);
  expect(adapter.getStablePlacement(actor).gridX).toBe(3);
  const saved = await captureCampaignScene(gm, library);
  expect(saved.creatures[0]).toMatchObject({
    gridX: 3,
    pose: { world: { x: 3.999999999 } },
  });
});

test('unchanged document interactions do not enqueue full-scene snapshots', async () => {
  const { autosave, library, enqueues, writes } = await fixture({ timers: true });
  for (const event of ['pointerup', 'keyup', 'change', 'pointerup', 'keyup', 'change']) {
    document.dispatchEvent(new Event(event));
    await jest.advanceTimersByTimeAsync(400);
    await library.flush();
  }
  expect(enqueues).not.toHaveBeenCalled();
  expect(writes).not.toHaveBeenCalled();
  expect(autosave.status.state).toBe('saved');
});

test('routine edits share a two-second quiet period without losing their saved data', async () => {
  const { autosave, actor, library, enqueues, writes, store, campaign } = await fixture({
    timers: true,
  });
  actor.movementSettings = { mode: 'run', type: 'default' };
  autosave.changed('movement settings');
  await jest.advanceTimersByTimeAsync(1999);
  expect(enqueues).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(1);
  await library.flush();
  expect(enqueues).toHaveBeenCalledTimes(1);
  expect(writes).toHaveBeenCalledTimes(1);
  const saved = decodeScene((await store.readScene(campaign.id)).scene, {
    ruleset: '2014',
    library,
  });
  expect(saved.creatures[0].movement.mode).toBe('run');
});

test('continuous routine edits cannot postpone a checkpoint beyond ten seconds', async () => {
  const { autosave, actor, library, enqueues, writes } = await fixture({ timers: true });
  for (let second = 0; second < 10; second++) {
    actor.movementSettings = { mode: second % 2 ? 'run' : 'walk', type: 'default' };
    autosave.changed('movement settings');
    expect(enqueues).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1000);
  }
  await library.flush();
  expect(enqueues).toHaveBeenCalledTimes(1);
  expect(writes).toHaveBeenCalledTimes(1);
  await autosave.writing;
  expect(autosave.status.state).toBe('saved');
});

test('long moves save safe positions and their movement costs at the ten-second deadline, not at every step', async () => {
  const {
    autosave,
    begin,
    checkpoint,
    finish,
    combat,
    adapter,
    actor,
    enqueues,
    writes,
    store,
    campaign,
    library,
    catalog,
  } = await fixture({ timers: true });
  combat.startTurn(actor);
  const ticket = combat.beginMovement(actor, 30);
  begin();
  adapter._movementRoutes.get(actor).spent = 15;
  checkpoint(3);
  await jest.advanceTimersByTimeAsync(9999);
  expect(enqueues).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(1);
  await library.flush();
  expect(writes).toHaveBeenCalledTimes(1);
  const saved = decodeScene((await store.readScene(campaign.id)).scene, {
    ruleset: '2014',
    library,
  });
  expect(saved.creatures[0].pose.world.x).toBe(3.5);
  expect(saved.combat.states.find((state) => state.tokenId === actor.id).movementSpent).toBe(15);
  const reopened = await CampaignCharacters.open({ store, campaignId: campaign.id, catalog });
  const restored = await createConnectedTravelBoard({ library: reopened, scene: saved });
  try {
    const restoredActor = restored.placedTokens[0];
    expect(restored.token3DAdapter.isMovementInProgress(restoredActor)).toBe(false);
    expect(restored.characterServices.combat.status(restoredActor).movement).toMatchObject({
      spent: 15,
      remaining: 15,
    });
  } finally {
    disposeConnectedTravelBoard(restored);
  }
  expect(adapter.isMovementInProgress(actor)).toBe(true);
  adapter._movementRoutes.get(actor).spent = 25;
  for (let step = 0; step < 10; step++) {
    checkpoint(step % 2 ? 5 : 4);
    await jest.advanceTimersByTimeAsync(1000);
  }
  await library.flush();
  expect(enqueues).toHaveBeenCalledTimes(2);
  expect(writes).toHaveBeenCalledTimes(2);
  adapter._movementRoutes.get(actor).spent = 30;
  checkpoint(6);
  combat.finishMovement(ticket, 30);
  finish();
  await autosave.flush();
  expect(writes).toHaveBeenCalledTimes(3);
});

test('a waiting explicit flush still checkpoints a long move but does not let the campaign close mid-route', async () => {
  const { autosave, begin, checkpoint, finish, enqueues, library } = await fixture({
    timers: true,
  });
  begin();
  checkpoint(3);
  let flushed = false;
  const flushing = autosave.flush().then(() => {
    flushed = true;
  });
  await jest.advanceTimersByTimeAsync(10000);
  await library.flush();
  expect(enqueues).toHaveBeenCalledTimes(1);
  expect(flushed).toBe(false);
  finish();
  await jest.advanceTimersByTimeAsync(100);
  await flushing;
  expect(flushed).toBe(true);
});

test('an atomic character save cancels a routine snapshot whose changes it already acknowledged', async () => {
  const { autosave, actor, library, enqueues, writes } = await fixture({ timers: true });
  actor.movementSettings = { mode: 'run', type: 'default' };
  autosave.changed('movement settings');
  await library.edit(actor.characterSheetId, { hp: { max: 30, current: 23 } });
  await jest.advanceTimersByTimeAsync(10000);
  await library.flush();
  expect(library.get(actor.characterSheetId).hp.current).toBe(23);
  expect(enqueues).not.toHaveBeenCalled();
  expect(writes).not.toHaveBeenCalled();
  expect(autosave.status.state).toBe('saved');
});

test('explicit flush bypasses the routine quiet period', async () => {
  const { autosave, actor, enqueues, writes } = await fixture({ timers: true });
  actor.movementSettings = { mode: 'run', type: 'default' };
  autosave.changed('movement settings');
  await autosave.flush();
  expect(enqueues).toHaveBeenCalledTimes(1);
  expect(writes).toHaveBeenCalledTimes(1);
});

test('selection and facing changes notify autosave without relying on unrelated UI events', async () => {
  const { autosave, adapter, actor, library, enqueues } = await fixture({ timers: true });
  jest.spyOn(adapter, '_refreshVisualState').mockResolvedValue(undefined);
  await adapter.setSelectedToken(actor);
  expect(autosave.dirty).toBe(true);
  await jest.advanceTimersByTimeAsync(2000);
  await library.flush();
  expect(enqueues).toHaveBeenCalledTimes(1);
  actor.facingAngle = 1.2;
  adapter.updateTokenOrientation(actor);
  expect(autosave.dirty).toBe(true);
  await jest.advanceTimersByTimeAsync(2000);
  await library.flush();
  expect(enqueues).toHaveBeenCalledTimes(2);
});

test('tab hiding flushes pending edits without waiting for the routine timer', async () => {
  const { autosave, actor, library, enqueues, writes } = await fixture({ timers: true });
  actor.movementSettings = { mode: 'run', type: 'default' };
  autosave.changed('movement settings');
  const visibility = jest.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  try {
    document.dispatchEvent(new Event('visibilitychange'));
    await jest.advanceTimersByTimeAsync(0);
    await library.flush();
    await autosave.writing;
    expect(enqueues).toHaveBeenCalledTimes(1);
    expect(writes).toHaveBeenCalledTimes(1);
    expect(autosave.status.state).toBe('saved');
  } finally {
    visibility.mockRestore();
  }
});

test('uncommitted actions do not trigger repeated captures and resume saving when settled', async () => {
  const { autosave, actor, combat, library, enqueues } = await fixture({ timers: true });
  combat.pending = {};
  actor.movementSettings = { mode: 'run', type: 'default' };
  autosave.changed('pending action');
  await jest.advanceTimersByTimeAsync(12000);
  expect(enqueues).not.toHaveBeenCalled();
  combat.pending = null;
  autosave.changed('action settled');
  await jest.advanceTimersByTimeAsync(0);
  await library.flush();
  await autosave.writing;
  expect(enqueues).toHaveBeenCalledTimes(1);
  expect(autosave.status.state).toBe('saved');
});

test('edits made during a write keep their deadline instead of getting ten fresh seconds after storage settles', async () => {
  const { autosave, actor, library, enqueues, writes, store } = await fixture({ timers: true });
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  writes.mockImplementationOnce(async (...args) => {
    await gate;
    return CampaignStore.prototype.commitScene.apply(store, args);
  });
  actor.movementSettings = { mode: 'run', type: 'default' };
  autosave.changed('movement settings');
  await jest.advanceTimersByTimeAsync(3000);
  actor.movementSettings = { mode: 'walk', type: 'drunk' };
  autosave.changed('movement settings');
  await jest.advanceTimersByTimeAsync(1000);
  release();
  await library.flush();
  await autosave.writing;
  for (let second = 4; second < 12; second++) {
    actor.movementSettings = { mode: 'walk', type: second % 2 ? 'drunk' : 'default' };
    autosave.changed('movement settings');
    expect(enqueues).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1000);
  }
  await library.flush();
  await autosave.writing;
  expect(enqueues).toHaveBeenCalledTimes(2);
  expect(writes).toHaveBeenCalledTimes(2);
});

test('wall-clock adjustments cannot reset the ten-second save deadline', async () => {
  const { autosave, actor, library, enqueues } = await fixture({ timers: true });
  for (let second = 0; second < 10; second++) {
    if (second === 5) jest.setSystemTime(Date.now() - 60000);
    actor.movementSettings = { mode: second % 2 ? 'run' : 'walk', type: 'default' };
    autosave.changed('movement settings');
    expect(enqueues).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1000);
  }
  await library.flush();
  await autosave.writing;
  expect(enqueues).toHaveBeenCalledTimes(1);
});

test('a committed character rename updates linked tokens without scheduling another snapshot', async () => {
  const { autosave, actor, library, enqueues, writes } = await fixture({ timers: true });
  await library.edit(actor.characterSheetId, { name: 'Renamed scout' });
  await jest.advanceTimersByTimeAsync(10000);
  await library.flush();
  await autosave.writing;
  expect(actor.name).toBe('Renamed scout');
  expect(enqueues).not.toHaveBeenCalled();
  expect(writes).not.toHaveBeenCalled();
  expect(autosave.status.state).toBe('saved');
});
