/**
 * 3D Drag API (public for tests): initiate a token drag by its grid coords.
 * Records original position but does not mutate token grid yet.
 */
export function startTokenDragByGrid(gm, gx, gy) {
  if (!gm.is3DModeActive()) return false;
  if (gm._draggingToken) return false; // already dragging
  const token = (gm.placedTokens || []).find((t) => t.gridX === gx && t.gridY === gy);
  if (!token) return false;
  gm._draggingToken = token;
  gm._dragStart = { gx, gy };
  gm._dragLastPreview = { gx, gy };
  try {
    if (typeof window !== 'undefined') {
      (window.__TT_METRICS__ = window.__TT_METRICS__ || {}).interaction =
        window.__TT_METRICS__.interaction || {};
      window.__TT_METRICS__.interaction.dragActive = true;
    }
  } catch (_) {
    /* ignore */
  }
  return true;
}

/** Update drag preview (token mesh position only) without committing logical grid. */
export function updateTokenDragToGrid(gm, gx, gy) {
  if (!gm._draggingToken) return false;
  if (!Number.isFinite(gx) || !Number.isFinite(gy)) return false;
  if (gm._dragLastPreview && gm._dragLastPreview.gx === gx && gm._dragLastPreview.gy === gy)
    return true; // no change
  gm._dragLastPreview = { gx, gy };
  // Live-move mesh (visual feedback)
  try {
    const t = gm._draggingToken;
    const mesh = t.__threeMesh;
    if (mesh && gm.spatial && typeof gm.spatial.gridToWorld === 'function') {
      const world = gm.spatial.gridToWorld(gx + 0.5, gy + 0.5, 0);
      let terrainH = 0;
      try {
        terrainH = (gm.getTerrainHeight?.(gx, gy) || 0) * gm.spatial.elevationUnit;
      } catch (_) {
        /* ignore */
      }
      mesh.position.set(world.x, terrainH, world.z);
    }
  } catch (_) {
    /* ignore */
  }
  return true;
}

/** Commit the drag (apply grid change) */
export function commitTokenDrag(gm) {
  if (!gm._draggingToken) return false;
  const token = gm._draggingToken;
  const from = { ...(gm._dragStart || { gx: token.gridX, gy: token.gridY }) };
  const to = { ...(gm._dragLastPreview || from) };
  try {
    token.gridX = to.gx;
    token.gridY = to.gy;
    // After committing, ensure mesh Y aligns with terrain bias via adapter (if any)
    try {
      gm.token3DAdapter?.resyncHeights?.();
    } catch (_) {
      /* ignore */
    }
    if (typeof window !== 'undefined') {
      (window.__TT_METRICS__ = window.__TT_METRICS__ || {}).interaction =
        window.__TT_METRICS__.interaction || {};
      window.__TT_METRICS__.interaction.lastTokenDragGrid = { from, to };
      window.__TT_METRICS__.interaction.dragActive = false;
    }
  } catch (_) {
    /* ignore */
  } finally {
    gm._draggingToken = null;
    gm._dragStart = null;
    gm._dragLastPreview = null;
  }
  return true;
}

/** Cancel current drag reverting mesh to original grid (does not change logical token position) */
export function cancelTokenDrag(gm) {
  if (!gm._draggingToken) return false;
  try {
    const token = gm._draggingToken;
    const orig = gm._dragStart || { gx: token.gridX, gy: token.gridY };
    const mesh = token.__threeMesh;
    if (mesh && gm.spatial) {
      const world = gm.spatial.gridToWorld(orig.gx + 0.5, orig.gy + 0.5, 0);
      let terrainH = 0;
      try {
        terrainH = (gm.getTerrainHeight?.(orig.gx, orig.gy) || 0) * gm.spatial.elevationUnit;
      } catch (_) {
        /* ignore */
      }
      mesh.position.set(world.x, terrainH, world.z);
    }
    if (typeof window !== 'undefined') {
      (window.__TT_METRICS__ = window.__TT_METRICS__ || {}).interaction =
        window.__TT_METRICS__.interaction || {};
      window.__TT_METRICS__.interaction.dragActive = false;
    }
  } catch (_) {
    /* ignore */
  } finally {
    gm._draggingToken = null;
    gm._dragStart = null;
    gm._dragLastPreview = null;
  }
  return true;
}
