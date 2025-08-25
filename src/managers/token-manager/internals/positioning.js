import { CoordinateUtils } from '../../../utils/CoordinateUtils.js';
import { TerrainHeightUtils } from '../../../utils/TerrainHeightUtils.js';
import { logger, LOG_CATEGORY } from '../../../utils/Logger.js';
import { ErrorHandler, ERROR_SEVERITY, ERROR_CATEGORY } from '../../../utils/ErrorHandler.js';

export function snapTokenToGrid(c, token, pointerLocalX = null, pointerLocalY = null) {
  try {
    const localX = (pointerLocalX !== null && pointerLocalY !== null) ? pointerLocalX : token.x;
    const localY = (pointerLocalX !== null && pointerLocalY !== null) ? pointerLocalY : token.y;

    let target = null;
    // Remember original token entry so we can prefer snapping back to it
    const tokenEntry = c.placedTokens.find(t => t.creature && t.creature.sprite === token);
    try {
      const im = c.gameManager?.interactionManager;
      if (im && typeof im.pickTopmostGridCellAt === 'function') {
        const picked = im.pickTopmostGridCellAt(localX, localY);
        if (picked) {
          // If picked cell is occupied by another token, prefer original token cell (if available)
          const occupying = c.placedTokens.find(t => t.gridX === picked.gridX && t.gridY === picked.gridY && t.creature && t.creature.sprite !== token);
          if (occupying) {
            if (tokenEntry) {
              target = { gridX: tokenEntry.gridX, gridY: tokenEntry.gridY };
            } else {
              // leave target null so fallback candidate logic runs
              target = null;
            }
          } else {
            target = picked;
          }
        }
      }
    } catch (_) { /* ignore and fallback */ }

    if (!target) {
      // Use continuous grid coords to produce a ranked candidate list instead
      // of a single rounded value. This reduces incorrect rounding when the
      // pointer lies near tile boundaries.
      const coarse = CoordinateUtils.isometricToGrid(localX, localY, c.gameManager.tileWidth, c.gameManager.tileHeight);
      const gxF = typeof coarse.gridXf === 'number' ? coarse.gridXf : coarse.gridX;
      const gyF = typeof coarse.gridYf === 'number' ? coarse.gridYf : coarse.gridY;

      const candidates = [];
      const pushIfValid = (gx, gy) => {
        if (CoordinateUtils.isValidGridPosition(gx, gy, c.gameManager.cols, c.gameManager.rows)) {
          // Skip tiles occupied by another token (allow own original tile)
          const occupying = c.placedTokens.find(t => t.gridX === gx && t.gridY === gy && t.creature && t.creature.sprite !== token);
          if (occupying) return;

          // compute center and distance metric (manhattan-like normalized) to rank
          const baseX = (gx - gy) * (c.gameManager.tileWidth / 2);
          const baseY = (gx + gy) * (c.gameManager.tileHeight / 2);
          const cx = baseX + (c.gameManager.tileWidth / 2);
          const cy = baseY + (c.gameManager.tileHeight / 2);
          const dx = Math.abs(localX - cx);
          const dy = Math.abs(localY - cy);
          const halfW = c.gameManager.tileWidth / 2;
          const halfH = c.gameManager.tileHeight / 2;
          const score = (dx / halfW + dy / halfH);
          candidates.push({ gx, gy, score });
        }
      };

      const centerGX = Math.round(gxF);
      const centerGY = Math.round(gyF);
      // check a 1-cell radius around fractional center ordered by proximity
      const search = [
        [centerGX, centerGY],
        [centerGX + 1, centerGY],
        [centerGX, centerGY + 1],
        [centerGX - 1, centerGY],
        [centerGX, centerGY - 1],
        [centerGX + 1, centerGY + 1],
        [centerGX - 1, centerGY - 1],
        [centerGX + 1, centerGY - 1],
        [centerGX - 1, centerGY + 1]
      ];
      for (const [gx, gy] of search) pushIfValid(gx, gy);

      if (candidates.length) {
        candidates.sort((a, b) => a.score - b.score);
        target = { gridX: candidates[0].gx, gridY: candidates[0].gy };
      } else {
        // Fallback: if preferred rounded cell is occupied by another token,
        // prefer the token's original cell (if available) or clamp to grid.
        const rounded = { gx: Math.round(gxF), gy: Math.round(gyF) };
        const occupied = c.placedTokens.find(t => t.gridX === rounded.gx && t.gridY === rounded.gy && t.creature && t.creature.sprite !== token);
        if (!occupied) {
          target = CoordinateUtils.clampToGrid(rounded.gx, rounded.gy, c.gameManager.cols, c.gameManager.rows);
        } else {
          // try original token cell
          if (tokenEntry) {
            target = { gridX: tokenEntry.gridX, gridY: tokenEntry.gridY };
          } else {
            target = CoordinateUtils.clampToGrid(rounded.gx, rounded.gy, c.gameManager.cols, c.gameManager.rows);
          }
        }
      }
    }

    // Final collision safety: if target is occupied by another token, snap back to original token cell
    const collision = c.placedTokens.find(t => t.gridX === target.gridX && t.gridY === target.gridY && t.creature && t.creature.sprite !== token);
    if (collision) {
      if (tokenEntry) {
        target = { gridX: tokenEntry.gridX, gridY: tokenEntry.gridY };
      }
    }

    // Compute isometric coordinates and elevation after final target resolution
    const finalIso = CoordinateUtils.gridToIsometric(target.gridX, target.gridY, c.gameManager.tileWidth, c.gameManager.tileHeight);
    let elevationOffset = 0;
    try {
      const height = c.gameManager?.terrainCoordinator?.dataStore?.get(target.gridX, target.gridY) ?? 0;
      elevationOffset = TerrainHeightUtils.calculateElevationOffset(height);
    } catch (_) { /* ignore */ }

    token.x = finalIso.x;
    token.y = finalIso.y + elevationOffset;
    const newDepth = target.gridX + target.gridY;
    token.zIndex = newDepth * 100 + 1;

    if (tokenEntry) {
      tokenEntry.gridX = target.gridX;
      tokenEntry.gridY = target.gridY;
      logger.debug(`Token snapped to grid (${target.gridX}, ${target.gridY})`, {
        coordinates: target,
        originalPosition: { localX, localY },
        newPosition: finalIso
      }, LOG_CATEGORY.USER);
    }
  } catch (error) {
    const errorHandler = new ErrorHandler();
    errorHandler.handle(error, ERROR_SEVERITY.WARNING, ERROR_CATEGORY.INPUT, {
      stage: 'snapToGrid',
      tokenPosition: { x: token.x, y: token.y }
    });
  }
}
