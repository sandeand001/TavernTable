import { FALL_TRAITS_DEFAULTS, MOVEMENT_CONDITIONS } from '../config/TokenMovementConfig.js';
import { edition } from './editions.js';

// -- Falling and recovery --
export function fallingDice(distanceFeet) {
  if (!Number.isFinite(distanceFeet) || distanceFeet < 0) {
    throw new Error('Fall distance must be a finite, non-negative number of feet');
  }
  return Math.min(20, Math.floor((distanceFeet + Number.EPSILON * distanceFeet) / 10));
}

export function standingCost(speed) {
  if (!Number.isFinite(speed) || speed < 0) {
    throw new Error('Standing requires a finite, non-negative Speed');
  }
  return Math.floor(speed / 2);
}

export function movementImpaired(character, { ruleset = '2014' } = {}) {
  edition(ruleset);
  const conditions = character.conditions || [];
  return (
    character.hp.current === 0 ||
    conditions.some(
      (condition) =>
        ['grappled', 'restrained', 'unconscious', 'paralyzed', 'petrified'].includes(condition) ||
        (condition === 'stunned' && ruleset === '2014')
    )
  );
}

export function cannotTakeActions(character) {
  return (
    character.hp.current === 0 ||
    (character.conditions || []).some((condition) =>
      ['incapacitated', 'unconscious', 'paralyzed', 'petrified', 'stunned'].includes(condition)
    )
  );
}

export function canRemainAirborne(character, { ruleset = '2014' } = {}) {
  edition(ruleset);
  const traits = { ...FALL_TRAITS_DEFAULTS, ...character.fallTraits };
  if (!Number.isFinite(traits.flySpeed) || traits.flySpeed < 0) {
    throw new Error('Flying speed must be a finite, non-negative number of feet');
  }
  return (
    traits.flySpeed > 0 &&
    (traits.hover ||
      (!movementImpaired(character, { ruleset }) &&
        !(character.conditions || []).includes('prone') &&
        !(ruleset === '2024' && cannotTakeActions(character))))
  );
}

export function fallProtection(character, { ignoreFlight = false, ruleset = '2014' } = {}) {
  if (typeof ignoreFlight !== 'boolean') {
    throw new Error('Flight protection must be explicitly enabled or relinquished');
  }
  const traits = { ...FALL_TRAITS_DEFAULTS, ...character.fallTraits };
  const cannotReact = cannotTakeActions(character);
  const flight = !ignoreFlight && canRemainAirborne(character, { ruleset });
  return {
    avoidDamage: traits.featherFall || flight,
    reason: traits.featherFall ? 'Feather Fall' : flight ? 'Flight' : '',
    featherFall: traits.featherFall,
    reduction: traits.fallDamageReduction,
    proneImmune: traits.proneImmune,
    slowFallReduction:
      !cannotReact && character.classId === 'monk' && character.level >= 4
        ? 5 * character.level
        : 0,
  };
}

export function resolveFall({
  distanceFeet,
  rawDamage,
  reduction = 0,
  avoidDamage = false,
  proneImmune = false,
}) {
  const dice = fallingDice(distanceFeet);
  if (
    !Number.isInteger(rawDamage) ||
    rawDamage < (avoidDamage ? 0 : dice) ||
    rawDamage > (avoidDamage ? 0 : dice * 6) ||
    !Number.isInteger(reduction) ||
    reduction < 0 ||
    reduction > 1000000 ||
    typeof avoidDamage !== 'boolean' ||
    typeof proneImmune !== 'boolean'
  ) {
    throw new Error('Falling requires a valid damage roll and explicit protections');
  }
  const damage = avoidDamage ? 0 : Math.max(0, rawDamage - reduction);
  return { distanceFeet, dice, rawDamage, reduction, damage, prone: damage > 0 && !proneImmune };
}

// -- Saved movement effects --
export function validateMovementEffects(character) {
  if (
    character.conditions !== undefined &&
    (!Array.isArray(character.conditions) ||
      new Set(character.conditions).size !== character.conditions.length ||
      character.conditions.some((condition) => !MOVEMENT_CONDITIONS.includes(condition)))
  ) {
    throw new Error('Character movement conditions are invalid');
  }
  const traits = character.fallTraits;
  if (traits !== undefined) {
    if (
      !traits ||
      typeof traits !== 'object' ||
      Array.isArray(traits) ||
      Object.keys(traits).some((key) => !(key in FALL_TRAITS_DEFAULTS)) ||
      ['flySpeed', 'fallDamageReduction'].some(
        (key) =>
          traits[key] !== undefined &&
          (!Number.isInteger(traits[key]) || traits[key] < 0 || traits[key] > 1000)
      ) ||
      ['hover', 'featherFall', 'proneImmune'].some(
        (key) => traits[key] !== undefined && typeof traits[key] !== 'boolean'
      )
    ) {
      throw new Error('Character fall protections are invalid');
    }
  }
  const fall = character.lastFall;
  if (
    fall !== undefined &&
    (!fall ||
      typeof fall !== 'object' ||
      Array.isArray(fall) ||
      typeof fall.id !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,299}$/.test(fall.id) ||
      typeof fall.featherFall !== 'boolean' ||
      typeof fall.avoidDamage !== 'boolean' ||
      typeof fall.prone !== 'boolean' ||
      Object.keys(fall).some(
        (key) =>
          ![
            'id',
            'distanceFeet',
            'dice',
            'rawDamage',
            'reduction',
            'damage',
            'prone',
            'featherFall',
            'avoidDamage',
          ].includes(key)
      ))
  ) {
    throw new Error('The saved fall result is invalid');
  }
  if (fall !== undefined) {
    const resolved = resolveFall({ ...fall, proneImmune: !fall.prone });
    if (
      resolved.dice !== fall.dice ||
      resolved.damage !== fall.damage ||
      resolved.prone !== fall.prone
    ) {
      throw new Error('The saved fall damage is inconsistent');
    }
  }
}
