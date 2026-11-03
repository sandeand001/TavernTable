import { finitePoint, validateAreaGeometry } from '../../../rules/targeting/geometry.js';
import { TARGET_AREA_SHAPES } from '../../../config/targeting/SpellProfiles.js';

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
];

// -- Source-owned visual areas and temporary flight --
export function actionTargetingEffect(session, token, action, selection, sequence) {
  const profile = action.targeting;
  if (!profile || !(profile.lingerTurns > 0)) return null;
  const lifetime = {
    version: 1,
    id: sequence,
    casterTokenId: token.id,
    characterId: token.characterSheetId,
    label: action.label,
    sourceId: action.spellEntryId || action.customId || action.id,
    remainingTurns: profile.lingerTurns,
    expiry: profile.expiry,
    createdTurn: session.turn,
    lastTickTurn: session.turn,
    concentrationSpellId: profile.concentration ? action.spellId || null : null,
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
    typeof effect.label !== 'string' ||
    !effect.label.trim() ||
    effect.label.length > 500 ||
    !integer(effect.remainingTurns, 100000) ||
    effect.remainingTurns === 0 ||
    !['start', 'end'].includes(effect.expiry) ||
    !integer(effect.createdTurn, Number.MAX_SAFE_INTEGER) ||
    !integer(effect.lastTickTurn, Number.MAX_SAFE_INTEGER) ||
    effect.lastTickTurn < effect.createdTurn ||
    (effect.concentrationSpellId !== null && !id(effect.concentrationSpellId))
  )
    throw new Error('Saved spell effect has invalid duration or source references');
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
    const effect =
      source?.kind === 'flight' ? validateFlightEffect(source) : validateAreaEffect(source);
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
    seen.add(effect.id);
    return effect;
  });
}

export function advanceTargetingEffects(session, token, phase) {
  session.effects = session.effects.flatMap((effect) => {
    if (
      effect.casterTokenId !== token.id ||
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
      (effect.followCaster || effect.kind === 'flight') &&
      session.targeting &&
      !session.targeting.hasTokenId(
        effect.casterTokenId,
        effect.kind === 'flight' ? effect.characterId : null
      )
    )
      return remove();
    if (
      effect.concentrationSpellId &&
      session.library.get(effect.characterId).concentration !== effect.concentrationSpellId
    )
      return remove();
    if (effect.kind === 'flight' && session.targeting) {
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
