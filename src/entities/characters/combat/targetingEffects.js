import { finitePoint, validateAreaGeometry } from '../../../rules/targeting/geometry.js';
import {
  validateEffectMovement,
  validateTargetingProfile,
} from '../../../rules/targeting/profiles.js';
import { TARGET_AREA_SHAPES, TARGETING_LIMITS } from '../../../config/targeting/SpellProfiles.js';

const id = (value) =>
  typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,299}$/.test(value);
const integer = (value, max) => Number.isInteger(value) && value >= 0 && value <= max;
const clone = (value) => JSON.parse(JSON.stringify(value));
const LIFETIME_FIELDS = [
  'version',
  'id',
  'casterTokenId',
  'characterId',
  'label',
  'sourceId',
  'remainingTurns',
  'expiry',
  'createdTurn',
  'lastTickTurn',
  'concentrationSpellId',
  'durationLabel',
  'sourceSpellId',
  'movement',
  'locationId',
];

// -- Source-owned visual areas and temporary flight --
export function actionTargetingEffect(session, token, action, selection, sequence) {
  const profile = action.targeting;
  if (!profile || !(profile.lingerTurns > 0 || profile.indefiniteDuration)) return null;
  const locationId = session.getLocationId?.(token);
  const lifetime = {
    version: 1,
    id: sequence,
    casterTokenId: token.id,
    ...(locationId ? { locationId } : {}),
    characterId: token.characterSheetId,
    label: action.label,
    sourceId: action.spellEntryId || action.customId || action.id,
    remainingTurns: profile.indefiniteDuration ? null : profile.lingerTurns,
    expiry: profile.expiry,
    createdTurn: session.turn,
    lastTickTurn: session.turn,
    concentrationSpellId: profile.concentration ? action.spellId || null : null,
    ...(profile.durationLabel ? { durationLabel: profile.durationLabel } : {}),
    ...(profile.movement
      ? { movement: clone(profile.movement), sourceSpellId: action.spellId || null }
      : {}),
  };
  if (profile.flightGrant) {
    if (
      action.kind !== 'spell' ||
      action.spellEntryId !== 'spell:fly' ||
      selection?.manual !== false ||
      selection.willingConfirmed !== true ||
      !selection.targets?.length
    )
      throw new Error('Fly requires confirmed willing creature targets');
    return validateFlightEffect({
      ...lifetime,
      kind: 'flight',
      targetTokenIds: selection.targets.map((target) => target.tokenId),
      ...profile.flightGrant,
    });
  }
  if (selection?.manual !== false && profile.durationTarget) return null;
  if (profile.durationTarget === 'targets' || profile.durationTarget === 'caster') {
    const targetTokenIds =
      profile.durationTarget === 'caster'
        ? [token.id]
        : (selection.targets || []).map((target) => target.tokenId);
    if (!targetTokenIds.length) return null;
    return validateRecipientEffect({ ...lifetime, kind: 'targets', targetTokenIds });
  }
  if (profile.durationTarget === 'point') {
    return validatePointEffect({
      ...lifetime,
      kind: 'point',
      origin: clone(selection.origin),
    });
  }
  if (!selection?.area) return null;
  return validateAreaEffect({
    ...lifetime,
    area: clone(selection.area),
    followCaster: profile.followCaster,
    exclusions: [...(selection.exclusions || [])],
  });
}

function validateLifetime(effect) {
  if (
    !effect ||
    effect.version !== 1 ||
    !id(effect.id) ||
    !id(effect.casterTokenId) ||
    !id(effect.characterId) ||
    !id(effect.sourceId) ||
    (effect.locationId !== undefined && !id(effect.locationId)) ||
    typeof effect.label !== 'string' ||
    !effect.label.trim() ||
    effect.label.length > 500 ||
    (effect.remainingTurns === null
      ? typeof effect.durationLabel !== 'string' || !effect.durationLabel.trim()
      : !integer(effect.remainingTurns, TARGETING_LIMITS.durationTurns) ||
        effect.remainingTurns === 0) ||
    (effect.durationLabel !== undefined &&
      (typeof effect.durationLabel !== 'string' || effect.durationLabel.length > 200)) ||
    (effect.sourceSpellId !== undefined && !id(effect.sourceSpellId)) ||
    !['start', 'end'].includes(effect.expiry) ||
    !integer(effect.createdTurn, Number.MAX_SAFE_INTEGER) ||
    !integer(effect.lastTickTurn, Number.MAX_SAFE_INTEGER) ||
    effect.lastTickTurn < effect.createdTurn ||
    (effect.concentrationSpellId !== null && !id(effect.concentrationSpellId))
  )
    throw new Error('Saved spell effect has invalid duration or source references');
  if (effect.movement !== undefined) {
    validateEffectMovement(effect.movement);
    if (!id(effect.sourceSpellId))
      throw new Error('Movable spell effects need an owned spell source');
  }
}

