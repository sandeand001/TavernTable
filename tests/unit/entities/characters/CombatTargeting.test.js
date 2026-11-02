import { CharacterLibrary } from '../../../../src/entities/characters/CharacterLibrary.js';
import CombatSession from '../../../../src/entities/characters/CombatSession.js';
import {
  targetingAvailability,
  validateTargetSelection,
} from '../../../../src/rules/targeting/assessment.js';
import { validateAreaEffect } from '../../../../src/entities/characters/combat/targetingEffects.js';
import data from '../../../../assets/data/resources/srd-2024-5.2.1-seed.1.json';

let library, session, caster, other, targets;
const board = () => ({
  tileSize: 1,
  tokens: targets,
  inside: () => true,
  clearPath: () => true,
  clearPoint: () => true,
  clearArea: () => true,
});
const actor = (token) => targets.find((candidate) => candidate.id === token.id);
const addSpell = (entryId) => {
  const owned = library.add(caster.characterSheetId, entryId);
  library.prepare(caster.characterSheetId, owned, true);
  return `spell:${owned}`;
};
const castArea = (actionId, origin = { x: 5, y: 0, z: 5 }) => {
  const ticket = session.prepareAction(caster, actionId);
  return session.commitAction(ticket, '', null, { origin, targets: [] });
};

beforeEach(() => {
  localStorage.clear();
  library = new CharacterLibrary({
    ruleset: '2024',
    storage: localStorage,
    catalog: data.entries,
    classes: data.classes,
  });
  caster = { id: 'caster', characterSheetId: library.create('Caster') };
  other = { id: 'other', characterSheetId: library.create('Other') };
  library.edit(caster.characterSheetId, { classId: 'wizard', level: 10 });
  targets = [caster, other].map((token, index) => ({
    ...token,
    name: token.id,
    world: { x: index + 1, y: 0, z: 1 },
    allegiance: index ? 'hostile' : 'friendly',
    creatureType: 'humanoid',
    conditions: [],
    abilities: { strength: 10, dexterity: 10 },
  }));
  session = new CombatSession({ library });
  session.targeting = {
    beginQuery: () => {},
    hasTokenId: (id) => targets.some((token) => token.id === id),
    availability: (token, action) => targetingAvailability(board(), actor(token), action.targeting),
    validate: (token, action, selection) =>
      validateTargetSelection(board(), actor(token), action.targeting, selection),
  };
});

test('target availability updates as opponents enter range; an invalid selection spends nothing', () => {
  targets[1].world.x = 10;
  expect(session.availableActions(caster).map((action) => action.id)).not.toContain(
    'attack:unarmed'
  );
  targets[1].world.x = 2;
  session.startTurn(caster);
  const ticket = session.prepareAction(caster, 'attack:unarmed');
  expect(() =>
    session.commitAction(ticket, '', null, { targets: [{ tokenId: 'missing', count: 1 }] })
  ).toThrow('left the board');
  expect(session.status(caster).actions).toBe(1);
  expect(session.history(caster)).toEqual([]);
  expect(session.pending).toBeNull();
});

test('canceling an AOE reservation spends no spell slot and creates no area', () => {
  const spell = addSpell('spell:grease');
  session.startTurn(caster);
  const ticket = session.prepareAction(caster, spell);
  session.cancelAction(ticket);
  expect(session.effects).toEqual([]);
  expect(library.get(caster.characterSheetId).slotsUsed[0]).toBe(0);
  expect(session.status(caster).actions).toBe(1);
});

test('changing a reserved spell level revalidates the actor, invalidates the old ticket and spends no costs itself', () => {
  const missile = addSpell('spell:magic-missile');
  session.startTurn(caster);
  const original = session.prepareAction(caster, missile);
  const revised = session.changeSpellLevel(original, 2);
  expect(Object.isFrozen(revised)).toBe(true);
  expect(session.pending).toBe(revised);
  expect(revised.action).toMatchObject({ slotLevel: 2, targeting: { maxTargets: 4 } });
  expect(session.status(caster).actions).toBe(1);
  expect(library.get(caster.characterSheetId).slotsUsed.every((used) => used === 0)).toBe(true);
  expect(() => session.commitAction(original)).toThrow('no longer active');
  session.cancelAction(revised);
});

test('an exhausted or under-level spell slot cannot replace a valid reservation', () => {
  const ray = addSpell('spell:scorching-ray');
  library.setSlotUsed(caster.characterSheetId, 3, 3);
  const ticket = session.prepareAction(caster, ray);
  expect(() => session.changeSpellLevel(ticket, 1)).toThrow();
  expect(() => session.changeSpellLevel(ticket, 3)).toThrow();
  expect(session.pending).toBe(ticket);
  expect(session.history(caster)).toEqual([]);
});

test('changing cast level cannot legitimize a character that changed during targeting', () => {
  const ray = addSpell('spell:scorching-ray');
  const ticket = session.prepareAction(caster, ray);
  library.edit(caster.characterSheetId, { abilities: { intelligence: 18 } });
  expect(() => session.changeSpellLevel(ticket, 3)).toThrow('changed');
  expect(session.pending).toBe(ticket);
  expect(library.get(caster.characterSheetId).slotsUsed.every((used) => used === 0)).toBe(true);
});

