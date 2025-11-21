import { GameValidators } from '../../../utils/Validation.js';
import { normalizeCreatureType } from '../../../config/GameConstants.js';

// UI decoupling: DOM access now routed through c.domPorts (injected by UI layer) with fallbacks.
function getPorts(c) {
  const dp = (c && c.domPorts) || {};
  const fallback = {
    getCreatureButtons: () => {
      if (typeof document === 'undefined') return [];
      return Array.from(document.querySelectorAll('[data-creature]'));
    },
    getTokenButtonByType: (type) => {
      if (typeof document === 'undefined') return null;
      return document.querySelector(`[data-creature="${type}"]`);
    },
    getTokenInfoEl: () =>
      typeof document !== 'undefined' ? document.querySelector('[data-token-info]') : null,
  };
  return {
    getCreatureButtons: dp.getCreatureButtons || fallback.getCreatureButtons,
    getTokenButtonByType: dp.getTokenButtonByType || fallback.getTokenButtonByType,
    getTokenInfoEl: dp.getTokenInfoEl || fallback.getTokenInfoEl,
  };
}

export function findExistingTokenAt(c, gridX, gridY) {
  // Previously this matched tokens in adjacent cells which caused
  // accidental removals/moves when clicking nearby tiles. Only return
  // a token if it exactly occupies the requested grid cell.
  return c.placedTokens.find(
    (token) =>
      Number.isFinite(token.gridX) &&
      Number.isFinite(token.gridY) &&
      token.gridX === gridX &&
      token.gridY === gridY
  );
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