export function validateRecipientEffect(effect) {
  validateLifetime(effect);
  if (
    effect.kind !== 'targets' ||
    !Array.isArray(effect.targetTokenIds) ||
    !effect.targetTokenIds.length ||
    effect.targetTokenIds.length > TARGETING_LIMITS.targets ||
    new Set(effect.targetTokenIds).size !== effect.targetTokenIds.length ||
    effect.targetTokenIds.some((tokenId) => !id(tokenId)) ||
    effect.movement !== undefined ||
    Object.keys(effect).some((key) => ![...LIFETIME_FIELDS, 'kind', 'targetTokenIds'].includes(key))
  )
    throw new Error('Saved spell reminder has invalid recipients');
  return clone(effect);
}

export function validatePointEffect(effect) {
  validateLifetime(effect);
  if (
    effect.kind !== 'point' ||
    !finitePoint(effect.origin) ||
    Object.keys(effect).some((key) => ![...LIFETIME_FIELDS, 'kind', 'origin'].includes(key))
  )
    throw new Error('Saved spell marker has an invalid location');
  return clone(effect);
}

export function validateTargetingEffect(effect) {
  if (effect?.kind === 'flight') return validateFlightEffect(effect);
  if (effect?.kind === 'targets') return validateRecipientEffect(effect);
  if (effect?.kind === 'point') return validatePointEffect(effect);
  if (effect?.kind !== undefined) throw new Error('Saved spell effect has an unsupported kind');
  return validateAreaEffect(effect);
}

export function effectMoveAction(effect, tileSize) {
  if (!effect.movement) throw new Error('This spell effect cannot be moved');
  if (!Number.isFinite(tileSize) || tileSize <= 0)
    throw new Error('Spell movement needs a valid grid scale');
  const scale = 5 / tileSize;
  const origin = effect.kind === 'point' ? effect.origin : effect.area.origin;
  const targeting = validateTargetingProfile({
    version: 1,
    kind: effect.kind === 'point' ? 'point' : 'area',
    rangeFeet: effect.movement.distanceFeet,
    ...(effect.kind === 'point'
      ? {}
      : {
          shape: effect.area.shape,
          sizeFeet: effect.area.size * scale,
          widthFeet: effect.area.width * scale,
          heightFeet: effect.area.height * scale,
        }),
    ignoreOriginCover: true,
    coverageNote:
      'Move the existing visual without another spell slot or resetting its duration. Resolve the movement path, obstacles, triggered saves and damage manually.',
  });
  return {
    id: `effect-move:${effect.id}`,
    label: `Move ${effect.label}`,
    kind: 'spell-effect',
    cost: effect.movement.cost,
    magicAction: effect.movement.magicAction,
    ownTurnOnly: true,
    spellEffectId: effect.id,
    effectOrigin: clone(origin),
    effectSnapshot: clone(effect),
    casterRangeFeet: effect.movement.casterRangeFeet,
    targeting,
    roll: null,
    followups: [],
    note: `${effect.movement.magicAction ? 'Magic action' : effect.movement.cost === 'bonus' ? 'Bonus action' : 'Action'}; move up to ${effect.movement.distanceFeet} feet. No new spell slot; duration is unchanged.`,
  };
}

export function validateAreaEffect(effect) {
  validateLifetime(effect);
  if (
    !TARGET_AREA_SHAPES.includes(effect.area?.shape) ||
    !finitePoint(effect.area?.origin) ||
    !finitePoint(effect.area?.direction) ||
    ['size', 'width', 'height'].some(
      (key) =>
        !Number.isFinite(effect.area[key]) || effect.area[key] <= 0 || effect.area[key] > 100000
    ) ||
    typeof effect.followCaster !== 'boolean' ||
    (effect.movement !== undefined && effect.followCaster) ||
    !Array.isArray(effect.exclusions) ||
    effect.exclusions.some((tokenId) => !id(tokenId)) ||
    Object.keys(effect).some(
      (key) => ![...LIFETIME_FIELDS, 'area', 'followCaster', 'exclusions'].includes(key)
    )
  )
    throw new Error('Saved spell area has invalid geometry, duration or references');
  validateAreaGeometry(effect.area);
  return clone(effect);
}

