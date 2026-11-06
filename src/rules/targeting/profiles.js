import {
  THROWN_WEAPON_RANGES,
  TARGET_AREA_SHAPES,
  TARGET_CREATURE_TYPES,
  TARGETING_LIMITS,
} from '../../config/targeting/SpellProfiles.js';
import { edition } from '../editions.js';

const integer = (value, minimum, maximum) =>
  Number.isInteger(value) && value >= minimum && value <= maximum;
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const MAX_RANGE = TARGETING_LIMITS.rangeFeet;
const MAX_TURNS = TARGETING_LIMITS.durationTurns;
const positive = (value, max) => Number.isFinite(value) && value > 0 && value <= max;

export function validateEffectMovement(movement) {
  if (
    !record(movement) ||
    !positive(movement.distanceFeet, MAX_RANGE) ||
    !['action', 'bonus'].includes(movement.cost) ||
    typeof movement.magicAction !== 'boolean' ||
    (movement.laterTurnsOnly !== undefined && typeof movement.laterTurnsOnly !== 'boolean') ||
    (movement.casterRangeFeet !== null && !positive(movement.casterRangeFeet, MAX_RANGE)) ||
    Object.keys(movement).some(
      (key) =>
        !['distanceFeet', 'cost', 'magicAction', 'casterRangeFeet', 'laterTurnsOnly'].includes(key)
    )
  )
    throw new Error('Spell effect movement has invalid distance or action cost');
  return movement;
}

function spellRange(entry) {
  const range = entry.range.trim();
  if (/^self$/i.test(range)) return 0;
  if (/^touch$/i.test(range)) return 5;
  const value = /^(\d+(?:\.\d+)?)\s+(feet|foot|miles?|mile)$/i.exec(range);
  if (!value) throw new Error(`The reviewed ${entry.name} profile needs an explicit range`);
  return Number(value[1]) * (/mile/i.test(value[2]) ? 5280 : 1);
}

function spellDuration(entry, spec, slot) {
  if (!spec.durationFromSpell)
    return { turns: spec.lingerTurns || 0, label: spec.durationLabel || '' };
  const override = spec.durationTurnsBySlot?.[slot];
  if (override !== undefined) {
    if (!integer(override, 1, MAX_TURNS))
      throw new Error('The reviewed upcast duration is invalid');
    return { turns: override, label: `${override} caster turns` };
  }
  if (spec.manualUpcastDuration && slot > entry.level)
    return { turns: 0, indefinite: true, label: 'Upcast duration: end manually' };
  const duration = entry.duration.trim();
  if (/^instantaneous$/i.test(duration)) return { turns: 0, label: duration };
  if (/^until dispelled\b/i.test(duration) || /^special$/i.test(duration))
    return { turns: 0, indefinite: true, label: `${duration} (end manually)` };
  const timed = /^(?:up to\s+)?(\d+)\s+(round|minute|hour|day)s?$/i.exec(duration);
  if (!timed) throw new Error(`The reviewed ${entry.name} profile needs an explicit duration`);
  const turns =
    Number(timed[1]) * { round: 1, minute: 10, hour: 600, day: 14400 }[timed[2].toLowerCase()];
  if (!integer(turns, 1, MAX_TURNS))
    throw new Error('The spell duration is outside supported bounds');
  return { turns, label: duration };
}

