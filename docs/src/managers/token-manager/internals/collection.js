import { logger, LOG_CATEGORY } from '../../../utils/Logger.js';

export function addTokenToCollection(c, creature, gridX, gridY, selectedTokenType = null, placedTokens = null) {
  // Use provided parameters or fall back to instance properties
  const tokenType = selectedTokenType || c.selectedTokenType;
  const tokens = placedTokens || c.placedTokens;

  const newTokenData = {
    creature: creature,
    gridX: gridX,
    gridY: gridY,
    type: tokenType
  };
  tokens.push(newTokenData);

  // Set up right-click drag system for all tokens
  if (creature && creature.sprite) {
    c.setupTokenInteractions(creature.sprite, newTokenData);
  }

  logger.debug('Token added to collection', {
    type: tokenType,
    grid: { x: gridX, y: gridY },
    total: tokens.length
  }, LOG_CATEGORY.SYSTEM);
}
