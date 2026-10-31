import { movementSpeed } from '../../../rules/flight.js';
import { getTokenTravelMode } from '../../creatures/TokenMovement.js';

// -- Voluntary recovery --
export function standingAvailability(session, token) {
  const character = session._character(token);
  const speed = movementSpeed(character, getTokenTravelMode(token));
  const cost = session.library.rules.standingCost(speed);
  let reason = '';
  if (!(character.conditions || []).includes('prone')) reason = 'This creature is not prone';
  else if (token.flightActive && !session.library.rules.canRemainAirborne(character))
    reason = 'Reach the ground before standing up';
  else if (speed === 0 || session.library.rules.movementImpaired(character))
    reason = 'A creature at 0 HP, with Speed 0 or restricted movement cannot stand up';
  else if (
    session.pending ||
    session.committing ||
    session.library.isSaving ||
    session.moves.size ||
    session.isMoving(token) ||
    session.isSceneMoving()
  )
    reason = 'Finish the current movement, fall or save before standing up';
  else if (session.active && session.activeToken !== token)
    reason = "Stand up during this creature's turn";
  else if (
    (session.active ? session.movementAllowance(token) : session.freeMovementAllowance(token)) <
    cost
  )
    reason = `Standing up requires ${cost} feet of remaining movement`;
  return { allowed: reason === '', reason, cost, maxSpeed: speed };
}

export function standUp(session, token) {
  const availability = standingAvailability(session, token);
  if (!availability.allowed) throw new Error(availability.reason);
  const character = session._character(token);
  const ticket = Object.freeze({ token, characterId: character.id, standing: true });
  session.pending = ticket;
  let managed = false;
  try {
    const apply = (_, target = session) => {
      const state = target._state(token);
      state.movementSpent += availability.cost;
      return { cost: availability.cost };
    };
    const persisted = session._persistWithScene(
      () =>
        session.library.edit(character.id, {
          conditions: character.conditions.filter((condition) => condition !== 'prone'),
        }),
      apply
    );
    managed = true;
    return session._afterPersistence(ticket, persisted, apply);
  } finally {
    if (!managed) session._releasePersistence(ticket);
  }
}

// -- Reactions at the start of a fall --
export function slowFallAvailability(session, token) {
  const protection = session.library.rules.fallProtection(session._character(token));
  return {
    reduction: protection.slowFallReduction,
    allowed:
      protection.slowFallReduction > 0 &&
      (!session.active || session._state(token).reactions > 0) &&
      !session.pending &&
      !session.committing &&
      !session.library.isSaving,
  };
}

export function useSlowFall(session, token, fallId) {
  const character = session._character(token);
  const sequence = `${fallId}:slow-fall`;
  const previous = session.histories
    .get(character.id)
    ?.find((entry) => entry.sequence === sequence);
  if (previous) return previous.reduction;
  const availability = slowFallAvailability(session, token);
  if (!availability.allowed) throw new Error('Slow Fall requires an available Monk reaction');
  const ticket = Object.freeze({ token, characterId: character.id, fallReaction: true });
  session.pending = ticket;
  let managed = false;
  try {
    const entry = {
      sequence,
      type: 'use',
      kind: 'feature',
      label: 'Slow Fall',
      cost: 'reaction',
      reduction: availability.reduction,
      characterId: character.id,
      characterName: character.name,
      turn: session.active ? session.turn : null,
      rollText: `Slow Fall: reduce falling damage by ${availability.reduction}.`,
      followups: [],
    };
    const apply = (_, target = session) => {
      if (target.active) target._state(token).reactions--;
      recordFallEntry(target, token, entry);
      return availability.reduction;
    };
    const persisted = session._persistWithScene(
      () => session.library.edit(character.id, {}),
      apply
    );
    managed = true;
    return session._afterPersistence(ticket, persisted, apply);
  } finally {
    if (!managed) session._releasePersistence(ticket);
  }
}

// -- Irreversible landing effects --
export function applyFall(session, token, context) {
  const character = session._character(token);
  if (character.id !== context.characterId)
    throw new Error('The falling creature changed its linked character');
  if (session.pending || session.committing || session.library.isSaving)
    throw new Error('Finish the current character save before applying fall damage');
  const result = session.library.rules.resolveFall(context);
  const ticket = Object.freeze({ token, characterId: character.id, landing: true });
  session.pending = ticket;
  let managed = false;
  try {
    const entry = {
      sequence: context.id,
      type: 'roll',
      label: `${character.name}: ${Number(context.distanceFeet.toFixed(2))}-foot fall`,
      expression: context.roll.expression,
      characterId: character.id,
      characterName: character.name,
      turn: session.active ? session.turn : null,
      rollText: `${context.roll.text}; ${result.damage} bludgeoning damage${
        result.reduction ? ` after ${result.reduction} reduction` : ''
      }${result.prone ? '; Prone' : ''}${context.reason ? `; ${context.reason}` : ''}.`,
      ...(context.roll.summary ? { rollResult: context.roll.summary } : {}),
      followups: [],
    };
    const apply = (receipt, target = session) => {
      recordFallEntry(target, token, entry);
      return receipt || result;
    };
    const persisted = session._persistWithScene(
      () => session.library.applyFall(character.id, context),
      apply
    );
    managed = true;
    return session._afterPersistence(ticket, persisted, apply);
  } finally {
    if (!managed) session._releasePersistence(ticket);
  }
}

function recordFallEntry(session, token, entry) {
  const entries = session.histories.get(entry.characterId) || [];
  if (!entries.some((previous) => previous.sequence === entry.sequence)) {
    entries.unshift({ ...entry });
    session.histories.set(entry.characterId, entries);
    const state = session._state(token);
    state.recent.unshift(entries[0]);
    state.recent = state.recent.slice(0, 10);
  }
  session._state(token).undo = [];
}
