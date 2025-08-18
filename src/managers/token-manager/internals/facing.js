export function toggleFacing(c) {
  c.tokenFacingRight = !c.tokenFacingRight;

  const facingBtn = document.getElementById('facing-right');
  if (facingBtn) {
    facingBtn.textContent = c.tokenFacingRight ? '➡️ Right' : '⬅️ Left';
  }
}
