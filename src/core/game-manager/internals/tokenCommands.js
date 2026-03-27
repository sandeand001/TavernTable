import { getTokenCommand } from '../../../config/TokenCommandConfig.js';
import { logger, LOG_CATEGORY } from '../../../utils/logger/Logger.js';

const EMOTE_COMMAND_PREFIX = 'emote-';
const EMOTE_IDLE_ACTIONS = ['idle', 'idleVariant2', 'idleVariant3', 'idleVariant4', 'idleVariant5'];

/** Apply a quick command selected from the radial menu. */
export function applyTokenCommand(gm, tokenEntry, commandId) {
  if (!commandId) return false;
  const command = getTokenCommand(commandId);
  if (!command) {
    logger.warn('Unknown token command', { commandId }, LOG_CATEGORY.INTERACTION);
    return false;
  }

  const targetToken = _resolveTokenEntry(gm, tokenEntry);

  if (commandId === 'clear') {
    _setTokenQuickCommand(gm, targetToken, null);
    try {
      gm.token3DAdapter?.playTokenAnimation?.(targetToken, 'idle', { force: true });
    } catch (_) {
      /* ignore */
    }
    return true;
  }

  if (targetToken) {
    _setTokenQuickCommand(gm, targetToken, commandId);
  }

  if (commandId.startsWith(EMOTE_COMMAND_PREFIX)) {
    return _handleEmoteCommand(gm, targetToken, commandId);
  }

  return true;
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

export function _handleEmoteCommand(gm, tokenEntry, commandId) {
  const token = _resolveTokenEntry(gm, tokenEntry);
  if (!token) {
    return false;
  }
  const adapter = gm.token3DAdapter;
  if (!adapter || typeof adapter.playTokenAnimation !== 'function') {
    logger.warn(
      'Emote command requested before Token3DAdapter was ready',
      { commandId },
      LOG_CATEGORY.INTERACTION
    );
    return false;
  }

  switch (commandId) {
    case 'emote-defeated':
      return adapter.playTokenAnimation(token, 'defeated', {
        force: true,
        fadeIn: 0.22,
        fadeOut: 0.35,
        allowRootMotion: true,
        releaseOnMovement: true,
      });
    case 'emote-rumba':
    case 'emote-jump':
      return adapter.playTokenAnimation(token, 'jump', {
        force: true,
        fadeIn: 0.2,
        fadeOut: 0.3,
        allowRootMotion: true,
        movementLockMs: Infinity,
        autoRevert: false,
        releaseOnMovement: true,
      });

    case 'emote-fancy-pose':
      return adapter.playTokenAnimation(token, 'fancyPose', {
        force: true,
        fadeIn: 0.25,
        fadeOut: 0.35,
        autoRevert: false,
        movementLockMs: Infinity,
        allowRootMotion: true,
        releaseOnMovement: true,
      });
    case 'emote-dynamic-pose':
      return adapter.playTokenAnimation(token, 'dynamicPose', {
        force: true,
        fadeIn: 0.25,
        fadeOut: 0.35,
        autoRevert: false,
        movementLockMs: Infinity,
        allowRootMotion: true,
        releaseOnMovement: true,
      });
    case 'emote-idle':
      return _playIdleEmote(gm, token);
    default:
      return false;
  }
}

export function _playIdleEmote(gm, tokenEntry) {
  const token = _resolveTokenEntry(gm, tokenEntry);
  if (!token) return false;
  const adapter = gm.token3DAdapter;
  if (!adapter || typeof adapter.playTokenAnimation !== 'function') {
    return false;
  }
  const available = EMOTE_IDLE_ACTIONS.filter((key) => adapter.hasAnimation?.(token, key));
  const pool = available.length ? available : ['idle'];
  const choice = pool[Math.floor(Math.random() * pool.length)];
  return adapter.playTokenAnimation(token, choice, { force: true });
}
