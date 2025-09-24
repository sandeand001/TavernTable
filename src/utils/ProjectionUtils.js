/**
 * ProjectionUtils.js - CLEANED VERSION (incremental transition system removed)
 * ---------------------------------------------------------------------------
 * Provides synchronous reprojection between 'isometric' and 'topdown' modes.
 * Focus: correctness, clarity, minimal side-effects.
 */

import { logger, LOG_CATEGORY } from './Logger.js';

// Top-down zIndex bases (kept far apart to avoid collisions)
const TOPDOWN_TILE_BASE = 0;
const TOPDOWN_PLACEABLE_BASE = 500000;
const TOPDOWN_CREATURE_BASE = 1000000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function applyIsometricPosition(displayObject, gx, gy, gameManager) {
  if (!displayObject || !gameManager) return;
  const w = gameManager.tileWidth;
  const h = gameManager.tileHeight;
  const isoX = (gx - gy) * (w / 2);
  const isoY = (gx + gy) * (h / 2);
  displayObject.x = isoX;
  displayObject.y = isoY;
  displayObject.baseIsoY = isoY;
}

export function applyTopDownPosition(displayObject, gx, gy, gameManager) {
  if (!displayObject || !gameManager) return;
  const size = gameManager.tileWidth;
  displayObject.x = gx * size + size / 2;
  displayObject.y = gy * size + size / 2;
}

export function ensureTopDownSquare(tile, gameManager) {
  if (!tile || !gameManager) return null;
  if (tile.__topDownGraphic && tile.__topDownGraphic.__isTopDownSquare) {
    return tile.__topDownGraphic;
  }
  // eslint-disable-next-line no-undef
  const g = new PIXI.Graphics();
  g.__isTopDownSquare = true;
  g.__gridX = tile.__gridX;
  g.__gridY = tile.__gridY;
  const size = gameManager.tileWidth;
  try {
    const fill = tile.__currentFillColor || tile.__baseColor || 0x444444;
    g.clear();
    g.beginFill(fill, 1.0);
    g.lineStyle({ width: 1, color: 0x000000, alpha: 0.15 });
    g.drawRect(-size / 2, -size / 2, size, size);
    g.endFill();
  } catch (_) {
    /* ignore drawing errors */
  }
  tile.__topDownGraphic = g;
  gameManager.gridContainer.addChild(g);
  return g;
}

// ---------------------------------------------------------------------------
// Main reprojection
// ---------------------------------------------------------------------------

