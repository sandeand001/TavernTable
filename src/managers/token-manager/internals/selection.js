import { GameValidators } from '../../../utils/Validation.js';

export function findExistingTokenAt(c, gridX, gridY) {
  return c.placedTokens.find(token => {
    const diffX = Math.abs(token.gridX - gridX);
    const diffY = Math.abs(token.gridY - gridY);
    return diffX <= 1 && diffY <= 1 && (diffX + diffY) <= 1;
  });
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
  document.querySelectorAll('#creature-content button[id^="token-"], #token-remove').forEach(btn => {
    btn.classList.remove('selected');
    btn.setAttribute('aria-pressed', 'false');
  });
  const tokenButton = document.getElementById(`token-${tokenType}`);
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
  const infoEl = document.getElementById('token-info');
  if (infoEl) {
    infoEl.textContent = tokenType === 'remove' ? 'Click on tokens to remove them' : `Click on grid to place ${tokenType}`;
  }
}
