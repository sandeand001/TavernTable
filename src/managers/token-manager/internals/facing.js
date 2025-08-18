import { getFacingButton } from '../../../ui/domHelpers.js';
export function toggleFacing(c) {
  c.tokenFacingRight = !c.tokenFacingRight;

  const facingBtn = getFacingButton();
  if (facingBtn) {
    facingBtn.textContent = c.tokenFacingRight ? '➡️ Right' : '⬅️ Left';
  }
}
