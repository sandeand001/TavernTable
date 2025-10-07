export function removeToken(c, token) {
  token.creature.removeFromStage();
  c.placedTokens = c.placedTokens.filter((t) => t !== token);
  // Phase 3: notify 3D adapter for cleanup if hybrid mode active
  try {
    const gm = c.gameManager;
    if (
      gm?.is3DModeActive?.() &&
      gm.token3DAdapter &&
      typeof gm.token3DAdapter.onTokenRemoved === 'function'
    ) {
      gm.token3DAdapter.onTokenRemoved(token);
    }
  } catch (_) {
    /* non-fatal */
  }
}
