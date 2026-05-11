// ── In-Place Tile Update ───────────────────────────────────────────

/**
 * In 3D mode all geometry lives in the Three.js terrain mesh; there are no
 * 2D sprite tiles to update in-place.  Always returns false so callers know
 * to skip the replacement path (which also no-ops — see TileLifecycleController).
 */
export function updateBaseGridTileInPlace(_c, _x, _y, _height) {
  // 2D sprite tiles no longer exist in 3D mode; always signal "no existing tile found".
  return false;
}

// ── Tile Replacement ──────────────────────────────────────────────

/** No-op in 3D mode: terrain mesh is updated via notifyTerrainHeightsChanged. */
export function replaceBaseGridTile(_c, _x, _y, _height) {
  // 2D sprite replacement removed; Three.js mesh handles terrain geometry.
}
