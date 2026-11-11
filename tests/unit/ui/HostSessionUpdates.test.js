import CampaignStore from '../../../src/campaigns/CampaignStore.js';
import CampaignCharacters from '../../../src/campaigns/CampaignCharacters.js';
import CampaignWorld from '../../../src/campaigns/CampaignWorld.js';
import CampaignAutosave from '../../../src/campaigns/CampaignAutosave.js';
import { decodeScene, encodeScene } from '../../../src/campaigns/CampaignScene.js';
import { attachHostSessionUpdates } from '../../../src/ui/sessions/HostSessionUpdates.js';
import { testIndexedDB } from '../../helpers/indexedDB.js';
import { sceneState } from '../../helpers/sceneState.js';
import {
  createConnectedTravelBoard,
  disposeConnectedTravelBoard,
} from '../../helpers/connectedTravelBoard.js';

async function fixture({ startAutosave = true } = {}) {
  const store = new CampaignStore({
    indexedDB: testIndexedDB(),
    packs: [{ id: 'srd-2014', ruleset: '2014', version: '5.1', core: true }],
  });
  const campaign = await store.create({ name: 'Shared movement', ruleset: '2014' });
  const catalog = { ruleset: '2014', entries: [], classes: [], enabledEntryIds: [] };
  const library = await CampaignCharacters.open({ store, campaignId: campaign.id, catalog });
  const characterId = await library.create('Scout');
  const saved = sceneState({ characterId, name: 'Scout' });
  saved.terrain.heights = Array.from({ length: 5 }, () => Array(5).fill(0));
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
