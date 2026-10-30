import { copyRollSummary } from '../../../systems/dice/rollSummary.js';

const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const finite = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const identifier = (value) =>
  typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,299}$/.test(value);
const clone = (value) => JSON.parse(JSON.stringify(value));
const text = (value, max = 10000) =>
  typeof value === 'string' && value.length > 0 && value.length <= max;
const expression = (value) => text(value, 160) && /^[\d+\-dD\s]+$/.test(value);
const fail = () => {
  throw new Error('Saved combat state has invalid budgets, rolls or creature references');
};
const COUNTS = [
  'actions',
  'restrictedActions',
  'bonusActions',
  'reactions',
  'attacksRemaining',
  'bonusAttacksRemaining',
];
const FLAGS = ['attackActionTaken', 'readied', 'actionSurgeUsed'];

export function snapshotCombat(
  session,
  { movementCosts = new Map(), movementSession = session } = {}
) {
  const states = [];
  for (const [token, state] of session.states) {
    if (!session.hasToken(token) || !token.characterSheetId) continue;
    let movementSpent = movementSession.states.get(token)?.movementSpent ?? state.movementSpent;
    for (const ticket of movementSession.moves.values()) {
      if (ticket.token === token) movementSpent += (movementCosts.get(token.id) ?? 0) - ticket.cost;
    }
    states.push({
      tokenId: token.id,
      characterId: token.characterSheetId,
      budget: session._actionSnapshot(state),
      movementSpent: Math.max(0, movementSpent),
      recent: state.recent
        .filter((entry) => entry.characterId === token.characterSheetId)
        .map((entry) => entry.sequence),
    });
  }
  return clone({
    version: 1,
    active: session.active,
    turn: session.turn,
    activeTokenId: session.activeToken?.id ?? null,
    states,
    histories: [...session.histories].map(([characterId, entries]) => ({ characterId, entries })),
  });
}

export function restoreCombat(data, tokens, library) {
  if (
    !record(data) ||
    data.version !== 1 ||
    typeof data.active !== 'boolean' ||
    !integer(data.turn, 0, Number.MAX_SAFE_INTEGER) ||
    !Array.isArray(data.states) ||
    data.states.length > 2000 ||
    !Array.isArray(data.histories) ||
    data.histories.length > 10000 ||
    (data.activeTokenId !== null && !identifier(data.activeTokenId)) ||
    (!data.active && data.activeTokenId !== null) ||
    Object.keys(data).some(
      (key) => !['version', 'active', 'turn', 'activeTokenId', 'states', 'histories'].includes(key)
    )
  )
    fail();
  const byId = new Map(tokens.map((token) => [token.id, token]));
  if (byId.size !== tokens.length) fail();
  const histories = new Map();
  const entries = new Map();
  for (const group of data.histories) {
    if (
      !record(group) ||
      !identifier(group.characterId) ||
      histories.has(group.characterId) ||
      !Array.isArray(group.entries) ||
      group.entries.length > 10000
    )
      fail();
    const saved = [];
    for (const source of group.entries) {
      if (
        !record(source) ||
        source.characterId !== group.characterId ||
        !identifier(source.sequence) ||
        entries.has(source.sequence) ||
        !['roll', 'use'].includes(source.type) ||
        !text(source.label) ||
        typeof source.rollText !== 'string' ||
        source.rollText.length > 10000 ||
        (source.turn !== null && !integer(source.turn, 0, data.turn)) ||
        !Array.isArray(source.followups) ||
        source.followups.length > 30 ||
        (source.expression !== undefined && !expression(source.expression)) ||
        (source.undone !== undefined && typeof source.undone !== 'boolean')
      )
        fail();
      for (const roll of source.followups) {
        if (
          !record(roll) ||
          !text(roll.label) ||
          !expression(roll.expression) ||
          (roll.check !== undefined && typeof roll.check !== 'boolean')
        )
          fail();
      }
      const entry = clone(source);
      if (entry.rollResult !== undefined) entry.rollResult = copyRollSummary(entry.rollResult);
      entries.set(entry.sequence, entry);
      saved.push(entry);
    }
    histories.set(group.characterId, saved);
  }
  const states = new Map();
  for (const row of data.states) {
    const token = byId.get(row?.tokenId);
    if (!token || states.has(token) || token.characterSheetId !== row.characterId) fail();
    library.get(row.characterId);
    const budget = row.budget;
    if (
      !record(budget) ||
      COUNTS.some((key) => !integer(budget[key], 0, 20)) ||
      budget.restrictedActions > budget.actions ||
      FLAGS.some((key) => typeof budget[key] !== 'boolean') ||
      !finite(budget.movementBonus, -10000, 10000) ||
      !finite(row.movementSpent, 0, 1000000) ||
      !record(budget.customTurnUses) ||
      Object.entries(budget.customTurnUses).some(
        ([id, count]) => !identifier(id) || !integer(count, 0, 10000)
      ) ||
      !Array.isArray(budget.spellsCast) ||
      budget.spellsCast.length > 100 ||
      budget.spellsCast.some(
        (spell) =>
          !record(spell) ||
          !['action', 'bonus', 'reaction', 'free'].includes(spell.cost) ||
          !integer(spell.level, 0, 9) ||
          typeof spell.usesSlot !== 'boolean'
      ) ||
      !Array.isArray(row.recent) ||
      row.recent.length > 10 ||
      new Set(row.recent).size !== row.recent.length ||
      row.recent.some((id) => entries.get(id)?.characterId !== row.characterId) ||
      Object.keys(budget).some(
        (key) =>
          ![...COUNTS, ...FLAGS, 'movementBonus', 'customTurnUses', 'spellsCast'].includes(key)
      )
    )
      fail();
    states.set(token, {
      ...clone(budget),
      movementSpent: row.movementSpent,
      recent: row.recent.map((id) => entries.get(id)),
      undo: [],
    });
  }
  const activeToken = data.activeTokenId === null ? null : byId.get(data.activeTokenId);
  if (data.activeTokenId !== null && (!activeToken || !states.has(activeToken))) fail();
  return { active: data.active, activeToken, turn: data.turn, states, histories };
}
