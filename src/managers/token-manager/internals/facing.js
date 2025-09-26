// UI decoupling: retrieve facing button via injected domPorts (set by UI layer) with fallback query.
// Tests (TokenManagerMisc.test) create a button with id="facing-right" and expect text toggling.
function getFacingButtonPort(c) {
  if (c?.domPorts?.getFacingButton) return c.domPorts.getFacingButton();
  if (typeof document === 'undefined') return null;
  // Prefer id used in existing UI helpers / tests.
  return document.getElementById('facing-right');
}

export function toggleFacing(c) {
  // Default initial orientation if field absent.
  if (typeof c.tokenFacingRight !== 'boolean') c.tokenFacingRight = true;
  c.tokenFacingRight = !c.tokenFacingRight;
  const facingBtn = getFacingButtonPort(c);
  if (facingBtn) facingBtn.textContent = c.tokenFacingRight ? '➡️ Right' : '⬅️ Left';
  // Apply horizontal flip to existing token sprites (2D) so user sees orientation change immediately.
  try {
    const all = (c.placedTokens || c.gameManager?.placedTokens || []).filter(Boolean);
    const sign = c.tokenFacingRight ? 1 : -1;
    for (const t of all) {
      const sprite = t?.creature?.sprite;
      if (!sprite) continue;
      if (!sprite.scale) sprite.scale = { x: 1, y: 1 };
      const current = sprite.scale.x || 1;
      sprite.scale.x = sign * Math.abs(current);
    }
  } catch (_) {
    /* ignore sprite flip errors */
  }
  return c.tokenFacingRight;
}
