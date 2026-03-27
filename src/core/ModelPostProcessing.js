// Post-processing pipeline for loaded 3D model assets.
// Extracted from ModelAssetCache.js (Phase 8).
// Handles texture application, foliage detection, alpha testing,
// shadow setup, height-based scaling, and per-asset tuning.

// ── Imports & Constants ─────────────────────────────────────────
import logger, { LOG_CATEGORY } from '../utils/Logger.js';

const MODEL_LOG_CATEGORY = LOG_CATEGORY.CACHE;
const DEFAULT_TEXTURE_BASE = 'assets/terrain/3d Assets/Textures';

const KNOWN_ALPHA_TEXTURES = new Set(
  [
    'MI_MZRa_Monstera_B07a1_BC.png',
    'MI_MZRa_Monstera_B07a2_BC.png',
    'T_MZRa_Banana_B09a_BC.png',
    'T_MZRa_Fern_B051_BC.png',
    'T_MZRa_Fern_B052_BC.png',
    'T_MZRa_Fern_B053_BC.png',
    'T_MZRa_Palm_B08a_BC.png',
  ].map((name) => name.toLowerCase())
);

const clampAlphaTest = (value) => Math.min(0.45, Math.max(0.01, value ?? 0.05));

/**
 * Apply texture mapping, foliage classification, alpha testing, shadow setup,
 * and auto-scaling to a loaded model.
 *
 * @param {ModelAssetCache} cache  The cache instance (for _textureLoader / _textureCache)
 * @param {object} three           Three.js namespace
 * @param {object} root            The root Object3D of the model
 * @param {string} key             Registry key
 * @param {string} path            Resolved file path
 * @param {string} kind            'obj' | 'fbx'
 * @param {object} descriptor      Registry entry (textures, foliageAlphaTest, etc.)
 */
