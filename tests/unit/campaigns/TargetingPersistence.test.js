import CampaignStore from '../../../src/campaigns/CampaignStore.js';
import CampaignCharacters from '../../../src/campaigns/CampaignCharacters.js';
import CombatSession from '../../../src/entities/characters/CombatSession.js';
import CampaignWorld from '../../../src/campaigns/CampaignWorld.js';
import { encodeScene, decodeScene } from '../../../src/campaigns/CampaignScene.js';
import {
  targetingAvailability,
  validateTargetSelection,
} from '../../../src/rules/targeting/assessment.js';
import { testIndexedDB } from '../../helpers/indexedDB.js';
import { sceneState } from '../../helpers/sceneState.js';
import data from '../../../assets/data/resources/srd-2024-5.2.1-seed.1.json';

const packs = [{ id: 'srd-2024', ruleset: '2024', version: '5.2.1', core: true }];
const catalog = {
  ...data,
  entries: data.entries.map((entry) => ({ ...entry, sourcePack: 'srd-2024' })),
  enabledEntryIds: data.entries.map((entry) => entry.id),
};
let store, campaign, library, session, caster, actor;
const board = () => ({
  tokens: [actor],
  tileSize: 1,
  inside: () => true,
  clearPoint: () => true,
  clearPath: () => true,
  clearArea: () => true,
});
const cast = (spellId) =>
  session.commitAction(session.prepareAction(caster, spellId), '', null, {
    origin: { x: 3.5, y: 0, z: 3.5 },
    targets: [],
  });
const addSpell = async (id) => {
  const owned = await library.add(caster.characterSheetId, id);
  await library.prepare(caster.characterSheetId, owned, true);
  return `spell:${owned}`;
};

beforeEach(async () => {
  store = new CampaignStore({ indexedDB: testIndexedDB(), packs });
  campaign = await store.create({ name: 'Targeting persistence', ruleset: '2024' });
  library = await CampaignCharacters.open({ store, campaignId: campaign.id, catalog });
  caster = { id: 'token-1', characterSheetId: await library.create('Caster') };
  await library.edit(caster.characterSheetId, { classId: 'wizard', level: 10 });
  actor = {
    ...caster,
    name: 'Caster',
    allegiance: 'friendly',
    creatureType: 'humanoid',
    conditions: [],
    abilities: {},
    world: { x: 1.5, y: 0, z: 1.5 },
  };
  session = new CombatSession({ library });
  session.targeting = {
    board,
    beginQuery: () => {},
    hasTokenId: (id) => id === caster.id,
    availability: (token, action) => targetingAvailability(board(), actor, action.targeting),
    validate: (token, action, selection) =>
      validateTargetSelection(
        board(),
        action.effectOrigin ? { ...actor, world: action.effectOrigin } : actor,
        action.targeting,
        selection
      ),
  };
  library.bindScene({
    capture: (engine, context) => {
      const scene = sceneState({
        ruleset: '2024',
        characterId: caster.characterSheetId,
        name: 'Caster',
      });
      Object.assign(scene.creatures[0], {
        allegiance: 'friendly',
        creatureType: 'humanoid',
        creatureSize: 'small',
      });
      scene.combat = (context.combat || session).snapshot();
      return { value: encodeScene(scene, { ruleset: '2024', library: engine }) };
    },
  });
});

afterEach(() => store.close());

test('Moonbeam movement, action cost and unchanged slot/duration are acknowledged in one scene write', async () => {
  const moonbeam = await addSpell('spell:moonbeam');
  session.startTurn(caster);
  const castResult = await cast(moonbeam);
  session.endTurn();
  await session.startTurn(caster);
  const before = JSON.parse(JSON.stringify(session.effects[0]));
  const slots = [...library.get(caster.characterSheetId).slotsUsed];
  const moving = session.commitAction(
    session.prepareAction(caster, `effect-move:${castResult.sequence}`),
    '',
    null,
    { origin: { x: 4.5, y: 0, z: 3.5 }, targets: [] }
  );
  expect(session.effects[0]).toEqual(before);
  expect(session.status(caster).actions).toBe(1);
  await moving;
  expect(session.effects[0]).toMatchObject({
    id: castResult.sequence,
    remainingTurns: before.remainingTurns,
    area: { origin: { x: 4.5, y: 0, z: 3.5 } },
  });
  const reopened = await CampaignCharacters.open({ store, campaignId: campaign.id, catalog });
  const scene = decodeScene(reopened.savedScene, { ruleset: '2024', library: reopened });
  expect(scene.combat.effects).toEqual(session.effects);
  expect(scene.combat.states[0].budget.actions).toBe(0);
  expect(reopened.get(caster.characterSheetId).slotsUsed).toEqual(slots);
  expect(reopened.get(caster.characterSheetId).concentration).toBe(before.concentrationSpellId);
  await session.undoLastUse(caster);
  expect(session.effects[0]).toEqual(before);
  const undoScene = decodeScene(library.savedScene, { ruleset: '2024', library });
  expect(undoScene.combat.effects).toEqual([before]);
  expect(undoScene.combat.states[0].budget.actions).toBe(1);
});

