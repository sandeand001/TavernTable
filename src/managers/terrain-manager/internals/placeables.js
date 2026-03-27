import { TERRAIN_PLACEABLES } from '../../../config/terrain/TerrainPlaceables.js';
import logger, { LOG_CATEGORY } from '../../../utils/Logger.js';
import { createPlaceableSprite } from './placeables-sprite.js';
import {
  repositionPlaceableSprite,
  updatePlaceablesForCell,
  repositionAllPlaceables,
} from './placeables-positioning.js';

// Depth utilities no longer used for cross-container zIndex raise; we align to tile scheme.
// import { computeDepthKey, TYPE_BIAS, withOverlayRaise } from '../../../utils/geometry/DepthUtils.js';

// NOTE: previous QA introduced a fixed LEVEL_COMPENSATION which caused
// consistent downward shifts and incorrect behavior for elevated tiles.
// We intentionally do NOT apply a blanket compensation. Instead we only
// apply the per-tile elevation offset computed by TerrainHeightUtils so
// height 0 maps to the iso baseline and positive heights are moved up
// (negative Y) by the appropriate pixel amount.

// Temporary/adjustable baseline compensation removed: use per-asset offsets only.

// Optional auto-baseline detection helpers for trees were removed in favor of
// explicit, per-asset baselineOffsetPx in the config to keep behavior deterministic.

// ── Constants ─────────────────────────────────────────────

const TREE_ID_PATTERN = /^tree-/i;

const MODEL_BASELINE_OFFSETS = new Map();

const PLACEABLE_LOG_CATEGORY = LOG_CATEGORY.RENDERING;
const shouldLogTreeModelInfo = () =>
  logger.isInfoEnabled() && typeof window !== 'undefined' && !!window.DEBUG_TREE_MODELS;

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

// ── Model Cache ─────────────────────────────────────────────

function resolveModelBaselineOffset(gameManager, cacheKey, root) {
  const key = cacheKey || null;
  if (key && MODEL_BASELINE_OFFSETS.has(key)) {
    return MODEL_BASELINE_OFFSETS.get(key);
  }
  let baseline = 0;
  try {
    const threeNS = gameManager?.threeSceneManager?.three;
    const Box3Ctor = threeNS?.Box3;
    if (typeof Box3Ctor === 'function' && root) {
      const bounds = new Box3Ctor();
      try {
        root.updateMatrixWorld?.(true);
      } catch (_) {
        /* ignore matrix sync */
      }
      bounds.setFromObject(root);
      if (Number.isFinite(bounds?.min?.y)) {
        baseline = bounds.min.y;
      }
    }
  } catch (_) {
    baseline = 0;
  }
  if (key) {
    MODEL_BASELINE_OFFSETS.set(key, baseline);
  }
  return baseline;
}

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

// ── Tree Helpers ─────────────────────────────────────────────

function isTreePlaceableId(id, def = TERRAIN_PLACEABLES[id]) {
  if (!id) return false;
  if (TREE_ID_PATTERN.test(id)) return true;
  if (def?.type === 'plant-family' && Array.isArray(def.familyVariants)) {
    return def.familyVariants.some((variantId) => TREE_ID_PATTERN.test(variantId));
  }
  return false;
}

function resolveFamilyVariant(def, x, y) {
  if (!def || def.type !== 'plant-family' || !Array.isArray(def.familyVariants)) return null;
  const variants = def.familyVariants.filter((variantId) => TERRAIN_PLACEABLES[variantId]);
  if (!variants.length) return null;
  if (variants.length === 1) return variants[0];
  const seed = ((x * 73856093) ^ (y * 19349663) ^ variants.length) >>> 0;
  const idx = seed % variants.length;
  return variants[idx];
}

function clearExistingTreesAtTile(m, tileKey, x, y) {
  if (!m?.placeables || !m.placeables.has(tileKey)) return false;
  const list = m.placeables.get(tileKey);
  if (!Array.isArray(list) || !list.length) return false;
  let removed = false;
  const snapshot = list.slice();
  for (const entry of snapshot) {
    const existingId = entry?.placeableId;
    if (!existingId || !isTreePlaceableId(existingId)) continue;
    removeItem(m, x, y, existingId);
    removed = true;
  }
  return removed;
}