export function postProcessModel(cache, three, root, key, path, kind, descriptor) {
  try {
    const entry = descriptor || {};
    const textureBases = [];
    if (entry.textureBase) textureBases.push(entry.textureBase);
    if (!textureBases.includes(DEFAULT_TEXTURE_BASE)) textureBases.push(DEFAULT_TEXTURE_BASE);
    const uniqueBases = textureBases.filter((base, idx) => textureBases.indexOf(base) === idx);
    const ensureTexture = (file, opts = {}) => {
      if (!file) return null;
      if (!cache._textureLoader) cache._textureLoader = new three.TextureLoader();
      if (!cache._textureCache) cache._textureCache = new Map();
      const { colorSpace = 'srgb' } = opts;
      for (const base of uniqueBases) {
        const full = `${base}/${file}`;
        let tex = cache._textureCache.get(full);
        if (!tex) {
          try {
            tex = cache._textureLoader.load(full, () => {
              if (tex && 'colorSpace' in tex) {
                if (colorSpace === 'srgb' && three.SRGBColorSpace) {
                  tex.colorSpace = three.SRGBColorSpace;
                } else if (colorSpace === 'linear' && three.LinearSRGBColorSpace) {
                  tex.colorSpace = three.LinearSRGBColorSpace;
                }
                tex.needsUpdate = true;
              }
            });
            if (tex && !tex.name) tex.name = file;
            cache._textureCache.set(full, tex);
          } catch (_) {
            tex = null;
          }
        }
        if (tex) return tex;
      }
      return null;
    };
    const entryTextures = entry.textures || {};
    const entryTextureCache = new Map();
    const getEntryTexture = (purpose, opts) => {
      if (!entryTextures[purpose]) return null;
      if (!entryTextureCache.has(purpose)) {
        entryTextureCache.set(purpose, ensureTexture(entryTextures[purpose], opts));
      }
      return entryTextureCache.get(purpose);
    };
    const foliageAlpha =
      entry.foliageAlphaTest !== undefined ? clampAlphaTest(entry.foliageAlphaTest) : null;
    const foliageHintsLc = Array.isArray(entry.foliageTextureHints)
      ? entry.foliageTextureHints.map((hint) => String(hint || '').toLowerCase())
      : [];
    const matchesKnownAlphaTexture = (value) => {
      if (!value) return false;
      const lc = String(value || '').toLowerCase();
      const leaf = lc.split(/[\\/]/).pop() || lc;
      return KNOWN_ALPHA_TEXTURES.has(leaf);
    };
    root.traverse((child) => {
      if (!child.isMesh) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach((mat) => {
        if (!mat) return;
        try {
          if (!mat.map) {
            const direct = getEntryTexture('baseColor', { colorSpace: 'srgb' });
            if (direct) {
              mat.map = direct;
              mat.needsUpdate = true;
            }
          }
          if (!mat.map) {
            const nameLc = (mat.name || '').toLowerCase();
            const pick = () => {
              if (/leaves_birch|birch_leaves/.test(nameLc)) return 'Leaves_Birch_C.png';
              if (/bark_birch/.test(nameLc)) return 'Bark_BirchTree.png';
              if (/leaves_twistedtree/.test(nameLc)) return 'Leaves_TwistedTree_C.png';
              if (/leaves_normaltree/.test(nameLc)) return 'Leaves_NormalTree_C.png';
              if (/leaves_giantpine/.test(nameLc)) return 'Leaves_GiantPine_C.png';
              if (/cherry|sakura|blossom/.test(nameLc)) return 'Leaves_CherryBlossom_C.png';
              if (/(leaves_pine|leaf_pine)/.test(nameLc)) return 'Leaf_Pine_C.png';
              if (/leaves/.test(nameLc)) return 'Leaves.png';
              if (/bark_twistedtree/.test(nameLc)) return 'Bark_TwistedTree.png';
              if (/bark_deadtree/.test(nameLc)) return 'Bark_DeadTree.png';
              if (/bark_normaltree/.test(nameLc)) return 'Bark_NormalTree.png';
              if (/bark/.test(nameLc)) return 'Bark_NormalTree.png';
              if (/mushroom/.test(nameLc)) return 'Mushrooms.png';
              if (/grass/.test(nameLc)) return 'Grass.png';
              if (/rock|stone|path/.test(nameLc)) return 'Rocks_Diffuse.png';
              return null;
            };
            const file = pick();
            if (file) {
              const tex = ensureTexture(file, { colorSpace: 'srgb' });
              if (tex) {
                mat.map = tex;
                mat.needsUpdate = true;
              }
            }
          }
          if (mat.map) {
            try {
              const src = mat.map.image?.src || mat.map.source?.data?.src || '';
              if (/^[a-zA-Z]:[\\/]/.test(src)) {
                const file = src.split(/[/\\]/).pop();
                const tex = ensureTexture(file, { colorSpace: 'srgb' });
                if (tex) {
                  mat.map = tex;
                  mat.needsUpdate = true;
                }
              } else if ('colorSpace' in mat.map && three.SRGBColorSpace) {
                mat.map.colorSpace = three.SRGBColorSpace;
              }
            } catch (_) {
              /* ignore texture rewrite failures */
            }
          }
          const nodeLabel = `${child.name || ''}`.toLowerCase();
          const matLabelLc = `${mat.name || ''}`.toLowerCase();
          const mapNameLc = `${mat.map?.name || ''}`.toLowerCase();
          const mapSrcLc = (mat.map?.image?.src || mat.map?.source?.data?.src || '').toLowerCase();
          const mapFileLc = mapSrcLc.split(/[\\/]/).pop() || '';
          const mapNameFileLc = mapNameLc.split(/[\\/]/).pop() || '';
          const alphaSrcLc = (
            mat.alphaMap?.image?.src ||
            mat.alphaMap?.source?.data?.src ||
            ''
          ).toLowerCase();
          const alphaFileLc = alphaSrcLc.split(/[\\/]/).pop() || '';
          const combinedLabel = `${nodeLabel} ${matLabelLc} ${mapNameLc} ${mapSrcLc}`;
          const heurFoliage =
            /(leaf|leaves|foliage|canopy|crown|autumn|orange|yellow|red|frond|palm|banana|monstera|fern)/.test(
              combinedLabel
            );
          const heurTrunk = /(bark|trunk|branch|wood|stem|log)/.test(combinedLabel);
          const matchesHint =
            foliageHintsLc.length > 0 &&
            foliageHintsLc.some(
              (hint) =>
                hint &&
                (mapNameLc.includes(hint) ||
                  mapSrcLc.includes(hint) ||
                  mapFileLc.includes(hint) ||
                  mapNameFileLc.includes(hint) ||
                  alphaSrcLc.includes(hint) ||
                  alphaFileLc.includes(hint))
            );
          const hasKnownAlpha =
            matchesKnownAlphaTexture(mapNameLc) ||
            matchesKnownAlphaTexture(mapNameFileLc) ||
            matchesKnownAlphaTexture(mapSrcLc) ||
            matchesKnownAlphaTexture(mapFileLc) ||
            matchesKnownAlphaTexture(alphaSrcLc) ||
            matchesKnownAlphaTexture(alphaFileLc);
          const isFoliage = !heurTrunk && (heurFoliage || matchesHint || hasKnownAlpha);
          if (!mat.userData) mat.userData = {};
          if (!isFoliage) {
            mat.userData.__foliageCandidate = false;
            const normalTex = getEntryTexture('normal', { colorSpace: 'linear' });
            if (normalTex && !mat.normalMap) {
              mat.normalMap = normalTex;
              mat.needsUpdate = true;
            }
            const roughnessTex = getEntryTexture('roughness', { colorSpace: 'linear' });
            if (roughnessTex && !mat.roughnessMap) {
              mat.roughnessMap = roughnessTex;
              mat.needsUpdate = true;
            }
            return;
          }
          mat.userData.__foliageCandidate = true;
          if (!mat.map) {
            try {
              const tex = ensureTexture('Leaves_NormalTree_C.png', { colorSpace: 'srgb' });
              if (tex) {
                mat.map = tex;
                mat.needsUpdate = true;
              }
            } catch (_) {
              /* ignore leaf fallback failure */
            }
          }
          const normalTex = getEntryTexture('normal', { colorSpace: 'linear' });
          if (normalTex && !mat.normalMap) {
            mat.normalMap = normalTex;
            mat.needsUpdate = true;
          }
          const roughnessTex = getEntryTexture('roughness', { colorSpace: 'linear' });
          if (roughnessTex && !mat.roughnessMap) {
            mat.roughnessMap = roughnessTex;
            mat.needsUpdate = true;
          }
          const opacityTex = getEntryTexture('opacity', { colorSpace: 'linear' });
          if (opacityTex) {
            mat.alphaMap = opacityTex;
            mat.needsUpdate = true;
          }
          mat.transparent = false;
          if (
            /cherry/.test(key) &&
            mat.map &&
            /leaves_(normal|twisted|tallthick|giantpine)/.test(mat.map.image?.src || '')
          ) {
            if (mat.color && mat.color.r === 1 && mat.color.g === 1 && mat.color.b === 1) {
              mat.color.setRGB(1.0, 0.78, 0.92);
            }
          }
          if (foliageAlpha !== null) {
            mat.alphaTest = clampAlphaTest(foliageAlpha);
          } else {
            if (typeof mat.alphaTest !== 'number' || mat.alphaTest < 0.02) mat.alphaTest = 0.05;
            if (mat.alphaTest > 0.4) mat.alphaTest = 0.4;
          }
          mat.opacity = 1;
          mat.depthWrite = true;
          if (typeof mat.depthTest === 'boolean') mat.depthTest = true;
          mat.side = three.DoubleSide;
          mat.userData.__foliageStrategy = 'cutout-lite';
          mat.needsUpdate = true;
        } catch (materialErr) {
          // ignore material processing error to keep model usable
        }
      });
      child.castShadow = true;
      child.receiveShadow = true;
    });
  } catch (traverseErr) {
    // ignore traversal issues (model still may be usable)
  }
  try {
    const targetH = computeTargetHeight(key);
    autoScaleModel(three, root, targetH);
  } catch (scaleErr) {
    // scaling failure is non-fatal
  }
  try {
    if (!cache.__loggedKeys) cache.__loggedKeys = new Set();
    if (!cache.__loggedKeys.has(key)) {
      cache.__loggedKeys.add(key);
      const fileName = (path || '').split('/')?.pop() || path;
      if (logger.isInfoEnabled()) {
        logger.info(
          'Model asset cached',
          { key, resolvedFile: fileName, path, kind },
          MODEL_LOG_CATEGORY
        );
      }
    }
  } catch (logErr) {
    // ignore logging error
  }
}

