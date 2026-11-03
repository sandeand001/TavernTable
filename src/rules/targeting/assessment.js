import { boardDistance, targetRelation, areaPlacement, inArea, finitePoint } from './geometry.js';
import { validateTargetingProfile } from './profiles.js';
import { TARGET_CREATURE_SIZES } from '../../config/targeting/SpellProfiles.js';

const EPSILON = 1e-7;
const incapacitated = (token) =>
  token.hpCurrent === 0 ||
  (token.conditions || []).some((condition) =>
    ['incapacitated', 'unconscious', 'paralyzed', 'petrified', 'stunned'].includes(condition)
  );

// -- Candidate legality and attack accuracy --
export function targetStatus(board, actor, target, profile, modeId = null) {
  if (!actor || !target) throw new Error('Targeting requires creatures still on the board');
  const distance = boardDistance(actor.world, target.world, board.tileSize);
  const relation = targetRelation(actor, target);
  if (modeId !== null && !profile.modes?.some((mode) => mode.id === modeId))
    throw new Error('Choose a valid weapon targeting mode');
  const mode = profile.modes
    ? profile.modes.find((entry) => entry.id === modeId) || profile.modes[0]
    : null;
  const maximum = mode?.long ?? profile.rangeFeet;
  const actorSize = TARGET_CREATURE_SIZES.indexOf(actor.creatureSize || 'medium');
  const targetSize = TARGET_CREATURE_SIZES.indexOf(target.creatureSize || 'medium');
  if (profile.maxSizeDifference !== null && (actorSize < 0 || targetSize < 0))
    throw new Error('Choose valid creature sizes before targeting');
  let reason = '';
  if ((profile.attack || profile.excludeSelf) && relation === 'self')
    reason = 'Choose another creature to target';
  else if (profile.maxSizeDifference !== null && targetSize > actorSize + profile.maxSizeDifference)
    reason = 'This creature is too large for the ability';
  else if (profile.creatureTypes.length && !profile.creatureTypes.includes(target.creatureType))
    reason = 'This spell requires a different creature type';
  else if (profile.excludedTypes.includes(target.creatureType))
    reason = 'This creature type is excluded by the spell';
  else if (distance + EPSILON < profile.minRangeFeet)
    reason = `Inside minimum range (${profile.minRangeFeet} ft)`;
  else if (distance > maximum + EPSILON)
    reason = `Out of range (${Number(distance.toFixed(2))}/${maximum} ft)`;
  else if (profile.requiresSight && !canSee(actor, target))
    reason = 'The caster cannot see this target';
  else if (!board.clearPath(actor, target))
    reason = 'Total cover blocks a clear path to this target';
  const disadvantage = [],
    advantage = [];
  if (profile.attack) {
    if (profile.heavyAbility && (actor.abilities[profile.heavyAbility] || 0) < 13)
      disadvantage.push(`Heavy weapon requires ${profile.heavyAbility} 13`);
    if (profile.heavySmall && ['tiny', 'small'].includes(actor.creatureSize))
      disadvantage.push('Heavy weapon is too large for this creature');
    if (mode && distance > mode.normal + EPSILON && !profile.ignoreLongRangeDisadvantage)
      disadvantage.push('Long range');
    if (
      profile.closeDisadvantage > 0 &&
      mode?.id === 'melee' &&
      distance <= profile.closeDisadvantage + EPSILON
    )
      disadvantage.push('Weapon close-range restriction');
    const ranged = mode ? mode.id !== 'melee' : true;
    if (
      ranged &&
      !profile.ignoreCloseRangeDisadvantage &&
      board.tokens.some(
        (enemy) =>
          targetRelation(actor, enemy) === 'hostile' &&
          !incapacitated(enemy) &&
          canSee(enemy, actor) &&
          boardDistance(actor.world, enemy.world, board.tileSize) <= 5 + EPSILON &&
          board.clearPath(enemy, actor)
      )
    ) {
      disadvantage.push('Hostile creature within 5 ft');
    }
    if (
      (actor.conditions || []).includes('blinded') ||
      (target.conditions || []).includes('invisible')
    )
      disadvantage.push('Unseen target');
    if (
      (actor.conditions || []).includes('invisible') &&
      !(target.conditions || []).includes('invisible')
    )
      advantage.push('Unseen attacker');
    if ((target.conditions || []).includes('blinded')) advantage.push('Blinded target');
    if ((target.conditions || []).includes('prone')) {
      (distance <= 5 + EPSILON ? advantage : disadvantage).push('Prone target');
    }
    if (
      incapacitated(target) &&
      (target.conditions || []).some((condition) =>
        ['unconscious', 'paralyzed', 'petrified', 'stunned'].includes(condition)
      )
    )
      advantage.push('Target condition');
  }
  return {
    allowed: reason === '',
    reason,
    distance,
    relation,
    mode: mode?.id || null,
    normalRange: mode?.normal ?? profile.rangeFeet,
    maximumRange: maximum,
    disadvantage,
    advantage,
  };
}

function canSee(observer, target) {
  return (
    !(observer.conditions || []).includes('blinded') &&
    !(target.conditions || []).includes('invisible')
  );
}

export function targetingAvailability(board, actor, value) {
  if (!value) return { allowed: true, reason: '', candidates: [], profile: null };
  const profile = validateTargetingProfile(value);
  if (profile.kind === 'manual')
    return { allowed: true, reason: profile.reason, candidates: [], profile };
  if (profile.kind !== 'tokens') return { allowed: true, reason: '', candidates: [], profile };
  const candidates = [];
  for (const target of board.tokens) {
    const modes = profile.modes?.map((mode) => mode.id) || [null];
    const status = modes
      .map((mode) => targetStatus(board, actor, target, profile, mode))
      .find((entry) => entry.allowed);
    if (status) candidates.push({ tokenId: target.id, name: target.name, ...status });
  }

  const required = profile.allowRepeat ? 1 : profile.minTargets;
  return {
    allowed: candidates.length >= required,
    reason:
      candidates.length >= required
        ? ''
        : 'Not enough viable targets are within range with a clear path',
    candidates,
    profile,
  };
}