test('failed and queued-stale Moonbeam moves do not spend a slot or overwrite a newer area edit', async () => {
  const moonbeam = await addSpell('spell:moonbeam');
  session.startTurn(caster);
  const castResult = await cast(moonbeam);
  session.endTurn();
  await session.startTurn(caster);
  const moving = session.commitAction(
    session.prepareAction(caster, `effect-move:${castResult.sequence}`),
    '',
    null,
    { origin: { x: 4.5, y: 0, z: 3.5 }, targets: [] }
  );
  session.effects[0] = {
    ...session.effects[0],
    area: { ...session.effects[0].area, origin: { x: 4, y: 0, z: 3.5 } },
  };
  await expect(moving).rejects.toThrow('changed');
  expect(session.effects[0].area.origin.x).toBe(4);
  expect(session.status(caster).actions).toBe(1);
  const before = JSON.parse(JSON.stringify(session.effects));
  store.close();
  await expect(
    session.commitAction(
      session.prepareAction(caster, `effect-move:${castResult.sequence}`),
      '',
      null,
      { origin: { x: 4.5, y: 0, z: 3.5 }, targets: [] }
    )
  ).rejects.toThrow('closed');
  expect(session.effects).toEqual(before);
  expect(session.status(caster).actions).toBe(1);
  expect(library.get(caster.characterSheetId).slotsUsed[1]).toBe(1);
});

test('point and recipient reminders reopen without leaking into character-only exports', async () => {
  const hand = await addSpell('spell:mage-hand');
  await cast(hand);
  const haste = await addSpell('spell:haste');
  await session.commitAction(session.prepareAction(caster, haste), '', null, {
    targets: [{ tokenId: caster.id, count: 1 }],
    willingConfirmed: true,
  });
  const reopened = await CampaignCharacters.open({ store, campaignId: campaign.id, catalog });
  const scene = decodeScene(reopened.savedScene, { ruleset: '2024', library: reopened });
  expect(scene.combat.effects.map((effect) => effect.kind)).toEqual(['point', 'targets']);
  const restored = new CombatSession({ library: reopened });
  restored.restore(scene.combat, [caster]);
  expect(restored.effects).toEqual(session.effects);
  const exported = JSON.parse(library.export(caster.characterSheetId));
  expect(JSON.stringify(exported)).not.toContain('targetTokenIds');
  expect(library.get(caster.characterSheetId).speed).toBe(30);
});

test('legacy point marker coordinates migrate to campaign feet without scaling movement allowances', async () => {
  const hand = await addSpell('spell:mage-hand');
  await cast(hand);
  const scene = decodeScene(library.savedScene, { ruleset: '2024', library });
  const world = CampaignWorld.fromScene(scene, { ruleset: '2024', library });
  const marker = world.save().combat.effects[0];
  expect(marker.origin).toEqual({ x: 17.5, y: 0, z: 17.5 });
  expect(marker.movement.distanceFeet).toBe(30);
});

const castFly = (spellId) =>
  session.commitAction(session.prepareAction(caster, spellId), '', null, {
    targets: [{ tokenId: caster.id, count: 1 }],
    willingConfirmed: true,
  });

test('Fly grants, concentration, slot and action costs are saved together without changing character-only exports', async () => {
  const fly = await addSpell('spell:fly');
  session.startTurn(caster);
  const saving = castFly(fly);
  expect(session.effects).toEqual([]);
  expect(library.get(caster.characterSheetId).slotsUsed[2]).toBe(0);
  await saving;
  const reopened = await CampaignCharacters.open({ store, campaignId: campaign.id, catalog });
  const scene = decodeScene(reopened.savedScene, { ruleset: '2024', library: reopened });
  expect(scene.combat.effects).toEqual(session.effects);
  expect(scene.combat.effects[0]).toMatchObject({
    kind: 'flight',
    targetTokenIds: [caster.id],
    flySpeed: 60,
    hover: true,
  });
  expect(scene.combat.states[0].budget.actions).toBe(0);
  expect(reopened.get(caster.characterSheetId)).toMatchObject({
    fallTraits: { flySpeed: 0 },
    slotsUsed: [0, 0, 1, 0, 0, 0, 0, 0, 0],
  });
  const restored = new CombatSession({ library: reopened });
  restored.restore(scene.combat, [caster]);
  expect(
    restored.movementCharacter(caster, reopened.get(caster.characterSheetId)).fallTraits.flySpeed
  ).toBe(60);
  const copiedId = await library.import(library.export(caster.characterSheetId));
  expect(library.get(copiedId).fallTraits.flySpeed).toBe(0);
});