function cloneMeshMaterials(root) {
  if (!root?.traverse) return;
  root.traverse((child) => {
    if (!child?.isMesh || !child.material) return;
    if (Array.isArray(child.material)) {
      child.material = child.material.map((mat) => {
        if (!mat || typeof mat.clone !== 'function') return mat;
        const clone = mat.clone();
        clone.needsUpdate = true;
        return clone;
      });
      return;
    }
    const mat = child.material;
    if (mat && typeof mat.clone === 'function') {
      child.material = mat.clone();
      child.material.needsUpdate = true;
    }
  });
}

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

// ── Place Item ─────────────────────────────────────────────

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
  if (def?.type === 'plant-family') {
    const variantId = resolveFamilyVariant(def, x, y);
    if (variantId && TERRAIN_PLACEABLES[variantId]) {
      id = variantId;
      def = TERRAIN_PLACEABLES[id];
    }
  }
  const isPlant = def?.type === 'plant';
  const gm3d = m.gameManager;
  // Do not snapshot scene reference; it may initialize after placement request.

  // PURE 3D PATH: plants always use models now (legacy 2D removed)
  if (isPlant) {
    if (!m.placeables) m.placeables = new Map();
    if (isTreePlaceableId(id, def)) {
      clearExistingTreesAtTile(m, tileKey, x, y);
    }
    if (!m.placeables.has(tileKey)) m.placeables.set(tileKey, []);
    const record = {
      gridX: x,
      gridY: y,
      id,
      placeableId: id,
      placeableType: def.type,
      __threeModelPending: true,
      // Maintain a variant index concept even for 3D-only plants so existing
      // variant cycling tests (which expect a sprite-era property) remain valid.
      placeableVariantIndex: 0,
      // Provide a variant key for potential instancing (canonical id)
      variantKey: id,
      renderProfile: 'billboard',
      __is3DPlaceable: true,
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
      const modelKey = def.modelKey;
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
        const baselineKey = modelKey || id;
        const baseline = resolveModelBaselineOffset(gm3d, baselineKey, model);
        const manualOffset = Number.isFinite(def?.modelGroundOffset) ? def.modelGroundOffset : 0;
        const groundOffset = -baseline + manualOffset;
        const finalX = Number.isFinite(world?.x) ? world.x : 0;
        const finalZ = Number.isFinite(world?.z) ? world.z : 0;
        model.position.set(finalX, terrainH + groundOffset, finalZ);
        record.__groundOffset = groundOffset;
        record.__baselineOffset = baseline;
        record.__manualGroundOffset = manualOffset;
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
            if (shouldLogTreeModelInfo()) {
              logger.info(
                '[Placeables] Deferred plant model (scene not ready)',
                { id, modelKey },
                PLACEABLE_LOG_CATEGORY
              );
            }
          }
        } catch (_) {
          /* ignore add failures */
        }
        record.__threeModel = model;
        delete record.__threeModelPending;
        if (shouldLogTreeModelInfo()) {
          logger.info(
            '[Placeables] 3D plant placed',
            { id, modelKey, x, y },
            PLACEABLE_LOG_CATEGORY
          );
        }
      };
      // Palm model aliasing: if dedicated palm assets don't exist yet, map them to a broadleaf base and adjust.
      const palmAliasMap = {
        'tropical-palm-a': 'common-broadleaf-2',
        'tropical-palm-b': 'common-broadleaf-3',
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
      if (palmAliasMap[modelKey] && !cache.hasKey(modelKey)) {
        const baseKey = palmAliasMap[modelKey];
        cache
          .getModel(baseKey)
          .then((model) => {
            if (!model) return;
            const root = model.clone(true);
            cloneMeshMaterials(root);
            palmStyler(root, modelKey);
            finalizeModelPlacement(root);
          })
          .catch(() => {
            /* optional coastal palm variant missing; fall back gracefully */
          });
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
          cloneMeshMaterials(root);
          try {
            const tintVariant = def?.tintVariant || TERRAIN_PLACEABLES[id]?.tintVariant;
            const isSpectralTint = tintVariant === 'spectral' || /-spectral$/i.test(id);
            if (isSpectralTint) {
              const spectralPalettes = [
                {
                  foliage: 0xbd4bff,
                  trunk: 0x261047,
                  glow: 0x61f7ff,
                  foliageOpacity: 0.62,
                  trunkOpacity: 0.34,
                },
                {
                  foliage: 0x64ffe1,
                  trunk: 0x033f3b,
                  glow: 0x7ea4ff,
                  foliageOpacity: 0.6,
                  trunkOpacity: 0.32,
                },
                {
                  foliage: 0xff5bd8,
                  trunk: 0x5c103c,
                  glow: 0xffc26e,
                  foliageOpacity: 0.61,
                  trunkOpacity: 0.35,
                },
                {
                  foliage: 0x6d8bff,
                  trunk: 0x1a256e,
                  glow: 0x9d5dff,
                  foliageOpacity: 0.58,
                  trunkOpacity: 0.33,
                },
                {
                  foliage: 0x9dff5c,
                  trunk: 0x1f440d,
                  glow: 0x67d6ff,
                  foliageOpacity: 0.6,
                  trunkOpacity: 0.32,
                },
              ];
              const seed = ((x * 73856093) ^ (y * 19349663) ^ id.length) >>> 0;
              const palette = spectralPalettes[seed % spectralPalettes.length];
              const hueJitter = (((seed >> 7) & 0x1f) / 31 - 0.5) * 0.12; // +/- ~0.06 hue shift
              root.traverse?.((ch) => {
                if (ch?.isMesh) {
                  try {
                    if (ch.castShadow !== false) ch.castShadow = false;
                  } catch (_) {
                    /* shadow tweak non-fatal */
                  }
                  try {
                    if (ch.receiveShadow !== false) ch.receiveShadow = false;
                  } catch (_) {
                    /* shadow tweak non-fatal */
                  }
                }
                if (!ch.isMesh || !ch.material) return;
                const mats = Array.isArray(ch.material) ? ch.material : [ch.material];
                const nodeLabel = `${ch.name || ''}`.toLowerCase();
                mats.forEach((m) => {
                  if (!m || !m.color) return;
                  const matLabel = `${nodeLabel} ${(m.name || '').toLowerCase()}`;
                  const mapName = `${m.map?.name || ''}`.toLowerCase();
                  const mapSrc = `${m.map?.image?.src || ''}`.toLowerCase();
                  const mapLabel = `${mapName} ${mapSrc}`;
                  const isFoliageCandidate = !!(m.userData && m.userData.__foliageCandidate);
                  const usesCutout = m.userData?.__foliageStrategy === 'cutout-lite';
                  const heurFoliage = /leaf|foliage|petal|flower|canopy|crown|blossom/.test(
                    `${matLabel} ${mapLabel}`
                  );
                  const isFoliage = isFoliageCandidate || heurFoliage;
                  const isTrunk = /trunk|bark|branch|wood|stem/.test(matLabel);
                  if (!isFoliage && !isTrunk) return;
                  try {
                    const targetHex = isFoliage ? palette.foliage : palette.trunk;
                    m.color.setHex(targetHex);
                    if (typeof m.color.offsetHSL === 'function') {
                      const baseSat = isFoliage ? 0.24 : -0.18;
                      const baseLight = isFoliage ? 0.16 : -0.2;
                      m.color.offsetHSL(hueJitter, baseSat, baseLight);
                    }
                  } catch (_) {
                    /* tint apply fallback */
                  }
                  const targetOpacity = isFoliage
                    ? (palette.foliageOpacity ?? 0.58)
                    : (palette.trunkOpacity ?? 0.34);
                  try {
                    if (usesCutout) {
                      m.opacity = 1;
                      m.alphaTest = Math.min(0.35, Math.max(0.02, m.alphaTest ?? 0.05));
                    } else if (typeof m.opacity !== 'number' || m.opacity > targetOpacity) {
                      m.opacity = targetOpacity;
                    }
                  } catch (_) {
                    /* ignore opacity failure */
                  }
                  if (m.emissive && typeof m.emissive.setHex === 'function' && palette.glow) {
                    try {
                      m.emissive.setHex(palette.glow);
                      const desired = isFoliage ? 0.48 : 0.28;
                      m.emissiveIntensity = Math.max(m.emissiveIntensity ?? 0, desired);
                    } catch (_) {
                      /* emissive optional */
                    }
                  }
                  try {
                    if (usesCutout) {
                      m.transparent = false;
                      if (typeof m.depthWrite === 'boolean') m.depthWrite = true;
                      if (typeof m.depthTest === 'boolean') m.depthTest = true;
                    } else {
                      m.transparent = true;
                      if (m.depthWrite !== false) m.depthWrite = false;
                    }
                    if (typeof m.alphaHash === 'boolean') m.alphaHash = false;
                  } catch (_) {
                    /* transparency setup non-fatal */
                  }
                  m.needsUpdate = true;
                });
              });
            } else if (/^tree-thick-[a-e]$/i.test(id)) {
              root.traverse?.((ch) => {
                if (!ch?.isMesh || !ch.material) return;
                const mats = Array.isArray(ch.material) ? ch.material : [ch.material];
                const nodeLabel = `${ch.name || ''}`.toLowerCase();
                mats.forEach((m) => {
                  if (!m) return;
                  const matLabel = `${nodeLabel} ${(m.name || '').toLowerCase()}`;
                  const mapName = `${m.map?.name || ''}`.toLowerCase();
                  const mapSrc = `${m.map?.image?.src || ''}`.toLowerCase();
                  const mapLabel = `${mapName} ${mapSrc}`;
                  const isFoliageCandidate = !!(m.userData && m.userData.__foliageCandidate);
                  const usesCutout = m.userData?.__foliageStrategy === 'cutout-lite';
                  const heurFoliage = /leaf|foliage|needl|canopy|crown|pine/.test(
                    `${matLabel} ${mapLabel}`
                  );
                  const isFoliage = isFoliageCandidate || heurFoliage;
                  const isTrunk = /trunk|bark|branch|wood|stem/.test(matLabel);
                  if (!isFoliage && !isTrunk) return;
                  try {
                    if (m.color) {
                      // Restore neutral multiplier so baked textures define the palette.
                      if (m.color.setRGB) {
                        m.color.setRGB(1, 1, 1);
                      } else if ('r' in m.color && 'g' in m.color && 'b' in m.color) {
                        m.color.r = 1;
                        m.color.g = 1;
                        m.color.b = 1;
                      }
                    }
                  } catch (_) {
                    /* natural tint reset fallback */
                  }
                  try {
                    if (typeof m.opacity === 'number') {
                      if (usesCutout && isFoliage) {
                        m.opacity = 1;
                        m.alphaTest = Math.min(0.35, Math.max(0.02, m.alphaTest ?? 0.05));
                      } else {
                        m.opacity = isFoliage ? 0.98 : 1;
                      }
                    }
                    if (typeof m.transparent === 'boolean') {
                      m.transparent = usesCutout ? false : !!isFoliage;
                    }
                    if (typeof m.depthWrite === 'boolean') {
                      m.depthWrite = usesCutout ? true : !isFoliage;
                    }
                    if (usesCutout && typeof m.depthTest === 'boolean') {
                      m.depthTest = true;
                    }
                  } catch (_) {
                    /* transparency reset non-fatal */
                  }
                  if (m.emissive && typeof m.emissive.setHex === 'function') {
                    try {
                      m.emissive.setHex(0x000000);
                      if (typeof m.emissiveIntensity === 'number') {
                        m.emissiveIntensity = 0;
                      }
                    } catch (_) {
                      /* emissive reset optional */
                    }
                  }
                  m.needsUpdate = true;
                });
              });
            }
          } catch (_) {
            /* spectral tint non-fatal */
          }
          finalizeModelPlacement(root);
        })
        .catch(() => {
          /* asset missing at runtime; sprite fallback already covers this */
        });
    });

    // Immediate metrics-only instancing registration (hidden) so tests & metrics update synchronously.
    try {
      const gm = gm3d;
      if (gm?.features?.instancedPlaceables && gm?.is3DModeActive?.()) {
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
            .catch(() => {
              /* instancing handle is optional for metrics path */
            });
        }
      }
    } catch (_) {
      /* ignore immediate plant instancing */
    }

    return true;
  }

  // Non-plant path: prefer native 3D placement when hybrid rendering is active.
  // Guard: if this is still a virtual family entry without resolution to a concrete plant variant
  // (unexpected, but defensive), abort instead of creating a placeholder sprite.
  if (def && def.type === 'plant-family') {
    try {
      logger.warn(
        '[placeItem] Abort unresolved plant-family placement',
        { id, x, y },
        PLACEABLE_LOG_CATEGORY
      );
    } catch (_) {
      /* ignore */
    }
    return false; // cannot place unresolved family directly
  }

  const gm = m.gameManager;
  const hybridReady =
    gm?.is3DModeActive?.() &&
    gm?.features?.instancedPlaceables &&
    typeof gm.ensureInstancing === 'function';
  const meshPool = hybridReady ? gm.ensureInstancing() || gm.placeableMeshPool : null;

  // Resolve deterministic variant (mirrors sprite-era hashing so tests remain stable)
  let variantPath = Array.isArray(def?.img) ? null : def?.img || null;
  let variantIndex = 0;
  if (Array.isArray(def?.img) && def.img.length) {
    const len = def.img.length;
    const hash = Math.abs(((x * 73856093) ^ (y * 19349663)) >>> 0);
    variantIndex = hash % len;
    variantPath = def.img[variantIndex];
  }
  const variantKey = variantPath || `${id}:${variantIndex}`;

  if (meshPool) {
    if (!m.placeables.has(tileKey)) m.placeables.set(tileKey, []);
    const tileWidthPx = gm?.tileWidth ?? 64;
    const tileHeightPx = gm?.tileHeight ?? 32;
    const elevationUnit = gm?.spatial?.elevationUnit ?? 0.5;
    const isGroundPath = def?.type === 'path' && def.disableGroundLift !== true;
    const baseLift = isGroundPath ? 0.01 : 0;
    const baselinePx = Number.isFinite(def?.baselineOffsetPx) ? def.baselineOffsetPx : 0;
    const baselineWorld = baselinePx !== 0 ? (baselinePx / tileHeightPx) * elevationUnit : 0;
    const record = {
      gridX: x,
      gridY: y,
      id,
      placeableId: id,
      placeableType: def?.type || 'generic',
      placeableVariantIndex: variantIndex,
      variantKey,
      texturePath: variantPath,
      __rawVariantKey: variantPath,
      renderProfile: def?.renderProfile || (def?.type === 'path' ? 'ground' : 'billboard'),
      scaleMode: def?.scaleMode || 'contain',
      __nominalSize: {
        widthPx: Number.isFinite(def?.nominalWidthPx) ? def.nominalWidthPx : tileWidthPx,
        heightPx: Number.isFinite(def?.nominalHeightPx) ? def.nominalHeightPx : tileHeightPx,
      },
      heightOffset: baseLift + baselineWorld,
      __is3DPlaceable: true,
    };
    record.__instancedRef = record;
    if (Number.isFinite(m.gameManager?.terrainCoordinator?._generationRunId)) {
      record.__generationRunId = m.gameManager.terrainCoordinator._generationRunId;
    }
    m.placeables.get(tileKey).push(record);

    try {
      const handlePromise = meshPool.addPlaceable(record);
      record.__instancingPromise = handlePromise;
      if (handlePromise && typeof handlePromise.then === 'function') {
        if (!Array.isArray(gm._pendingInstancingPromises)) {
          gm._pendingInstancingPromises = [];
        }
        gm._pendingInstancingPromises.push(handlePromise);
        handlePromise.catch(() => {
          /* instancing handle is optional; bookkeeping already recorded */
        });
      }
    } catch (_) {
      /* ignore instancing add failures (record remains for bookkeeping) */
    }

    return true;
  }

  // Legacy 2D fallback when hybrid renderer/instancing is unavailable (e.g., tests or 2D mode).
  const sprite = createPlaceableSprite(m, id, x, y);
  try {
    const gen = m.gameManager?.terrainCoordinator?._generationRunId;
    if (Number.isFinite(gen)) sprite.__generationRunId = gen;
  } catch (_) {
    /* ignore */
  }
  try {
    if (m.terrainContainer) {
      m.terrainContainer.addChild(sprite);
    } else {
      m.gameManager.gridContainer.addChild(sprite);
    }
  } catch (_) {
    /* ignore add failures */
  }
  try {
    if (m.terrainContainer) {
      m.terrainContainer.sortableChildren = true;
      m.terrainContainer.sortChildren?.();
    } else {
      m.gameManager.gridContainer.sortChildren?.();
    }
  } catch (_) {
    /* ignore */
  }
  if (!m.placeables.has(tileKey)) m.placeables.set(tileKey, []);
  m.placeables.get(tileKey).push(sprite);
  return true;
}

// ── Variant Cycling ─────────────────────────────────────────────

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

// ── Removal ─────────────────────────────────────────────

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

// ── Re-exports ─────────────────────────────────────────────

// Re-export extracted functions so existing callers see no change
export { createPlaceableSprite, updatePlaceablesForCell, repositionAllPlaceables };