export function validateFlightEffect(effect) {
  validateLifetime(effect);
  if (
    effect.kind !== 'flight' ||
    effect.remainingTurns === null ||
    effect.movement !== undefined ||
    effect.sourceId !== 'spell:fly' ||
    !id(effect.concentrationSpellId) ||
    !Array.isArray(effect.targetTokenIds) ||
    !effect.targetTokenIds.length ||
    effect.targetTokenIds.length > 100 ||
    new Set(effect.targetTokenIds).size !== effect.targetTokenIds.length ||
    effect.targetTokenIds.some((tokenId) => !id(tokenId)) ||
    !integer(effect.flySpeed, 1000) ||
    effect.flySpeed === 0 ||
    ['hover', 'magicalSupport'].some((key) => typeof effect[key] !== 'boolean') ||
    Object.keys(effect).some(
      (key) =>
        ![
          ...LIFETIME_FIELDS,
          'kind',
          'targetTokenIds',
          'flySpeed',
          'hover',
          'magicalSupport',
        ].includes(key)
    )
  )
    throw new Error('Saved flight effect has invalid speed, protections or targets');
  return clone(effect);
}

export function restoreTargetingEffects(effects, turn, library, tokens) {
  if (effects === undefined) return [];
  if (!Array.isArray(effects) || effects.length > 500)
    throw new Error('Saved spell effects are invalid');
  const seen = new Set(),
    characters = new Set(library.list().map((character) => character.id));
  return effects.map((source) => {
    const effect = validateTargetingEffect(source);
    if (seen.has(effect.id) || !characters.has(effect.characterId) || effect.lastTickTurn > turn)
      throw new Error('Saved spell effects have duplicate or stale caster references');
    if (effect.kind === 'flight') {
      const caster = tokens.get(effect.casterTokenId);
      const character = library.get(effect.characterId);
      if (
        caster?.characterSheetId !== effect.characterId ||
        effect.targetTokenIds.some((tokenId) => !tokens.has(tokenId)) ||
        character.concentration !== effect.concentrationSpellId ||
        !character.spells.some(
          (spell) => spell.id === effect.concentrationSpellId && spell.entryId === effect.sourceId
        )
      )
        throw new Error('Saved flight effect has missing targets or stale caster concentration');
    }
    if (effect.kind === 'targets' && effect.targetTokenIds.some((tokenId) => !tokens.has(tokenId)))
      throw new Error('Saved spell reminder has missing recipients');
    if (effect.movement) {
      const caster = tokens.get(effect.casterTokenId);
      if (
        caster?.characterSheetId !== effect.characterId ||
        !library
          .get(effect.characterId)
          .spells.some(
            (spell) => spell.id === effect.sourceSpellId && spell.entryId === effect.sourceId
          )
      )
        throw new Error('Saved movable spell effect has a stale caster or spell source');
    }
    seen.add(effect.id);
    return effect;
  });
}

export function advanceTargetingEffects(session, token, phase) {
  session.effects = session.effects.flatMap((effect) => {
    if (
      effect.remainingTurns === null ||
      effect.casterTokenId !== token.id ||
      effect.characterId !== token.characterSheetId ||
      effect.expiry !== phase ||
      session.turn <= effect.lastTickTurn ||
      session.turn <= effect.createdTurn
    )
      return [effect];
    if (effect.remainingTurns === 1) return [];
    return [{ ...effect, remainingTurns: effect.remainingTurns - 1, lastTickTurn: session.turn }];
  });
}

export function syncTargetingEffects(session) {
  const characters = new Set(session.library.list().map((character) => character.id));
  let changed = false;
  const next = session.effects.flatMap((effect) => {
    const remove = () => {
      changed = true;
      return [];
    };
    if (!characters.has(effect.characterId)) return remove();
    if (
      effect.movement &&
      !session.library
        .get(effect.characterId)
        .spells.some(
          (spell) => spell.id === effect.sourceSpellId && spell.entryId === effect.sourceId
        )
    )
      return remove();
    if (
      (effect.followCaster || effect.kind === 'flight' || effect.movement) &&
      session.targeting &&
      !session.targeting.hasTokenId(
        effect.casterTokenId,
        effect.kind === 'flight' || effect.movement ? effect.characterId : null
      )
    )
      return remove();
    if (
      effect.concentrationSpellId &&
      session.library.get(effect.characterId).concentration !== effect.concentrationSpellId
    )
      return remove();
    if (['flight', 'targets'].includes(effect.kind) && session.targeting) {
      const targetTokenIds = effect.targetTokenIds.filter((tokenId) =>
        session.targeting.hasTokenId(tokenId)
      );
      if (!targetTokenIds.length) return remove();
      if (targetTokenIds.length !== effect.targetTokenIds.length) {
        changed = true;
        return [{ ...effect, targetTokenIds }];
      }
    }
    return [effect];
  });
  if (changed) {
    session.effects = next;
    session._publish();
  }
}