// -- Reviewed profiles and explicit overrides --
export function targetingProfile(
  library,
  character,
  action,
  overrides = library.actions.snapshot(character.id).targetingOverrides || {}
) {
  let entry = null,
    spec = null;
  if (action.kind === 'spell') {
    edition(library.ruleset);
    const owned = character.spells.find((spell) => spell.id === action.spellId);
    entry = owned && library.catalog.get(owned.entryId);
    if (!entry) throw new Error('The targeting spell is no longer owned');
    spec = library.rules.spellTargetProfiles[entry.id];
  }
  if (overrides[action.id]) {
    const override = overrides[action.id];
    return validateTargetingProfile({
      ...override,
      concentration: action.kind === 'spell' ? action.spellConcentration : override.concentration,
      ...(spec?.flightGrant && override.kind === 'tokens'
        ? {
            flightGrant: spec.flightGrant,
            requiresWilling: true,
            lingerTurns: override.lingerTurns || spec.lingerTurns,
          }
        : {}),
    });
  }
  if (['grapple', 'shove'].includes(action.id))
    return validateTargetingProfile({
      version: 1,
      kind: 'tokens',
      rangeFeet: 5,
      excludeSelf: true,
      maxSizeDifference: 1,
      preferred: 'hostile',
    });
  if (action.kind === 'weapon') return weaponProfile(library, character, action);
  if (action.kind !== 'spell') return null;
  if (!spec) {
    return {
      version: 1,
      kind: 'manual',
      reason: 'No reviewed targeting profile. Configure one or explicitly use manual targeting.',
    };
  }
  if (spec.kind === 'manual')
    return validateTargetingProfile({ version: 1, kind: 'manual', reason: spec.reason });
  const slot = action.slotLevel ?? entry.level;
  if (spec.manualFromSlot && slot >= spec.manualFromSlot)
    return validateTargetingProfile({
      version: 1,
      kind: 'manual',
      reason: spec.upcastReason,
    });
  const variants = spec.variants || [];
  const variant = action.targetingVariant || variants[0]?.id || null;
  if (variant !== null) {
    const selected = variants.find((option) => option.id === variant);
    if (!selected) throw new Error('Choose a supported spell template');
    spec = { ...spec, ...selected };
  }
  const duration = spellDuration(entry, spec, slot);
  const rangeFeet =
    (spec.rangeFeet === 'spell' ? spellRange(entry) : spec.rangeFeet) *
    (spec.rangeDoubleLevels
      ? 2 ** spec.rangeDoubleLevels.filter((level) => character.level >= level).length
      : 1);
  const attack = spec.attack ?? (action.roll?.attack === true && spec.kind === 'tokens');
  const targets = spec.targets
    ? spec.targets[0] + Math.max(0, slot - spec.targets[1]) * spec.targets[2]
    : spec.beams
      ? 1 + spec.beams.filter((level) => character.level >= level).length
      : 1;
  const radius = spec.radiusSlots
    ? spec.radiusSlots[0] + Math.max(0, slot - spec.radiusSlots[1]) * spec.radiusSlots[2]
    : spec.sizeFeet;
  return validateTargetingProfile({
    version: 1,
    kind: spec.kind,
    rangeFeet,
    maxTargets: targets,
    minTargets: spec.allowRepeat ? targets : 1,
    allowRepeat: spec.allowRepeat === true,
    requiresSight: spec.requiresSight === true,
    requiresWilling: spec.requiresWilling === true,
    requireCasterTarget: spec.requireCasterTarget === true,
    flightGrant: spec.flightGrant || null,
    preferred: spec.preferred || 'any',
    creatureTypes: spec.creatureTypes || [],
    creatureSizes: spec.creatureSizes || [],
    excludedTypes: spec.excludedTypes || [],
    spreadFeet: spec.spreadFeet ?? null,
    anchor: spec.anchor || 'point',
    shape: spec.shape || null,
    sizeFeet: radius ?? 0,
    widthFeet: spec.widthFeet || 5,
    heightFeet: spec.heightFeet || 5,
    followCaster: spec.followCaster === true,
    excludeCaster: spec.excludeCaster === true,
    allowExclusions: spec.allowExclusions === true,
    maxAreaTargets: spec.maxAreaTargets ?? null,
    areaTargetsRequireSight: spec.areaTargetsRequireSight === true,
    exclusionsRequireSight: spec.exclusionsRequireSight === true,
    lingerTurns: duration.turns,
    indefiniteDuration: duration.indefinite === true,
    durationLabel: duration.label,
    durationTarget: spec.durationTarget || null,
    movement: spec.movement || null,
    variant,
    variantOptions: variants.map(({ id, label }) => ({ id, label })),
    defaultElevationFeet: spec.defaultElevationFeet || 0,
    minOriginHeightFeet: spec.minOriginHeightFeet || 0,
    ignoreOriginCover: spec.ignoreOriginCover === true,
    replacePrevious: spec.replacePrevious === true,
    expiry: spec.expiry || 'start',
    concentration: entry.concentration,
    areaCover: spec.areaCover !== false,
    coverageNote: spec.coverageNote || '',
    attack,
    ...(attack && (spec.meleeAttack || entry.attackType === 'melee')
      ? { modes: [{ id: 'melee', normal: rangeFeet, long: rangeFeet }] }
      : {}),
  });
}

