import { GameValidators } from '../../../utils/Validation.js';

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
  // Validate token type (except 'remove')
  if (tokenType !== 'remove') {
    const typeValidation = GameValidators.creatureType(tokenType);
    if (!typeValidation.isValid) {
      throw new Error(`Invalid token type: ${typeValidation.getErrorMessage()}`);
    }
  }

  // Update UI selection
  const { getCreatureButtons, getTokenButtonByType, getTokenInfoEl } = getPorts(c);
  getCreatureButtons().forEach((btn) => {
    btn.classList.remove('selected');
    btn.setAttribute('aria-pressed', 'false');
  });
  const tokenButton = getTokenButtonByType(tokenType);
  if (tokenButton) {
    tokenButton.classList.add('selected');
    tokenButton.setAttribute('aria-pressed', 'true');
  }

  c.selectedTokenType = tokenType;
  if (typeof window !== 'undefined') {
    window.selectedTokenType = tokenType;
  }

  if (window.sidebarController) {
    window.sidebarController.updateTokenSelection(tokenType);
  }
  const infoEl = getTokenInfoEl();
  if (infoEl) {
    infoEl.textContent =
      tokenType === 'remove'
        ? 'Click on tokens to remove them'
        : `Click on grid to place ${tokenType}`;
  }
}
