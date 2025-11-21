import { GameValidators } from '../../../utils/Validation.js';
import { normalizeCreatureType } from '../../../config/GameConstants.js';
function getPorts(c) {
  const dp = (c && c.domPorts) || {};
  const fb = {
    getCreatureButtons: () =>
      typeof document !== 'undefined'
        ? Array.from(document.querySelectorAll('[data-creature]'))
        : [],
    getTokenButtonByType: (type) =>
      typeof document !== 'undefined' ? document.querySelector(`[data-creature="${type}"]`) : null,
    getTokenInfoEl: () =>
      typeof document !== 'undefined' ? document.querySelector('[data-token-info]') : null,
  };
  return {
    getCreatureButtons: dp.getCreatureButtons || fb.getCreatureButtons,
    getTokenButtonByType: dp.getTokenButtonByType || fb.getTokenButtonByType,
    getTokenInfoEl: dp.getTokenInfoEl || fb.getTokenInfoEl,
  };
}

export function findExistingTokenAt(c, gridX, gridY) {
  return c.placedTokens.find((token) => {
    const diffX = Math.abs(token.gridX - gridX);
    const diffY = Math.abs(token.gridY - gridY);
    return diffX <= 1 && diffY <= 1 && diffX + diffY <= 1;
  });
}

export function selectToken(c, tokenType) {
  let canonicalType = tokenType;
  // Validate token type (except 'remove')
  if (tokenType !== 'remove') {
    const typeValidation = GameValidators.creatureType(tokenType);
    if (!typeValidation.isValid) {
      throw new Error(`Invalid token type: ${typeValidation.getErrorMessage()}`);
    }
    canonicalType = typeValidation.normalizedType || normalizeCreatureType(tokenType);
  }

  if (canonicalType !== 'remove') {
    canonicalType = normalizeCreatureType(canonicalType);
  }

  // Update UI selection
  const { getCreatureButtons, getTokenButtonByType, getTokenInfoEl } = getPorts(c);
  getCreatureButtons().forEach((btn) => {
    btn.classList.remove('selected');
    btn.setAttribute('aria-pressed', 'false');
  });
  const tokenButton = getTokenButtonByType(canonicalType);
  if (tokenButton) {
    tokenButton.classList.add('selected');
    tokenButton.setAttribute('aria-pressed', 'true');
  }

  if (typeof c.setSelectedTokenType === 'function') {
    c.setSelectedTokenType(canonicalType);
  } else {
    c.selectedTokenType = canonicalType;
    if (typeof window !== 'undefined') {
      window.selectedTokenType = canonicalType;
    }
  }

  if (window.sidebarController) {
    window.sidebarController.updateTokenSelection(canonicalType);
  }
  const infoEl = getTokenInfoEl();
  if (infoEl) {
    infoEl.textContent =
      canonicalType === 'remove'
        ? 'Click on tokens to remove them'
        : `Click on grid to place ${canonicalType}`;
  }
}
