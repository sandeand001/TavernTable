import { readFileSync } from 'node:fs';
import path from 'node:path';
import CampaignStore from '../../../src/campaigns/CampaignStore.js';
import CampaignCharacters from '../../../src/campaigns/CampaignCharacters.js';
import CampaignAutosave from '../../../src/campaigns/CampaignAutosave.js';
import CampaignWorld from '../../../src/campaigns/CampaignWorld.js';
import { encodeScene } from '../../../src/campaigns/CampaignScene.js';
import { connectCharacterServices } from '../../../src/ui/characters/characterServices.js';
import { sceneActorPlacement } from '../../../src/scene/token-adapter/SavedPlacements.js';
import { createCampaignBoard } from '../../helpers/campaignBoard.js';
import { installHumanoidAssetFiles } from '../../helpers/humanoid-fixture.js';
import { testIndexedDB } from '../../helpers/indexedDB.js';
import { sceneState } from '../../helpers/sceneState.js';

let restoreFiles;
beforeAll(() => {
  restoreFiles = installHumanoidAssetFiles();
});
afterAll(() => restoreFiles());

async function fixture() {
  const { default: CloudHostSessionUpdates } = await import(
    '../../../src/ui/sessions/CloudHostSessionUpdates.js'
  );
  const html = readFileSync(path.resolve(__dirname, '..', '..', '..', 'index.html'), 'utf8');
  document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
  const store = new CampaignStore({
    indexedDB: testIndexedDB(),
    packs: [{ id: 'srd-2014', ruleset: '2014', version: '5.1', core: true }],
  });
  const campaign = await store.create({ name: 'Cloud DM receiving movement', ruleset: '2014' });
  const catalog = { ruleset: '2014', entries: [], classes: [], enabledEntryIds: [] };
  const library = await CampaignCharacters.open({ store, campaignId: campaign.id, catalog });
  const hero = await library.create('Cloud scout');
  const raw = sceneState({ characterId: hero, name: 'Cloud scout' });
  raw.terrain.heights = raw.terrain.heights.map((row) => row.map(() => 0));
  const scene = CampaignWorld.fromScene(raw, { ruleset: '2014', library }).save();
  const gm = createCampaignBoard(library);
  delete gm.__threeTestDouble;
  let milliseconds = 0;
  const clock = jest.spyOn(performance, 'now').mockImplementation(() => milliseconds);
  gm.token3DAdapter.attach();
  connectCharacterServices(gm, { library, catalog });
  const autosave = new CampaignAutosave({
    gameManager: gm,
    library,
    combat: gm.characterServices.combat,
  });
  await autosave.start(scene);
  const parent = document.createElement('section');
  document.body.append(parent);
  const sessionId = '11111111-1111-4111-8111-111111111111';
  const access = {
    version: 1,
    uid: 'owner-a',
    campaignId: campaign.id,
    role: 'owner',
    seatId: null,
    accessGeneration: 0,
  };
  const initial = {
    version: 1,
    access,
    sessionId,
    generation: 1,
    origin: null,
    state: await store.readCharacters(campaign.id),
  };
  let notify;
  const closeStream = jest.fn(async () => {});
  const unbind = jest.fn();
  const cloud = {
    uid: access.uid,
    storageInfo: { kind: 'cloud' },
    isLocalChange: (event) => event.origin?.uid === 'local-ignored-owner',
    bindOwnerWorld: jest.fn(() => unbind),
    readCharacters: jest.fn(async () => {
      throw new Error('Cloud live updates must not poll character snapshots');
    }),
    observeOwnerEvents: jest.fn((_id, _request, _scope, listeners) => {
      notify = listeners;
      const ready = Promise.resolve().then(() => {
        listeners.onState(initial, { reconcile: true });
        listeners.onStatus({ phase: 'ready', reason: null });
        return initial;
      });
      return { ready, close: closeStream };
    }),
  };
  const services = { campaign, library, autosave, workspace: { store: cloud } };
  const sharing = new CloudHostSessionUpdates({
    gameManager: gm,
    services,
    parent,
    sessionId,
    access,
  });
  await sharing.ready;
  gm.advanceFrame();
  return {
    store,
    campaign,
    library,
    gm,
    autosave,
    cloud,
    notify,
    access,
    sessionId,
    closeStream,
    unbind,
    tick: (seconds) => {
      milliseconds += seconds * 1000;
      gm.advanceFrame();
    },
    close: async () => {
      await sharing.close();
      autosave.dispose();
      gm.characterServices.targeting?.dispose();
      gm.characterServices.falling?.dispose();
      for (const token of [...gm.placedTokens]) gm.tokenManager.removeToken(token);
      gm.token3DAdapter.disposeMovementRange();
      gm.token3DAdapter.disposeMapProjectionTerrain();
      store.close();
      clock.mockRestore();
      document.body.replaceChildren();
    },
  };
}