// ── Target Height Computation ───────────────────────────────────
/**
 * Determine canonical target height in scene units for a given registry key.
 * These values preserve natural relative proportions (tree > bush > flower > pebble).
 */
export function computeTargetHeight(key) {
  if (/^giant-pine-/.test(key)) return 9.5;
  if (/^tall-thick-/.test(key)) return 7.5;
  if (/^tropical-palm-/.test(key)) return 6.4;
  if (/^tropical-banana-/.test(key)) return 3.6;
  if (/^tropical-monstera-/.test(key)) return 2.4;
  if (/^tropical-fern-/.test(key)) return 1.1;
  if (/^(common-broadleaf-|pine-conifer-|birch-|cherry-|dead-tree-|twisted-bare-)/.test(key))
    return 6.2;
  if (/^rock-big-/.test(key)) return 4.2;
  if (/^rock-medium-/.test(key)) return 2.8;
  if (/^bush-long-/.test(key)) return 3.2;
  if (/^bush-large/.test(key)) return 2.8;
  if (/^bush-common/.test(key)) return 2.4;
  if (/^ground-cover-/.test(key)) return 1.05;
  if (/^grass-.*-tall$/.test(key)) return 1.0;
  if (/^grass-/.test(key)) return 0.7;
  if (/^flower-/.test(key)) return 0.9;
  if (/^mushroom-laetiporus/.test(key)) return 0.9;
  if (/^mushroom-/.test(key)) return 0.75;
  if (/^pebble-/.test(key)) return 0.35;
  return 6;
}

// ── Auto-Scaling ────────────────────────────────────────────────
export function autoScaleModel(three, root, targetHeight = 6) {
  try {
    const box = new three.Box3().setFromObject(root);
    const size = new three.Vector3();
    box.getSize(size);
    const h = size.y || 1;
    const s = targetHeight / h;
    if (s > 0 && Number.isFinite(s)) root.scale.setScalar(s);
  } catch (scaleErr) {
    // ignore scaling error
  }
}
