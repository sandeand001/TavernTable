import { getTokenCommand } from '../../../config/TokenCommandConfig.js';
import { logger, LOG_CATEGORY } from '../../../utils/logger/Logger.js';

/** Apply a quick command selected from the radial menu. */
export async function applyTokenCommand(gm, tokenEntry, commandId) {
  if (!commandId) return false;
  const command = getTokenCommand(commandId);
  if (!command) {
    logger.warn('Unknown token command', { commandId }, LOG_CATEGORY.INTERACTION);
    return false;
  }
  if (command.disabled || commandId === 'character-sheet' || command.subActions?.length) {
    logger.warn(
      'Token action is unavailable as a quick command',
      { commandId },
      LOG_CATEGORY.INTERACTION
    );
    return false;
  }

  const targetToken = _resolveTokenEntry(gm, tokenEntry);

  if (command.flight) {
    if (!targetToken || !gm.token3DAdapter?.applyFlightCommand) {
      throw new Error('Flight requires a placed creature and an active movement adapter');
    }
    return gm.token3DAdapter.applyFlightCommand(
      targetToken,
      command.flight.kind,
      command.flight.feet
    );
  }

  const played = await _handleEmoteCommand(gm, targetToken, commandId);
  if (played) {
    _setTokenQuickCommand(gm, targetToken, commandId);
  }
  return played;
}

export function _setTokenQuickCommand(gm, tokenEntry, commandId) {
  if (!tokenEntry) return;
  if (commandId) {
    tokenEntry.quickCommand = commandId;
  } else {
    delete tokenEntry.quickCommand;
  }
}

export function _resolveTokenEntry(gm, tokenLike) {
  if (!tokenLike) return null;
  const tokens = gm.placedTokens || [];
  if (tokens.includes(tokenLike)) {
    return tokenLike;
  }

  const targetId = _extractTokenId(tokenLike);
  if (targetId != null) {
    const byId = tokens.find((token) => _extractTokenId(token) === targetId);
    if (byId) {
      return byId;
    }
  }

  const gx = Number.isFinite(tokenLike.gridX) ? tokenLike.gridX : null;
  const gy = Number.isFinite(tokenLike.gridY) ? tokenLike.gridY : null;
  if (gx != null && gy != null) {
    const byGrid = tokens.find((token) => token.gridX === gx && token.gridY === gy);
    if (byGrid) {
      return byGrid;
    }
  }

  return null;
}

export function _extractTokenId(tokenLike) {
  if (tokenLike == null) return null;
  if (typeof tokenLike === 'string' || typeof tokenLike === 'number') {
    return tokenLike;
  }
  return tokenLike.id ?? tokenLike.creature?.id ?? null;
}

export async function _handleEmoteCommand(gm, tokenEntry, commandId) {
  const token = _resolveTokenEntry(gm, tokenEntry);
  if (!token) {
    logger.warn('Manual action has no placed creature', { commandId }, LOG_CATEGORY.INTERACTION);
    return false;
  }
  const adapter = gm.token3DAdapter;
  if (!adapter || typeof adapter.playTokenAction !== 'function') {
    logger.warn(
      'Manual action requested before Token3DAdapter was ready',
      { commandId },
      LOG_CATEGORY.INTERACTION
    );
    return false;
  }

  return adapter.playTokenAction(token, commandId);
}

export function _playIdleEmote(gm, tokenEntry) {
  return _handleEmoteCommand(gm, tokenEntry, 'emote-idle');
}