export function weaponProfile(library, character, action) {
  if (!action.itemId) {
    return validateTargetingProfile({
      version: 1,
      kind: 'tokens',
      rangeFeet: 5,
      maxTargets: 1,
      attack: true,
      modes: [{ id: 'melee', normal: 5, long: 5 }],
    });
  }
  const item = character.equipment.find((entry) => entry.id === action.itemId);
  return weaponEntryProfile(library.catalog.get(item?.entryId), library.rules);
}

export function weaponEntryProfile(entry, rules) {
  edition(rules.id);
  const weapon = entry?.weapon;
  if (!weapon) throw new Error('Equip a known weapon before configuring its targets');
  const modes = [];
  if (weapon.range === 'melee') {
    const reach = (weapon.distance?.normal || 5) + (weapon.properties.includes('reach') ? 5 : 0);
    modes.push({
      id: 'melee',
      normal: reach,
      long: reach,
    });
    if (weapon.properties.includes('thrown')) {
      const key = entry.id.replace(/^item:/, '').replace(/^enhanced:([^:]+):[123]$/, '$1');
      const distances = THROWN_WEAPON_RANGES[key];
      if (distances) modes.push({ id: 'thrown', normal: distances[0], long: distances[1] });
    }
  } else if (Number.isFinite(weapon.distance?.normal) && Number.isFinite(weapon.distance?.long)) {
    modes.push({ id: 'ranged', normal: weapon.distance.normal, long: weapon.distance.long });
  }
  if (!modes.length)
    return {
      version: 1,
      kind: 'manual',
      reason: 'This weapon has no reviewed distance. Configure its targeting profile.',
    };
  return validateTargetingProfile({
    version: 1,
    kind: 'tokens',
    rangeFeet: Math.max(...modes.map((mode) => mode.long)),
    maxTargets: 1,
    minTargets: 1,
    attack: true,
    modes,
    preferred: 'hostile',
    closeDisadvantage: rules.weaponClosePenalty(entry),
    heavyAbility: rules.heavyWeaponAbility(entry),
    heavySmall: rules.heavyWeaponSizePenalty(entry),
  });
}