test('a failed Fly save applies neither flight nor concentration, slot or action costs', async () => {
  const fly = await addSpell('spell:fly');
  session.startTurn(caster);
  store.close();
  await expect(castFly(fly)).rejects.toThrow('closed');
  expect(session.effects).toEqual([]);
  expect(library.get(caster.characterSheetId)).toMatchObject({
    concentration: '',
    slotsUsed: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  });
  expect(session.status(caster).actions).toBe(1);
});

test('Fly rechecks recipients when its queued scene commit begins and spends nothing if they left', async () => {
  const fly = await addSpell('spell:fly');
  session.startTurn(caster);
  const saving = castFly(fly);
  actor = { ...actor, id: 'replacement' };
  await expect(saving).rejects.toThrow('left the board');
  expect(session.effects).toEqual([]);
  expect(library.get(caster.characterSheetId).slotsUsed[2]).toBe(0);
  expect(library.get(caster.characterSheetId).concentration).toBe('');
  expect(session.status(caster).actions).toBe(1);
});

test('ordinary recipient spells also recheck queued targets before any costs are committed', async () => {
  const haste = await addSpell('spell:haste');
  session.startTurn(caster);
  const saving = session.commitAction(session.prepareAction(caster, haste), '', null, {
    targets: [{ tokenId: caster.id, count: 1 }],
    willingConfirmed: true,
  });
  actor = { ...actor, id: 'replacement' };
  await expect(saving).rejects.toThrow('left the board');
  expect(session.effects).toEqual([]);
  expect(library.get(caster.characterSheetId).slotsUsed[2]).toBe(0);
  expect(library.get(caster.characterSheetId).concentration).toBe('');
  expect(session.status(caster).actions).toBe(1);
});

test('ending Fly atomically removes concentration and grants; a failed end preserves both', async () => {
  const fly = await addSpell('spell:fly');
  await castFly(fly);
  const effect = session.effects[0];
  const ending = session.endEffect(effect.id);
  expect(session.effects).toEqual([effect]);
  await ending;
  const reopened = await CampaignCharacters.open({ store, campaignId: campaign.id, catalog });
  const scene = decodeScene(reopened.savedScene, { ruleset: '2024', library: reopened });
  expect(scene.combat.effects).toEqual([]);
  expect(reopened.get(caster.characterSheetId).concentration).toBe('');
  await castFly(fly);
  const current = session.effects[0];
  store.close();
  await expect(session.endEffect(current.id)).rejects.toThrow('closed');
  expect(session.effects).toEqual([current]);
  expect(library.get(caster.characterSheetId).concentration).toBe(current.concentrationSpellId);
});

test('Fly expiry and the new caster turn are acknowledged together with concentration cleanup', async () => {
  const fly = await addSpell('spell:fly');
  const profile = session.availableActions(caster).find((action) => action.id === fly).targeting;
  await library.actions.setTargetingProfile(caster.characterSheetId, fly, {
    ...profile,
    lingerTurns: 1,
  });
  session.startTurn(caster);
  await castFly(fly);
  session.endTurn();
  const expired = session.startTurn(caster);
  expect(session.effects[0].remainingTurns).toBe(1);
  expect(session.activeToken).toBeNull();
  await expired;
  const reopened = await CampaignCharacters.open({ store, campaignId: campaign.id, catalog });
  const scene = decodeScene(reopened.savedScene, { ruleset: '2024', library: reopened });
  expect(scene.combat.effects).toEqual([]);
  expect(scene.combat.turn).toBe(2);
  expect(scene.combat.activeTokenId).toBe(caster.id);
  expect(scene.combat.states[0].budget.actions).toBe(1);
  expect(reopened.get(caster.characterSheetId).concentration).toBe('');
});

test('failed Fly expiry leaves the previous turn and active grant available to retry', async () => {
  const fly = await addSpell('spell:fly');
  const profile = session.availableActions(caster).find((action) => action.id === fly).targeting;
  await library.actions.setTargetingProfile(caster.characterSheetId, fly, {
    ...profile,
    lingerTurns: 1,
  });
  session.startTurn(caster);
  await castFly(fly);
  session.endTurn();
  const previous = session.snapshot();
  store.close();
  await expect(session.startTurn(caster)).rejects.toThrow('closed');
  expect(session.snapshot()).toEqual(previous);
});

