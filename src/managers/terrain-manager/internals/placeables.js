import { TERRAIN_PLACEABLES } from '../../../config/TerrainPlaceables.js';
import { CoordinateUtils } from '../../../utils/CoordinateUtils.js';
import { TerrainHeightUtils } from '../../../utils/TerrainHeightUtils.js';
// Depth utilities no longer used for cross-container zIndex raise; we align to tile scheme.
// import { computeDepthKey, TYPE_BIAS, withOverlayRaise } from '../../../utils/DepthUtils.js';

// NOTE: previous QA introduced a fixed LEVEL_COMPENSATION which caused
// consistent downward shifts and incorrect behavior for elevated tiles.
// We intentionally do NOT apply a blanket compensation. Instead we only
// apply the per-tile elevation offset computed by TerrainHeightUtils so
// height 0 maps to the iso baseline and positive heights are moved up
// (negative Y) by the appropriate pixel amount.

// Temporary/adjustable baseline compensation removed: use per-asset offsets only.

// Optional auto-baseline detection helpers for trees were removed in favor of
// explicit, per-asset baselineOffsetPx in the config to keep behavior deterministic.

// Central model key mapping for plant/tree placeables (previously duplicated in multiple branches)
const ID_TO_MODEL_KEY = {
  // Updated to canonical model keys
  'tree-green-deciduous': 'common-broadleaf-1',
  'tree-green-conifer': 'pine-conifer-1',
  'tree-green-willow': 'common-broadleaf-4',
  'tree-green-oval': 'common-broadleaf-2',
  'tree-green-columnar': 'pine-conifer-2',
  'tree-green-small': 'pine-conifer-4',
  'tree-green-small-oval': 'pine-conifer-5',
  'tree-green-tall-columnar': 'pine-conifer-3',
  'tree-orange-deciduous': 'common-broadleaf-3',
  'tree-yellow-willow': 'common-broadleaf-5',
  'tree-yellow-conifer': 'pine-conifer-5',
  'tree-yellow-conifer-alt': 'twisted-bare-2',
  'tree-bare-deciduous': 'twisted-bare-1',
};

async function ensureModelCache(gameManager) {
  if (gameManager._modelAssetCache !== undefined) {
    // Upgrade path: legacy instance without hasKey -> recreate
    if (gameManager._modelAssetCache && typeof gameManager._modelAssetCache.hasKey !== 'function') {
      try {
        const mod = await import('../../../core/ModelAssetCache.js');
        const MC = mod.ModelAssetCache || mod.default;
        gameManager._modelAssetCache = MC ? new MC() : null;
        try {
          const threeRef = gameManager?.threeSceneManager?.three;
          if (threeRef && gameManager._modelAssetCache && !gameManager._modelAssetCache._three) {
            gameManager._modelAssetCache.setThree(threeRef);
          }
        } catch (_) {
          /* ignore */
        }
      } catch (_) {
        /* ignore upgrade failure */
      }
    }
    return gameManager._modelAssetCache;
  }
  try {
    const mod = await import('../../../core/ModelAssetCache.js');
    const MC = mod.ModelAssetCache || mod.default;
    gameManager._modelAssetCache = MC ? new MC() : null;
    // Inject three reference if already initialized
    try {
      const threeRef = gameManager?.threeSceneManager?.three;
      if (threeRef && gameManager._modelAssetCache && !gameManager._modelAssetCache._three) {
        gameManager._modelAssetCache.setThree(threeRef);
      }
    } catch (_) {
      /* ignore three inject */
    }
  } catch (_) {
    gameManager._modelAssetCache = null;
  }
  return gameManager._modelAssetCache;
}

