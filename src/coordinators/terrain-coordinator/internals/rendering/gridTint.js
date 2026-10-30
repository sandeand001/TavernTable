// ── Terrain Mode Grid Tint Helpers ──────────────────────────────
// Extracted from TerrainCoordinator. Each fn receives the coordinator (c).

import { TERRAIN_CONFIG } from '../../../../config/terrain/TerrainConstants.js';

/** Apply editing opacity and refresh mode-dependent vertex colors. */
export function applyTerrainModeGridTint(c) {
  const gm = c.gameManager;
  if (!gm) return;
  c._gridTintApplied = false;
  const meshAlpha =
    typeof TERRAIN_CONFIG.TERRAIN_MODE_MESH_ALPHA === 'number'
      ? TERRAIN_CONFIG.TERRAIN_MODE_MESH_ALPHA
      : 0.55;
  gm.threeSceneManager?.setTerrainMeshOpacity?.(meshAlpha);
  gm.terrainRebuilder?.request({});
}

/** Refresh normal colors after edited heights have been committed. */
export function restoreTerrainModeGridTint(c) {
  const gm = c.gameManager;
  if (!gm) return;
  gm.threeSceneManager?.setTerrainMeshOpacity?.(1);
  gm.terrainRebuilder?.request({});
  c._gridTintApplied = false;
}
