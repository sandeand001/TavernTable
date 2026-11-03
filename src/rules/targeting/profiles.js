import {
  THROWN_WEAPON_RANGES,
  TARGET_AREA_SHAPES,
  TARGET_CREATURE_TYPES,
} from '../../config/targeting/SpellProfiles.js';
import { edition } from '../editions.js';

const integer = (value, minimum, maximum) =>
  Number.isInteger(value) && value >= minimum && value <= maximum;
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

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
  const slot = action.slotLevel ?? entry.level;
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
    rangeFeet: spec.rangeFeet,
    maxTargets: targets,
    minTargets: spec.allowRepeat ? targets : 1,
    allowRepeat: spec.allowRepeat === true,
    requiresSight: spec.requiresSight === true,
    requiresWilling: spec.requiresWilling === true,
    flightGrant: spec.flightGrant || null,
    preferred: spec.preferred || 'any',
    creatureTypes: spec.creatureTypes || [],
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
    exclusionsRequireSight: spec.exclusionsRequireSight === true,
    lingerTurns: spec.lingerTurns || 0,
    expiry: spec.expiry || 'start',
    concentration: entry.concentration,
    areaCover: spec.areaCover !== false,
    coverageNote: spec.coverageNote || '',
    attack: action.roll?.attack === true,
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
    flightGrant: null,
    preferred: 'any',
    creatureTypes: [],
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
    lingerTurns: 0,
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
          'flightGrant',
          'preferred',
          'creatureTypes',
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
          'lingerTurns',
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
    !integer(profile.rangeFeet, 0, 10000) ||
    !integer(profile.minRangeFeet, 0, profile.rangeFeet) ||
    !integer(profile.maxTargets, 1, 100) ||
    !integer(profile.minTargets, 1, profile.maxTargets) ||
    (profile.maxSizeDifference !== null && !integer(profile.maxSizeDifference, 0, 5)) ||
    !['any', 'friendly', 'hostile'].includes(profile.preferred) ||
    !['point', 'caster'].includes(profile.anchor) ||
    !['start', 'end'].includes(profile.expiry) ||
    !integer(profile.lingerTurns, 0, 100000) ||
    !integer(profile.sizeFeet, 0, 1000) ||
    !integer(profile.widthFeet, 1, 1000) ||
    !integer(profile.heightFeet, 1, 1000) ||
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
      'followCaster',
      'excludeCaster',
      'allowExclusions',
      'exclusionsRequireSight',
      'concentration',
      'areaCover',
      'attack',
      'heavySmall',
      'ignoreCloseRangeDisadvantage',
      'ignoreLongRangeDisadvantage',
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
        (profile.lingerTurns > 0 && !profile.flightGrant))) ||
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
            !integer(mode.normal, 1, 10000) ||
            !integer(mode.long, mode.normal, profile.rangeFeet) ||
            (mode.id === 'melee' && mode.normal !== mode.long)
        )))
  )
    throw new Error('Targeting profile has invalid range, targets, shape or duration');
  return profile;
}
