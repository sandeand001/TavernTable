import { targetingProfile } from '../../../src/rules/targeting/profiles.js';
import { characterActionOptions } from '../../../src/entities/characters/combat/actions.js';
import { CharacterLibrary } from '../../../src/entities/characters/CharacterLibrary.js';
import { rulesFor } from '../../../src/rules/rulesets.js';
import { targetStatus } from '../../../src/rules/targeting/assessment.js';
import classic from '../../../assets/data/resources/srd-2014-5.1-seed.1.json';
import revised from '../../../assets/data/resources/srd-2024-5.2.1-seed.1.json';

describe.each([
  ['2014', classic],
  ['2024', revised],
])('%s core spell targeting coverage', (ruleset, data) => {
  const spells = data.entries.filter((entry) => entry.kind === 'spell');
  const character = {
    id: 'caster',
    level: 20,
    spells: spells.map((entry) => ({ id: entry.id, entryId: entry.id })),
  };
  const library = {
    ruleset,
    rules: rulesFor(ruleset),
    catalog: new Map(spells.map((entry) => [entry.id, entry])),
    actions: { snapshot: () => ({}) },
  };
  const profile = (id, slotLevel = null, variant = null) => {
    const entry = library.catalog.get(id);
    return targetingProfile(library, character, {
      id,
      kind: 'spell',
      spellId: id,
      slotLevel: slotLevel ?? entry.level,
      targetingVariant: variant,
      spellConcentration: entry.concentration,
      roll: entry.attackType ? { attack: true } : null,
    });
  };

  test('every core entry has an explicit profile and the registry has no cross-edition leftovers', () => {
    expect(Object.keys(library.rules.spellTargetProfiles).sort()).toEqual(
      spells.map((entry) => entry.id).sort()
    );
  });

  test.each(spells.map((entry) => [entry.id, entry.level]))(
    '%s resolves at its base and maximum casting levels',
    (id, level) => {
      for (const slot of level === 0 ? [0] : [level, 9]) {
        const resolved = profile(id, slot);
        expect(resolved.version).toBe(1);
        if (resolved.kind === 'manual') {
          expect(resolved.reason).not.toContain('No reviewed targeting profile');
          expect(resolved.reason.length).toBeGreaterThan(30);
        } else {
          expect(Number.isFinite(resolved.rangeFeet)).toBe(true);
          for (const variant of resolved.variantOptions)
            expect(profile(id, slot, variant.id).variant).toBe(variant.id);
        }
      }
    }
  );

  test('Moonbeam has an exact persistent cylinder and edition-correct later-turn movement', () => {
    expect(profile('spell:moonbeam')).toMatchObject({
      kind: 'area',
      rangeFeet: 120,
      shape: 'cylinder',
      sizeFeet: 5,
      heightFeet: 40,
      lingerTurns: 10,
      concentration: true,
      durationTarget: 'area',
      movement: {
        distanceFeet: 60,
        cost: 'action',
        magicAction: ruleset === '2024',
        laterTurnsOnly: true,
      },
    });
    expect(profile('spell:moonbeam', 9).sizeFeet).toBe(5);
  });

  test('Flaming Sphere uses a five-foot diameter, not a five-foot radius', () => {
    expect(profile('spell:flaming-sphere')).toMatchObject({
      shape: 'sphere',
      sizeFeet: 2.5,
      lingerTurns: 10,
      movement: { distanceFeet: 30, cost: 'bonus' },
    });
  });

  test('Sleet Storm geometry follows the chosen edition', () => {
    expect(profile('spell:sleet-storm')).toMatchObject({
      shape: 'cylinder',
      sizeFeet: ruleset === '2014' ? 40 : 20,
      heightFeet: ruleset === '2014' ? 20 : 40,
    });
  });

  test('wall, ring and dome choices preserve their exact dimensions', () => {
    expect(profile('spell:wall-of-fire', 4, 'wall')).toMatchObject({
      shape: 'wall',
      sizeFeet: 60,
      widthFeet: 1,
      heightFeet: 20,
    });
    expect(profile('spell:wall-of-fire', 4, 'ring')).toMatchObject({
      shape: 'ring',
      sizeFeet: 10,
      widthFeet: 1,
      heightFeet: 20,
    });
    expect(profile('spell:wall-of-force', 5, 'dome').shape).toBe('hemisphere');
    expect(profile('spell:wall-of-force', 5, 'wall').widthFeet).toBeCloseTo(1 / 48);
    expect(() => profile('spell:wall-of-fire', 4, 'triangle')).toThrow('template');
  });

  test('duration reminders support days and explicit manually ended effects', () => {
    expect(profile('spell:mage-armor')).toMatchObject({
      kind: 'tokens',
      lingerTurns: 4800,
      durationTarget: 'targets',
    });

    expect(profile('spell:geas')).toMatchObject({ lingerTurns: 432000 });
    expect(profile('spell:hallow')).toMatchObject({
      lingerTurns: 0,
      indefiniteDuration: true,
      durationTarget: 'area',
    });
    expect(profile('spell:geas', 9)).toMatchObject({
      lingerTurns: 0,
      indefiniteDuration: true,
      durationLabel: 'Upcast duration: end manually',
    });
  });

  test('higher-slot concentration exceptions stay explicitly manual instead of getting a false timer', () => {
    expect(profile('spell:major-image', ruleset === '2014' ? 5 : 3).kind).toBe('point');
    expect(profile('spell:major-image', ruleset === '2014' ? 6 : 4).kind).toBe('manual');
    expect(profile('spell:bestow-curse', 5).kind).toBe('manual');
    expect(profile('spell:bestow-curse', 4).lingerTurns).toBe(100);
  });

  test('Haste requires explicit willingness rather than inferring it from allegiance', () => {
    expect(profile('spell:haste')).toMatchObject({
      kind: 'tokens',
      requiresWilling: true,
      requiresSight: true,
      lingerTurns: 10,
      durationTarget: 'targets',
    });
  });

  test('Chill Touch uses ranged attacks in 2014 and melee attacks in 2024', () => {
    const resolved = profile('spell:chill-touch');
    const actor = {
      id: 'caster',
      world: { x: 0, y: 0, z: 0 },
      allegiance: 'friendly',
      conditions: [],
      abilities: {},
      creatureType: 'humanoid',
      creatureSize: 'medium',
    };
    const target = { ...actor, id: 'enemy', allegiance: 'hostile', world: { x: 1, y: 0, z: 0 } };
    const status = targetStatus(
      { tokens: [actor, target], tileSize: 1, clearPath: () => true },
      actor,
      target,
      resolved
    );
    expect(resolved.rangeFeet).toBe(ruleset === '2014' ? 120 : 5);
    expect(status.disadvantage).toEqual(ruleset === '2014' ? ['Hostile creature within 5 ft'] : []);
  });

  test('complex multi-origin spells have a specific limitation rather than a misleading single area', () => {
    expect(profile('spell:meteor-swarm')).toMatchObject({ kind: 'manual' });
    expect(profile('spell:meteor-swarm').reason).toContain('four');
    expect(profile('spell:fire-storm').reason).toContain('connected cubes');
    expect(profile('spell:spiritual-weapon').reason).toContain('combined move/attack');
  });
});

test('preparing self and location spells does not roll an unrelated later attack when they are cast', () => {
  localStorage.clear();
  const library = new CharacterLibrary({
    ruleset: '2014',
    storage: localStorage,
    catalog: classic.entries,
    classes: classic.classes,
  });
  const id = library.create('Caster');
  library.edit(id, { classId: 'wizard', level: 10 });
  const owned = library.add(id, 'spell:produce-flame');
  const action = characterActionOptions(library, { id: 'caster', characterSheetId: id }).find(
    (entry) => entry.id === `spell:${owned}`
  );
  expect(action.targeting.kind).toBe('self');
  expect(action.roll).toBeNull();
});
