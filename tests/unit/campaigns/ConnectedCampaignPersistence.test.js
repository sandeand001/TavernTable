import CampaignStore from '../../../src/campaigns/CampaignStore.js';
import CampaignCharacters from '../../../src/campaigns/CampaignCharacters.js';
import CampaignWorld from '../../../src/campaigns/CampaignWorld.js';
import { encodeScene, decodeScene } from '../../../src/campaigns/CampaignScene.js';
import { testIndexedDB } from '../../helpers/indexedDB.js';
import { sceneState } from '../../helpers/sceneState.js';
import classic from '../../../assets/data/resources/srd-2014-5.1-seed.1.json';

test('all connected grids and their creature locations survive acknowledged saves and campaign backups', async () => {
  const store = new CampaignStore({
    indexedDB: testIndexedDB(),
    packs: [{ id: 'srd-2014', ruleset: '2014', version: '5.1', core: true }],
  });
  const catalog = {
    ...classic,
    entries: classic.entries.map((entry) => ({ ...entry, sourcePack: 'srd-2014' })),
    enabledEntryIds: classic.entries.map((entry) => entry.id),
  };
  try {
    const campaign = await store.create({ name: 'Connected grids', ruleset: '2014' });
    const library = await CampaignCharacters.open({ store, campaignId: campaign.id, catalog });
    const characterId = await library.create('Alice');
    const scene = sceneState({ characterId, name: 'Alice' });
    scene.terrain.heights = scene.terrain.heights.map((row) => row.map(() => 0));
    const world = CampaignWorld.fromScene(scene, { ruleset: '2014', library });
    world.addMap({
      id: 'inside',
      name: 'Interior',
      originFeet: { x: 0, y: 0, z: 0 },
      quarterTurns: 0,
      base: 'floor',
      grid: { ...scene.grid, tileWorldSize: 2 },
      terrain: { ...scene.terrain },
    });
    world.transferCreature('token-1', 'inside');
    const saved = world.save();
    await library.saveScene((engine) => ({
      value: encodeScene(saved, { ruleset: '2014', library: engine }),
    }));
    const reopened = await CampaignCharacters.open({ store, campaignId: campaign.id, catalog });
    expect(decodeScene(reopened.savedScene, { ruleset: '2014', library: reopened })).toEqual(saved);
    const backup = await store.exportBackup(campaign.id);
    const imported = await store.importBackup(backup);
    const restored = await CampaignCharacters.open({ store, campaignId: imported.id, catalog });
    expect(decodeScene(restored.savedScene, { ruleset: '2014', library: restored })).toEqual(saved);
    expect(restored.get(characterId).name).toBe('Alice');
    await expect(
      store.commitScene(campaign.id, {
        ruleset: '2014',
        revision: 0,
        charactersRevision: reopened.revision,
        scene: encodeScene(saved, { ruleset: '2014', library: reopened }),
      })
    ).rejects.toThrow(/changed in another window/i);
    expect((await store.readScene(campaign.id)).scene).toBe(reopened.savedScene);
  } finally {
    store.close();
  }
});
