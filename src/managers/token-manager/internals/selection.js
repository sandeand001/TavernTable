import { GameValidators } from '../../../utils/Validation.js';
import { getCreatureButtons, getTokenButtonByType, getTokenInfoEl } from '../../../ui/domHelpers.js';

export function findExistingTokenAt(c, gridX, gridY) {
  // Previously this matched tokens in adjacent cells which caused
  // accidental removals/moves when clicking nearby tiles. Only return
  // a token if it exactly occupies the requested grid cell.
  return c.placedTokens.find(token => (
    Number.isFinite(token.gridX) && Number.isFinite(token.gridY) &&
    token.gridX === gridX && token.gridY === gridY
  ));
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
  getCreatureButtons().forEach(btn => {
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
    infoEl.textContent = tokenType === 'remove' ? 'Click on tokens to remove them' : `Click on grid to place ${tokenType}`;
  }
}