export function affectedAreaTargets(board, actor, profile, area, exclusions = []) {
  return board.tokens.filter(
    (token) =>
      (!profile.excludeCaster || token.id !== actor.id) &&
      !exclusions.includes(token.id) &&
      !profile.excludedTypes.includes(token.creatureType) &&
      (!profile.creatureTypes.length || profile.creatureTypes.includes(token.creatureType)) &&
      inArea(token.world, area) &&
      (!profile.areaCover || board.clearArea(area.origin, token))
  );
}

// -- Confirmed selections --
export function validateTargetSelection(board, actor, value, selection) {
  const profile = validateTargetingProfile(value);
  if (!actor || !selection || typeof selection !== 'object' || Array.isArray(selection))
    throw new Error('Confirm a targeting selection for a creature still on the board');
  if (profile.kind === 'manual') {
    if (selection.manual !== true)
      throw new Error('Confirm manual targeting for this unreviewed ability');
    return { manual: true, targets: [], area: null, profile };
  }
  if (profile.requiresWilling && selection.willingConfirmed !== true)
    throw new Error('Confirm that every selected creature is willing');
  if (profile.kind === 'self') {
    return {
      manual: false,
      targets: [{ tokenId: actor.id, count: 1, name: actor.name }],
      area: null,
      profile,
      ...(profile.requiresWilling ? { willingConfirmed: true } : {}),
    };
  }
  if (profile.kind === 'area' || profile.kind === 'point') {
    const origin = profile.anchor === 'caster' ? actor.world : selection.origin;
    if (!finitePoint(origin)) throw new Error('Place the spell origin on the board');
    if (profile.anchor !== 'caster') {
      if (!board.inside(origin)) throw new Error('Place the spell origin inside the board');
      if (boardDistance(actor.world, origin, board.tileSize) > profile.rangeFeet + EPSILON)
        throw new Error('The spell origin is out of range');
      if (boardDistance(actor.world, origin, board.tileSize) + EPSILON < profile.minRangeFeet)
        throw new Error('The spell origin is inside minimum range');
      if (profile.requiresSight && (actor.conditions || []).includes('blinded'))
        throw new Error('The caster cannot see the spell origin');
      if (!board.clearPoint(actor, origin)) throw new Error('Total cover blocks the spell origin');
    }
    const area =
      profile.kind === 'area' ? areaPlacement(profile, actor, selection, board.tileSize) : null;
    const exclusions = selection.exclusions || [];
    if (
      !Array.isArray(exclusions) ||
      exclusions.length > board.tokens.length ||
      new Set(exclusions).size !== exclusions.length ||
      exclusions.some((id) => typeof id !== 'string') ||
      (exclusions.length && !profile.allowExclusions)
    )
      throw new Error('This spell does not allow those exclusions');
    for (const id of exclusions) {
      const target = board.tokens.find((token) => token.id === id);
      if (
        !target ||
        (profile.exclusionsRequireSight &&
          (!canSee(actor, target) || !board.clearPath(actor, target)))
      )
        throw new Error('Excluded creatures must be visible when the spell is cast');
    }
    const targets = area
      ? affectedAreaTargets(board, actor, profile, area, exclusions).map((token) => ({
          tokenId: token.id,
          count: 1,
          name: token.name,
        }))
      : [];
    return {
      manual: false,
      targets,
      area,
      origin: { ...origin },
      aim: selection.aim ? { ...selection.aim } : null,
      exclusions: [...exclusions],
      profile,
    };
  }
  if (!Array.isArray(selection.targets) || !selection.targets.length)
    throw new Error('Select at least one viable target');
  const seen = new Set(),
    targets = [];
  let allocations = 0;
  for (const entry of selection.targets) {
    if (
      !entry ||
      typeof entry.tokenId !== 'string' ||
      seen.has(entry.tokenId) ||
      !Number.isInteger(entry.count) ||
      entry.count < 1 ||
      (!profile.allowRepeat && entry.count !== 1)
    )
      throw new Error('Target allocations are invalid');
    const target = board.tokens.find((token) => token.id === entry.tokenId);
    if (!target) throw new Error('A selected target left the board');
    const status = targetStatus(board, actor, target, profile, selection.mode);
    if (!status.allowed) throw new Error(`${target.name}: ${status.reason}`);
    seen.add(entry.tokenId);
    allocations += entry.count;
    targets.push({ tokenId: target.id, name: target.name, count: entry.count, ...status });
  }
  if (allocations > profile.maxTargets)
    throw new Error(`This ability allows at most ${profile.maxTargets} targets or projectiles`);
  if (allocations < profile.minTargets)
    throw new Error(
      `This ability requires at least ${profile.minTargets} allocated targets or projectiles`
    );
  if (profile.spreadFeet !== null) {
    for (const first of targets)
      for (const second of targets) {
        const a = board.tokens.find((token) => token.id === first.tokenId);
        const b = board.tokens.find((token) => token.id === second.tokenId);
        if (boardDistance(a.world, b.world, board.tileSize) > profile.spreadFeet + EPSILON)
          throw new Error(
            `Selected targets must be within ${profile.spreadFeet} feet of each other`
          );
      }
  }
  return {
    manual: false,
    targets,
    area: null,
    mode: selection.mode || null,
    profile,
    ...(profile.requiresWilling ? { willingConfirmed: true } : {}),
  };
}
