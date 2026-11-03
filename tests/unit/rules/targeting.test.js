import { CharacterLibrary } from '../../../src/entities/characters/CharacterLibrary.js';
import { characterActionOptions } from '../../../src/entities/characters/combat/actions.js';
import {
  boardDistance,
  clearSegment,
  areaPlacement,
  inArea,
  targetRelation,
} from '../../../src/rules/targeting/geometry.js';
import {
  targetStatus,
  targetingAvailability,
  validateTargetSelection,
} from '../../../src/rules/targeting/assessment.js';
import {
  validateTargetingProfile,
  weaponEntryProfile,
} from '../../../src/rules/targeting/profiles.js';
import { rulesFor } from '../../../src/rules/rulesets.js';
import classic from '../../../assets/data/resources/srd-2014-5.1-seed.1.json';
import revised from '../../../assets/data/resources/srd-2024-5.2.1-seed.1.json';

const token = (id, x = 0, y = 0, z = 0, allegiance = 'friendly') => ({
  id,
  name: id,
  world: { x, y, z },
  allegiance,
  creatureType: 'humanoid',
  conditions: [],
  abilities: { strength: 15, dexterity: 15 },
});
const board = (tokens, clear = true) => ({
  tokens,
  tileSize: 1,
  inside: () => true,
  clearPath: () => clear,
  clearPoint: () => clear,
  clearArea: () => clear,
});

