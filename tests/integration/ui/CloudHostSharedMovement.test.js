import { readFileSync } from 'node:fs';
import path from 'node:path';
import CampaignStore from '../../../src/campaigns/CampaignStore.js';
import CampaignCharacters from '../../../src/campaigns/CampaignCharacters.js';
import CampaignAutosave from '../../../src/campaigns/CampaignAutosave.js';
import CampaignWorld from '../../../src/campaigns/CampaignWorld.js';
import { encodeScene } from '../../../src/campaigns/CampaignScene.js';
import { connectCharacterServices } from '../../../src/ui/characters/characterServices.js';
import { installCameraMethods } from '../../../src/scene/camera/CameraSystem.js';
import { sceneActorPlacement } from '../../../src/scene/token-adapter/SavedPlacements.js';
import {
  executePlayerCommand,
  playerCommandReceipt,
} from '../../../src/campaigns/ServerGameplay.js';
import { createCampaignBoard } from '../../helpers/campaignBoard.js';
import { installHumanoidAssetFiles } from '../../helpers/humanoid-fixture.js';
import { testIndexedDB } from '../../helpers/indexedDB.js';
import { sceneState } from '../../helpers/sceneState.js';

let restoreFiles;
beforeAll(() => {
  restoreFiles = installHumanoidAssetFiles();
});
afterAll(() => restoreFiles());

const WAIT_TIMEOUT_MS = 10000;