test('a cloud owner receiving consecutive native routes preserves the first step and renders the whole queue without spending movement', async () => {
  const f = await fixture();
  try {
    const token = f.gm.placedTokens[0];
    const model = token.__threeMesh;
    const camera = f.gm.threeSceneManager.snapshotView();
    for (const step of [2, 3]) {
      const before = await f.store.readCharacters(f.campaign.id);
      const scene = JSON.parse(before.scene);
      const actor = scene.creatures[0];
      const from = structuredClone(sceneActorPlacement(scene, actor));
      actor.gridX = step;
      actor.pose.world.x = step + 0.5;
      await f.store.commitScene(f.campaign.id, {
        ruleset: '2014',
        revision: before.sceneRevision,
        charactersRevision: before.revision,
        scene: encodeScene(scene, { ruleset: '2014', library: f.library }),
      });
      const state = await f.store.readCharacters(f.campaign.id);
      const commandId =
        step === 2
          ? '22222222-2222-4222-8222-222222222222'
          : '33333333-3333-4333-8333-333333333333';
      const origin = { uid: 'member-a', commandId, kind: 'world.command', generation: step };
      f.notify.onState(
        {
          version: 1,
          access: f.access,
          sessionId: f.sessionId,
          generation: step,
          origin,
          state,
        },
        {
          reconcile: false,
          origin,
          presentations: [
            {
              commandId,
              tokenId: token.id,
              kind: 'move',
              sceneRevision: state.sceneRevision,
              charactersRevision: state.revision,
              motion: {
                kind: 'walk',
                completed: true,
                from,
                route: [sceneActorPlacement(scene, actor)],
              },
            },
          ],
        }
      );
    }
    for (let check = 0; check < 100 && !f.gm.token3DAdapter.isMovementInProgress(token); check++)
      await new Promise((resolve) => setTimeout(resolve, 0));
    f.tick(0.1);
    expect(token.world.x).toBeGreaterThan(1.5);
    expect(token.world.x).toBeLessThan(2.5);
    for (let frame = 0; frame < 600; frame++) {
      f.tick(1 / 120);
      if (frame % 16 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(token.__threeMesh).toBe(model);
    expect(token.world.x).toBe(3.5);
    expect(f.gm.threeSceneManager.snapshotView()).toEqual(camera);
    expect(f.gm.characterServices.combat.status(token).movement.spent).toBe(0);
    expect(f.autosave.dirty).toBe(false);
    expect(f.cloud.readCharacters).not.toHaveBeenCalled();
  } finally {
    await f.close();
  }
});

test('a cloud owner reconciliation cancels obsolete movement even when the checkpoint origin matches its own issued command', async () => {
  const f = await fixture();
  const localCommandId = '33333333-3333-4333-8333-333333333333';
  f.cloud.isLocalChange = (event) =>
    event.origin?.uid === f.access.uid && event.origin.commandId === localCommandId;
  try {
    const token = f.gm.placedTokens[0];
    const model = token.__threeMesh;
    for (const step of [2, 3]) {
      const before = await f.store.readCharacters(f.campaign.id);
      const scene = JSON.parse(before.scene);
      const actor = scene.creatures[0];
      const from = structuredClone(sceneActorPlacement(scene, actor));
      actor.gridX = step;
      actor.pose.world.x = step + 0.5;
      await f.store.commitScene(f.campaign.id, {
        ruleset: '2014',
        revision: before.sceneRevision,
        charactersRevision: before.revision,
        scene: encodeScene(scene, { ruleset: '2014', library: f.library }),
      });
      const state = await f.store.readCharacters(f.campaign.id);
      const origin = {
        uid: step === 2 ? 'member-a' : f.access.uid,
        commandId: step === 2 ? '22222222-2222-4222-8222-222222222222' : localCommandId,
        kind: step === 2 ? 'world.command' : 'scene.commit',
        generation: step,
      };
      f.notify.onState(
        {
          version: 1,
          access: f.access,
          sessionId: f.sessionId,
          generation: step,
          origin,
          state,
        },
        {
          reconcile: step === 3,
          origin,
          presentations:
            step === 3
              ? []
              : [
                  {
                    commandId: origin.commandId,
                    tokenId: token.id,
                    kind: 'move',
                    sceneRevision: state.sceneRevision,
                    charactersRevision: state.revision,
                    motion: {
                      kind: 'walk',
                      completed: true,
                      from,
                      route: [sceneActorPlacement(scene, actor)],
                    },
                  },
                ],
        }
      );
      if (step === 2) {
        for (
          let check = 0;
          check < 100 && !f.gm.token3DAdapter.isMovementInProgress(token);
          check++
        )
          await new Promise((resolve) => setTimeout(resolve, 0));
        expect(f.gm.token3DAdapter.isMovementInProgress(token)).toBe(true);
        f.tick(0.1);
        expect(token.world.x).toBeGreaterThan(1.5);
        expect(token.world.x).toBeLessThan(2.5);
      } else expect(f.gm.token3DAdapter.isMovementInProgress(token)).toBe(false);
    }
    for (let check = 0; check < 100 && token.world.x !== 3.5; check++)
      await new Promise((resolve) => setTimeout(resolve, 0));
    expect(token.__threeMesh).toBe(model);
    expect(token.world.x).toBe(3.5);
    expect(f.gm.characterServices.combat.status(token).movement.spent).toBe(0);
    expect(f.cloud.readCharacters).not.toHaveBeenCalled();
  } finally {
    await f.close();
  }
});

test.each(['walk', 'run'])(
  'a cloud DM renders the received player %s through native animation without polling, movement cost or camera reset',
  async (pace) => {
    const f = await fixture();
    try {
      const token = f.gm.placedTokens[0];
      const model = token.__threeMesh;
      const camera = f.gm.threeSceneManager.snapshotView();
      const before = await f.store.readCharacters(f.campaign.id);
      const scene = JSON.parse(before.scene);
      const actor = scene.creatures[0];
      const from = structuredClone(sceneActorPlacement(scene, actor));
      actor.gridX = 2;
      actor.pose.world.x = 2.5;
      actor.movement.mode = pace;
      await f.store.commitScene(f.campaign.id, {
        ruleset: '2014',
        revision: before.sceneRevision,
        charactersRevision: before.revision,
        scene: encodeScene(scene, { ruleset: '2014', library: f.library }),
      });
      const state = await f.store.readCharacters(f.campaign.id);
      const commandId = `cloud-received-${pace}-0001`;
      const origin = {
        uid: 'member-a',
        commandId: '22222222-2222-4222-8222-222222222222',
        kind: 'world.command',
        generation: 2,
      };
      f.notify.onState(
        {
          version: 1,
          access: f.access,
          sessionId: f.sessionId,
          generation: 2,
          origin,
          state,
        },
        {
          reconcile: false,
          origin,
          presentations: [
            {
              commandId,
              tokenId: token.id,
              kind: 'move',
              sceneRevision: state.sceneRevision,
              charactersRevision: state.revision,
              motion: {
                kind: 'walk',
                completed: true,
                from,
                route: [sceneActorPlacement(scene, actor)],
              },
            },
          ],
        }
      );
      for (let check = 0; check < 100 && !f.gm.token3DAdapter.isMovementInProgress(token); check++)
        await new Promise((resolve) => setTimeout(resolve, 0));
      expect(f.gm.token3DAdapter.isMovementInProgress(token)).toBe(true);
      expect(token.world.x).toBe(1.5);
      f.tick(0.1);
      expect(token.world.x).toBeGreaterThan(1.5);
      expect(token.world.x).toBeLessThan(2.5);
      for (let frame = 0; frame < 600 && f.gm.token3DAdapter.isMovementInProgress(token); frame++)
        f.tick(1 / 120);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(token.__threeMesh).toBe(model);
      expect(token.world.x).toBe(2.5);
      expect(f.gm.threeSceneManager.snapshotView()).toEqual(camera);
      expect(f.gm.characterServices.combat.status(token).movement.spent).toBe(0);
      expect(f.autosave.dirty).toBe(false);
      expect(f.cloud.readCharacters).not.toHaveBeenCalled();
    } finally {
      await f.close();
    }
  }
);
