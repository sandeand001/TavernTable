// UI decoupling: docs mirror. Retrieve facing button via injected domPorts with fallback id lookup.
function getFacingButtonPort(c) {
    if (c?.domPorts?.getFacingButton) return c.domPorts.getFacingButton();
    if (typeof document === 'undefined') return null;
    return document.getElementById('facing-right');
}
export function toggleFacing(c) {
    if (typeof c.tokenFacingRight !== 'boolean') c.tokenFacingRight = true;
    c.tokenFacingRight = !c.tokenFacingRight;
    const btn = getFacingButtonPort(c);
    if (btn) btn.textContent = c.tokenFacingRight ? '➡️ Right' : '⬅️ Left';
    return c.tokenFacingRight;
}
