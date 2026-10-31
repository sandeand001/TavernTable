import CampaignStore from '../../../src/campaigns/CampaignStore.js';
import CampaignCharacters from '../../../src/campaigns/CampaignCharacters.js';
import { testIndexedDB } from '../../helpers/indexedDB.js';
import CombatSession from '../../../src/entities/characters/CombatSession.js';
import snapshot from '../../../assets/data/srd2014.json';

const packs = [
  { id: 'srd-2014', ruleset: '2014', version: '5.1', core: true },
  { id: 'srd-2024', ruleset: '2024', version: '5.2.1', core: true },
];
const catalog = {
  version: 1,
  ruleset: '2014',
  entries: [],
  classes: [],
  enabledEntryIds: [],
};

test('campaign characters expose only acknowledged writes, queue changes, and survive reopening', async () => {
  const store = new CampaignStore({ indexedDB: testIndexedDB(), packs });
  const campaign = await store.create({ name: 'Characters', ruleset: '2014' });
  const library = await CampaignCharacters.open({ store, campaignId: campaign.id, catalog });
  const creating = library.create('First');
  expect(library.list()).toEqual([]);
  const id = await creating;
  await Promise.all([library.edit(id, { name: 'Saved' }), library.edit(id, { speed: 40 })]);
  const reopened = await CampaignCharacters.open({ store, campaignId: campaign.id, catalog });
  expect(reopened.get(id)).toMatchObject({ name: 'Saved', speed: 40 });
  const other = await store.create({ name: 'Other campaign', ruleset: '2014' });
  const separate = await CampaignCharacters.open({ store, campaignId: other.id, catalog });
  expect(() => separate.get(id)).toThrow('not found');
  store.close();
  await expect(library.edit(id, { speed: 50 })).rejects.toThrow('closed');
  expect(library.get(id).speed).toBe(40);
});

test('character copies carry their edition and reject imports into another ruleset', async () => {
  const store = new CampaignStore({ indexedDB: testIndexedDB(), packs });
  const classic = await store.create({ name: 'Classic', ruleset: '2014' });
  const revised = await store.create({ name: 'Revised', ruleset: '2024' });
  const library = await CampaignCharacters.open({ store, campaignId: classic.id, catalog });
  const modern = await CampaignCharacters.open({
    store,
    campaignId: revised.id,
    catalog: { ...catalog, ruleset: '2024' },
  });
  const id = await library.create('Portable');
  await library.layouts.savePage(id, 'combat', {
    sectionOrder: ['favorites'],
    cardOrder: {},
    favorites: ['attack:unarmed'],
  });
  const backup = library.export(id);
  expect(JSON.parse(backup)).toMatchObject({
    version: 5,
    ruleset: '2014',
    sourcePacks: [{ id: 'srd-2014', ruleset: '2014', version: '5.1' }],
  });
  await expect(modern.import(backup)).rejects.toThrow('ruleset');
  expect(modern.list()).toEqual([]);
  const copy = await library.import(backup);
  expect(copy).not.toBe(id);
  expect(library.layouts.page(copy, 'combat')).toEqual(library.layouts.page(id, 'combat'));
  store.close();
});

test('combat economy changes only after persistent resource costs commit and failures spend nothing', async () => {
  const store = new CampaignStore({ indexedDB: testIndexedDB(), packs });
  const campaign = await store.create({ name: 'Combat', ruleset: '2014' });
  const library = await CampaignCharacters.open({
    store,
    campaignId: campaign.id,
    catalog: { ...catalog, classes: snapshot.classes },
  });
  const token = { id: 'hero', characterSheetId: await library.create('Fighter') };
  const combat = new CombatSession({ library });
  combat.startTurn(token);
  const saving = combat.useAction(token, 'ability:second-wind');
  expect(combat.status(token).bonusActions).toBe(1);
  expect(() => combat.endTurn()).toThrow('Finish');
  await saving;
  expect(combat.status(token).bonusActions).toBe(0);
  expect(
    library.rest
      .status(token.characterSheetId)
      .resources.find((resource) => resource.id === 'second-wind').remaining
  ).toBe(0);
  const editing = library.edit(token.characterSheetId, { abilities: { strength: 16 } });
  expect(() => combat.captureRoll(token)).toThrow('Finish saving');
  expect(() => combat.beginMovement(token, 5)).toThrow('Finish');
  expect(combat.status(token).canUndo).toBe(false);
  await editing;
  store.close();
  const failed = combat.useAction(token, 'dash');
  expect(combat.status(token).actions).toBe(1);
  await expect(failed).rejects.toThrow('closed');
  expect(combat.status(token).actions).toBe(1);
  expect(combat.pending).toBeNull();
});

