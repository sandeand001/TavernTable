import { CoordinateUtils } from '../../../utils/CoordinateUtils.js';
import { TerrainHeightUtils } from '../../../utils/TerrainHeightUtils.js';
import { logger, LOG_CATEGORY } from '../../../utils/Logger.js';
// Depth utils no longer used for token layering; use tile depth bands instead.
import { ErrorHandler, ERROR_SEVERITY, ERROR_CATEGORY } from '../../../utils/ErrorHandler.js';

export function snapTokenToGrid(c, token, pointerLocalX = null, pointerLocalY = null) {
  try {
    const localX = pointerLocalX !== null && pointerLocalY !== null ? pointerLocalX : token.x;
    const localY = pointerLocalX !== null && pointerLocalY !== null ? pointerLocalY : token.y;

    let target = null;
    // Remember original token entry so we can prefer snapping back to it
    const tokenEntry = c.placedTokens.find((t) => t.creature && t.creature.sprite === token);
    // Helper: does this grid cell have a blocking placeable (trees/plants or structures)?
    const hasBlockingPlaceable = (gx, gy) => {
      try {
        const tm = c?.gameManager?.terrainManager;
        const map = tm?.placeables;
        if (!map || !map.size) return false;
        const key = `${gx},${gy}`;
        if (!map.has(key)) return false;
        const list = map.get(key);
        if (!Array.isArray(list)) return false;
        return list.some(
          (p) => p && (p.placeableType === 'plant' || p.placeableType === 'structure')
        );
      } catch (_) {
        return false;
      }
    };

    try {
      const im = c.gameManager?.interactionManager;
      if (im && typeof im.pickTopmostGridCellAt === 'function') {
        const picked = im.pickTopmostGridCellAt(localX, localY);
        if (picked) {
          // If picked cell is occupied by another token, prefer original token cell (if available)
          const occupying = c.placedTokens.find(
            (t) =>
              t.gridX === picked.gridX &&
              t.gridY === picked.gridY &&
              t.creature &&
              t.creature.sprite !== token
          );
          const blocked = hasBlockingPlaceable(picked.gridX, picked.gridY);
          if (occupying || blocked) {
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
    } catch (_) {
      /* ignore and fallback */
    }

    if (!target) {
      // Use continuous grid coords to produce a ranked candidate list instead
      // of a single rounded value. This reduces incorrect rounding when the
      // pointer lies near tile boundaries.
      const coarse = CoordinateUtils.isometricToGrid(
        localX,
        localY,
        c.gameManager.tileWidth,
        c.gameManager.tileHeight
      );
      const gxF = typeof coarse.gridXf === 'number' ? coarse.gridXf : coarse.gridX;
      const gyF = typeof coarse.gridYf === 'number' ? coarse.gridYf : coarse.gridY;

      const candidates = [];
      const pushIfValid = (gx, gy) => {
        const valid = CoordinateUtils.isValidGridPosition(
          gx,
          gy,
          c.gameManager.cols,
          c.gameManager.rows
        );
        if (valid) {
          // Skip tiles occupied by another token (allow own original tile)
          const occupying = c.placedTokens.find(
            (t) => t.gridX === gx && t.gridY === gy && t.creature && t.creature.sprite !== token
          );
          if (occupying) return;
          // Skip tiles blocked by placeables (trees/plants or structures)
          if (hasBlockingPlaceable(gx, gy)) return;

          // compute center and distance metric (manhattan-like normalized) to rank
          const baseX = (gx - gy) * (c.gameManager.tileWidth / 2);
          const baseY = (gx + gy) * (c.gameManager.tileHeight / 2);
          const cx = baseX + c.gameManager.tileWidth / 2;
          const cy = baseY + c.gameManager.tileHeight / 2;
          const dx = Math.abs(localX - cx);
          const dy = Math.abs(localY - cy);
          const halfW = c.gameManager.tileWidth / 2;
          const halfH = c.gameManager.tileHeight / 2;
          const score = dx / halfW + dy / halfH;
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
        [centerGX - 1, centerGY + 1],
      ];
      for (const [gx, gy] of search) pushIfValid(gx, gy);

      if (candidates.length) {
        candidates.sort((a, b) => a.score - b.score);
        target = { gridX: candidates[0].gx, gridY: candidates[0].gy };
      } else {
        // Fallback: if preferred rounded cell is occupied by another token,
        // prefer the token's original cell (if available) or clamp to grid.
        const rounded = { gx: Math.round(gxF), gy: Math.round(gyF) };
        const occupied = c.placedTokens.find(
          (t) =>
            t.gridX === rounded.gx &&
            t.gridY === rounded.gy &&
            t.creature &&
            t.creature.sprite !== token
        );
        const blocked = hasBlockingPlaceable(rounded.gx, rounded.gy);
        if (!occupied && !blocked) {
          target = CoordinateUtils.clampToGrid(
            rounded.gx,
            rounded.gy,
            c.gameManager.cols,
            c.gameManager.rows
          );
        } else {
          // If rounded cell is blocked/occupied, pick nearest unblocked candidate in a small radius
          const findNearest = () => {
            for (let r = 1; r <= 2; r++) {
              const ring = [
                [rounded.gx + r, rounded.gy],
                [rounded.gx - r, rounded.gy],
                [rounded.gx, rounded.gy + r],
                [rounded.gx, rounded.gy - r],
                [rounded.gx + r, rounded.gy + r],
                [rounded.gx - r, rounded.gy - r],
                [rounded.gx + r, rounded.gy - r],
                [rounded.gx - r, rounded.gy + r],
              ];
              for (const [gx, gy] of ring) {
                if (
                  !CoordinateUtils.isValidGridPosition(
                    gx,
                    gy,
                    c.gameManager.cols,
                    c.gameManager.rows
                  )
                )
                  continue;
                const occ = c.placedTokens.find(
                  (t) =>
                    t.gridX === gx && t.gridY === gy && t.creature && t.creature.sprite !== token
                );
                if (!occ && !hasBlockingPlaceable(gx, gy)) {
                  return { gridX: gx, gridY: gy };
                }
              }
            }
            return null;
          };
          const nearest = findNearest();
          if (nearest) {
            target = nearest;
          } else if (tokenEntry) {
            target = { gridX: tokenEntry.gridX, gridY: tokenEntry.gridY };
          } else {
            // No valid target; keep current position by bailing out early
            return;
          }
        }
      }
    }

    // Final collision safety: if target is occupied by another token, snap back to original token cell
    const collision = c.placedTokens.find(
      (t) =>
        t.gridX === target.gridX &&
        t.gridY === target.gridY &&
        t.creature &&
        t.creature.sprite !== token
    );
    const placeableBlocked = hasBlockingPlaceable(target.gridX, target.gridY);
    if (collision || placeableBlocked) {
      if (tokenEntry) {
        target = { gridX: tokenEntry.gridX, gridY: tokenEntry.gridY };
      }
    }

    // Compute isometric coordinates and elevation after final target resolution
    const finalIso = CoordinateUtils.gridToIsometric(
      target.gridX,
      target.gridY,
      c.gameManager.tileWidth,
      c.gameManager.tileHeight
    );
    let elevationOffset = 0;
    try {
      const height =
        c.gameManager?.terrainCoordinator?.dataStore?.get(target.gridX, target.gridY) ?? 0;
      elevationOffset = TerrainHeightUtils.calculateElevationOffset(height);
    } catch (_) {
      /* ignore */
    }
    token.x = finalIso.x;
    token.y = finalIso.y + elevationOffset;
    const depth = target.gridX + target.gridY;
    token.depthValue = depth;
    token.zIndex = depth * 100 + 70;
    // Ensure parent is terrainContainer for correct occlusion
    try {
      const tContainer =
        c.gameManager?.terrainManager?.terrainContainer || c.gameManager?.gridContainer;
      if (tContainer && token.parent !== tContainer) {
        if (token.parent) token.parent.removeChild(token);
        tContainer.addChild(token);
      }
      if (tContainer) {
        tContainer.sortableChildren = true;
        tContainer.sortChildren?.();
      }
    } catch (_) {
      /* ignore */
    }

    if (tokenEntry) {
      tokenEntry.gridX = target.gridX;
      tokenEntry.gridY = target.gridY;
      // Maintain world position snapshot (Phase 0). Use terrain height for elevation if available.
      try {
        const gm = c.gameManager;
        const height = gm?.terrainCoordinator?.dataStore?.get(target.gridX, target.gridY) ?? 0;
        const worldLockActive = Number(tokenEntry.__ttWorldLock) > 0;
        if (!worldLockActive && gm?.spatial && typeof gm.spatial.gridToWorld === 'function') {
          tokenEntry.world = gm.spatial.gridToWorld(target.gridX + 0.5, target.gridY + 0.5, height);
        }
      } catch (_) {
        /* ignore */
      }
      logger.debug(
        `Token snapped to grid (${target.gridX}, ${target.gridY})`,
        {
          coordinates: target,
          originalPosition: { localX, localY },
          newPosition: finalIso,
        },
        LOG_CATEGORY.USER
      );
    }
  } catch (error) {
    const errorHandler = new ErrorHandler();
    errorHandler.handle(error, ERROR_SEVERITY.WARNING, ERROR_CATEGORY.INPUT, {
      stage: 'snapToGrid',
      tokenPosition: { x: token.x, y: token.y },
    });
  }
}