export function reprojectAll(gameManager, mode) {
  if (!gameManager || !gameManager.gridContainer) return;
  const isTopDown = mode === 'topdown';
  const gc = gameManager.gridContainer;
  const biomeVersion = gameManager.__biomeVersion || 0;

  try {
    // 1. Biome painter visibility
    try {
      gc.children.forEach((ch) => {
        if (ch && ch.__biomeLayer) {
          ch.visible = !isTopDown;
          ch.renderable = !isTopDown;
        }
      });
    } catch (_) {
      /* ignore biome visibility errors */
    }

    // 2. Tiles
    gc.children.forEach((child) => {
      if (child?.__isTopDownSquare) {
        child.visible = isTopDown;
        return;
      }
      if (!child?.isGridTile) return;

      if (!Number.isInteger(child.__gridX) || !Number.isInteger(child.__gridY)) {
        if (Number.isInteger(child.gridX) && Number.isInteger(child.gridY)) {
          child.__gridX = child.gridX;
          child.__gridY = child.gridY;
        }
      }
      const gx = child.__gridX;
      const gy = child.__gridY;
      if (!Number.isInteger(gx) || !Number.isInteger(gy)) {
        child.visible = !isTopDown;
        return;
      }

      if (typeof child.baseIsoY === 'number' && typeof child.__storedBaseIsoY === 'undefined') {
        child.__storedBaseIsoY = child.baseIsoY;
      }
      if (child.__elevationCacheBiomeVersion !== biomeVersion) {
        child.__storedElevationOffset = undefined;
      }
      if (
        typeof child.__storedElevationOffset === 'undefined' &&
        typeof child.baseIsoY === 'number'
      ) {
        child.__storedElevationOffset = child.y - child.baseIsoY;
        child.__elevationCacheBiomeVersion = biomeVersion;
      }

      const square = ensureTopDownSquare(child, gameManager);
      if (isTopDown) {
        child.visible = false;
        child.renderable = false;
        if (child.shadowTile) child.shadowTile.visible = false;
        if (child.sideFaces) child.sideFaces.visible = false;
        if (child.baseSideFaces) child.baseSideFaces.visible = false;
        if (child.paintLayer) child.paintLayer.visible = false;
        if (child.paintMask) child.paintMask.visible = false;
        if (square) {
          square.visible = true;
          applyTopDownPosition(square, gx, gy, gameManager);
          square.zIndex = gy * gameManager.cols + gx + TOPDOWN_TILE_BASE;
        }
      } else {
        child.visible = true;
        child.renderable = true;
        if (square) square.visible = false;
        applyIsometricPosition(child, gx, gy, gameManager);
        if (typeof child.__storedBaseIsoY === 'number') {
          child.baseIsoY = child.__storedBaseIsoY;
          child.y = child.baseIsoY;
        }
        if (typeof child.__storedElevationOffset === 'number') {
          child.y = child.baseIsoY + child.__storedElevationOffset;
        }
        child.zIndex = (gx + gy) * 100;
        if (child.shadowTile) child.shadowTile.visible = true;
        if (child.sideFaces) child.sideFaces.visible = true;
        if (child.baseSideFaces) child.baseSideFaces.visible = true;
        if (child.paintLayer) child.paintLayer.visible = true;
        if (child.paintMask) child.paintMask.visible = true;
      }
    });

    // 3. Placeables
    try {
      const placeablesMap = gameManager?.terrainCoordinator?.terrainManager?.placeables;
      if (placeablesMap && typeof placeablesMap.forEach === 'function') {
        placeablesMap.forEach((arr) => {
          if (!Array.isArray(arr)) return;
          arr.forEach((sprite) => {
            if (!sprite) return;
            if (!Number.isInteger(sprite.__gridX) || !Number.isInteger(sprite.__gridY)) {
              if (Number.isInteger(sprite.gridX) && Number.isInteger(sprite.gridY)) {
                sprite.__gridX = sprite.gridX;
                sprite.__gridY = sprite.gridY;
              }
            }
            const gx = sprite.__gridX;
            const gy = sprite.__gridY;
            if (!Number.isInteger(gx) || !Number.isInteger(gy)) return;
            if (!sprite.__originalIsoCaptured && mode === 'topdown') {
              sprite.__originalIsoCaptured = true;
              sprite.__originalIsoX = sprite.x;
              sprite.__originalIsoY = sprite.y;
            }
            if (isTopDown) {
              applyTopDownPosition(sprite, gx, gy, gameManager);
              sprite.zIndex = gy * gameManager.cols + gx + TOPDOWN_PLACEABLE_BASE;
            } else {
              if (sprite.__originalIsoCaptured) {
                sprite.x = sprite.__originalIsoX;
                sprite.y = sprite.__originalIsoY;
              } else {
                applyIsometricPosition(sprite, gx, gy, gameManager);
              }
              sprite.zIndex = (gx + gy) * 100 + 50;
            }
          });
        });
      }
    } catch (_) {
      /* ignore placeable errors */
    }

    // 4. Tokens / creatures
    try {
      const tokens = Array.isArray(gameManager.placedTokens) ? gameManager.placedTokens : [];
      tokens.forEach((t) => {
        const sprite = t?.creature?.sprite;
        if (!sprite) return;
        const fp = t.footprint || { w: 1, h: 1 };
        const centerGX = t.gridX + (fp.w - 1) / 2;
        const centerGY = t.gridY + (fp.h - 1) / 2;
        if (isTopDown) {
          applyTopDownPosition(sprite, centerGX, centerGY, gameManager);
          sprite.zIndex = TOPDOWN_CREATURE_BASE + centerGY * gameManager.cols + centerGX;
        } else {
          applyIsometricPosition(sprite, centerGX, centerGY, gameManager);
          sprite.zIndex = (centerGX + centerGY) * 100 + 90;
        }
      });
    } catch (_) {
      /* ignore token errors */
    }

    // 5. Sorting & centering
    try {
      if (gc.sortChildren) gc.sortChildren();
    } catch (_) {
      /* ignore */
    }

    if (isTopDown) {
      if (typeof gameManager.__isoGridX === 'undefined') {
        gameManager.__isoGridX = gc.x;
        gameManager.__isoGridY = gc.y;
      }
      if (typeof gameManager.__isoGridScale === 'undefined') {
        gameManager.__isoGridScale = gameManager.gridScale || 1;
      }
      try {
        if (gameManager.renderCoordinator?.centerGrid) gameManager.renderCoordinator.centerGrid();
      } catch (_) {
        /* ignore */
      }
      try {
        if (gameManager.app?.screen) {
          const screenW = gameManager.app.screen.width;
          const screenH = gameManager.app.screen.height;
          const padding = 80;
          const rawMapW = (gameManager.cols || 0) * gameManager.tileWidth;
          const rawMapH = (gameManager.rows || 0) * gameManager.tileWidth;
          const availableW = Math.max(10, screenW - padding * 2);
          const availableH = Math.max(10, screenH - padding * 2);
          const scaleFitW = availableW / rawMapW;
          const scaleFitH = availableH / rawMapH;
          const targetScale = Math.min(1, scaleFitW, scaleFitH);
          try {
            if (gameManager.interactionManager) {
              gameManager.interactionManager.setGridScale(targetScale);
            }
            gc.scale.set(targetScale);
          } catch (_) {
            /* ignore */
          }
          const mapW = rawMapW * targetScale;
          const mapH = rawMapH * targetScale;
          gc.x = Math.floor((screenW - mapW) / 2);
          gc.y = Math.floor((screenH - mapH) / 2);
          if (mapW + padding * 2 <= screenW) {
            gc.x = Math.floor(padding + (screenW - padding * 2 - mapW) / 2);
          }
          if (mapH + padding * 2 <= screenH) {
            gc.y = Math.floor(padding + (screenH - padding * 2 - mapH) / 2);
          }
        }
      } catch (_) {
        /* ignore centering errors */
      }
    } else {
      if (typeof gameManager.__isoGridX === 'number') gc.x = gameManager.__isoGridX;
      if (typeof gameManager.__isoGridY === 'number') gc.y = gameManager.__isoGridY;
      try {
        if (typeof gameManager.__isoGridScale === 'number') {
          if (gameManager.interactionManager) {
            gameManager.interactionManager.setGridScale(gameManager.__isoGridScale);
          }
          gc.scale.set(gameManager.__isoGridScale);
        }
      } catch (_) {
        /* ignore */
      }
      delete gameManager.__isoGridScale;
    }

    logger.debug('Reprojected scene', { mode, children: gc.children.length }, LOG_CATEGORY.SYSTEM);
  } catch (error) {
    logger.error('Failed to reproject scene', LOG_CATEGORY.SYSTEM, { mode, error: error?.message });
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Deprecated wrapper
// ---------------------------------------------------------------------------

export function scheduleIncrementalReproject(gameManager, mode) {
  if (typeof window !== 'undefined' && !scheduleIncrementalReproject.__warned) {
    scheduleIncrementalReproject.__warned = true;
    // eslint-disable-next-line no-console
    console.warn(
      '[ProjectionUtils] scheduleIncrementalReproject is deprecated; using reprojectAll'
    );
  }
  try {
    reprojectAll(gameManager, mode);
  } catch (_) {
    /* ignore */
  }
  return Promise.resolve();
}
