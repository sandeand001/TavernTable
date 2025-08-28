import { TERRAIN_PLACEABLES } from '../../../config/TerrainPlaceables.js';
import { CoordinateUtils } from '../../../utils/CoordinateUtils.js';
import { TerrainHeightUtils } from '../../../utils/TerrainHeightUtils.js';

// NOTE: previous QA introduced a fixed LEVEL_COMPENSATION which caused
// consistent downward shifts and incorrect behavior for elevated tiles.
// We intentionally do NOT apply a blanket compensation. Instead we only
// apply the per-tile elevation offset computed by TerrainHeightUtils so
// height 0 maps to the iso baseline and positive heights are moved up
// (negative Y) by the appropriate pixel amount.

// Temporary/adjustable baseline compensation: some workflows expect items
// placed on elevated faces to instead land on the face of the base (height 0)
// tile. Set this to a positive integer level to lower newly placed sprites
// by that many elevation levels (pixels per level come from TerrainHeightUtils).
// Set to 0 to disable.
const BASELINE_COMPENSATION_LEVEL = 3;
const BASELINE_COMPENSATION_PX = Math.abs(TerrainHeightUtils.calculateElevationOffset(BASELINE_COMPENSATION_LEVEL));

/** Create a PIXI.Sprite for a placeable item and attach metadata. */
export function createPlaceableSprite(m, id, x, y) {
  const def = TERRAIN_PLACEABLES[id];
  if (!def) throw new Error(`Unknown placeable id: ${id}`);
  const sprite = PIXI.Sprite.from(def.img);
  // Bottom-center anchor: CoordinateUtils.gridToIsometric returns the tile
  // baseline (tile center line). Tokens use anchor (0.5,1.0), so use the same
  // anchor for placeables so their bottom aligns to the tile baseline and
  // they visually sit correctly on the diamond.
  // Use bottom-center anchor so the sprite's bottom rests on the tile baseline
  // (matches tokens which use anchor (0.5, 1.0)). Using top-left caused sprites
  // to appear vertically offset above the selected tile.
  sprite.anchor.set(0.5, 1.0);
  // Ensure no accidental rotation/skew inherited from texture or previous use
  try { sprite.rotation = 0; sprite.skew?.set?.(0, 0); } catch (_) { /* ignore */ }
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
  // Position using coordinate util so behavior matches other systems
  const iso = CoordinateUtils.gridToIsometric(x, y, m.gameManager.tileWidth, m.gameManager.tileHeight);

  // Capture current terrain height for this tile so we can apply the
  // visual elevation offset consistently (and re-apply after texture load)
  const tileHeight = (m.terrainCoordinator && typeof m.terrainCoordinator.getTerrainHeight === 'function')
    ? m.terrainCoordinator.getTerrainHeight(x, y)
    : 0;
    // Store on sprite so alignment helper can access it across re-aligns
  sprite.terrainHeight = Number.isFinite(tileHeight) ? tileHeight : 0;

  // Robust alignment: different display objects (Sprite vs Graphics) use
  // anchor/pivot differently. To ensure the bottom-center of the visual
  // content rests on the tile baseline (iso.y), normalize the pivot/anchor
  // and then set the position. This prevents cases where trimmed textures
  // or Graphics objects place their visual bottom above the baseline.
  const alignBottomCenter = (s, targetX, targetY) => {
    try {
      // Use local bounds and pivot for all display objects (Sprites, Graphics, Containers).
      // Anchors on Sprite can be unreliable when textures are trimmed/packed; pivot
      // via getLocalBounds ensures the visible bottom is aligned regardless of texture frame.
      // Ensure any Sprite anchor is neutralized before computing pivot so we don't
      // double-apply horizontal/vertical offsets (anchor + pivot) which can produce
      // a half-tile diagonal placement error.
      if (typeof s.anchor?.set === 'function') {
        try { s.anchor.set(0, 0); } catch (_) { /* ignore */ }
      }
      const b = s.getLocalBounds();
      const pivotX = (b.x + b.width) / 2;
      const pivotY = b.y + b.height;
      // Only set pivot if methods exist
      if (typeof s.pivot?.set === 'function') s.pivot.set(pivotX, pivotY);
      // Position at isometric baseline
      s.x = targetX;
      s.y = targetY;
      // Apply elevation offset (height > 0 => negative Y to lift sprite)
      try {
        const elev = (typeof s.terrainHeight === 'number') ? TerrainHeightUtils.calculateElevationOffset(s.terrainHeight) : 0;
        s.y += elev;
      } catch (_) { /* best-effort */ }
      // Apply per-asset baseline offset (allow small pixel tuning per placeable)
      try {
        const assetDef = TERRAIN_PLACEABLES[s.placeableId] || {};
        const assetOffset = Number.isFinite(assetDef.baselineOffsetPx) ? assetDef.baselineOffsetPx : 0;
        s.y += assetOffset;
      } catch (_) { /* best-effort */ }
      // Apply optional baseline compensation (lowers sprite by N levels worth of pixels)
      try {
        if (BASELINE_COMPENSATION_PX) s.y += BASELINE_COMPENSATION_PX;
      } catch (_) { /* best-effort */ }
    } catch (err) {
      if (__dbg) console.debug('[placeable:alignBottomCenter] failed', { id, err });
      // best-effort fallback
      try { s.x = targetX; s.y = targetY; } catch (_) { /* ignore */ }
    }
  };

  const setSize = () => {
    try {
      // Prefer reliable original texture dimensions when available
      const texW = sprite.texture?.orig?.width || sprite.texture?.width || sprite.texture?.baseTexture?.width || 0;
      const texH = sprite.texture?.orig?.height || sprite.texture?.height || sprite.texture?.baseTexture?.height || 0;

      // If we don't yet know the texture size, wait for the baseTexture to emit
      // an update/loaded event and apply a conservative initial scale so the sprite
      // isn't visually massive. When the texture loads, setSize will re-run.
      if (!texW || !texH) {
        // conservative: treat as 1x1 texture (so scale = tile size), but clamp
        const sx = Math.min(Math.max(tileW / Math.max(texW, 1), 0.0001), 100);
        const sy = Math.min(Math.max(tileH / Math.max(texH, 1), 0.0001), 100);
        if (__dbg) console.debug('[placeable:setSize] initial/fallback', { id, type: def.type, scaleMode, tileW, tileH, texW, texH, sx, sy });
        if (scaleMode === 'stretch') {
          sprite.scale.set(sx, sy);
        } else if (scaleMode === 'cover') {
          const s = Math.max(sx, sy); sprite.scale.set(s, s);
        } else { // contain
          const s = Math.min(sx, sy); sprite.scale.set(s, s);
        }
        // Ensure pivot/anchor reflect the fallback scale too
        try { alignBottomCenter(sprite, iso.x, iso.y); } catch (_) { /* ignore */ }
        return;
      }

      const scaleX = tileW / texW;
      const scaleY = tileH / texH;
      // If this is a path asset (pre-drawn isometric artwork) we prefer to
      // preserve its isometric aspect ratio and size it to the tile width
      // so it visually sits correctly; avoid forcing it to match tile height
      // which can squash the perspective.
      if (def.type === 'path' && (scaleMode === 'cover' || scaleMode === 'contain')) {
        const s = Math.min(Math.max(scaleX, 0.0001), 100);
        sprite.scale.set(s, s);
        if (__dbg) console.debug('[placeable:setSize] path-preserve-width', { id, type: def.type, scaleMode, tileW, tileH, texW, texH, scaleX, scaleY, finalScale: s });
      } else if (scaleMode === 'stretch') {
        const sx = Math.min(Math.max(scaleX, 0.0001), 100);
        const sy = Math.min(Math.max(scaleY, 0.0001), 100);
        sprite.scale.set(sx, sy);
        if (__dbg) console.debug('[placeable:setSize] stretch', { id, type: def.type, scaleMode, tileW, tileH, texW, texH, sx, sy });
      } else if (scaleMode === 'cover') {
        const s = Math.max(scaleX, scaleY);
        const clamped = Math.min(Math.max(s, 0.0001), 100);
        sprite.scale.set(clamped, clamped);
        if (__dbg) console.debug('[placeable:setSize] cover', { id, type: def.type, scaleMode, tileW, tileH, texW, texH, finalScale: clamped });
      } else { // contain
        const s = Math.min(scaleX, scaleY);
        const clamped = Math.min(Math.max(s, 0.0001), 100);
        sprite.scale.set(clamped, clamped);
        if (__dbg) console.debug('[placeable:setSize] contain', { id, type: def.type, scaleMode, tileW, tileH, texW, texH, finalScale: clamped });
      }
      // After any scale change, re-align to ensure pivot/anchor reflect new bounds
      try { alignBottomCenter(sprite, iso.x, iso.y); } catch (_) { /* ignore */ }
    } catch (err) { /* best-effort */ }
  };
    // If texture dimensions are known, set immediately; otherwise listen for load
  const tex = sprite.texture;
  const base = tex?.baseTexture;
  // If dimensions available now, size immediately. Otherwise attach safe listeners
  // that trigger once when the base texture finishes loading or updating.
  if ((tex && tex.orig && tex.orig.width && tex.orig.height) || (base && base.width && base.height)) {
    setSize();
  } else if (base && typeof base.once === 'function') {
    try {
      base.once('loaded', setSize);
      base.once('update', setSize);
      // still attempt a conservative sizing so initial render isn't huge
      setSize();
    } catch (_) { /* ignore */ }
  } else {
    // Conservative attempt
    setSize();
  }
  sprite.gridX = x;
  sprite.gridY = y;
  sprite.placeableId = id;
  sprite.placeableType = def.type;

  // Initial alignment (may be re-applied when texture loads/updates)
  try { alignBottomCenter(sprite, iso.x, iso.y); } catch (_) { /* ignore */ }
  if (__dbg) console.debug('[placeable:create] positioned', { id, type: def.type, x, y, isoX: iso.x, isoY: iso.y, anchor: sprite.anchor, scale: { x: sprite.scale.x, y: sprite.scale.y }, bounds: sprite.getLocalBounds ? sprite.getLocalBounds() : null });
  // Structures should sit above paths; small zIndex offset per type
  sprite.zIndex = (x + y) * 100 + (def.type === 'structure' ? 80 : 30);
  return sprite;
}

