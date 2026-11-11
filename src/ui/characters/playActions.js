import { getTokenConditions } from '../../entities/creatures/TokenMovement.js';

export async function rollForSheet(
  context,
  request,
  { recordHistory = true, parentSequence } = {}
) {
  const advantage =
    request.check && (context.rollMode === 'advantage' || request.advantage === true);
  const disadvantage =
    request.check &&
    (context.rollMode === 'disadvantage' ||
      request.disadvantage === true ||
      (request.attack && getTokenConditions(context.token).includes('prone')));
  const mode = advantage === disadvantage ? 'normal' : advantage ? 'advantage' : 'disadvantage';
  const token = context.token;
  const characterId = context.characterId;
  if (context.services.playerGameplay) {
    if (context.services.sheetContext === 'library')
      throw new Error('Place this character before using world dice actions');
    context.rollStatus.textContent = `Waiting for the host: ${request.label}...`;
    const result = await context.services.playerGameplay.roll(token, {
      expression: request.expression,
      label: request.label,
      mode,
    });
    const roll = result.receipt.roll;
    if (!context.disposed && context.token === token && context.characterId === characterId)
      context.rollStatus.textContent = roll.text;
    return roll;
  }
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
  if (context.services.playerGameplay) {
    try {
      if (context.services.sheetContext === 'library')
        throw new Error('Place this character before using world actions');
      context.rollStatus.textContent = 'Waiting for the host to resolve this action...';
      const result = await context.services.playerGameplay.useAction(token, actionId, choice);
      if (result.cancelled) {
        context.rollStatus.textContent =
          result.reason || 'Targeting cancelled. No action or resources were spent.';
        return null;
      }
      if (!context.disposed && context.token === token && context.characterId === characterId) {
        context.rollStatus.textContent =
          result.outcome === 'duplicate'
            ? 'This action was already accepted. Current host data was refreshed.'
            : result.receipt.roll?.text || 'The host accepted this action and its resource costs.';
        context._run(() => {}, 'Host action and resources updated.', false);
      }
      return result.receipt;
    } catch (error) {
      context.rollStatus.textContent = error.message;
      context._failure(error, 'playerAction');
      return null;
    }
  }
  const session = context.services.combat;
  let ticket;
  let rollScope;
  let rollRequest;
  let rolled = null;
  let selection = null;
  let committed = false;
  let recordedUncommitted = false;
  const targetRolls = [];
  const targetRollScopes = [];
  const recordUncommitted = () => {
    if (recordedUncommitted) return;
    recordedUncommitted = true;
    for (const [index, roll] of targetRolls.entries())
      session.recordRoll(targetRollScopes[index], {
        label: `${roll.label} (use not committed)`,
        expression: roll.expression,
        rollText: roll.text,
        ...(roll.summary ? { rollResult: roll.summary } : {}),
      });
  };
  try {
    rollScope = session.captureRoll(token);
    ticket = session.prepareAction(token, actionId, choice);
    if (ticket.action.targeting && context.services.targeting) {
      selection = await context.services.targeting.choose(token, ticket);
      if (selection.cancelled) {
        if (session.pending === ticket) session.cancelAction(ticket);
        context.rollStatus.textContent = 'Targeting cancelled; no action or resources were spent.';
        return null;
      }
      if (
        ticket.action.kind === 'spell' &&
        ((selection.slotLevel !== undefined && selection.slotLevel !== ticket.action.slotLevel) ||
          (selection.variant !== undefined &&
            selection.variant !== ticket.action.targeting.variant))
      ) {
        ticket = session.changeSpellChoices(ticket, {
          ...ticket.choice,
          ...(selection.slotLevel !== undefined ? { slotLevel: selection.slotLevel } : {}),
          ...(selection.variant !== undefined ? { variant: selection.variant } : {}),
        });
      }
    }
    const character = context.services.library.get(characterId);
    rollRequest = ticket.action.roll
      ? { ...ticket.action.roll, label: `${character.name}: ${ticket.action.roll.label}` }
      : null;
    if (rollRequest?.attack && selection?.targets.length && !selection.manual) {
      for (const target of selection.targets) {
        for (let index = 0; index < target.count; index++) {
          if (
            context.disposed ||
            context.token !== token ||
            token.characterSheetId !== characterId ||
            !context.gameManager.placedTokens.includes(token) ||
            session.pending !== ticket
          )
            throw new Error('Creature changed while resolving the use; no costs were spent');
          const targetRollScope = session.captureRoll(token);
          rolled = await rollForSheet(
            context,
            {
              ...rollRequest,
              label:
                `${rollRequest.label} vs ${target.name}${target.count > 1 ? ` (${index + 1}/${target.count})` : ''}`.slice(
                  0,
                  240
                ),
              advantage: target.advantage?.length > 0,
              disadvantage: target.disadvantage?.length > 0,
            },
            { recordHistory: false }
          );
          if (rolled.cancelled) break;
          targetRollScopes.push(targetRollScope);
          targetRolls.push({
            tokenId: target.tokenId,
            label: `${ticket.action.label} vs ${target.name}`,
            expression: rollRequest.expression,
            text: rolled.text,
            ...(rolled.summary ? { summary: rolled.summary } : {}),
          });
        }
        if (rolled?.cancelled) break;
      }
    } else {
      rolled = rollRequest
        ? await rollForSheet(context, rollRequest, { recordHistory: false })
        : null;
    }
    if (rolled?.cancelled) {
      if (session.pending === ticket) session.cancelAction(ticket);
      context.services.targeting?.finish();
      recordUncommitted();
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
    const rollText = (
      targetRolls.length ? targetRolls.map((roll) => roll.text).join('\n') : rolled?.text || ''
    ).slice(0, 10000);
    const used = await session.commitAction(
      ticket,
      rollText,
      targetRolls.length > 1 ? null : (rolled?.summary ?? null),
      selection,
      targetRolls
    );
    committed = true;
    if (used.kind === 'spell') context.slotLevels?.set(used.spellId, used.slotLevel);
    context.services.targeting?.finish();
    context.rollStatus.textContent =
      rolled?.text ||
      `${character.name}: used ${used.label}${selection?.targets.length ? ` on ${selection.targets.map((target) => target.name).join(', ')}` : ''}. Resolve damage, saves and other effects manually.`;
    context._run(() => {}, 'Use and resource costs saved.');
    return used;
  } catch (error) {
    if (ticket && session.pending === ticket) session.cancelAction(ticket);
    let failure = error;
    if (!committed && targetRolls.length && !recordedUncommitted) {
      try {
        recordUncommitted();
      } catch (historyError) {
        failure = new AggregateError(
          [error, historyError],
          'Use failed and its attack-roll history could not be updated'
        );
      }
    } else if (!committed && !targetRolls.length && rolled && !rolled.cancelled) {
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
      context.rollStatus.textContent = `${committed ? 'Use saved, but the view failed to update' : 'Use failed'}: ${failure.message}`;
    }
    context._failure(failure, 'playAction');
    context.services.targeting?.finish();
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