describe.each([
  ['2014', classic],
  ['2024', revised],
])('%s target rules', (ruleset, data) => {
  let library, character, actor;
  beforeEach(() => {
    localStorage.clear();
    library = new CharacterLibrary({
      ruleset,
      storage: localStorage,
      catalog: data.entries,
      classes: data.classes,
    });
    const id = library.create('Caster');
    library.edit(id, { classId: 'wizard', level: 10, abilities: { intelligence: 18 } });
    character = library.get(id);
    actor = token('caster');
  });
  const spell = (id, slotLevel = null) => {
    const owned = library.add(character.id, id);
    library.prepare(character.id, owned, true);
    const choices = slotLevel === null ? {} : { [`spell:${owned}`]: { slotLevel } };
    return characterActionOptions(library, { characterSheetId: character.id }, choices).find(
      (action) => action.id === `spell:${owned}`
    );
  };

  test('Fly targets willing creatures within Touch range, including self, and upcasts one extra target per level', () => {
    const profile = spell('spell:fly', 3).targeting;
    expect(profile).toMatchObject({
      kind: 'tokens',
      rangeFeet: 5,
      maxTargets: 1,
      minTargets: 1,
      requiresWilling: true,
      concentration: true,
      lingerTurns: 100,
      flightGrant: { flySpeed: 60, hover: ruleset === '2024', magicalSupport: true },
    });
    const ally = token('ally', 1);
    const distant = token('distant', 0, 1.01);
    const env = board([actor, ally, distant]);
    expect(
      targetingAvailability(env, actor, profile).candidates.map((target) => target.tokenId)
    ).toEqual(['caster', 'ally']);
    expect(() =>
      validateTargetSelection(env, actor, profile, {
        targets: [{ tokenId: ally.id, count: 1 }],
      })
    ).toThrow('willing');
    const self = validateTargetSelection(env, actor, profile, {
      targets: [{ tokenId: actor.id, count: 1 }],
      willingConfirmed: true,
    });
    expect(self).toMatchObject({ willingConfirmed: true, targets: [{ tokenId: actor.id }] });
    const upcast = spell('spell:fly', 4).targeting;
    expect(upcast.maxTargets).toBe(2);
    expect(
      validateTargetSelection(env, actor, upcast, {
        targets: [
          { tokenId: actor.id, count: 1 },
          { tokenId: ally.id, count: 1 },
        ],
        willingConfirmed: true,
      }).targets
    ).toHaveLength(2);
    expect(targetStatus(env, actor, distant, upcast).allowed).toBe(false);
    ally.allegiance = 'hostile';
    expect(
      validateTargetSelection(env, actor, profile, {
        targets: [{ tokenId: ally.id, count: 1 }],
        willingConfirmed: true,
      }).targets[0].relation
    ).toBe('hostile');
  });

  test('normal, long and beyond-maximum weapon distances are distinct', () => {
    const profile = weaponEntryProfile(library.catalog.get('item:longbow'), rulesFor(ruleset));
    const normal = token('normal', 30),
      long = token('long', 31),
      tooFar = token('far', 121);
    const env = board([actor, normal, long, tooFar]);
    expect(targetStatus(env, actor, normal, profile, 'ranged')).toMatchObject({
      allowed: true,
      distance: 150,
      disadvantage: [],
    });
    expect(targetStatus(env, actor, long, profile, 'ranged').disadvantage).toContain('Long range');
    expect(targetStatus(env, actor, tooFar, profile, 'ranged').allowed).toBe(false);
  });

  test('close friendly creatures do not impose ranged disadvantage; active hostiles do', () => {
    const profile = weaponEntryProfile(library.catalog.get('item:longbow'), rulesFor(ruleset));
    const target = token('target', 8, 0, 0, 'hostile'),
      ally = token('ally', 1);
    expect(targetStatus(board([actor, target, ally]), actor, target, profile).disadvantage).toEqual(
      []
    );
    ally.allegiance = 'hostile';
    expect(
      targetStatus(board([actor, target, ally]), actor, target, profile).disadvantage
    ).toContain('Hostile creature within 5 ft');
    ally.conditions = ['incapacitated'];
    expect(targetStatus(board([actor, target, ally]), actor, target, profile).disadvantage).toEqual(
      []
    );
  });

  test('daggers offer separate melee and thrown distances; lance close penalties are edition-specific', () => {
    const dagger = weaponEntryProfile(library.catalog.get('item:dagger'), rulesFor(ruleset));
    expect(dagger.modes).toContainEqual({ id: 'thrown', normal: 20, long: 60 });
    const enemy = token('enemy', 4, 0, 0, 'hostile');
    expect(targetingAvailability(board([actor, enemy]), actor, dagger).allowed).toBe(true);
    expect(targetStatus(board([actor, enemy]), actor, enemy, dagger, 'melee').allowed).toBe(false);
    const lance = weaponEntryProfile(library.catalog.get('item:lance'), rulesFor(ruleset));
    expect(lance.closeDisadvantage).toBe(ruleset === '2014' ? 5 : 0);
  });

  test('reach and magical variants preserve their base weapon’s targeting rules', () => {
    const lance = weaponEntryProfile(library.catalog.get('enhanced:lance:1'), rulesFor(ruleset));
    const dagger = weaponEntryProfile(library.catalog.get('enhanced:dagger:1'), rulesFor(ruleset));
    expect(lance.modes[0]).toEqual({ id: 'melee', normal: 10, long: 10 });
    expect(lance.closeDisadvantage).toBe(ruleset === '2014' ? 5 : 0);
    expect(dagger.modes).toContainEqual({ id: 'thrown', normal: 20, long: 60 });
  });

  test('heavy weapon penalties use creature size in 2014 and effective attributes in 2024', () => {
    const bow = weaponEntryProfile(library.catalog.get('item:longbow'), rulesFor(ruleset));
    const enemy = token('enemy', 10, 0, 0, 'hostile');
    actor.creatureSize = 'small';
    const initial = targetStatus(board([actor, enemy]), actor, enemy, bow);
    expect(initial.disadvantage.length).toBe(ruleset === '2014' ? 1 : 0);
    actor.creatureSize = 'medium';
    actor.abilities.dexterity = 12;
    const lowDex = targetStatus(board([actor, enemy]), actor, enemy, bow);
    expect(lowDex.disadvantage.length).toBe(ruleset === '2024' ? 1 : 0);
  });

  test('attacks require another viable target, while an empty AOE can still be placed', () => {
    const weapon = validateTargetingProfile({
      version: 1,
      kind: 'tokens',
      rangeFeet: 5,
      attack: true,
    });
    expect(targetingAvailability(board([actor]), actor, weapon).allowed).toBe(false);
    const fireball = spell('spell:fireball', 3).targeting;
    const selection = validateTargetSelection(board([actor]), actor, fireball, {
      origin: { x: 10, y: 0, z: 0 },
      targets: [],
    });
    expect(selection.targets).toEqual([]);
    expect(selection.area).toMatchObject({ shape: 'sphere', size: 4 });
  });

  test('Fire Bolt at 30 feet has no distance penalty, but a hostile within 5 feet of the caster imposes disadvantage', () => {
    const profile = spell('spell:fire-bolt').targeting;
    const distant = token('distant', 6, 0, 0, 'hostile');
    const adjacent = token('adjacent', 1, 0, 0, 'hostile');
    expect(targetStatus(board([actor, distant]), actor, distant, profile)).toMatchObject({
      allowed: true,
      distance: 30,
      disadvantage: [],
    });
    expect(targetStatus(board([actor, distant, adjacent]), actor, distant, profile)).toMatchObject({
      allowed: true,
      distance: 30,
      disadvantage: ['Hostile creature within 5 ft'],
    });
    adjacent.world.x = 2;
    expect(
      targetStatus(board([actor, distant, adjacent]), actor, distant, profile).disadvantage
    ).toEqual([]);
    adjacent.world.x = 1;
    adjacent.allegiance = 'friendly';
    expect(
      targetStatus(board([actor, distant, adjacent]), actor, distant, profile).disadvantage
    ).toEqual([]);
  });

  test('Grapple and Shove require a different creature in reach and no more than one size larger', () => {
    const action = characterActionOptions(library, { characterSheetId: character.id }).find(
      (entry) => entry.id === 'grapple'
    );
    expect(action.targeting).toMatchObject({ kind: 'tokens', rangeFeet: 5 });
    const enemy = { ...token('enemy', 1), creatureSize: 'huge' };
    expect(targetStatus(board([actor, enemy]), actor, actor, action.targeting).allowed).toBe(false);
    expect(targetStatus(board([actor, enemy]), actor, enemy, action.targeting).allowed).toBe(false);
    enemy.creatureSize = 'large';
    expect(targetStatus(board([actor, enemy]), actor, enemy, action.targeting).allowed).toBe(true);
    enemy.world.x = 2;
    expect(targetStatus(board([actor, enemy]), actor, enemy, action.targeting).allowed).toBe(false);
    expect(action.roll?.expression || null).toEqual(
      ruleset === '2014' ? expect.stringContaining('1d20') : null
    );
  });

  test('Magic Missile supports upcast projectile allocation without fake extra targets', () => {
    const profile = spell('spell:magic-missile', 2).targeting;
    expect(profile).toMatchObject({ maxTargets: 4, allowRepeat: true });
    const a = token('a', 4),
      b = token('b', 5);
    const env = board([actor, a, b]);
    expect(
      validateTargetSelection(env, actor, profile, {
        targets: [
          { tokenId: 'a', count: 3 },
          { tokenId: 'b', count: 1 },
        ],
      }).targets
    ).toHaveLength(2);
    expect(() =>
      validateTargetSelection(env, actor, profile, { targets: [{ tokenId: 'a', count: 5 }] })
    ).toThrow('at most 4');
  });

  test('a multi-projectile spell requires all its projectiles to be allocated before confirmation', () => {
    const profile = spell('spell:magic-missile', 1).targeting;
    const enemy = token('enemy', 5);
    const env = board([actor, enemy]);
    expect(() =>
      validateTargetSelection(env, actor, profile, { targets: [{ tokenId: enemy.id, count: 1 }] })
    ).toThrow('at least 3');
    expect(
      validateTargetSelection(env, actor, profile, { targets: [{ tokenId: enemy.id, count: 3 }] })
        .targets[0].count
    ).toBe(3);
  });

  test('Acid Splash and Sleep use their own edition’s target mechanics', () => {
    const acid = spell('spell:acid-splash').targeting;
    const sleep = spell('spell:sleep', 1).targeting;
    if (ruleset === '2014') {
      expect(acid).toMatchObject({ kind: 'tokens', maxTargets: 2, spreadFeet: 5 });
      expect(sleep).toMatchObject({ rangeFeet: 90, sizeFeet: 20 });
    } else {
      expect(acid).toMatchObject({ kind: 'area', shape: 'sphere', sizeFeet: 5 });
      expect(sleep).toMatchObject({ rangeFeet: 60, sizeFeet: 5, concentration: true });
    }
    expect(sleep.lingerTurns).toBe(0);
  });

  test('Hold Person spread limits and Spirit Guardians shapes do not leak across editions', () => {
    const hold = spell('spell:hold-person', 3).targeting;
    expect(hold.spreadFeet).toBe(ruleset === '2014' ? 30 : null);
    expect(spell('spell:spirit-guardians', 3).targeting).toMatchObject({
      shape: ruleset === '2014' ? 'sphere' : 'emanation',
      lingerTurns: 100,
      followCaster: true,
    });
    expect(spell('spell:ice-storm', 4).targeting).toMatchObject({ lingerTurns: 1, expiry: 'end' });
  });
});

