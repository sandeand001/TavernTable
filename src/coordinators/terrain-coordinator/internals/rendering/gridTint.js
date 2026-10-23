// ── Terrain Mode Grid Tint Helpers ──────────────────────────────
// Extracted from TerrainCoordinator. Each fn receives the coordinator (c).

import { TERRAIN_CONFIG } from '../../../../config/terrain/TerrainConstants.js';

/** Apply overlay mesh opacity when entering terrain mode. */
export function applyTerrainModeGridTint(c) {
  const gm = c.gameManager;
  if (!gm) return;
  c._gridTintApplied = false;
  const meshAlpha =
    typeof TERRAIN_CONFIG.TERRAIN_MODE_MESH_ALPHA === 'number'
      ? TERRAIN_CONFIG.TERRAIN_MODE_MESH_ALPHA
      : 0.55;
  try {
    gm.threeSceneManager?.setTerrainMeshOpacity?.(meshAlpha);
  } catch (_) {
    /* non-fatal */
  }
}

/** Restore full mesh opacity when exiting terrain mode. */
export function restoreTerrainModeGridTint(c) {
  const gm = c.gameManager;
  if (!gm) return;
  try {
    gm.threeSceneManager?.setTerrainMeshOpacity?.(1);
  } catch (_) {
    /* non-fatal */
  }
  c._gridTintApplied = false;
}