test('spell cost, confirmed targets, active visual area and budgets are acknowledged together and reopen together', async () => {
  const fog = await addSpell('spell:fog-cloud');
  session.startTurn(caster);
  const saving = cast(fog);
  expect(session.effects).toEqual([]);
  expect(library.get(caster.characterSheetId).slotsUsed[0]).toBe(0);
  expect(session.status(caster).actions).toBe(1);
  await saving;
  const reopened = await CampaignCharacters.open({ store, campaignId: campaign.id, catalog });
  const scene = decodeScene(reopened.savedScene, { ruleset: '2024', library: reopened });
  expect(reopened.get(caster.characterSheetId).slotsUsed[0]).toBe(1);
  expect(scene.creatures[0]).toMatchObject({
    allegiance: 'friendly',
    creatureType: 'humanoid',
    creatureSize: 'small',
  });
  expect(scene.combat.effects).toEqual(session.effects);
  expect(scene.combat.states[0].budget.actions).toBe(0);
  const restored = new CombatSession({ library: reopened });
  restored.restore(scene.combat, [caster]);
  expect(restored.history(caster)[0].targetingSelection.area.shape).toBe('sphere');
  expect(restored.effects).toEqual(session.effects);
  expect(restored.pending).toBeNull();
});

test('a confirmed higher casting level saves its own slot and target allocations atomically', async () => {
  const missile = await addSpell('spell:magic-missile');
  session.startTurn(caster);
  const original = session.prepareAction(caster, missile);
  const revised = session.changeSpellLevel(original, 2);
  const saving = session.commitAction(revised, '', null, {
    targets: [{ tokenId: caster.id, count: 4 }],
  });
  expect(library.get(caster.characterSheetId).slotsUsed.slice(0, 2)).toEqual([0, 0]);
  await saving;
  const reopened = await CampaignCharacters.open({ store, campaignId: campaign.id, catalog });
  const saved = decodeScene(reopened.savedScene, { ruleset: '2024', library: reopened });
  expect(reopened.get(caster.characterSheetId).slotsUsed.slice(0, 2)).toEqual([0, 1]);
  expect(saved.combat.histories[0].entries[0]).toMatchObject({
    slotLevel: 2,
    targetingSelection: { targets: [expect.objectContaining({ count: 4 })] },
  });
  expect(saved.combat.states[0].budget.actions).toBe(0);
});

test('failed persistence leaves prior concentration visuals, resources and budgets intact', async () => {
  const fog = await addSpell('spell:fog-cloud'),
    entangle = await addSpell('spell:entangle');
  session.startTurn(caster);
  await cast(fog);
  session.endTurn();
  session.startTurn(caster);
  const before = JSON.parse(JSON.stringify(session.effects));
  const concentration = library.get(caster.characterSheetId).concentration;
  store.close();
  await expect(cast(entangle)).rejects.toThrow('closed');
  expect(session.effects).toEqual(before);
  expect(library.get(caster.characterSheetId)).toMatchObject({
    concentration,
    slotsUsed: [1, 0, 0, 0, 0, 0, 0, 0, 0],
  });
  expect(session.status(caster).actions).toBe(1);
  expect(session.pending).toBeNull();
});

test('Undo atomically restores the preceding concentration visual and slot usage', async () => {
  const fog = await addSpell('spell:fog-cloud'),
    entangle = await addSpell('spell:entangle');
  await cast(fog);
  const original = session.effects[0];
  await cast(entangle);
  await session.undoLastUse(caster);
  const reopened = await CampaignCharacters.open({ store, campaignId: campaign.id, catalog });
  const scene = decodeScene(reopened.savedScene, { ruleset: '2024', library: reopened });
  expect(scene.combat.effects).toEqual([original]);
  expect(reopened.get(caster.characterSheetId).concentration).toBe(original.concentrationSpellId);
  expect(reopened.get(caster.characterSheetId).slotsUsed[0]).toBe(1);
});

test('targeting overrides use acknowledged companion writes and survive both backup formats', async () => {
  const profile = { version: 1, kind: 'tokens', rangeFeet: 30, minRangeFeet: 10 };
  const saving = library.actions.setTargetingProfile(
    caster.characterSheetId,
    'attack:unarmed',
    profile
  );
  expect(library.actions.snapshot(caster.characterSheetId).targetingOverrides).toBeUndefined();
  await saving;
  const copy = await library.import(library.export(caster.characterSheetId));
  expect(library.actions.snapshot(copy).targetingOverrides['attack:unarmed']).toMatchObject(
    profile
  );
  const campaignCopy = await store.importBackup(await store.exportBackup(campaign.id));
  const imported = await CampaignCharacters.open({ store, campaignId: campaignCopy.id, catalog });
  expect(
    imported.actions.snapshot(caster.characterSheetId).targetingOverrides['attack:unarmed']
  ).toMatchObject(profile);
});