test('lingering time advances only on later caster turns and survives save/restore', () => {
  const grease = addSpell('spell:grease');
  session.startTurn(caster);
  castArea(grease);
  expect(session.effects[0].remainingTurns).toBe(10);
  session.endTurn();
  session.startTurn(other);
  session.status(caster);
  session._publish();
  expect(session.effects[0].remainingTurns).toBe(10);
  session.endTurn();
  session.startTurn(caster);
  expect(session.effects[0].remainingTurns).toBe(9);
  const saved = session.snapshot();
  const restored = new CombatSession({ library });
  restored.restore(saved, [caster, other]);
  expect(restored.effects).toEqual(session.effects);
  restored.endTurn();
  restored.startTurn(caster);
  expect(restored.effects[0].remainingTurns).toBe(8);
});

test('Ice Storm persists through creation-turn end and expires at the end of the next caster turn', () => {
  const ice = addSpell('spell:ice-storm');
  session.startTurn(caster);
  castArea(ice);
  session.endTurn();
  expect(session.effects).toHaveLength(1);
  session.startTurn(other);
  session.endTurn();
  session.startTurn(caster);
  expect(session.effects).toHaveLength(1);
  session.endTurn();
  expect(session.effects).toEqual([]);
});

test('concentration replacement and ending remove only the corresponding caster’s concentration areas', () => {
  const fog = addSpell('spell:fog-cloud'),
    entangle = addSpell('spell:entangle');
  castArea(fog);
  const first = session.effects[0].id;
  castArea(entangle);
  expect(session.effects).toHaveLength(1);
  expect(session.effects[0].id).not.toBe(first);
  library.endConcentration(caster.characterSheetId);
  session.syncEffects();
  expect(session.effects).toEqual([]);
});

test('a non-concentration zone and another caster’s concentration are not cleared with this caster’s concentration', () => {
  const fog = addSpell('spell:fog-cloud'),
    grease = addSpell('spell:grease');
  library.edit(other.characterSheetId, { classId: 'wizard', level: 10 });
  const otherFog = library.add(other.characterSheetId, 'spell:fog-cloud');
  library.prepare(other.characterSheetId, otherFog, true);
  castArea(fog);
  castArea(grease);
  session.commitAction(session.prepareAction(other, `spell:${otherFog}`), '', null, {
    origin: { x: 8, y: 0, z: 5 },
    targets: [],
  });
  expect(session.effects).toHaveLength(3);
  library.endConcentration(caster.characterSheetId);
  session.syncEffects();
  expect(session.effects.map((effect) => [effect.characterId, effect.sourceId])).toEqual([
    [caster.characterSheetId, 'spell:grease'],
    [other.characterSheetId, 'spell:fog-cloud'],
  ]);
});

test('Undo restores the replaced concentration visual with its remaining duration', () => {
  const fog = addSpell('spell:fog-cloud'),
    entangle = addSpell('spell:entangle');
  castArea(fog);
  const original = session.effects[0];
  castArea(entangle);
  session.undoLastUse(caster);
  expect(session.effects).toEqual([original]);
  expect(library.get(caster.characterSheetId).concentration).toBe(original.concentrationSpellId);
});

test('manual removal and Undo remove the correct visual without replaying effects', () => {
  const grease = addSpell('spell:grease');
  session.startTurn(caster);
  castArea(grease);
  const effect = session.effects[0];
  session.undoLastUse(caster);
  expect(session.effects).toEqual([]);
  expect(session.status(caster).actions).toBe(1);
  expect(library.get(caster.characterSheetId).slotsUsed[0]).toBe(0);
  castArea(grease);
  expect(() => session.endEffect(effect.id)).toThrow();
  session.endEffect(session.effects[0].id);
  expect(session.effects).toEqual([]);
  expect(library.get(caster.characterSheetId).slotsUsed[0]).toBe(1);
});

test('fixed areas survive caster token removal, while caster-following areas do not', () => {
  const grease = addSpell('spell:grease'),
    guardians = addSpell('spell:spirit-guardians');
  castArea(grease);
  castArea(guardians);
  targets = targets.filter((token) => token.id !== caster.id);
  session.forget(caster);
  expect(session.effects.map((effect) => effect.sourceId)).toEqual(['spell:grease']);
});

test('invalid per-target roll records are rejected before persistent spell costs', () => {
  const ray = addSpell('spell:scorching-ray');
  const ticket = session.prepareAction(caster, ray);
  expect(() =>
    session.commitAction(
      ticket,
      '',
      null,
      {
        targets: [{ tokenId: other.id, count: 3 }],
      },
      [{ tokenId: other.id, label: 'Ray', expression: 'invalid', text: 'bad' }]
    )
  ).toThrow();
  expect(library.get(caster.characterSheetId).slotsUsed[1]).toBe(0);
  expect(session.history(caster)).toEqual([]);
});

test('non-unit directions and unsupported saved area fields cannot enter persistent state', () => {
  const grease = addSpell('spell:grease');
  castArea(grease);
  const effect = session.effects[0];
  expect(() =>
    validateAreaEffect({ ...effect, area: { ...effect.area, direction: { x: 10, y: 0, z: 0 } } })
  ).toThrow();
  expect(() =>
    validateAreaEffect({ ...effect, area: { ...effect.area, unknown: true } })
  ).toThrow();
});

test('old combat snapshots without areas remain valid and malformed effects do not partially restore', () => {
  session.startTurn(caster);
  const legacy = session.snapshot();
  delete legacy.effects;
  const restored = new CombatSession({ library });
  restored.restore(legacy, [caster, other]);
  expect(restored.effects).toEqual([]);
  const invalid = { ...legacy, effects: [{ version: 1, id: 'broken' }] };
  expect(() => restored.restore(invalid, [caster, other])).toThrow();
  expect(restored.status(caster).actions).toBe(1);
});
