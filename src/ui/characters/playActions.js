export async function rollForSheet(
  context,
  request,
  { recordHistory = true, parentSequence } = {}
) {
  const mode = request.check ? context.rollMode : 'normal';
  const token = context.token;
  const characterId = context.characterId;
  const session = context.services.combat;
  const scope = recordHistory ? session.captureRoll(token) : null;
  context.rollStatus.textContent = `Rolling ${request.label}...`;
  const { rollDiceExpression } = await import('../../systems/dice/dice.js');
  const result = await rollDiceExpression({
    expression: request.expression,
    mode,
    label: request.label,
  });
  if (recordHistory && !result.cancelled) {
    session.recordRoll(scope, {
      label: request.label,
      expression: request.expression,
      rollText: result.text,
      ...(result.summary !== undefined ? { rollResult: result.summary } : {}),
      ...(parentSequence ? { parentSequence } : {}),
    });
  }
  if (!context.disposed && context.token === token && context.characterId === characterId) {
    context.rollStatus.textContent = result.text;
  }
  return result;
}

export async function performPlayAction(context, actionId, choice = {}) {
  const token = context.token;
  const characterId = context.characterId;
  const session = context.services.combat;
  let ticket;
  let rollScope;
  let rollRequest;
  let rolled = null;
  try {
    rollScope = session.captureRoll(token);
    ticket = session.prepareAction(token, actionId, choice);
    const character = context.services.library.get(characterId);
    rollRequest = ticket.action.roll
      ? { ...ticket.action.roll, label: `${character.name}: ${ticket.action.roll.label}` }
      : null;
    rolled = rollRequest
      ? await rollForSheet(context, rollRequest, { recordHistory: false })
      : null;
    if (rolled?.cancelled) {
      session.cancelAction(ticket);
      context.rollStatus.textContent = 'Use cancelled; no action or resources were spent.';
      return null;
    }
    if (
      context.disposed ||
      context.token !== token ||
      token.characterSheetId !== characterId ||
      !context.gameManager.placedTokens.includes(token) ||
      session.pending !== ticket
    ) {
      throw new Error('Creature changed while resolving the use; no costs were spent');
    }
    const used = await session.commitAction(ticket, rolled?.text || '', rolled?.summary ?? null);
    context.rollStatus.textContent =
      rolled?.text ||
      `${character.name}: used ${used.label}. Resolve its targets and effects manually.`;
    context._run(() => {}, 'Use and resource costs saved.');
    return used;
  } catch (error) {
    if (ticket && session.pending === ticket) session.cancelAction(ticket);
    let failure = error;
    if (rolled && !rolled.cancelled) {
      try {
        session.recordRoll(rollScope, {
          label: `${rollRequest.label} (use not committed)`,
          expression: rollRequest.expression,
          rollText: rolled.text,
          ...(rolled.summary !== undefined ? { rollResult: rolled.summary } : {}),
        });
      } catch (historyError) {
        failure = new AggregateError(
          [error, historyError],
          'Use failed and its roll history could not be updated'
        );
      }
    }
    if (!context.disposed && context.token === token && context.characterId === characterId) {
      context.rollStatus.textContent = `Use failed: ${failure.message}`;
    }
    context._failure(failure, 'playAction');
    return null;
  }
}

export async function rollRecentAction(context, sequence, part) {
  try {
    const entry = context.services.combat.historyEntry(context.token, sequence);
    const request = entry?.followups[Number(part)];
    if (!request) throw new Error('The recent damage/healing roll is no longer available');
    const character = context.services.library.get(context.characterId);
    return await rollForSheet(
      context,
      {
        ...request,
        check: false,
        label: `${character.name}: ${request.label}`,
      },
      { parentSequence: sequence }
    );
  } catch (error) {
    context.rollStatus.textContent = `Roll failed: ${error.message}`;
    context._failure(error, 'recentRoll');
    return null;
  }
}
