import { CharacterLibrary } from '../../../../src/entities/characters/CharacterLibrary.js';
import CombatSession from '../../../../src/entities/characters/CombatSession.js';
import {
  targetingAvailability,
  validateTargetSelection,
} from '../../../../src/rules/targeting/assessment.js';
import classic from '../../../../assets/data/resources/srd-2014-5.1-seed.1.json';
import revised from '../../../../assets/data/resources/srd-2024-5.2.1-seed.1.json';

describe.each([
  ['2014', classic],
  ['2024', revised],
])('%s Fly effects', (ruleset, data) => {
  let library, session, caster, recipient, clone, tokens;
  const addSpell = (token, entryId = 'spell:fly') => {
    const owned = library.add(token.characterSheetId, entryId);
    library.prepare(token.characterSheetId, owned, true);
    return `spell:${owned}`;
  };
  const cast = (actionId, recipients = [caster], slotLevel = 3, token = caster) =>
    session.commitAction(session.prepareAction(token, actionId, { slotLevel }), '', null, {
      targets: recipients.map((target) => ({ tokenId: target.id, count: 1 })),
      willingConfirmed: true,
    });
  const effective = (token) =>
    session.movementCharacter(token, library.get(token.characterSheetId));

  beforeEach(() => {
    localStorage.clear();
    library = new CharacterLibrary({
      ruleset,
      storage: localStorage,
      catalog: data.entries,
      classes: data.classes,
    });
    caster = { id: 'caster', characterSheetId: library.create('Caster') };
    recipient = { id: 'recipient', characterSheetId: library.create('Recipient') };
    clone = { id: 'clone', characterSheetId: recipient.characterSheetId };
    library.edit(caster.characterSheetId, { classId: 'wizard', level: 10 });
    tokens = [caster, recipient, clone];
    session = new CombatSession({ library, hasToken: (token) => tokens.includes(token) });
    const board = () => ({
      tokens: tokens.map((token, index) => ({
        id: token.id,
        name: library.get(token.characterSheetId).name,
        world: { x: index * 0.5, y: 0, z: 0 },
        allegiance: 'friendly',
        creatureType: 'humanoid',
        conditions: [],
        abilities: {},
      })),
      tileSize: 1,
      clearPath: () => true,
      clearPoint: () => true,
      clearArea: () => true,
      inside: () => true,
    });
    session.targeting = {
      beginQuery: () => {},
      hasTokenId: (id) => tokens.some((token) => token.id === id),
      availability: (token, action) => {
        const current = board();
        return targetingAvailability(
          current,
          current.tokens.find((row) => row.id === token.id),
          action.targeting
        );
      },
      validate: (token, action, selection) => {
        const current = board();
        return validateTargetSelection(
          current,
          current.tokens.find((row) => row.id === token.id),
          action.targeting,
          selection
        );
      },
    };
  });

  test('Fly grants temporary flight to self after confirmation, without taking off or altering base traits', () => {
    const fly = addSpell(caster);
    session.startTurn(caster);
    const before = library.get(caster.characterSheetId).fallTraits;
    const result = cast(fly);
    expect(result.targetingSelection.targets[0].tokenId).toBe(caster.id);
    expect(session.effects).toEqual([
      expect.objectContaining({
        kind: 'flight',
        id: result.sequence,
        targetTokenIds: [caster.id],
        flySpeed: 60,
        hover: ruleset === '2024',
        magicalSupport: true,
        remainingTurns: 100,
        concentrationSpellId: result.spellId,
      }),
    ]);
    expect(effective(caster).fallTraits).toMatchObject({ flySpeed: 60, hover: ruleset === '2024' });
    expect(library.get(caster.characterSheetId).fallTraits).toEqual(before);
    expect(caster.flightActive).toBeUndefined();
    expect(session.status(caster).actions).toBe(0);
    expect(session.status(caster).movement.base).toBe(30);
    expect(library.get(caster.characterSheetId).slotsUsed[2]).toBe(1);
  });

  test('Fly upcasts to multiple recipients but does not grant flight to another token sharing their character', () => {
    const fly = addSpell(caster);
    cast(fly, [caster, recipient], 4);
    expect(effective(caster).fallTraits.flySpeed).toBe(60);
    expect(effective(recipient).fallTraits.flySpeed).toBe(60);
    expect(effective(clone).fallTraits.flySpeed).toBe(0);
    expect(session.effects[0].targetTokenIds).toEqual([caster.id, recipient.id]);
    expect(library.get(caster.characterSheetId).slotsUsed.slice(2, 4)).toEqual([0, 1]);
  });

  test('cancelled, unwilling and stale Fly casts spend nothing and grant nothing', () => {
    const fly = addSpell(caster);
    session.startTurn(caster);
    session.cancelAction(session.prepareAction(caster, fly));
    const unwilling = session.prepareAction(caster, fly);
    expect(() =>
      session.commitAction(unwilling, '', null, {
        targets: [{ tokenId: caster.id, count: 1 }],
        willingConfirmed: false,
      })
    ).toThrow('willing');
    const stale = session.prepareAction(caster, fly);
    library.edit(caster.characterSheetId, { level: 9 });
    expect(() =>
      session.commitAction(stale, '', null, {
        targets: [{ tokenId: caster.id, count: 1 }],
        willingConfirmed: true,
      })
    ).toThrow('changed');
    expect(session.effects).toEqual([]);
    expect(library.get(caster.characterSheetId).slotsUsed.every((used) => used === 0)).toBe(true);
    expect(session.status(caster).actions).toBe(1);
    expect(session.history(caster)).toEqual([]);
  });

  test('Fly cannot consume a slot without a confirmed creature selection even without a targeting service', () => {
    const fly = addSpell(caster);
    session.targeting = null;
    expect(() => session.useAction(caster, fly)).toThrow('target');
    expect(library.get(caster.characterSheetId).slotsUsed[2]).toBe(0);
    expect(session.effects).toEqual([]);
  });

  test('natural flying speed and Hover survive ending the temporary Fly source', () => {
    const fly = addSpell(caster);
    library.edit(recipient.characterSheetId, { fallTraits: { flySpeed: 90, hover: true } });
    cast(fly, [recipient]);
    expect(effective(recipient).fallTraits).toMatchObject({ flySpeed: 90, hover: true });
    library.edit(recipient.characterSheetId, { fallTraits: { flySpeed: 40, hover: false } });
    expect(effective(recipient).fallTraits.flySpeed).toBe(60);
    library.endConcentration(caster.characterSheetId);
    session.syncEffects();
    expect(effective(recipient).fallTraits).toMatchObject({ flySpeed: 40, hover: false });
    expect(library.get(recipient.characterSheetId).fallTraits).toMatchObject({
      flySpeed: 40,
      hover: false,
    });
  });

  test('magical support in 2014 and explicit Hover in 2024 keep recipients aloft when Prone or unable to move', () => {
    cast(addSpell(caster), [recipient]);
    for (const conditions of [['prone'], ['grappled'], ['unconscious']]) {
      library.edit(recipient.characterSheetId, { conditions });
      expect(library.rules.canRemainAirborne(effective(recipient))).toBe(true);
      expect(library.rules.flightAvailability(effective(recipient)).allowed).toBe(false);
    }
    library.endConcentration(caster.characterSheetId);
    session.syncEffects();
    expect(library.rules.canRemainAirborne(effective(recipient))).toBe(false);
  });

  test('ending one caster’s concentration retains another active Fly source', () => {
    library.edit(recipient.characterSheetId, { classId: 'wizard', level: 10 });
    cast(addSpell(caster), [clone]);
    cast(addSpell(recipient), [clone], 3, recipient);
    library.endConcentration(caster.characterSheetId);
    session.syncEffects();
    expect(session.effects).toHaveLength(1);
    expect(effective(clone).fallTraits.flySpeed).toBe(60);
    library.endConcentration(recipient.characterSheetId);
    expect(effective(clone).fallTraits.flySpeed).toBe(0);
  });

  test('recasting replaces the caster’s old recipients and Undo restores the previous grant', () => {
    const fly = addSpell(caster);
    cast(fly, [recipient]);
    const original = JSON.parse(JSON.stringify(session.effects[0]));
    cast(fly, [caster]);
    expect(effective(recipient).fallTraits.flySpeed).toBe(0);
    expect(effective(caster).fallTraits.flySpeed).toBe(60);
    session.undoLastUse(caster);
    expect(session.effects).toEqual([original]);
    expect(effective(recipient).fallTraits.flySpeed).toBe(60);
    expect(effective(caster).fallTraits.flySpeed).toBe(0);
    expect(library.get(caster.characterSheetId).slotsUsed[2]).toBe(1);
  });

  test('replacing Fly with a concentration area removes the grant, and Undo restores it', () => {
    const fly = addSpell(caster);
    const fog = addSpell(caster, 'spell:fog-cloud');
    cast(fly, [recipient]);
    const original = JSON.parse(JSON.stringify(session.effects[0]));
    session.commitAction(session.prepareAction(caster, fog), '', null, {
      origin: { x: 3, y: 0, z: 0 },
      targets: [],
    });
    expect(effective(recipient).fallTraits.flySpeed).toBe(0);
    expect(session.effects[0].area.shape).toBe('sphere');
    session.undoLastUse(caster);
    expect(session.effects).toEqual([original]);
    expect(effective(recipient).fallTraits.flySpeed).toBe(60);
  });

  test('Fly lasts exactly 100 later caster turns, not recipient turns, and ends concentration on expiry', async () => {
    const fly = addSpell(caster);
    session.startTurn(caster);
    cast(fly, [recipient]);
    session.endTurn();
    for (let tick = 1; tick <= 100; tick++) {
      await session.startTurn(recipient);
      session.endTurn();
      expect(session.effects[0].remainingTurns).toBe(101 - tick);
      await session.startTurn(caster);
      if (tick < 100) {
        expect(session.effects[0].remainingTurns).toBe(100 - tick);
        session.endTurn();
      }
    }
    expect(session.effects).toEqual([]);
    expect(library.get(caster.characterSheetId).concentration).toBe('');
    expect(effective(recipient).fallTraits.flySpeed).toBe(0);
    expect(session.status(caster).actions).toBe(1);
  });

  test('ending Fly manually removes the grant and concentration, but does not refund casting costs', async () => {
    cast(addSpell(caster), [recipient]);
    await session.endEffect(session.effects[0].id);
    expect(session.effects).toEqual([]);
    expect(library.get(caster.characterSheetId)).toMatchObject({
      concentration: '',
      slotsUsed: [0, 0, 1, 0, 0, 0, 0, 0, 0],
    });
    expect(effective(recipient).fallTraits.flySpeed).toBe(0);
  });

  test('Fly survives combat ending and restores by token identity without becoming a character trait', () => {
    cast(addSpell(caster), [recipient]);
    session.endCombat();
    const saved = session.snapshot();
    const restored = new CombatSession({ library });
    restored.restore(saved, tokens);
    expect(
      restored.movementCharacter(recipient, library.get(recipient.characterSheetId)).fallTraits
        .flySpeed
    ).toBe(60);
    const copiedId = library.import(library.export(recipient.characterSheetId));
    expect(library.get(copiedId).fallTraits.flySpeed).toBe(0);
  });

  test('removing a recipient only removes its grant; removing the caster clears the whole Fly source', () => {
    cast(addSpell(caster), [caster, recipient], 4);
    tokens = tokens.filter((token) => token !== recipient);
    session.forget(recipient);
    expect(session.effects[0].targetTokenIds).toEqual([caster.id]);
    tokens = tokens.filter((token) => token !== caster);
    session.forget(caster);
    expect(session.effects).toEqual([]);
  });

  test('malformed or orphaned saved Fly grants are rejected without partially restoring combat', () => {
    cast(addSpell(caster), [recipient]);
    const saved = session.snapshot();
    const restored = new CombatSession({ library });
    const effect = saved.effects[0];
    for (const patch of [
      { flySpeed: 0 },
      { hover: 'yes' },
      { magicalSupport: 'yes' },
      { targetTokenIds: [recipient.id, recipient.id] },
      { targetTokenIds: ['missing'] },
      { casterTokenId: 'missing' },
      { concentrationSpellId: 'missing' },
      { unknown: true },
    ]) {
      expect(() =>
        restored.restore({ ...saved, effects: [{ ...effect, ...patch }] }, tokens)
      ).toThrow();
      expect(restored.effects).toEqual([]);
    }
    restored.restore(saved, tokens);
    expect(restored.effects).toEqual(saved.effects);
  });
});
