import { readFileSync } from 'node:fs';
import path from 'node:path';
import CampaignStore from '../../../src/campaigns/CampaignStore.js';
import CampaignCharacters from '../../../src/campaigns/CampaignCharacters.js';
import CampaignAutosave from '../../../src/campaigns/CampaignAutosave.js';
import CampaignWorld from '../../../src/campaigns/CampaignWorld.js';
import { decodeScene, encodeScene } from '../../../src/campaigns/CampaignScene.js';
import { connectCharacterServices } from '../../../src/ui/characters/characterServices.js';
import { attachHostSessionUpdates } from '../../../src/ui/sessions/HostSessionUpdates.js';
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
  const html = readFileSync(path.resolve(__dirname, '..', '..', '..', 'index.html'), 'utf8');
  document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
  const store = new CampaignStore({
    indexedDB: testIndexedDB(),
    packs: [{ id: 'srd-2014', ruleset: '2014', version: '5.1', core: true }],
  });
  const campaign = await store.create({ name: 'DM receiving movement', ruleset: '2014' });
  const catalog = { ruleset: '2014', entries: [], classes: [], enabledEntryIds: [] };
  const library = await CampaignCharacters.open({ store, campaignId: campaign.id, catalog });
  const characterId = await library.create('Scout');
  const saved = sceneState({ characterId, name: 'Scout' });
  saved.terrain.heights = Array.from({ length: 5 }, () => Array(5).fill(0));
  const scene = CampaignWorld.fromScene(saved, { ruleset: '2014', library }).save();
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
  let notify;
  const dispose = attachHostSessionUpdates({
    gameManager: gm,
    parent,
    services: {
      campaign,
      library,
      autosave,
      workspace: {
        store: {
          identity: { id: 'dm-session' },
          readCharacters: (id) => store.readCharacters(id),
          subscribeChanges: (listener) => {
            notify = listener;
            return () => {};
          },
        },
      },
    },
  });
  gm.advanceFrame();
  return {
    store,
    campaign,
    library,
    gm,
    autosave,
    notify: (event) => notify(event),
    tick: (seconds) => {
      milliseconds += seconds * 1000;
      gm.advanceFrame();
    },
    close: () => {
      dispose();
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

test.each(['walk', 'run'])(
  'multiplayer regression: the DM renders a received player %s route without spending movement or changing the camera',
  async (pace) => {
    const { store, campaign, library, gm, autosave, notify, tick, close } = await fixture();
    try {
      const token = gm.placedTokens[0];
      const model = token.__threeMesh;
      const camera = gm.threeSceneManager.snapshotView();
      const before = await store.readCharacters(campaign.id);
      const scene = decodeScene(before.scene, { ruleset: library.ruleset, library });
      const actor = scene.creatures[0];
      const from = {
        mapId: actor.mapId,
        gridX: actor.gridX,
        gridY: actor.gridY,
        facingAngle: actor.facingAngle,
        pose: JSON.parse(JSON.stringify(actor.pose)),
      };
      actor.gridX = 2;
      actor.pose.world.x = 2.5;
      actor.movement.mode = pace;
      const saved = await store.commitScene(campaign.id, {
        ruleset: library.ruleset,
        revision: before.sceneRevision,
        charactersRevision: before.revision,
        scene: encodeScene(scene, { ruleset: library.ruleset, library }),
      });
      notify({
        type: 'campaign',
        version: 1,
        campaignId: campaign.id,
        actorId: 'player-session',
        kind: 'playerCommand',
        sceneRevision: saved.revision,
        charactersRevision: before.revision,
        presentations: [
          {
            commandId: `received-${pace}-0001`,
            tokenId: token.id,
            kind: 'move',
            sceneRevision: saved.revision,
            charactersRevision: before.revision,
            motion: {
              kind: 'walk',
              completed: true,
              from,
              route: [{ ...from, gridX: 2, pose: actor.pose }],
            },
          },
        ],
      });
      for (let check = 0; check < 100 && !gm.token3DAdapter.isMovementInProgress(token); check++)
        await new Promise((resolve) => setTimeout(resolve, 0));
      expect(gm.token3DAdapter.isMovementInProgress(token)).toBe(true);
      expect(token.world.x).toBe(1.5);
      tick(0.1);
      expect(token.world.x).toBeGreaterThan(1.5);
      expect(token.world.x).toBeLessThan(2.5);
      for (let frame = 0; frame < 600 && gm.token3DAdapter.isMovementInProgress(token); frame++)
        tick(1 / 120);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(token.__threeMesh).toBe(model);
      expect(token.world.x).toBe(2.5);
      expect(gm.threeSceneManager.snapshotView()).toEqual(camera);
      expect(gm.characterServices.combat.status(token).movement.spent).toBe(0);
      expect(autosave.dirty).toBe(false);
      expect(library.sceneRevision).toBe(saved.revision);
    } finally {
      close();
    }
  }
);

test('multiplayer regression: queued player notices do not skip the first step of a DM-view route', async () => {
  const { store, campaign, library, gm, notify, tick, close } = await fixture();
  try {
    const token = gm.placedTokens[0];
    let before = await store.readCharacters(campaign.id);
    const scene = decodeScene(before.scene, { ruleset: library.ruleset, library });
    const actor = scene.creatures[0];
    const notices = [];
    for (const gridX of [2, 3]) {
      const from = {
        mapId: actor.mapId,
        gridX: actor.gridX,
        gridY: actor.gridY,
        facingAngle: actor.facingAngle,
        pose: JSON.parse(JSON.stringify(actor.pose)),
      };
      actor.gridX = gridX;
      actor.pose.world.x = gridX + 0.5;
      const saved = await store.commitScene(campaign.id, {
        ruleset: library.ruleset,
        revision: before.sceneRevision,
        charactersRevision: before.revision,
        scene: encodeScene(scene, { ruleset: library.ruleset, library }),
      });
      notices.push({
        type: 'campaign',
        version: 1,
        campaignId: campaign.id,
        actorId: 'player-session',
        kind: 'playerCommand',
        sceneRevision: saved.revision,
        charactersRevision: before.revision,
        presentations: [
          {
            commandId: `queued-player-${gridX}`,
            tokenId: token.id,
            kind: 'move',
            sceneRevision: saved.revision,
            charactersRevision: before.revision,
            motion: {
              kind: 'walk',
              completed: true,
              from,
              route: [{ ...from, gridX, pose: JSON.parse(JSON.stringify(actor.pose)) }],
            },
          },
        ],
      });
      before = await store.readCharacters(campaign.id);
    }
    for (const event of notices) notify(event);
    for (let check = 0; check < 100 && !gm.token3DAdapter.isMovementInProgress(token); check++)
      await new Promise((resolve) => setTimeout(resolve, 0));
    expect(gm.token3DAdapter.isMovementInProgress(token)).toBe(true);
    expect(token.world.x).toBe(1.5);
    expect(gm.token3DAdapter._approvedMovements.get(token).route.map(({ gridX }) => gridX)).toEqual(
      [2, 3]
    );
    for (let frame = 0; frame < 600 && gm.token3DAdapter.isMovementInProgress(token); frame++)
      tick(1 / 120);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(token.world.x).toBe(3.5);
  } finally {
    close();
  }
});
