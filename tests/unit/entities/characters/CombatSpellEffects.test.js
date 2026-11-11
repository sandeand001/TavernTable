import { CharacterLibrary } from '../../../../src/entities/characters/CharacterLibrary.js';
import CombatSession from '../../../../src/entities/characters/CombatSession.js';
import {
  targetingAvailability,
  validateTargetSelection,
} from '../../../../src/rules/targeting/assessment.js';
import { boardDistance } from '../../../../src/rules/targeting/geometry.js';
import classic from '../../../../assets/data/resources/srd-2014-5.1-seed.1.json';
import revised from '../../../../assets/data/resources/srd-2024-5.2.1-seed.1.json';

describe.each([
  ['2014', classic],
  ['2024', revised],
])('%s persistent spell effects', (ruleset, data) => {
  let library, session, caster, recipient, duplicate, tokens;
  const addSpell = (entryId) => {
    const owned = library.add(caster.characterSheetId, entryId);
    library.prepare(caster.characterSheetId, owned, true);
    return `spell:${owned}`;
  };
  const board = () => ({
    tileSize: 1,
    tokens: tokens.map((token) => ({
      ...token,
      name: library.get(token.characterSheetId).name,
      allegiance: 'friendly',
      creatureType: 'humanoid',
      creatureSize: 'medium',
      conditions: [],
      abilities: {},
    })),
    clearPath: () => true,
    clearPoint: () => true,
    clearArea: () => true,
    inside: () => true,
  });
  const select = (token, action, selection) => {
    const current = board();
    const casterRow = current.tokens.find((row) => row.id === token.id);
    const actor = action.effectOrigin ? { ...casterRow, world: action.effectOrigin } : casterRow;
    const result = validateTargetSelection(current, actor, action.targeting, selection);
    if (
      action.spellEffectId &&
      action.casterRangeFeet !== null &&
      boardDistance(casterRow.world, result.origin, current.tileSize) > action.casterRangeFeet
    )
      throw new Error('The destination is too far from the caster');
    return result;
  };
  const use = (id, selection, choice = {}) =>
    session.commitAction(session.prepareAction(caster, id, choice), '', null, selection);
  const nextTurn = async () => {
    if (session.activeToken) await session.endTurn();
    await session.startTurn(caster);
  };

  beforeEach(() => {
    localStorage.clear();
    library = new CharacterLibrary({
      ruleset,
      storage: localStorage,
      catalog: data.entries,
      classes: data.classes,
    });
    caster = {
      id: 'caster',
      characterSheetId: library.create('Caster'),
      world: { x: 0, y: 0, z: 0 },
    };
    recipient = {
      id: 'recipient',
      characterSheetId: library.create('Recipient'),
      world: { x: 1, y: 0, z: 0 },
    };
    duplicate = {
      id: 'duplicate',
      characterSheetId: recipient.characterSheetId,
      world: { x: 2, y: 0, z: 0 },
    };
    tokens = [caster, recipient, duplicate];
    library.edit(caster.characterSheetId, { classId: 'wizard', level: 20 });
    session = new CombatSession({ library, hasToken: (token) => tokens.includes(token) });
    session.targeting = {
      board,
      beginQuery: () => {},
      hasTokenId: (id, characterId = null) =>
        tokens.some(
          (token) =>
            token.id === id && (characterId === null || token.characterSheetId === characterId)
        ),
      availability: (token, action) => {
        const current = board();
        return targetingAvailability(
          current,
          current.tokens.find((row) => row.id === token.id),
          action.targeting
        );
      },
      validate: select,
    };
  });

  test('Moonbeam moves from its old origin, spends one action, preserves its slot/duration and undoes cleanly', async () => {
    const id = addSpell('spell:moonbeam');
    session.startTurn(caster);
    const cast = use(id, { origin: { x: 24, y: 0, z: 0 }, targets: [] }, { slotLevel: 2 });
    const effectId = cast.sequence;
    expect(session.effects[0]).toMatchObject({
      id: effectId,
      remainingTurns: 10,
      area: { origin: { x: 24, y: 0, z: 0 }, size: 1, height: 8 },
    });
    session._state(caster).actions = 1;
    expect(
      session.availableActions(caster).some((action) => action.spellEffectId === effectId)
    ).toBe(false);
    await nextTurn();
    const before = JSON.parse(JSON.stringify(session.effects[0]));
    const slots = [...library.get(caster.characterSheetId).slotsUsed];
    const concentration = library.get(caster.characterSheetId).concentration;
    const move = use(`effect-move:${effectId}`, {
      origin: { x: 36, y: 0, z: 0 },
      targets: [],
    });
    expect(move.kind).toBe('spell-effect');
    expect(move.targetingSelection.origin).toEqual({ x: 36, y: 0, z: 0 });
    expect(session.effects).toHaveLength(1);
    expect(session.effects[0]).toMatchObject({
      id: effectId,
      remainingTurns: 9,
      createdTurn: before.createdTurn,
      area: { origin: { x: 36, y: 0, z: 0 }, size: 1, height: 8 },
    });
    expect(session.status(caster)).toMatchObject({
      actions: 0,
      bonusActions: 1,
      reactions: 1,
      movement: { spent: 0 },
    });
    expect(library.get(caster.characterSheetId).slotsUsed).toEqual(slots);
    expect(library.get(caster.characterSheetId).concentration).toBe(concentration);
    expect(session._state(caster).spellsCast).toEqual([]);
    await session.undoLastUse(caster);
    expect(session.effects).toEqual([before]);
    expect(session.status(caster).actions).toBe(1);
    expect(library.get(caster.characterSheetId).slotsUsed).toEqual(slots);
  });

  test('canceled, out-of-range and stale movement never changes the area or spends an action', async () => {
    const id = addSpell('spell:moonbeam');
    session.startTurn(caster);
    const cast = use(id, { origin: { x: 1, y: 0, z: 0 }, targets: [] });
    await nextTurn();
    const before = JSON.stringify(session.effects);
    const ticket = session.prepareAction(caster, `effect-move:${cast.sequence}`);
    session.cancelAction(ticket);
    expect(JSON.stringify(session.effects)).toBe(before);
    expect(() =>
      use(`effect-move:${cast.sequence}`, {
        origin: { x: 13.01, y: 0, z: 0 },
        targets: [],
      })
    ).toThrow('out of range');
    expect(JSON.stringify(session.effects)).toBe(before);
    expect(session.status(caster).actions).toBe(1);
    const stale = session.prepareAction(caster, `effect-move:${cast.sequence}`);
    library.endConcentration(caster.characterSheetId);
    session.syncEffects();
    expect(() =>
      session.commitAction(stale, '', null, {
        origin: { x: 2, y: 0, z: 0 },
        targets: [],
      })
    ).toThrow();
    expect(session.status(caster).actions).toBe(1);
    expect(session.pending).toBeNull();
  });

  test('the 2024 Magic-action restriction applies to moving Moonbeam without treating it as another cast', async () => {
    const id = addSpell('spell:moonbeam');
    session.startTurn(caster);
    const cast = use(id, { origin: { x: 1, y: 0, z: 0 }, targets: [] });
    await nextTurn();
    Object.assign(session._state(caster), { actions: 1, restrictedActions: 1 });
    expect(
      session.availableActions(caster).some((action) => action.spellEffectId === cast.sequence)
    ).toBe(ruleset === '2014');
  });

  test('Undo cannot resurrect an area that was ended after its movement', async () => {
    const id = addSpell('spell:moonbeam');
    session.startTurn(caster);
    const cast = use(id, { origin: { x: 1, y: 0, z: 0 }, targets: [] });
    await nextTurn();
    use(`effect-move:${cast.sequence}`, { origin: { x: 2, y: 0, z: 0 }, targets: [] });
    session.endEffect(cast.sequence);
    expect(() => session.undoLastUse(caster)).toThrow('ended or changed');
    expect(session.status(caster).actions).toBe(0);
    expect(session.effects).toEqual([]);
  });

  test('Flaming Sphere movement spends a bonus action rather than another spell slot or main action', async () => {
    const id = addSpell('spell:flaming-sphere');
    session.startTurn(caster);
    const cast = use(id, { origin: { x: 1, y: 0, z: 0 }, targets: [] });
    const slots = [...library.get(caster.characterSheetId).slotsUsed];
    use(`effect-move:${cast.sequence}`, { origin: { x: 7, y: 0, z: 0 }, targets: [] });
    expect(session.status(caster)).toMatchObject({ actions: 0, bonusActions: 0, reactions: 1 });
    expect(session.effects[0].remainingTurns).toBe(10);
    expect(library.get(caster.characterSheetId).slotsUsed).toEqual(slots);
  });

  test('recipient reminders are token-specific and never apply Haste statistics or conditions', () => {
    const id = addSpell('spell:haste');
    const before = library.get(recipient.characterSheetId);
    const cast = use(id, {
      targets: [{ tokenId: recipient.id, count: 1 }],
      willingConfirmed: true,
    });
    expect(session.effects).toEqual([
      expect.objectContaining({
        id: cast.sequence,
        kind: 'targets',
        targetTokenIds: [recipient.id],
        remainingTurns: 10,
      }),
    ]);
    expect(library.get(recipient.characterSheetId)).toEqual(before);
    expect(session.movementCharacter(recipient, before).speed).toBe(before.speed);
    session.forget(duplicate);
    expect(session.effects).toHaveLength(1);
    session.forget(recipient);
    expect(session.effects).toEqual([]);
  });

  test('spatial spell effects retain the caster location through combat snapshots', () => {
    session.getLocationId = () => 'remote-location';
    const id = addSpell('spell:mage-hand');
    use(id, { origin: { x: 1, y: 0, z: 0 }, targets: [] });
    expect(session.effects[0].locationId).toBe('remote-location');
    const saved = session.snapshot();
    session.restore(saved, tokens);
    expect(session.effects[0].locationId).toBe('remote-location');
  });

  test('point reminders constrain movement relative to both the old marker and the caster', () => {
    const id = addSpell('spell:mage-hand');
    const cast = use(id, { origin: { x: 1, y: 0, z: 0 }, targets: [] });
    expect(session.effects[0]).toMatchObject({ kind: 'point', remainingTurns: 10 });
    expect(() =>
      use(`effect-move:${cast.sequence}`, {
        origin: { x: 7, y: 0, z: 0 },
        targets: [],
      })
    ).toThrow('caster');
    use(`effect-move:${cast.sequence}`, { origin: { x: 6, y: 0, z: 0 }, targets: [] });
    expect(session.effects[0].origin).toEqual({ x: 6, y: 0, z: 0 });
    expect(library.get(caster.characterSheetId).slotsUsed.every((used) => used === 0)).toBe(true);
  });

  test('recasting Mage Hand replaces its old marker and Undo restores that exact earlier marker', async () => {
    const id = addSpell('spell:mage-hand');
    use(id, { origin: { x: 1, y: 0, z: 0 }, targets: [] });
    const first = JSON.parse(JSON.stringify(session.effects[0]));
    use(id, { origin: { x: 2, y: 0, z: 0 }, targets: [] });
    expect(session.effects).toHaveLength(1);
    expect(session.effects[0].origin.x).toBe(2);
    expect(session.effects[0].id).not.toBe(first.id);
    await session.undoLastUse(caster);
    expect(session.effects).toEqual([first]);
  });

  test('declared-target reminders can be corrected after saves without spending another use', async () => {
    const id = addSpell('spell:bless');
    const cast = use(id, {
      targets: [
        { tokenId: recipient.id, count: 1 },
        { tokenId: duplicate.id, count: 1 },
      ],
    });
    const slots = [...library.get(caster.characterSheetId).slotsUsed];
    await session.removeEffectRecipient(cast.sequence, recipient.id);
    expect(session.effects[0].targetTokenIds).toEqual([duplicate.id]);
    expect(library.get(caster.characterSheetId).concentration).toBe(cast.spellId);
    await session.removeEffectRecipient(cast.sequence, duplicate.id);
    expect(session.effects).toEqual([]);
    expect(library.get(caster.characterSheetId).concentration).toBe('');
    expect(library.get(caster.characterSheetId).slotsUsed).toEqual(slots);
  });

  test('expiry and End spell finish concentration while ending only a visual area keeps the old manual behavior', async () => {
    const id = addSpell('spell:moonbeam');
    session.startTurn(caster);
    const cast = use(id, { origin: { x: 1, y: 0, z: 0 }, targets: [] });
    for (let turn = 0; turn < 9; turn++) await nextTurn();
    expect(session.effects[0].remainingTurns).toBe(1);
    await nextTurn();
    expect(session.effects).toEqual([]);
    expect(library.get(caster.characterSheetId).concentration).toBe('');
    const second = use(id, { origin: { x: 1, y: 0, z: 0 }, targets: [] });
    session.endEffect(second.sequence);
    expect(library.get(caster.characterSheetId).concentration).toBe(second.spellId);
    await nextTurn();
    const third = use(id, { origin: { x: 1, y: 0, z: 0 }, targets: [] });
    await session.endEffect(third.sequence, { endConcentration: true });
    expect(library.get(caster.characterSheetId).concentration).toBe('');
    expect(library.get(caster.characterSheetId).slotsUsed[1]).toBe(3);
    expect(cast.sequence).not.toBe(second.sequence);
  });

  test('indefinite areas and point/recipient effects survive snapshots with no permanent character changes', async () => {
    const hallow = addSpell('spell:hallow');
    use(hallow, { origin: { x: 1, y: 0, z: 0 }, targets: [] });
    expect(session.effects[0]).toMatchObject({ remainingTurns: null });
    for (let turn = 0; turn < 3; turn++) await nextTurn();
    session.endCombat();
    use(addSpell('spell:mage-hand'), { origin: { x: 1, y: 0, z: 0 }, targets: [] });
    use(addSpell('spell:haste'), {
      targets: [{ tokenId: recipient.id, count: 1 }],
      willingConfirmed: true,
    });
    const restored = new CombatSession({ library });
    restored.restore(session.snapshot(), tokens);
    expect(restored.effects).toEqual(session.effects);
    session.endEffect(session.effects[0].id);
    expect(session.effects.map((effect) => effect.kind)).toEqual(['point', 'targets']);
  });
});