test('resource costs, action budgets and completed history commit together, including Undo', async () => {
  const store = new CampaignStore({ indexedDB: testIndexedDB(), packs });
  const campaign = await store.create({ name: 'Atomic combat scene', ruleset: '2014' });
  const library = await CampaignCharacters.open({
    store,
    campaignId: campaign.id,
    catalog: { ...catalog, classes: snapshot.classes },
  });
  const token = { id: 'hero', characterSheetId: await library.create('Fighter') };
  const combat = new CombatSession({ library });
  library.bindScene({
    capture: (engine, context) => ({
      value: JSON.stringify({
        resource: engine.rest
          .status(token.characterSheetId)
          .resources.find((row) => row.id === 'second-wind').remaining,
        combat: (context.combat || combat).snapshot(),
      }),
    }),
  });
  combat.startTurn(token);
  await combat.useAction(token, 'ability:second-wind');
  let saved = JSON.parse((await store.readScene(campaign.id)).scene);
  expect(saved.resource).toBe(0);
  expect(saved.combat.states[0].budget.bonusActions).toBe(0);
  expect(saved.combat.histories[0].entries).toHaveLength(1);
  await combat.undoLastUse(token);
  saved = JSON.parse((await store.readScene(campaign.id)).scene);
  expect(saved.resource).toBe(1);
  expect(saved.combat.states[0].budget.bonusActions).toBe(1);
  expect(saved.combat.histories[0].entries[0].undone).toBe(true);
  store.close();
});

test('a prospective action save uses movement committed while awaiting scene assets', async () => {
  const store = new CampaignStore({ indexedDB: testIndexedDB(), packs });
  const campaign = await store.create({ name: 'Moving commit', ruleset: '2014' });
  const library = await CampaignCharacters.open({ store, campaignId: campaign.id, catalog });
  const token = { id: 'hero', characterSheetId: await library.create('Fighter') };
  const combat = new CombatSession({ library });
  combat.startTurn(token);
  const movement = combat.beginMovement(token, 20);
  library.bindScene({
    capture: async (engine, context) => {
      await Promise.resolve();
      combat.finishMovement(movement, 5);
      return { value: JSON.stringify(context.combat.snapshot({ movementSession: combat })) };
    },
  });
  await combat.useAction(token, 'dash');
  const saved = JSON.parse((await store.readScene(campaign.id)).scene);
  expect(saved.states[0].movementSpent).toBe(5);
  expect(saved.states[0].budget).toMatchObject({ actions: 0, movementBonus: 30 });
  store.close();
});

test('Add and equip and replacement characters are single acknowledged domain changes', async () => {
  const store = new CampaignStore({ indexedDB: testIndexedDB(), packs });
  const campaign = await store.create({ name: 'Atomic edits', ruleset: '2014' });
  const library = await CampaignCharacters.open({
    store,
    campaignId: campaign.id,
    catalog: {
      ...catalog,
      classes: snapshot.classes,
      entries: snapshot.entries,
      enabledEntryIds: snapshot.entries.map((entry) => entry.id),
    },
  });
  const id = await library.create('Original');
  await library.add(id, 'item:chain-mail', { equip: true });
  expect(library.stats(id).armorClass).toBe(16);
  const replacing = library.replace(id, 'Replacement');
  expect(library.get(id).name).toBe('Original');
  const replacement = await replacing;
  expect(() => library.get(id)).toThrow('not found');
  expect(library.get(replacement).name).toBe('Replacement');
  expect(library.list()).toHaveLength(1);
  store.close();
});

test('queued spell-slot adjustments read their state inside the acknowledged transaction', async () => {
  const store = new CampaignStore({ indexedDB: testIndexedDB(), packs });
  const campaign = await store.create({ name: 'Slots', ruleset: '2014' });
  const library = await CampaignCharacters.open({
    store,
    campaignId: campaign.id,
    catalog: { ...catalog, classes: snapshot.classes },
  });
  const id = await library.create('Wizard');
  await library.edit(id, { classId: 'wizard', level: 3 });
  await Promise.all([library.setSlotUsed(id, 1, 1), library.setSlotUsed(id, 2, 1)]);
  expect(library.get(id).slotsUsed.slice(0, 2)).toEqual([1, 1]);
  store.close();
});
