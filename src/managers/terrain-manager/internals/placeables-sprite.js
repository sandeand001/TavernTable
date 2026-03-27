// PIXI sprite creation for 2D placeable items extracted from placeables.js (Phase 8).
// Handles texture loading, scale computation, anchoring, and debug logging.

import { TERRAIN_PLACEABLES } from '../../../config/terrain/TerrainPlaceables.js';
import { CoordinateUtils } from '../../../utils/coordinates/CoordinateUtils.js';
import logger, { LOG_CATEGORY } from '../../../utils/Logger.js';
import { repositionPlaceableSprite } from './placeables-positioning.js';

const PLACEABLE_LOG_CATEGORY = LOG_CATEGORY.RENDERING;

/** Create a PIXI.Sprite for a placeable item and attach metadata (legacy 2D path). */
export function createPlaceableSprite(m, id, x, y) {
  const def = TERRAIN_PLACEABLES[id];
  if (!def) throw new Error(`Unknown placeable id: ${id}`);
  // Support multi-variant placeables where `def.img` may be an array of
  // image paths. Choose a deterministic variant based on tile coords so
  // re-creating the same tile yields the same initial variant.
  let imgPath = def.img;
  let variantIndex = 0;
  if (Array.isArray(def.img) && def.img.length > 0) {
    const len = def.img.length;
    const hash = Math.abs(((x * 73856093) ^ (y * 19349663)) >>> 0);
    variantIndex = hash % len;
    imgPath = def.img[variantIndex];
  }
  // Support environments where PIXI.Sprite.from may not be present (tests mock).
  let sprite;
  try {
    if (typeof PIXI.Sprite?.from === 'function') {
      sprite = PIXI.Sprite.from(imgPath);
    } else if (typeof PIXI.Texture?.from === 'function' && typeof PIXI.Sprite === 'function') {
      sprite = new PIXI.Sprite(PIXI.Texture.from(imgPath));
    } else {
      // Fallback: attempt direct construction
      sprite = new PIXI.Sprite(imgPath);
    }
  } catch (err) {
    // Best-effort fallback
    try {
      sprite = new PIXI.Sprite(PIXI.Texture.from ? PIXI.Texture.from(imgPath) : {});
    } catch (_) {
      sprite = {
        x: 0,
        y: 0,
        scale: { set: () => {} },
        anchor: { set: () => {} },
      };
    }
  }
  // Use bottom-center anchor so the sprite's bottom rests on the tile baseline
  // (matches tokens which use anchor (0.5, 1.0)). Using top-left caused sprites
  // to appear vertically offset above the selected tile.
  if (!sprite.anchor) sprite.anchor = { set: () => {} };
  try {
    sprite.anchor.set(0.5, 1.0);
  } catch (_) {
    /* ignore missing anchor impl in mocks */
  }
  // Ensure no accidental rotation/skew inherited from texture or previous use
  try {
    sprite.rotation = 0;
    sprite.skew?.set?.(0, 0);
  } catch (_) {
    /* ignore */
  }
  // Ensure placeable is sized to a single tile. Compute scale from the texture's
  // original dimensions when available. If dimensions are not yet available,
  // attach safe listeners on the baseTexture and apply a conservative sizing
  // that will be recalculated once the texture loads. Avoid forcing scale resets
  // that may conflict with PIXI internals.
  // Defaults chosen to match the project's isometric tile footprint: width ~64, height ~32
  const tileW = m.gameManager?.tileWidth || 64;
  const tileH = m.gameManager?.tileHeight || 32;
  const scaleMode = def.scaleMode || 'contain';
  // Enable runtime debug logging by setting `window.DEBUG_PLACEABLES = true`
  const __dbg = !!(typeof window !== 'undefined' && window.DEBUG_PLACEABLES);
  const debugLoggingEnabled = __dbg && logger.isDebugEnabled();
  // Position using coordinate util so behavior matches other systems
  // Use the same baseline point as tokens/selection so the preview and final
  // placement line up perfectly. CoordinateUtils.gridToIsometric already applies
  // the TOKEN_PLACEMENT_OFFSET used by input picking, so we do not remove it here.
  const isoBase = CoordinateUtils.gridToIsometric(x, y, tileW, tileH);
  const iso = { x: isoBase.x, y: isoBase.y };

  // No longer cache terrain height on the sprite; we will always recompute
  // from the coordinator so trees stay attached to tiles when elevation changes.

  // Align sprite using its bottom-center anchor to the iso baseline.
  const alignBottomCenter = (s, targetX, targetY) => {
    try {
      // Ensure anchor is bottom-center for Sprites
      if (typeof s.anchor?.set === 'function') {
        try {
          s.anchor.set(0.5, 1.0);
        } catch (_) {
          /* ignore */
        }
      }
      // Avoid pivot manipulation; rely on anchor for consistent math with Sprite.from textures
      if (typeof s.pivot?.set === 'function') {
        try {
          s.pivot.set(0, 0);
        } catch (_) {
          /* ignore */
        }
      }
      s.x = targetX;
      s.y = targetY;
      // Elevation offset will be applied by the shared reposition helper so
      // this align helper only sets the baseline iso position.
    } catch (err) {
      if (debugLoggingEnabled)
        logger.debug(
          '[placeable:alignBottomCenter] failed',
          { id, error: err?.message },
          PLACEABLE_LOG_CATEGORY
        );
      try {
        s.x = targetX;
        s.y = targetY;
      } catch (_) {
        /* ignore */
      }
    }
  };

  /* eslint-disable indent */
  // Clamp helper: enforce sane scale bounds per placeable type with optional overrides
  const clampScale = (val, type, def) => {
    const maxOverride = Number.isFinite(def?.maxScale) ? def.maxScale : null;
    const minOverride = Number.isFinite(def?.minScale) ? def.minScale : null;
    const isTree = typeof id === 'string' && id.startsWith('tree-');
    const defaults = {
      plant: { min: 0.1, max: 0.25 },
      path: { min: 0.2, max: 1.25 },
      structure: { min: 0.2, max: 2.0 },
      _default: { min: 0.2, max: 2.0 },
    };
    // Trees are a subset of plants; apply tighter bounds unless overrides are provided
    const baseRange = defaults[type] || defaults._default;
    const treeRange = isTree ? { min: 0.24, max: 0.36 } : baseRange;
    const range = treeRange;
    const min = minOverride ?? range.min;
    const max = maxOverride ?? range.max;
    return Math.min(Math.max(val, min), max);
  };

  // For trees, gently normalize toward the midpoint to reduce variation across frames
  const normalizeTreeScale = (sCandidate, def) => {
    if (!(typeof id === 'string' && id.startsWith('tree-'))) return sCandidate;
    const min = Number.isFinite(def?.minScale) ? def.minScale : 0.24;
    const max = Number.isFinite(def?.maxScale) ? def.maxScale : 0.36;
    const mid = (min + max) / 2;
    // Pull 70% toward midpoint (keep 30% of original deviation)
    const smoothed = mid + (sCandidate - mid) * 0.3;
    return Math.min(Math.max(smoothed, min), max);
  };
  const setSize = () => {
    try {
      // Prefer reliable original texture dimensions when available
      const texW =
        sprite.texture?.orig?.width ||
        sprite.texture?.width ||
        sprite.texture?.baseTexture?.width ||
        0;
      const texH =
        sprite.texture?.orig?.height ||
        sprite.texture?.height ||
        sprite.texture?.baseTexture?.height ||
        0;

      // If we don't yet know the texture size, wait for the baseTexture to emit
      // an update/loaded event and apply a conservative initial scale so the sprite
      // isn't visually massive. When the texture loads, setSize will re-run.
      if (!texW || !texH) {
        // Conservative fallback: assume a nominal source size so we don't blow up
        // sprites before the texture loads. Trees and structures are typically
        // 128-256px; default to 128px which yields ~0.5x scale for 64px tiles.
        const assumedW = Number.isFinite(def.nominalWidthPx) ? def.nominalWidthPx : 128;
        const assumedH = Number.isFinite(def.nominalHeightPx) ? def.nominalHeightPx : 128;
        let sx = tileW / assumedW;
        let sy = tileH / assumedH;
        // Apply type-aware clamp to avoid outliers
        sx = clampScale(sx, def.type, def);
        sy = clampScale(sy, def.type, def);
        if (debugLoggingEnabled) {
          logger.debug(
            '[placeable:setSize] initial/fallback',
            {
              id,
              type: def.type,
              scaleMode,
              tileW,
              tileH,
              texW,
              texH,
              sx,
              sy,
            },
            PLACEABLE_LOG_CATEGORY
          );
        }
        if (scaleMode === 'stretch') {
          if (typeof id === 'string' && id.startsWith('tree-')) {
            const s = normalizeTreeScale(Math.min(sx, sy), def);
            const c = clampScale(s, def.type, def);
            sprite.scale.set(c, c);
          } else {
            sprite.scale.set(sx, sy);
          }
        } else if (scaleMode === 'cover') {
          let s = Math.max(sx, sy);
          s = normalizeTreeScale(s, def);
          const c = clampScale(s, def.type, def);
          sprite.scale.set(c, c);
        } else {
          // contain (default)
          let s = Math.min(sx, sy);
          s = normalizeTreeScale(s, def);
          const c = clampScale(s, def.type, def);
          sprite.scale.set(c, c);
        }
        // Ensure pivot/anchor reflect the fallback scale too
        try {
          alignBottomCenter(sprite, iso.x, iso.y);
        } catch (_) {
          /* ignore */
        }
        return;
      }

      let scaleX = tileW / texW;
      let scaleY = tileH / texH;
      scaleX = clampScale(scaleX, def.type, def);
      scaleY = clampScale(scaleY, def.type, def);
      // If this is a path asset (pre-drawn isometric artwork) we prefer to
      // preserve its isometric aspect ratio and size it to the tile width
      // so it visually sits correctly; avoid forcing it to match tile height
      // which can squash the perspective.
      if (def.type === 'path' && (scaleMode === 'cover' || scaleMode === 'contain')) {
        const s = clampScale(scaleX, def.type, def);
        sprite.scale.set(s, s);
        if (debugLoggingEnabled) {
          logger.debug(
            '[placeable:setSize] path-preserve-width',
            {
              id,
              type: def.type,
              scaleMode,
              tileW,
              tileH,
              texW,
              texH,
              scaleX,
              scaleY,
              finalScale: s,
            },
            PLACEABLE_LOG_CATEGORY
          );
        }
      } else if (scaleMode === 'stretch') {
        const sx = clampScale(scaleX, def.type, def);
        const sy = clampScale(scaleY, def.type, def);
        sprite.scale.set(sx, sy);
        if (debugLoggingEnabled) {
          logger.debug(
            '[placeable:setSize] stretch',
            {
              id,
              type: def.type,
              scaleMode,
              tileW,
              tileH,
              texW,
              texH,
              sx,
              sy,
            },
            PLACEABLE_LOG_CATEGORY
          );
        }
      } else if (scaleMode === 'cover') {
        const s = clampScale(Math.max(scaleX, scaleY), def.type, def);
        const clamped = s;
        sprite.scale.set(clamped, clamped);
        if (debugLoggingEnabled) {
          logger.debug(
            '[placeable:setSize] cover',
            {
              id,
              type: def.type,
              scaleMode,
              tileW,
              tileH,
              texW,
              texH,
              finalScale: clamped,
            },
            PLACEABLE_LOG_CATEGORY
          );
        }
      } else {
        // contain
        const s = clampScale(Math.min(scaleX, scaleY), def.type, def);
        const clamped = s;
        sprite.scale.set(clamped, clamped);
        if (debugLoggingEnabled) {
          logger.debug(
            '[placeable:setSize] contain',
            {
              id,
              type: def.type,
              scaleMode,
              tileW,
              tileH,
              texW,
              texH,
              finalScale: clamped,
            },
            PLACEABLE_LOG_CATEGORY
          );
        }
      }
      // After any scale change, re-align to ensure pivot/anchor reflect new bounds
      try {
        alignBottomCenter(sprite, iso.x, iso.y);
      } catch (_) {
        /* ignore */
      }
    } catch (err) {
      /* best-effort */
    }
  };
  /* eslint-enable indent */
  // If texture dimensions are known, set immediately; otherwise listen for load
  const tex = sprite.texture;
  const base = tex?.baseTexture;
  // If dimensions available now, size immediately. Otherwise attach safe listeners
  // that trigger once when the base texture finishes loading or updating.
  if (
    (tex && tex.orig && tex.orig.width && tex.orig.height) ||
    (base && base.width && base.height)
  ) {
    setSize();
  } else if (base && typeof base.once === 'function') {
    try {
      base.once('loaded', setSize);
      base.once('update', setSize);
      // still attempt a conservative sizing so initial render isn't huge
      setSize();
    } catch (_) {
      /* ignore */
    }
  } else {
    // Conservative attempt
    setSize();
  }
  sprite.gridX = x;
  sprite.gridY = y;
  sprite.placeableId = id;
  sprite.placeableType = def.type;
  // record which variant (for multi-image placeables) was used so we can cycle later
  sprite.placeableVariantIndex = variantIndex || 0;

  // Initial alignment (may be re-applied when texture loads/updates)
  try {
    alignBottomCenter(sprite, iso.x, iso.y);
  } catch (_) {
    /* ignore */
  }
  if (debugLoggingEnabled) {
    const dbgBounds = sprite.getLocalBounds ? sprite.getLocalBounds() : null;
    logger.debug(
      '[placeable:create] positioned',
      {
        id,
        type: def.type,
        x,
        y,
        isoX: iso.x,
        isoY: iso.y,
        anchor: sprite.anchor,
        scale: { x: sprite.scale.x, y: sprite.scale.y },
        bounds: dbgBounds,
      },
      PLACEABLE_LOG_CATEGORY
    );
  }
  // Apply final positioning including elevation and per-asset baseline tweaks
  try {
    repositionPlaceableSprite(m, sprite);
  } catch (_) {
    // fallback: ensure zIndex is set deterministically
    sprite.zIndex = (x + y) * 100 + (def.type === 'structure' ? 80 : 30);
  }
  return sprite;
}