export function placeItem(m, id, x, y) {
  const tileKey = `${x},${y}`;
  // Validate map
  if (!m.terrainContainer) throw new Error('Terrain container missing');
  // Ensure placeables map exists
  if (!m.placeables) m.placeables = new Map();

  // Structures are exclusive: if a structure exists at tile, reject
  const existing = m.placeables.get(tileKey);
  if (existing && existing.some(p => p.placeableType === 'structure')) {
    return false; // occupied by structure
  }

  // If placing a structure and tokens are present, disallow (tokens cannot coexist with structures)
  if (TERRAIN_PLACEABLES[id].type === 'structure') {
    const tokensAt = m.gameManager?.tokenManager?.findExistingTokenAt?.(x, y);
    if (tokensAt) return false;
  }

  const sprite = createPlaceableSprite(m, id, x, y);
  // Add to container and record
  m.terrainContainer.addChild(sprite);
  if (!m.placeables.has(tileKey)) m.placeables.set(tileKey, []);
  m.placeables.get(tileKey).push(sprite);
  return true;
}

export function removeItem(m, x, y, id = null) {
  const tileKey = `${x},${y}`;
  if (!m.placeables || !m.placeables.has(tileKey)) return false;
  const list = m.placeables.get(tileKey);
  let removed = false;
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    if (!id || p.placeableId === id) {
      try { p.parent?.removeChild(p); } catch (_) { /* best-effort */ }
      list.splice(i, 1);
      removed = true;
    }
  }
  if (list.length === 0) m.placeables.delete(tileKey);
  return removed;
}
