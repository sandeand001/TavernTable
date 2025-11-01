import { logger, LOG_CATEGORY } from '../../../utils/Logger.js';

export function addTokenToCollection(
  c,
  creature,
  gridX,
  gridY,
  selectedTokenType = null,
  placedTokens = null
) {
  // Use provided parameters or fall back to instance properties
  const tokenType = selectedTokenType || c.selectedTokenType;
  const tokens = placedTokens || c.placedTokens;

  const newTokenData = {
    creature: creature,
    gridX: gridX,
    gridY: gridY,
    type: tokenType,
    facingAngle: 0,
    // Persist original placement grid (for stable reprojection cycles)
    __originGridX: gridX,
    __originGridY: gridY,
    // Phase 0 (3D Transition): canonical world position snapshot
    // We derive elevation from terrain data store (if present) so future 3D scene can place the mesh/billboard.
    world: (() => {
      try {
        const gm = c.gameManager;
        const height = gm?.terrainCoordinator?.dataStore?.get(gridX, gridY) ?? 0;
        if (gm?.spatial && typeof gm.spatial.gridToWorld === 'function') {
          return gm.spatial.gridToWorld(gridX, gridY, height);
        }
      } catch (_) {
        /* ignore */
      }
      return { x: 0, y: 0, z: 0 };
    })(),
  };
  tokens.push(newTokenData);

  // Establish baseIsoY if creature sprite present (prevents cumulative drift when toggling view modes)
  try {
    const sprite = creature?.sprite;
    if (sprite && typeof sprite.baseIsoY !== 'number') {
      sprite.baseIsoY = sprite.y;
    }
  } catch (_) {
    /* ignore */
  }

  // Phase 3 hook: if in hybrid mode and adapter present, request 3D billboard creation
  try {
    const gm = c.gameManager;
    if (
      gm?.is3DModeActive?.() &&
      gm.token3DAdapter &&
      typeof gm.token3DAdapter.onTokenAdded === 'function'
    ) {
      gm.token3DAdapter.onTokenAdded(newTokenData);
      if (typeof gm.token3DAdapter.setSelectedToken === 'function') {
        gm.token3DAdapter.setSelectedToken(newTokenData);
      }
    }
  } catch (_) {
    /* non-fatal */
  }

  // Set up right-click drag system for all tokens
  if (creature && creature.sprite) {
    c.setupTokenInteractions(creature.sprite, newTokenData);
  }

  logger.debug(
    'Token added to collection',
    {
      type: tokenType,
      grid: { x: gridX, y: gridY },
      total: tokens.length,
    },
    LOG_CATEGORY.SYSTEM
  );
}
