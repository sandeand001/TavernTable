// UI decoupling: retrieve facing button via injected domPorts (set by UI layer) with fallback query.
function getFacingButtonPort(c) {
  if (c?.domPorts?.getFacingButton) return c.domPorts.getFacingButton();
  if (typeof document === 'undefined') return null;
  return document.querySelector('[data-facing-button]');
}

export function toggleFacing(c) {
  c.tokenFacingRight = !c.tokenFacingRight;
  const facingBtn = getFacingButtonPort(c);
  if (facingBtn) facingBtn.textContent = c.tokenFacingRight ? '➡️ Right' : '⬅️ Left';
}
