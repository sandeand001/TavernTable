import { rulesFor } from '../../../src/rules/rulesets.js';
import { validateMovementEffects } from '../../../src/rules/falling.js';

describe.each(['2014', '2024'])('%s falling rules', (edition) => {
  const rules = rulesFor(edition);
  const character = (updates = {}) => ({
    hp: { current: 30 },
    speed: 30,
    classId: 'fighter',
    level: 1,
    conditions: [],
    ...updates,
  });

  test.each([
    [0, 0],
    [5, 0],
    [9.999, 0],
    [9.99999999, 0],
    [10, 1],
    [19.999, 1],
    [20, 2],
    [199.99, 19],
    [200, 20],
    [1000, 20],
  ])('%s feet rolls %s d6', (feet, dice) => {
    expect(rules.fallingDice(feet)).toBe(dice);
  });

  test.each([-1, NaN, Infinity])('rejects invalid distance %s', (feet) => {
    expect(() => rules.fallingDice(feet)).toThrow('distance');
  });

  test('damage causes Prone, but fully avoided damage does not', () => {
    expect(rules.resolveFall({ distanceFeet: 20, rawDamage: 9 })).toMatchObject({
      dice: 2,
      damage: 9,
      prone: true,
    });
    expect(rules.resolveFall({ distanceFeet: 20, rawDamage: 9, reduction: 9 })).toMatchObject({
      damage: 0,
      prone: false,
    });
    expect(rules.resolveFall({ distanceFeet: 20, rawDamage: 9, proneImmune: true })).toMatchObject({
      damage: 9,
      prone: false,
    });
    expect(rules.resolveFall({ distanceFeet: 20, rawDamage: 0, avoidDamage: true })).toMatchObject({
      damage: 0,
      prone: false,
    });
  });

  test('rejects impossible rolls and invalid reductions', () => {
    expect(() => rules.resolveFall({ distanceFeet: 20, rawDamage: 1 })).toThrow('damage roll');
    expect(() => rules.resolveFall({ distanceFeet: 20, rawDamage: 13 })).toThrow('damage roll');
    expect(() => rules.resolveFall({ distanceFeet: 20, rawDamage: 5, reduction: -1 })).toThrow();
  });

  test('flight needs a usable fly speed, unless the creature can hover', () => {
    const flyer = character({ fallTraits: { flySpeed: 30 } });
    expect(rules.fallProtection(flyer).avoidDamage).toBe(true);
    for (const condition of ['prone', 'grappled', 'restrained']) {
      expect(rules.fallProtection({ ...flyer, conditions: [condition] }).avoidDamage).toBe(false);
    }
    expect(rules.fallProtection({ ...flyer, hp: { current: 0 } }).avoidDamage).toBe(false);
    expect(
      rules.fallProtection({
        ...flyer,
        hp: { current: 0 },
        conditions: ['prone'],
        fallTraits: { flySpeed: 30, hover: true },
      }).avoidDamage
    ).toBe(true);
    expect(rules.fallProtection(character({ fallTraits: { hover: true } })).avoidDamage).toBe(
      false
    );
  });

  test('movement-only recovery and incapacitated flight follow the selected edition', () => {
    expect(rules.movementImpaired(character({ conditions: ['incapacitated'] }))).toBe(false);
    expect(rules.movementImpaired(character({ conditions: ['stunned'] }))).toBe(edition === '2014');
    expect(rules.cannotTakeActions(character({ conditions: ['stunned'] }))).toBe(true);
    const flyer = character({ fallTraits: { flySpeed: 30 }, conditions: ['incapacitated'] });
    expect(rules.fallProtection(flyer).avoidDamage).toBe(edition === '2014');
    expect(
      rules.fallProtection(character({ fallTraits: { flySpeed: 30 } }), { ignoreFlight: true })
        .avoidDamage
    ).toBe(false);
    expect(
      rules.fallProtection(character({ fallTraits: { flySpeed: 30, featherFall: true } }), {
        ignoreFlight: true,
      }).avoidDamage
    ).toBe(true);
  });

  test('Feather Fall is an active effect; Slow Fall is a level-gated reaction', () => {
    expect(rules.fallProtection(character({ fallTraits: { featherFall: true } }))).toMatchObject({
      avoidDamage: true,
      featherFall: true,
      reason: 'Feather Fall',
    });
    expect(rules.fallProtection(character({ classId: 'monk', level: 3 })).slowFallReduction).toBe(
      0
    );
    expect(rules.fallProtection(character({ classId: 'monk', level: 4 })).slowFallReduction).toBe(
      20
    );
    expect(rules.fallProtection(character({ classId: 'monk', level: 20 })).slowFallReduction).toBe(
      100
    );
    expect(
      rules.fallProtection(character({ classId: 'monk', level: 8, conditions: ['incapacitated'] }))
        .slowFallReduction
    ).toBe(0);
  });

  test('standing costs half maximum Speed, rounded down, not the remaining allowance', () => {
    expect(rules.standingCost(30)).toBe(15);
    expect(rules.standingCost(31)).toBe(15);
    expect(rules.standingCost(25)).toBe(12);
    expect(() => rules.standingCost(-1)).toThrow('Speed');
  });
});

test('old character records need no migration; malformed new effects fail', () => {
  expect(() => validateMovementEffects({})).not.toThrow();
  expect(() => validateMovementEffects({ conditions: ['prone', 'prone'] })).toThrow();
  expect(() => validateMovementEffects({ conditions: ['unknown'] })).toThrow();
  expect(() => validateMovementEffects({ fallTraits: { flySpeed: NaN } })).toThrow();
  expect(() => validateMovementEffects({ fallTraits: { featherFall: 'yes' } })).toThrow();
  expect(() => validateMovementEffects({ fallTraits: { unexpected: true } })).toThrow();
});
