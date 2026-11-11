import { logger, LOG_CATEGORY } from '../../../utils/logger/Logger.js';
import { TOKEN_MOVEMENT_DEFAULTS } from '../../../config/TokenMovementConfig.js';
import { normalizeCreatureType } from '../../../entities/creatures/creatureHelpers.js';
import { getAutomaticCreatureName } from '../../../entities/creatures/CreatureNames.js';

// ── Token Registration ─────────────────────────────────────────

export function addTokenToCollection(
  c,
  creature,
  gridX,
  gridY,
  selectedTokenType = null,
  placedTokens = null,
  checkpoint = null
) {
  const game = c.gameManager;
  if (
    game?.playerInput ||
    game?.characterServices?.sessionRole === 'player' ||
    game?.characterServices?.sheetContext === 'library'
  )
    throw new Error(
      'Sprite registration requires a host-authorized arrival grant and canonical player state'
    );
  // Use provided parameters or fall back to instance properties
  const tokenType = selectedTokenType || c.selectedTokenType;
  const tokens = placedTokens || c.placedTokens;
  const canonicalType = normalizeCreatureType(tokenType);
  c._tokenTypeCounts ||= new Map();
  const instanceNumber = (c._tokenTypeCounts.get(canonicalType) || 0) + 1;
  c._tokenTypeCounts.set(canonicalType, instanceNumber);
  c._nextTokenId = (c._nextTokenId || 0) + 1;

  const newTokenData = {
    id: checkpoint ? checkpoint.id : `token-${c._nextTokenId}`,
    instanceNumber: checkpoint ? checkpoint.instanceNumber : instanceNumber,
    name: checkpoint ? checkpoint.name : getAutomaticCreatureName(canonicalType, instanceNumber),
    nameMode: checkpoint ? checkpoint.nameMode : 'automatic',
    ...(checkpoint?.characterId ? { characterSheetId: checkpoint.characterId } : {}),
    movementSettings: { ...TOKEN_MOVEMENT_DEFAULTS },
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
      if (checkpoint) return { ...checkpoint.pose.world };
      try {
        const gm = c.gameManager;
        const height = gm?.getTerrainHeight?.(gridX, gridY) ?? 0;
        if (gm?.spatial && typeof gm.spatial.gridToWorld === 'function') {
          return gm.spatial.gridToWorld(gridX + 0.5, gridY + 0.5, height);
        }
      } catch (_) {
        /* ignore */
      }
      return { x: 0, y: 0, z: 0 };
    })(),
  };
  if (c.gameManager?.campaignWorld)
    newTokenData.mapId = checkpoint ? checkpoint.mapId : c.gameManager.campaignMapId;
  tokens.push(newTokenData);
  c.gameManager?.sceneAutosave?.changed('creature placed');
  if (instanceNumber > 1) {
    const duplicates = tokens.filter(
      (token) => normalizeCreatureType(token.type) === canonicalType
    );
    for (const token of duplicates) {
      if (!token.characterSheetId && (!token.nameMode || token.nameMode === 'automatic')) {
        token.name = getAutomaticCreatureName(canonicalType, token.instanceNumber, instanceNumber);
      }
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('taverntable:tokenNamesChanged', {
          detail: { tokens: duplicates, gameManager: c.gameManager },
        })
      );
    }
  }

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
      gm.token3DAdapter.onTokenAdded(newTokenData, checkpoint);
      if (!checkpoint && typeof gm.token3DAdapter.setSelectedToken === 'function') {
        gm.token3DAdapter.setSelectedToken(newTokenData);
      }
    }
  } catch (_) {
    /* non-fatal */
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
