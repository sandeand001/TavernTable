import { Texture } from '../../../utils/stubs/PixiStub.js';
import { TERRAIN_PLACEABLES } from '../../../config/terrain/TerrainPlaceables.js';

const PLANT_FAMILY_VARIANTS = (() => {
  const map = new Map();
  try {
    for (const def of Object.values(TERRAIN_PLACEABLES)) {
      if (!def || def.type !== 'plant-family' || !Array.isArray(def.familyVariants)) continue;
      const variants = def.familyVariants.filter(
        (variantId) => typeof variantId === 'string' && TERRAIN_PLACEABLES[variantId]
      );
      if (variants.length < 2) continue;
      for (const variantId of variants) {
        if (!map.has(variantId)) {
          map.set(variantId, variants);
        }
      }
    }
  } catch (_) {
    /* ignore mapping failures */
  }
  return map;
})();

function resolvePlantFamilyVariants(variantId) {
  if (typeof variantId !== 'string') return null;
  const cached = PLANT_FAMILY_VARIANTS.get(variantId);
  if (cached && cached.length >= 2) return cached;
  try {
    for (const def of Object.values(TERRAIN_PLACEABLES)) {
      if (!def || def.type !== 'plant-family' || !Array.isArray(def.familyVariants)) continue;
      if (!def.familyVariants.includes(variantId)) continue;
      const variants = def.familyVariants.filter(
        (v) => typeof v === 'string' && TERRAIN_PLACEABLES[v]
      );
      if (variants.length >= 2) {
        PLANT_FAMILY_VARIANTS.set(variantId, variants);
        return variants;
      }
    }
  } catch (_) {
    /* ignore */
  }
  return null;
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
  const gm = m.gameManager;
  for (const sprite of list) {
    if (!sprite || (id && sprite.placeableId !== id)) continue;

    // Handle native 3D instanced placeables
    if (sprite.__is3DPlaceable && !sprite.__threeModel) {
      const def = TERRAIN_PLACEABLES[sprite.placeableId];
      if (!def) continue;
      const variants = Array.isArray(def.img) ? def.img : def.img ? [def.img] : [];
      if (variants.length < 2) {
        const familyVariants = resolvePlantFamilyVariants(sprite.placeableId);
        if (familyVariants && familyVariants.length >= 2) {
          const len = familyVariants.length;
          const currentIndex = familyVariants.indexOf(sprite.placeableId);
          const baselineIndex =
            currentIndex >= 0 ? currentIndex : Number(sprite.placeableVariantIndex) || 0;
          const nextIndex = Number.isFinite(index)
            ? ((index % len) + len) % len
            : (baselineIndex + 1) % len;
          const nextId = familyVariants[nextIndex];
          if (nextId && nextId !== sprite.placeableId) {
            try {
              if (sprite.__instancedRef && gm?.placeableMeshPool) {
                gm.placeableMeshPool.removePlaceable(sprite.__instancedRef);
                delete sprite.__instancedRef;
              }
            } catch (_) {
              /* ignore removal failure */
            }
            sprite.placeableId = nextId;
            sprite.id = nextId;
            sprite.variantKey = nextId;
            sprite.texturePath = null;
            sprite.__rawVariantKey = null;
            sprite.placeableVariantIndex = nextIndex;
            const nextDef = TERRAIN_PLACEABLES[nextId];
            if (nextDef && typeof nextDef.type === 'string') {
              sprite.placeableType = nextDef.type;
            }
            if (nextDef && nextDef.tintVariant) {
              sprite.tintVariant = nextDef.tintVariant;
            } else if (sprite.tintVariant) {
              delete sprite.tintVariant;
            }
            sprite.__threeModelPending = true;
            if (sprite.__threeModel) {
              try {
                sprite.__threeModel.parent?.remove(sprite.__threeModel);
              } catch (_) {
                /* ignore */
              }
              delete sprite.__threeModel;
            }
            const pool =
              gm?.is3DModeActive?.() && gm?.features?.instancedPlaceables
                ? gm.ensureInstancing?.() || gm.placeableMeshPool
                : null;
            if (pool) {
              try {
                const handlePromise = pool.addPlaceable(sprite);
                sprite.__instancingPromise = handlePromise;
                if (handlePromise && typeof handlePromise.then === 'function') {
                  if (!Array.isArray(gm._pendingInstancingPromises)) {
                    gm._pendingInstancingPromises = [];
                  }
                  gm._pendingInstancingPromises.push(handlePromise);
                  handlePromise.catch(() => {
                    /* instancing re-add failure falls back to sprite rendering */
                  });
                }
              } catch (_) {
                /* ignore re-add failure */
              }
            }
            changed = true;
          }
          continue;
        }
        const nextIndex = Number.isFinite(index)
          ? Math.max(0, index) % Math.max(variants.length, 1)
          : (Number(sprite.placeableVariantIndex) + 1) % Math.max(variants.length, 1);
        if (nextIndex !== sprite.placeableVariantIndex) {
          sprite.placeableVariantIndex = nextIndex;
          changed = true;
        }
        continue;
      }
      const len = variants.length;
      const nextIndex = Number.isFinite(index)
        ? ((index % len) + len) % len
        : (sprite.placeableVariantIndex + 1) % len;
      const nextPath = variants[nextIndex];
      if (!nextPath) continue;
      try {
        if (sprite.__instancedRef && gm?.placeableMeshPool) {
          gm.placeableMeshPool.removePlaceable(sprite.__instancedRef);
          delete sprite.__meshPoolHandle;
        }
      } catch (_) {
        /* ignore */
      }
      sprite.placeableVariantIndex = nextIndex;
      sprite.variantKey = nextPath;
      sprite.texturePath = nextPath;
      sprite.__rawVariantKey = nextPath;
      const pool =
        gm?.is3DModeActive?.() && gm?.features?.instancedPlaceables
          ? gm.ensureInstancing?.() || gm.placeableMeshPool
          : null;
      if (pool) {
        try {
          const handlePromise = pool.addPlaceable(sprite);
          sprite.__instancingPromise = handlePromise;
          if (handlePromise && typeof handlePromise.then === 'function') {
            if (!Array.isArray(gm._pendingInstancingPromises)) {
              gm._pendingInstancingPromises = [];
            }
            gm._pendingInstancingPromises.push(handlePromise);
            handlePromise.catch(() => {
              /* instancing re-add failure falls back to sprite rendering */
            });
          }
        } catch (_) {
          /* ignore re-add failure */
        }
      }
      changed = true;
      continue;
    }

    // Skip pure 3D model records (handled separately)
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
      sprite.texture = Texture.from(nextPath);
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
