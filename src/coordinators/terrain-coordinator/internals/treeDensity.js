// ── Tree Density Helpers ────────────────────────────────────────
// Extracted from TerrainCoordinator. Each fn receives the coordinator (c).

export function getTreeDensityMultiplier(c) {
  return Number.isFinite(c._treeDensityMultiplier) ? c._treeDensityMultiplier : 1;
}

export function setTreeDensityMultiplier(c, multiplier) {
  const numeric = Number(multiplier);
  const clamped = Number.isFinite(numeric) && numeric >= 0 ? numeric : 1;
  c._treeDensityMultiplier = clamped;
  if (typeof window !== 'undefined') {
    window.treeDensityMultiplier = clamped;
  }
  return c._treeDensityMultiplier;
}