test('distance accounts for altitude and normal five-foot grid diagonals', () => {
  expect(boardDistance({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }, 1)).toBe(5);
  expect(boardDistance({ x: 0, y: 0, z: 0 }, { x: 1, y: 3, z: 1 }, 1)).toBe(15);
});

test('terrain/structure cover uses a real finite segment and does not block shots above it', () => {
  const wall = { min: { x: 2, y: 0, z: -1 }, max: { x: 3, y: 2, z: 1 } };
  expect(clearSegment({ x: 0, y: 1, z: 0 }, { x: 5, y: 1, z: 0 }, [wall])).toBe(false);
  expect(clearSegment({ x: 0, y: 3, z: 0 }, { x: 5, y: 3, z: 0 }, [wall])).toBe(true);
});

test.each([
  ['sphere', { x: 3, y: 0, z: 0 }, true],
  ['sphere', { x: 5, y: 0, z: 0 }, false],
  ['cone', { x: 3, y: 0, z: 1 }, true],
  ['cone', { x: -1, y: 0, z: 0 }, false],
  ['line', { x: 3, y: 0, z: 0.4 }, true],
  ['line', { x: 3, y: 0, z: 1 }, false],
  ['cylinder', { x: 2, y: 7, z: 0 }, true],
  ['cylinder', { x: 2, y: 9, z: 0 }, false],
])('%s area membership matches the preview geometry', (shape, point, expected) => {
  const profile = validateTargetingProfile({
    version: 1,
    kind: 'area',
    rangeFeet: 60,
    shape,
    sizeFeet: 20,
    widthFeet: 5,
    heightFeet: 40,
  });
  const actor = token('a'),
    placement = areaPlacement(
      profile,
      actor,
      { origin: { x: 0, y: 0, z: 0 }, aim: { x: 1, y: 0, z: 0 } },
      1
    );
  expect(inArea(point, placement)).toBe(expected);
});