export function validateTargetingProfile(value) {
  if (!record(value) || value.version !== 1) throw new Error('Unsupported targeting profile');
  if (value.kind === 'manual') {
    if (
      typeof value.reason !== 'string' ||
      !value.reason.trim() ||
      value.reason.length > 2000 ||
      Object.keys(value).some(
        (key) => !['version', 'kind', 'reason', 'concentration'].includes(key)
      )
    )
      throw new Error('Manual targeting needs a valid reason and supported fields');
    return { ...value };
  }
  const profile = {
    minRangeFeet: 0,
    maxTargets: 1,
    minTargets: 1,
    allowRepeat: false,
    excludeSelf: false,
    maxSizeDifference: null,
    requiresSight: false,
    requiresWilling: false,
    requireCasterTarget: false,
    flightGrant: null,
    preferred: 'any',
    creatureTypes: [],
    creatureSizes: [],
    excludedTypes: [],
    spreadFeet: null,
    anchor: 'point',
    shape: null,
    sizeFeet: 0,
    widthFeet: 5,
    heightFeet: 5,
    followCaster: false,
    excludeCaster: false,
    allowExclusions: false,
    maxAreaTargets: null,
    areaTargetsRequireSight: false,
    lingerTurns: 0,
    indefiniteDuration: false,
    durationLabel: '',
    durationTarget: null,
    movement: null,
    variant: null,
    variantOptions: [],
    defaultElevationFeet: 0,
    minOriginHeightFeet: 0,
    ignoreOriginCover: false,
    replacePrevious: false,
    expiry: 'start',
    concentration: false,
    areaCover: true,
    coverageNote: '',
    attack: false,
    closeDisadvantage: 0,
    heavyAbility: null,
    heavySmall: false,
    exclusionsRequireSight: false,
    ignoreCloseRangeDisadvantage: false,
    ignoreLongRangeDisadvantage: false,
    ...value,
  };
  if (profile.movement !== null) validateEffectMovement(profile.movement);
  if (
    Object.keys(profile).some(
      (key) =>
        ![
          'version',
          'kind',
          'rangeFeet',
          'minRangeFeet',
          'maxTargets',
          'minTargets',
          'allowRepeat',
          'excludeSelf',
          'maxSizeDifference',
          'requiresSight',
          'requiresWilling',
          'requireCasterTarget',
          'flightGrant',
          'preferred',
          'creatureTypes',
          'creatureSizes',
          'excludedTypes',
          'spreadFeet',
          'anchor',
          'shape',
          'sizeFeet',
          'widthFeet',
          'heightFeet',
          'followCaster',
          'excludeCaster',
          'allowExclusions',
          'maxAreaTargets',
          'areaTargetsRequireSight',
          'lingerTurns',
          'indefiniteDuration',
          'durationLabel',
          'durationTarget',
          'movement',
          'variant',
          'variantOptions',
          'defaultElevationFeet',
          'minOriginHeightFeet',
          'ignoreOriginCover',
          'replacePrevious',
          'expiry',
          'concentration',
          'areaCover',
          'coverageNote',
          'attack',
          'closeDisadvantage',
          'heavyAbility',
          'heavySmall',
          'modes',
          'exclusionsRequireSight',
          'ignoreCloseRangeDisadvantage',
          'ignoreLongRangeDisadvantage',
        ].includes(key)
    ) ||
    !['tokens', 'area', 'point', 'self'].includes(profile.kind) ||
    !integer(profile.rangeFeet, 0, MAX_RANGE) ||
    !integer(profile.minRangeFeet, 0, profile.rangeFeet) ||
    !integer(
      profile.maxTargets,
      1,
      profile.allowRepeat || profile.attack ? 100 : TARGETING_LIMITS.targets
    ) ||
    !integer(profile.minTargets, 1, profile.maxTargets) ||
    (profile.maxSizeDifference !== null && !integer(profile.maxSizeDifference, 0, 5)) ||
    !['any', 'friendly', 'hostile'].includes(profile.preferred) ||
    !['point', 'caster'].includes(profile.anchor) ||
    !['start', 'end'].includes(profile.expiry) ||
    !integer(profile.lingerTurns, 0, MAX_TURNS) ||
    !Number.isFinite(profile.sizeFeet) ||
    profile.sizeFeet < 0 ||
    profile.sizeFeet > 100000 ||
    !positive(profile.widthFeet, 100000) ||
    !positive(profile.heightFeet, 100000) ||
    !integer(profile.defaultElevationFeet, 0, 100000) ||
    !integer(profile.minOriginHeightFeet, 0, 100000) ||
    typeof profile.durationLabel !== 'string' ||
    profile.durationLabel.length > 200 ||
    ![null, 'area', 'targets', 'caster', 'point'].includes(profile.durationTarget) ||
    (profile.indefiniteDuration && (!profile.durationLabel || profile.lingerTurns !== 0)) ||
    (profile.durationTarget === 'area' && profile.kind !== 'area') ||
    (profile.durationTarget === 'point' && profile.kind !== 'point') ||
    (profile.maxAreaTargets !== null &&
      (!integer(profile.maxAreaTargets, 1, TARGETING_LIMITS.targets) ||
        profile.kind !== 'area' ||
        !profile.allowExclusions)) ||
    (profile.requireCasterTarget &&
      (profile.kind !== 'tokens' || profile.excludeSelf || profile.attack)) ||
    !Array.isArray(profile.creatureSizes) ||
    profile.creatureSizes.some(
      (size) => !['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'].includes(size)
    ) ||
    !Array.isArray(profile.variantOptions) ||
    profile.variantOptions.length > 10 ||
    new Set(profile.variantOptions.map((option) => option?.id)).size !==
      profile.variantOptions.length ||
    profile.variantOptions.some(
      (option) =>
        !record(option) ||
        typeof option.id !== 'string' ||
        !/^[a-z][a-z0-9-]{0,49}$/.test(option.id) ||
        typeof option.label !== 'string' ||
        !option.label.trim() ||
        option.label.length > 100 ||
        Object.keys(option).some((key) => !['id', 'label'].includes(key))
    ) ||
    (profile.variant === null
      ? profile.variantOptions.length !== 0
      : !profile.variantOptions.some((option) => option.id === profile.variant)) ||
    (profile.spreadFeet !== null && !integer(profile.spreadFeet, 0, 10000)) ||
    (profile.shape !== null && !TARGET_AREA_SHAPES.includes(profile.shape)) ||
    (profile.kind === 'area' && (!profile.shape || profile.sizeFeet === 0)) ||
    typeof profile.coverageNote !== 'string' ||
    profile.coverageNote.length > 2000 ||
    !integer(profile.closeDisadvantage, 0, 1000) ||
    ![null, 'strength', 'dexterity'].includes(profile.heavyAbility) ||
    [
      'allowRepeat',
      'excludeSelf',
      'requiresSight',
      'requiresWilling',
      'requireCasterTarget',
      'followCaster',
      'excludeCaster',
      'allowExclusions',
      'areaTargetsRequireSight',
      'exclusionsRequireSight',
      'concentration',
      'areaCover',
      'attack',
      'heavySmall',
      'ignoreCloseRangeDisadvantage',
      'ignoreLongRangeDisadvantage',
      'indefiniteDuration',
      'ignoreOriginCover',
      'replacePrevious',
    ].some((key) => typeof profile[key] !== 'boolean') ||
    ['creatureTypes', 'excludedTypes'].some(
      (key) =>
        !Array.isArray(profile[key]) ||
        profile[key].some((type) => !TARGET_CREATURE_TYPES.includes(type))
    ) ||
    (profile.kind !== 'area' &&
      (profile.shape !== null ||
        profile.sizeFeet !== 0 ||
        profile.followCaster ||
        profile.excludeCaster ||
        profile.allowExclusions ||
        ((profile.lingerTurns > 0 || profile.indefiniteDuration) &&
          !profile.flightGrant &&
          profile.durationTarget === null))) ||
    (profile.shape === 'ring' && profile.widthFeet >= profile.sizeFeet) ||
    (profile.movement !== null &&
      (!['area', 'point'].includes(profile.durationTarget) ||
        profile.followCaster ||
        !(profile.lingerTurns > 0 || profile.indefiniteDuration))) ||
    (profile.requiresWilling && !['tokens', 'self'].includes(profile.kind)) ||
    (profile.flightGrant !== null &&
      (!record(profile.flightGrant) ||
        Object.keys(profile.flightGrant).some(
          (key) => !['flySpeed', 'hover', 'magicalSupport'].includes(key)
        ) ||
        !integer(profile.flightGrant.flySpeed, 1, 1000) ||
        ['hover', 'magicalSupport'].some((key) => typeof profile.flightGrant[key] !== 'boolean') ||
        profile.kind !== 'tokens' ||
        profile.allowRepeat ||
        profile.attack ||
        !profile.requiresWilling ||
        !profile.concentration ||
        profile.lingerTurns === 0)) ||
    (profile.followCaster && profile.anchor !== 'caster') ||
    (profile.kind === 'self' && profile.rangeFeet !== 0) ||
    (profile.modes !== undefined &&
      (profile.kind !== 'tokens' ||
        !profile.attack ||
        !Array.isArray(profile.modes) ||
        !profile.modes.length ||
        new Set(profile.modes.map((mode) => mode?.id)).size !== profile.modes.length ||
        profile.modes.some(
          (mode) =>
            !record(mode) ||
            !['melee', 'thrown', 'ranged'].includes(mode.id) ||
            Object.keys(mode).some((key) => !['id', 'normal', 'long'].includes(key)) ||
            !integer(mode.normal, 1, MAX_RANGE) ||
            !integer(mode.long, mode.normal, profile.rangeFeet) ||
            (mode.id === 'melee' && mode.normal !== mode.long)
        )))
  )
    throw new Error('Targeting profile has invalid range, targets, shape or duration');
  return profile;
}