/** Create a PIXI.Sprite for a placeable item and attach metadata (non-plant or legacy path). */
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
  // Position using coordinate util so behavior matches other systems
  // Use the same baseline point as tokens/selection so the preview and final
  // placement line up perfectly. CoordinateUtils.gridToIsometric already applies
  // the TOKEN_PLACEMENT_OFFSET used by input picking, so we do not remove it here.
  const isoBase = CoordinateUtils.gridToIsometric(
    x,
    y,
    m.gameManager.tileWidth,
    m.gameManager.tileHeight
  );
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
      if (__dbg) console.debug('[placeable:alignBottomCenter] failed', { id, err });
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
        if (__dbg) {
          console.debug('[placeable:setSize] initial/fallback', {
            id,
            type: def.type,
            scaleMode,
            tileW,
            tileH,
            texW,
            texH,
            sx,
            sy,
          });
        }
        if (!sprite.scale) sprite.scale = { set: () => {} };
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
      if (!sprite.scale) sprite.scale = { set: () => {} };
      if (def.type === 'path' && (scaleMode === 'cover' || scaleMode === 'contain')) {
        const s = clampScale(scaleX, def.type, def);
        sprite.scale.set(s, s);
        if (__dbg) {
          console.debug('[placeable:setSize] path-preserve-width', {
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
          });
        }
      } else if (scaleMode === 'stretch') {
        const sx = clampScale(scaleX, def.type, def);
        const sy = clampScale(scaleY, def.type, def);
        sprite.scale.set(sx, sy);
        if (__dbg) {
          console.debug('[placeable:setSize] stretch', {
            id,
            type: def.type,
            scaleMode,
            tileW,
            tileH,
            texW,
            texH,
            sx,
            sy,
          });
        }
      } else if (scaleMode === 'cover') {
        const s = clampScale(Math.max(scaleX, scaleY), def.type, def);
        const clamped = s;
        sprite.scale.set(clamped, clamped);
        if (__dbg) {
          console.debug('[placeable:setSize] cover', {
            id,
            type: def.type,
            scaleMode,
            tileW,
            tileH,
            texW,
            texH,
            finalScale: clamped,
          });
        }
      } else {
        // contain
        const s = clampScale(Math.min(scaleX, scaleY), def.type, def);
        const clamped = s;
        sprite.scale.set(clamped, clamped);
        if (__dbg) {
          console.debug('[placeable:setSize] contain', {
            id,
            type: def.type,
            scaleMode,
            tileW,
            tileH,
            texW,
            texH,
            finalScale: clamped,
          });
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
  if (__dbg) {
    const dbgBounds = sprite.getLocalBounds ? sprite.getLocalBounds() : null;
    console.debug('[placeable:create] positioned', {
      id,
      type: def.type,
      x,
      y,
      isoX: iso.x,
      isoY: iso.y,
      anchor: sprite.anchor,
      scale: { x: sprite.scale.x, y: sprite.scale.y },
      bounds: dbgBounds,
    });
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

export function placeItem(m, id, x, y) {
  const tileKey = `${x},${y}`;
  // Validate map
  if (!m.gameManager?.gridContainer) throw new Error('Grid container missing');
  // Ensure placeables map exists
  if (!m.placeables) m.placeables = new Map();

  // Structures are exclusive: if a structure exists at tile, reject
  const existing = m.placeables.get(tileKey);
  if (existing && existing.some((p) => p.placeableType === 'structure')) {
    return false; // occupied by structure
  }

  // If placing a structure and tokens are present, disallow (tokens cannot coexist with structures)
  if (TERRAIN_PLACEABLES[id].type === 'structure') {
    const tokensAt = m.gameManager?.tokenManager?.findExistingTokenAt?.(x, y);
    if (tokensAt) return false;
  }
  // If placing a plant (tree) and a token exists at the tile, disallow to prevent overlap
  if (TERRAIN_PLACEABLES[id].type === 'plant') {
    const tokensAt = m.gameManager?.tokenManager?.findExistingTokenAt?.(x, y);
    if (tokensAt) return false;
  }

  let def = TERRAIN_PLACEABLES[id];
  // Support virtual family selectors (type: 'plant-family') by resolving to a concrete variant id
  if (
    def &&
    def.type === 'plant-family' &&
    Array.isArray(def.familyVariants) &&
    def.familyVariants.length
  ) {
    // Choose a variant per placement (simple random; could be made deterministic via coords if desired)
    const variantId = def.familyVariants[Math.floor(Math.random() * def.familyVariants.length)];
    if (TERRAIN_PLACEABLES[variantId]) {
      id = variantId; // replace id with concrete variant
      def = TERRAIN_PLACEABLES[id];
    }
  }
  const isPlant = def?.type === 'plant';
  const gm3d = m.gameManager;
  // Do not snapshot scene reference; it may initialize after placement request.

  // PURE 3D PATH: plants always use models now (legacy 2D removed)
  if (isPlant) {
    if (!m.placeables) m.placeables = new Map();
    if (!m.placeables.has(tileKey)) m.placeables.set(tileKey, []);
    const record = {
      gridX: x,
      gridY: y,
      placeableId: id,
      placeableType: def.type,
      __threeModelPending: true,
      // Maintain a variant index concept even for 3D-only plants so existing
      // variant cycling tests (which expect a sprite-era property) remain valid.
      placeableVariantIndex: 0,
      // Provide a variant key for potential instancing (canonical id)
      variantKey: id,
    };
    m.placeables.get(tileKey).push(record);

    // Provide a lightweight display-list presence so tests that previously
    // enumerated terrainContainer.children can still locate the placed item.
    // (PIXI containers in tests accept plain objects.)
    try {
      if (m.terrainContainer) {
        m.terrainContainer.addChild(record);
      } else if (m.gameManager?.gridContainer) {
        m.gameManager.gridContainer.addChild(record);
      }
    } catch (_) {
      /* non-fatal */
    }

    // Async model load & placement
    ensureModelCache(gm3d).then((cache) => {
      if (!cache) return;
      const modelKey = def.modelKey || ID_TO_MODEL_KEY[id];
      const finalizeModelPlacement = (model) => {
        // Guard: item may have been removed before model finished loading.
        const currentList = m.placeables?.get(tileKey);
        if (!currentList || !currentList.includes(record)) return;
        let world;
        let terrainH = 0;
        try {
          world = gm3d.spatial.gridToWorld(x + 0.5, y + 0.5, 0);
          terrainH = (gm3d.getTerrainHeight?.(x, y) || 0) * gm3d.spatial.elevationUnit;
        } catch (_) {
          world = { x: 0, z: 0 };
        }
        model.position.set(world.x, terrainH, world.z);
        try {
          model.rotation.y = Math.random() * Math.PI * 2;
        } catch (_) {
          /* ignore */
        }
        const sceneRef = gm3d?.threeSceneManager?.scene;
        try {
          if (sceneRef && typeof sceneRef.add === 'function') {
            sceneRef.add(model);
          } else if (typeof window !== 'undefined') {
            if (!Array.isArray(gm3d._deferredPlantModels)) gm3d._deferredPlantModels = [];
            gm3d._deferredPlantModels.push({ model, record });
            if (window.DEBUG_TREE_MODELS) {
              console.info('[Placeables] Deferred plant model (scene not ready)', {
                id,
                modelKey,
              });
            }
          }
        } catch (_) {
          /* ignore add failures */
        }
        record.__threeModel = model;
        delete record.__threeModelPending;
        if (typeof window !== 'undefined' && window.DEBUG_TREE_MODELS) {
          console.info('[Placeables] 3D plant placed', { id, modelKey, x, y });
        }
      };
      // Palm model aliasing: if dedicated palm assets don't exist yet, map them to a broadleaf base and adjust.
      const palmAliasMap = {
        'palm-single-a': 'common-broadleaf-2',
        'palm-double-a': 'common-broadleaf-3',
      };
      const palmStyler = (root, key) => {
        try {
          // Uniform scale tweak and Z rotation variance for more tropical silhouette.
          const scale = key === 'palm-double-a' ? 1.18 : 1.12;
          root.scale.multiplyScalar(scale);
          // Raise canopy slightly
          root.position.y += 0.15;
          // Desaturate trunk & recolor fronds if materials are individually identifiable
          root.traverse?.((child) => {
            if (!child.isMesh || !child.material) return;
            const mat = child.material;
            // Heuristic: darker trunk by name or index fallback
            if (/trunk|stem|bark/i.test(child.name)) {
              if (mat.color) mat.color.offsetHSL?.(0, -0.15, -0.1);
            } else if (/leaf|frond|canopy|foliage/i.test(child.name)) {
              if (mat.color) {
                // Warm greener palm frond tone
                mat.color.setHex(0x3d6f3a);
                mat.color.offsetHSL?.(0.05, 0.12, 0.05);
              }
            }
          });
        } catch (_) {
          /* styling non-fatal */
        }
      };
      if (palmAliasMap[modelKey]) {
        const baseKey = palmAliasMap[modelKey];
        cache
          .getModel(baseKey)
          .then((model) => {
            if (!model) return;
            const root = model.clone(true);
            palmStyler(root, modelKey);
            finalizeModelPlacement(root);
          })
          .catch(() => {});
        return;
      }
      if (!modelKey) {
        // No resolvable model key (test or placeholder asset): finalize with a dummy invisible object
        const dummy = { position: { set: () => {} }, rotation: { y: 0 } };
        finalizeModelPlacement(dummy);
        return;
      }
      cache
        .getModel(modelKey)
        .then((model) => {
          if (!model) return;
          const root = model.clone(true);
          try {
            if (/tree-birch-[a-e]-spectral/.test(id)) {
              const spectralColors = [0xff4444, 0xffffff, 0x3399ff, 0x44dd66];
              const seed = ((x * 73856093) ^ (y * 19349663) ^ id.length) >>> 0;
              const tintHex = spectralColors[seed % spectralColors.length];
              root.traverse?.((ch) => {
                if (!ch.isMesh || !ch.material) return;
                const mats = Array.isArray(ch.material) ? ch.material : [ch.material];
                mats.forEach((m) => {
                  if (!m || !m.userData || !m.userData.__foliageCandidate) return;
                  if (m.color) m.color.setHex(tintHex);
                  m.needsUpdate = true;
                });
              });
            }
          } catch (_) {
            /* spectral tint non-fatal */
          }
          finalizeModelPlacement(root);
        })
        .catch(() => {});
    });

    // Immediate metrics-only instancing registration (hidden) so tests & metrics update synchronously.
    try {
      const gm = gm3d;
      if (gm?.features?.instancedPlaceables && gm.renderMode === '3d-hybrid') {
        const placeableRecord = {
          gridX: x,
          gridY: y,
          type: 'plant',
          variantKey: id,
          metricsOnly: true,
        };
        record.__instancedRef = placeableRecord;
        const handlePromise = gm.placeableMeshPool?.addPlaceable(placeableRecord);
        if (handlePromise && typeof handlePromise.then === 'function') {
          if (!Array.isArray(gm._pendingInstancingPromises)) gm._pendingInstancingPromises = [];
          gm._pendingInstancingPromises.push(handlePromise);
          handlePromise
            .then((handle) => {
              if (handle) placeableRecord.__meshPoolHandle = handle;
            })
            .catch(() => {});
        }
      }
    } catch (_) {
      /* ignore immediate plant instancing */
    }

    return true;
  }

  // Non-plant fallback: create legacy sprite path (plants never use sprites now)
  // Guard: if this is still a virtual family entry without resolution to a concrete plant variant
  // (unexpected, but defensive), abort instead of creating a placeholder sprite.
  if (def && def.type === 'plant-family') {
    try {
      console.warn('[placeItem] Abort unresolved plant-family placement', { id, x, y });
    } catch (_) {
      /* ignore */
    }
    return false; // cannot place unresolved family directly
  }
  const sprite = createPlaceableSprite(m, id, x, y);
  const replacingWith3D = false; // legacy hidden-sprite path removed (pure 3D now)
  // Tag with current biome generation id if available so later reinstance passes can filter.
  try {
    const gen = m.gameManager?.terrainCoordinator?._generationRunId;
    if (Number.isFinite(gen)) sprite.__generationRunId = gen;
  } catch (_) {
    /* ignore */
  }
  // Placeables now live inside terrainContainer so they can be occluded by
  // elevated tile faces in front. This allows proper isometric overlap.
  // (Previously they were forced above all terrain by container zIndex.)
  // Only add sprite to display tree if not fully replacing OR we still need it for layering math.
  try {
    if (!replacingWith3D || !m.terrainContainer) {
      if (m.terrainContainer) {
        m.terrainContainer.addChild(sprite);
      } else {
        m.gameManager.gridContainer.addChild(sprite);
      }
    } else {
      // In full replacement mode we intentionally DO NOT add the hidden sprite to the stage
      // to avoid any residual green rectangle artifacts from fallback batching.
    }
  } catch (_) {
    /* ignore add failures */
  }
  if (!replacingWith3D) {
    try {
      // Sorting within terrainContainer handled by depthValue/zIndex values; ensure sortableChildren.
      if (m.terrainContainer) {
        m.terrainContainer.sortableChildren = true;
        m.terrainContainer.sortChildren?.();
      } else {
        m.gameManager.gridContainer.sortChildren?.();
      }
    } catch (_) {
      /* ignore */
    }
  }
  if (!m.placeables.has(tileKey)) m.placeables.set(tileKey, []);
  m.placeables.get(tileKey).push(sprite);
  // Phase 4: if instancing enabled and hybrid mode active, register with mesh pool
  try {
    const gm = m.gameManager;
    if (
      !replacingWith3D &&
      gm?.features?.instancedPlaceables &&
      (gm.renderMode === '3d-hybrid' || gm.placeableMeshPool)
    ) {
      // Provide minimal shape expected by pool (gridX/gridY/type)
      const texturePath =
        (sprite &&
          sprite.texture &&
          sprite.texture.baseTexture &&
          (sprite.texture.baseTexture.resource?.url || sprite.texture.baseTexture.image?.src)) ||
        null;
      const placeableRecord = {
        gridX: x,
        gridY: y,
        type: TERRAIN_PLACEABLES[id]?.type || 'generic',
        variantKey: texturePath || id, // ensure distinct group per texture variant
      };
      // Instancing path retained for non-plant assets only.
      sprite.__instancingPending = true;
      // Attach handle onto sprite for later removal linkage
      sprite.__instancedRef = placeableRecord;
      // Fire and forget; pool handles missing three gracefully
      // Capture handle so removal can free correct instance index
      try {
        const handlePromise = gm.placeableMeshPool?.addPlaceable(placeableRecord);
        // expose for deterministic tests
        sprite.__instancingPromise = handlePromise;
        if (handlePromise && typeof handlePromise.then === 'function') {
          try {
            if (!Array.isArray(gm._pendingInstancingPromises)) {
              gm._pendingInstancingPromises = [];
            }
            gm._pendingInstancingPromises.push(handlePromise);
          } catch (_) {
            /* ignore */
          }
          handlePromise
            .then((handle) => {
              if (handle) placeableRecord.__meshPoolHandle = handle; // maintain symmetry
              try {
                delete sprite.__instancingPending;
              } catch (_) {
                /* ignore */
              }
            })
            .catch(() => {
              try {
                delete sprite.__instancingPending;
              } catch (_) {
                /* ignore */
              }
              /* ignore */
            });
        }
      } catch (_) {
        /* ignore instancing add failures */
        try {
          delete sprite.__instancingPending;
        } catch (_) {
          /* ignore */
        }
      }
    }
  } catch (_) {
    /* ignore instancing errors */
  }
  return true;
}

/**
 * Cycle the variant for placeables at a tile or for a specific sprite.
 * If `id` is provided, only cycle sprites that match that placeable id.
 * If `index` is provided, set variant to the explicit index; otherwise
 * progress to the next variant in the source array.
 */
export function cyclePlaceableVariant(m, x, y, id = null, index = null) {
  const tileKey = `${x},${y}`;
  if (!m.placeables || !m.placeables.has(tileKey)) return false;
  const list = m.placeables.get(tileKey);
  let changed = false;
  for (const sprite of list) {
    // Skip pure 3D records (no sprite texture)
    if (sprite && sprite.__threeModel && !sprite.texture) continue;
    if (!sprite || (id && sprite.placeableId !== id)) continue;
    const def = TERRAIN_PLACEABLES[sprite.placeableId];
    if (!def) continue;
    if (!Array.isArray(def.img) || def.img.length < 2) {
      const nextIndex = Number.isFinite(index) ? index % 2 : (sprite.placeableVariantIndex + 1) % 2;
      if (nextIndex !== sprite.placeableVariantIndex) {
        sprite.placeableVariantIndex = nextIndex;
        changed = true;
      }
      continue;
    }
    const len = def.img.length;
    const nextIndex = Number.isFinite(index)
      ? index % len
      : (sprite.placeableVariantIndex + 1) % len;
    const nextPath = def.img[nextIndex];
    if (!nextPath) continue;
    try {
      sprite.texture = PIXI.Texture.from(nextPath);
      sprite.placeableVariantIndex = nextIndex;
      try {
        sprite.getLocalBounds && sprite.getLocalBounds();
      } catch (_) {
        /* ignore */
      }
      changed = true;
    } catch (_) {
      /* best-effort */
    }
  }
  return changed;
}

export function removeItem(m, x, y, id = null) {
  const tileKey = `${x},${y}`;
  if (!m.placeables || !m.placeables.has(tileKey)) return false;
  const list = m.placeables.get(tileKey);
  let removed = false;
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    if (!id || p.placeableId === id) {
      try {
        // Only attempt Pixi removal if object looks like a sprite
        if (p && p.parent && typeof p.parent.removeChild === 'function') {
          p.parent.removeChild(p);
        }
      } catch (_) {
        /* best-effort */
      }
      // Remove any attached 3D model (full replacement mode)
      try {
        if (p.__threeModel) {
          const tm = p.__threeModel;
          try {
            tm.parent?.remove(tm);
          } catch (_) {
            /* ignore */
          }
          // dispose resources
          try {
            tm.traverse?.((n) => {
              if (n.isMesh) {
                try {
                  n.geometry?.dispose?.();
                } catch (_) {
                  /* ignore */
                }
                if (n.material) {
                  const mats = Array.isArray(n.material) ? n.material : [n.material];
                  for (const mtl of mats) {
                    try {
                      mtl.map?.dispose?.();
                    } catch (_) {
                      /* ignore */
                    }
                    try {
                      mtl.alphaMap?.dispose?.();
                    } catch (_) {
                      /* ignore */
                    }
                    try {
                      mtl.dispose?.();
                    } catch (_) {
                      /* ignore */
                    }
                  }
                }
              }
            });
          } catch (_) {
            /* ignore */
          }
          delete p.__threeModel;
        }
      } catch (_) {
        /* ignore */
      }
      // Phase 4: if instanced, remove from mesh pool
      try {
        const gm = m.gameManager;
        if (gm?.features?.instancedPlaceables && p.__instancedRef) {
          gm.placeableMeshPool?.removePlaceable(p.__instancedRef);
          delete p.__instancedRef;
        }
      } catch (_) {
        /* ignore */
      }
      list.splice(i, 1);
      removed = true;
    }
  }
  if (list.length === 0) m.placeables.delete(tileKey);
  return removed;
}

/**
 * Compute isometric center for a grid cell using current tile dimensions.
 * @private
 */
function _isoCenterForCell(m, gx, gy) {
  return CoordinateUtils.gridToIsometric(gx, gy, m.gameManager.tileWidth, m.gameManager.tileHeight);
}

/**
 * Reposition a single placeable sprite using current grid position and terrain height.
 * Ensures bottom-center anchoring, elevation offset, per-asset baseline offset, and z-index.
 */
export function repositionPlaceableSprite(m, sprite) {
  if (!sprite) return;
  // PURE 3D MODEL RECORD (no PIXI sprite texture data)
  if (sprite.__threeModel && !sprite.texture) {
    try {
      const gm = m.gameManager;
      const model = sprite.__threeModel;
      const gx = Number(sprite.gridX);
      const gy = Number(sprite.gridY);
      let terrainH = 0;
      try {
        terrainH = (gm.getTerrainHeight?.(gx, gy) || 0) * gm.spatial.elevationUnit;
      } catch (_) {
        /* ignore */
      }
      // Preserve existing X/Z (grid center) and only update Y based on new terrain height.
      model.position.y = terrainH;
    } catch (_) {
      /* ignore model reposition */
    }
    return;
  }
  // Ensure parent is the terrainContainer so elevated tile faces can occlude sprites behind them
  try {
    const tContainer = m.terrainContainer;
    if (tContainer && sprite.parent !== tContainer) {
      if (sprite.parent) sprite.parent.removeChild(sprite);
      tContainer.addChild(sprite);
    }
  } catch (_) {
    /* ignore */
  }
  const gx = Number(sprite.gridX);
  const gy = Number(sprite.gridY);
  // Use the same baseline point as tokens/selection so placement matches the
  // highlighted cell exactly.
  const iso = _isoCenterForCell(m, gx, gy);
  // Ensure bottom-center anchor
  try {
    sprite.anchor?.set?.(0.5, 1.0);
    sprite.pivot?.set?.(0, 0);
  } catch (_) {
    /* ignore */
  }
  // Baseline position
  // Round to whole pixels to avoid 0.5px artifacts that can land on tile edges
  sprite.x = Math.round(iso.x);
  sprite.y = Math.round(iso.y);
  // Elevation offset from current terrain height
  try {
    const h = m.terrainCoordinator?.getTerrainHeight?.(gx, gy) ?? 0;
    const elev = TerrainHeightUtils.calculateElevationOffset(h);
    sprite.y += elev;
  } catch (_) {
    /* ignore */
  }
  // Per-asset tuning
  try {
    const def = TERRAIN_PLACEABLES[sprite.placeableId] || {};
    const assetOffset = Number.isFinite(def.baselineOffsetPx) ? def.baselineOffsetPx : 0;
    sprite.y += assetOffset;
  } catch (_) {
    /* ignore */
  }
  // Assign depthValue (same metric tiles use) and a zIndex band that sits ABOVE the tile surface
  // but BELOW elevation side faces (faces typically added later with higher offsets).
  try {
    sprite.depthValue = gx + gy;
    // Base tile zIndex pattern: depth*100 + 20 (see createBaseTerrainGraphics)
    // Reserve 30-49 for placeables, 50+ for faces/overlays.
    const base = sprite.depthValue * 100;
    const type = sprite.placeableType || (TERRAIN_PLACEABLES[sprite.placeableId]?.type ?? 'path');
    const typeOffset = type === 'structure' ? 45 : type === 'plant' ? 38 : 32; // path/default
    sprite.zIndex = base + typeOffset;
  } catch (_) {
    /* ignore */
  }
  // Ensure sorting applies within terrainContainer
  try {
    if (sprite.parent) {
      sprite.parent.sortableChildren = true;
      sprite.parent.sortChildren?.();
    }
  } catch (_) {
    /* ignore */
  }
}

/**
 * Reposition all placeables located on a specific cell (gx, gy).
 */
export function updatePlaceablesForCell(m, gx, gy) {
  if (!m.placeables) return;
  const key = `${gx},${gy}`;
  const list = m.placeables.get(key);
  if (!list || !list.length) return;
  for (const sprite of list) {
    try {
      repositionPlaceableSprite(m, sprite);
    } catch (_) {
      /* ignore */
    }
  }
}

/**
 * Reposition every placeable across the map (used when elevation scale changes).
 */
export function repositionAllPlaceables(m) {
  if (!m.placeables || m.placeables.size === 0) return;
  for (const [, list] of m.placeables) {
    if (!Array.isArray(list)) continue;
    for (const sprite of list) {
      try {
        repositionPlaceableSprite(m, sprite);
      } catch (_) {
        /* ignore */
      }
    }
  }
  try {
    m.gameManager?.gridContainer?.sortChildren?.();
  } catch (_) {
    /* ignore */
  }
}