test('tags classify allies and enemies relative to the acting side', () => {
  expect(targetRelation(token('a'), token('b'))).toBe('friendly');
  expect(targetRelation(token('a', 0, 0, 0, 'hostile'), token('b', 0, 0, 0, 'hostile'))).toBe(
    'friendly'
  );
  expect(targetRelation(token('a'), token('b', 0, 0, 0, 'hostile'))).toBe('hostile');
});

test.each([
  { unknown: true },
  {
    modes: [
      { id: 'ranged', normal: 30, long: 60 },
      { id: 'ranged', normal: 30, long: 60 },
    ],
  },
  { modes: [{ id: 'custom', normal: 30, long: 60 }] },
  { modes: [{ id: 'ranged', normal: 30, long: 60, unknown: true }] },
  { minRangeFeet: 61 },
  { shape: 'sphere', sizeFeet: 20 },
  { allowExclusions: true },
  { lingerTurns: 10 },
])('malformed or incompatible profile fields are rejected: %j', (extra) => {
  expect(() =>
    validateTargetingProfile({
      version: 1,
      kind: 'tokens',
      rangeFeet: 60,
      attack: true,
      ...extra,
    })
  ).toThrow();
});

test('an explicitly configured minimum range disables too-close targets, without changing normal D&D ranged weapons', () => {
  const actor = token('a'),
    near = token('near', 1),
    valid = token('valid', 4);
  const profile = validateTargetingProfile({
    version: 1,
    kind: 'tokens',
    rangeFeet: 60,
    minRangeFeet: 20,
  });
  expect(targetStatus(board([actor, near, valid]), actor, near, profile).allowed).toBe(false);
  expect(targetStatus(board([actor, near, valid]), actor, valid, profile).allowed).toBe(true);
});

test('missing or vertical cube aim uses the caster’s facing and cannot cover the entire board', () => {
  const actor = { ...token('a'), facingAngle: Math.PI / 2 };
  const profile = validateTargetingProfile({
    version: 1,
    kind: 'area',
    rangeFeet: 0,
    anchor: 'caster',
    shape: 'cube',
    sizeFeet: 15,
  });
  const facing = areaPlacement(profile, actor, {}, 1);
  expect(facing.direction.x).toBeCloseTo(0);
  expect(facing.direction.z).toBeCloseTo(-1);
  const vertical = areaPlacement(profile, actor, { aim: { x: 0, y: 10, z: 0 } }, 1);
  expect(inArea({ x: 100, y: 1, z: 100 }, vertical)).toBe(false);
});

test('a five-foot-wide line includes the corners shown by its square cross-section', () => {
  const area = {
    shape: 'line',
    origin: { x: 0, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    size: 20,
    width: 1,
    height: 1,
  };
  expect(inArea({ x: 3, y: 0.45, z: 0.45 }, area)).toBe(true);
  expect(inArea({ x: 3, y: 0.51, z: 0 }, area)).toBe(false);
});