async function waitForCondition(condition, message) {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function fixture({ coverWall = false } = {}) {
  const { default: CloudHostSessionUpdates } =
    await import('../../../src/ui/sessions/CloudHostSessionUpdates.js');
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
  if (coverWall) raw.terrain.heights[1][2] = 4;
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
    await waitForCondition(
      () => f.gm.token3DAdapter.isMovementInProgress(token),
      'The first cloud movement did not start'
    );
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

test('DM zoom and token selection do not start a save or conflict with an incoming player move', async () => {
  const f = await fixture();
  try {
    const token = f.gm.placedTokens[0];
    const before = await f.store.readCharacters(f.campaign.id);
    const scene = JSON.parse(before.scene);
    const actor = scene.creatures[0];
    actor.gridX = 2;
    actor.pose.world.x = 2.5;
    await f.store.commitScene(f.campaign.id, {
      ruleset: '2014',
      revision: before.sceneRevision,
      charactersRevision: before.revision,
      scene: encodeScene(scene, { ruleset: '2014', library: f.library }),
    });
    const state = await f.store.readCharacters(f.campaign.id);
    const camera = { gameManager: f.gm, _minZoom: 0.5, _maxZoom: 2, _zoom: 1 };
    installCameraMethods(camera);
    camera.setZoom(1.1);
    await f.gm.token3DAdapter.setSelectedToken(token);
    const origin = {
      uid: 'member-a',
      commandId: '22222222-2222-4222-8222-222222222222',
      kind: 'world.command',
      generation: 2,
    };
    f.notify.onState(
      { version: 1, access: f.access, sessionId: f.sessionId, generation: 2, origin, state },
      { reconcile: false, origin, presentations: [] }
    );
    await waitForCondition(
      () => f.library.sceneRevision >= state.sceneRevision,
      'The cloud owner did not apply the incoming canonical revision'
    );
    expect(f.autosave.sharedConflict).toBeFalsy();
    expect(f.autosave.dirty).toBe(false);
    expect(f.library.sceneRevision).toBe(state.sceneRevision);
    expect(token.world.x).toBe(2.5);
    await f.autosave.flush();
    expect((await f.store.readCharacters(f.campaign.id)).sceneRevision).toBe(state.sceneRevision);
  } finally {
    await f.close();
  }
});

test.each([
  ['member', 'member-a', 'world.command'],
  ['another owner tab', 'owner-a', 'scene.commit'],
])(
  'a live cloud owner renders a received canonical visual action from %s once without camera, pose or budget changes',
  async (_label, uid, kind) => {
    const f = await fixture();
    try {
      const token = f.gm.placedTokens[0];
      const model = token.__threeMesh;
      const position = { ...token.world };
      const camera = f.gm.threeSceneManager.snapshotView();
      const before = await f.store.readCharacters(f.campaign.id);
      await f.store.commitScene(f.campaign.id, {
        ruleset: '2014',
        revision: before.sceneRevision,
        charactersRevision: before.revision,
        scene: before.scene,
      });
      const state = await f.store.readCharacters(f.campaign.id);
      const scene = JSON.parse(state.scene);
      const commandId = '44444444-4444-4444-8444-444444444444';
      const origin = { uid, commandId, kind, generation: 2 };
      const checkpoint = {
        version: 1,
        access: f.access,
        sessionId: f.sessionId,
        generation: 2,
        origin,
        state,
      };
      const context = {
        reconcile: false,
        origin,
        presentations: [
          {
            commandId,
            tokenId: token.id,
            kind: 'emote',
            actionId: 'action-wave',
            animationKey: 'actionWave',
            sceneRevision: state.sceneRevision,
            charactersRevision: state.revision,
            placement: sceneActorPlacement(scene, scene.creatures[0]),
          },
        ],
      };
      f.notify.onState(checkpoint, context);
      const data = f.gm.token3DAdapter._tokenAnimationData.get(token);
      await waitForCondition(
        () => data.current === 'actionWave',
        'The cloud visual action did not start'
      );
      expect(data.current).toBe('actionWave');
      f.tick(0.25);
      const time = data.actions.actionWave.time;
      f.notify.onState(checkpoint, context);
      await new Promise((resolve) => setTimeout(resolve, 0));
      f.tick(0.1);
      expect(data.actions.actionWave.time).toBeGreaterThan(time);
      expect(token.__threeMesh).toBe(model);
      expect(token.world).toEqual(position);
      expect(f.gm.threeSceneManager.snapshotView()).toEqual(camera);
      expect(f.gm.characterServices.combat.status(token).movement.spent).toBe(0);
      expect(f.autosave.dirty).toBe(false);
    } finally {
      await f.close();
    }
  }
);

test('a cloud DM replays accepted Cover to its exact committed stance without an echo save', async () => {
  const f = await fixture({ coverWall: true });
  try {
    const token = f.gm.placedTokens[0];
    const model = token.__threeMesh;
    const camera = f.gm.threeSceneManager.snapshotView();
    const before = await f.store.readCharacters(f.campaign.id);
    const scene = JSON.parse(before.scene);
    const accepted = await executePlayerCommand(
      scene,
      f.library,
      {
        kind: 'emote',
        tokenId: token.id,
        payload: { actionId: 'action-cover' },
      },
      { ownedIds: [scene.creatures[0].characterId] }
    );
    const receipt = playerCommandReceipt(accepted, scene, f.library);
    await f.store.commitScene(f.campaign.id, {
      ruleset: '2014',
      revision: before.sceneRevision,
      charactersRevision: before.revision,
      scene: JSON.stringify(accepted.scene),
    });
    const state = await f.store.readCharacters(f.campaign.id);
    const commandId = '55555555-5555-4555-8555-555555555555';
    const origin = { uid: 'member-a', commandId, kind: 'world.command', generation: 2 };
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
            kind: 'emote',
            actionId: 'action-cover',
            animationKey: receipt.animationKey,
            from: receipt.from,
            placement: receipt.placement,
            sceneRevision: state.sceneRevision,
            charactersRevision: state.revision,
          },
        ],
      }
    );
    await waitForCondition(
      () => f.gm.token3DAdapter.isMovementInProgress(token),
      'The accepted Cover movement did not start'
    );
    expect(f.gm.token3DAdapter.isMovementInProgress(token)).toBe(true);
    expect(token.world).toEqual(receipt.from.pose.world);
    let interpolated = false;
    for (let frame = 0; frame < 3000 && f.gm.token3DAdapter.isMovementInProgress(token); frame++) {
      f.tick(1 / 120);
      if (
        token.world.x > receipt.from.pose.world.x &&
        token.world.x < receipt.placement.pose.world.x
      )
        interpolated = true;
      if (frame % 16 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(interpolated).toBe(true);
    expect(token.world).toEqual(receipt.placement.pose.world);
    expect(token.facingAngle).toBe(receipt.placement.facingAngle);
    expect(token.__threeMesh).toBe(model);
    expect(f.gm.threeSceneManager.snapshotView()).toEqual(camera);
    expect(f.autosave.dirty).toBe(false);
    expect(f.gm.characterServices.combat.status(token).movement.spent).toBe(0);
  } finally {
    await f.close();
  }
}, 30000);

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
        await waitForCondition(
          () => f.gm.token3DAdapter.isMovementInProgress(token),
          'The reconciled cloud movement did not start'
        );
        expect(f.gm.token3DAdapter.isMovementInProgress(token)).toBe(true);
        f.tick(0.1);
        expect(token.world.x).toBeGreaterThan(1.5);
        expect(token.world.x).toBeLessThan(2.5);
      } else expect(f.gm.token3DAdapter.isMovementInProgress(token)).toBe(false);
    }
    await waitForCondition(
      () => token.world.x === 3.5,
      'The reconciled cloud token did not reach its committed destination'
    );
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
      await waitForCondition(
        () => f.gm.token3DAdapter.isMovementInProgress(token),
        `The cloud ${pace} movement did not start`
      );
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
