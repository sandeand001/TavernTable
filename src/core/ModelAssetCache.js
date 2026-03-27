// ── Imports & Logging Helpers ───────────────────────────────────
import logger, { LOG_CATEGORY } from '../utils/Logger.js';
import {
  postProcessModel as _postProcess,
  computeTargetHeight as _computeTargetHeight,
  autoScaleModel as _autoScaleModel,
} from './ModelPostProcessing.js';

const MODEL_LOG_CATEGORY = LOG_CATEGORY.CACHE;
const isVerboseFlagEnabled = () =>
  typeof window !== 'undefined' && !!window.DEBUG_MODEL_CACHE_VERBOSE;
const canLogModelDebug = () => logger.isDebugEnabled() && isVerboseFlagEnabled();
const logModelDebug = (message, data = {}) => {
  if (canLogModelDebug()) {
    logger.debug(message, data, MODEL_LOG_CATEGORY);
  }
};
const toErrorPayload = (error) =>
  error
    ? {
        message: error.message,
        stack: error.stack,
        name: error.name,
      }
    : undefined;

// ── Constants & Tropical Entry Builder ──────────────────────────
const DEFAULT_TEXTURE_BASE = 'assets/terrain/3d Assets/Textures';
const TROPICAL_FBX_SOURCE = 'assets/terrain/3d Assets/Tropical/source/MZRa_Pack_M02P.fbx';
const TROPICAL_TEXTURE_BASE = 'assets/terrain/3d Assets/Tropical/textures';

const clampAlphaTest = (value) => Math.min(0.45, Math.max(0.01, value ?? 0.05));

const makeTropicalEntry = (node, textures = {}, options = {}) => {
  const entry = {
    path: TROPICAL_FBX_SOURCE,
    format: 'fbx',
    node,
    textures,
    textureBase: options.textureBase || TROPICAL_TEXTURE_BASE,
  };
  const resourceBase = options.resourcePath || entry.textureBase;
  if (resourceBase) entry.resourcePath = resourceBase;
  if (options.centerAndGround === undefined) {
    entry.centerAndGround = { alignXZ: true, alignY: true };
  } else if (options.centerAndGround) {
    entry.centerAndGround = options.centerAndGround;
  }
  if (options.prune) entry.prune = options.prune;
  if (options.foliageAlphaTest !== undefined) entry.foliageAlphaTest = options.foliageAlphaTest;
  const foliageHints = [];
  if (textures?.baseColor) foliageHints.push(textures.baseColor);
  if (textures?.opacity) foliageHints.push(textures.opacity);
  if (Array.isArray(options.foliageTextureHints)) foliageHints.push(...options.foliageTextureHints);
  if (foliageHints.length) {
    const unique = [];
    const seen = new Set();
    foliageHints.forEach((hint) => {
      const key = String(hint || '').trim();
      if (!key || seen.has(key.toLowerCase())) return;
      seen.add(key.toLowerCase());
      unique.push(key);
    });
    if (unique.length) entry.foliageTextureHints = unique;
  }
  return entry;
};

// ── Model Asset Cache ───────────────────────────────────────────
class ModelAssetCache {
  constructor() {
    this._three = null;
    this._cache = new Map();
    this._loading = new Map();
    this._textureLoader = null;
    this._textureCache = null;
    this._fbxLoaderCtorPromise = null;
    const base = 'assets/terrain/3d Assets/OBJ';
    this._registry = {
      'common-broadleaf-1': [`${base}/CommonTree_1.obj`],
      'common-broadleaf-2': [`${base}/CommonTree_2.obj`],
      'common-broadleaf-3': [`${base}/CommonTree_3.obj`],
      'common-broadleaf-4': [`${base}/CommonTree_4.obj`],
      'common-broadleaf-5': [`${base}/CommonTree_5.obj`],
      'pine-conifer-1': [`${base}/Pine_1.obj`],
      'pine-conifer-2': [`${base}/Pine_2.obj`],
      'pine-conifer-3': [`${base}/Pine_3.obj`],
      'pine-conifer-4': [`${base}/Pine_4.obj`],
      'pine-conifer-5': [`${base}/Pine_5.obj`],
      'twisted-bare-1': [`${base}/TwistedTree_1.obj`],
      'twisted-bare-2': [`${base}/TwistedTree_2.obj`],
      'twisted-bare-3': [`${base}/TwistedTree_3.obj`],
      'twisted-bare-4': [`${base}/TwistedTree_4.obj`],
      'twisted-bare-5': [`${base}/TwistedTree_5.obj`],
      'ground-cover-clover-1': [`${base}/Clover_1.obj`],
      'ground-cover-clover-2': [`${base}/Clover_2.obj`],
      'ground-cover-fern-1': [`${base}/Fern_1.obj`],
      'rock-medium-1': [`${base}/Rock_Medium_1.obj`],
      'rock-medium-2': [`${base}/Rock_Medium_2.obj`],
      'rock-medium-3': [`${base}/Rock_Medium_3.obj`],
      // legacy compatibility aliases
      'tree-oak-1': [`${base}/CommonTree_1.obj`],
      'tree-oak-2': [`${base}/CommonTree_2.obj`],
      'tree-oak-3': [`${base}/CommonTree_3.obj`],
      'tree-birch-1': [`${base}/CommonTree_4.obj`],
      'tree-birch-2': [`${base}/CommonTree_5.obj`],
      'tree-birch-3': [`${base}/TwistedTree_1.obj`],
      'tree-bare-deciduous-a': [`${base}/TwistedTree_1.obj`],
      'tree-pine-1': [`${base}/Pine_1.obj`],
      'tree-pine-2': [`${base}/Pine_2.obj`],
      'tree-pine-3': [`${base}/Pine_3.obj`],
      'tree-fir-1': [`${base}/Pine_4.obj`],
      'tree-fir-2': [`${base}/Pine_5.obj`],
      'tree-fir-3': [`${base}/TwistedTree_2.obj`],
      'fern-1': [`${base}/Clover_1.obj`],
      'fern-2': [`${base}/Clover_2.obj`],
      'fern-3': [`${base}/Fern_1.obj`],
      'rock-1': [`${base}/Rock_Medium_1.obj`],
      'rock-2': [`${base}/Rock_Medium_2.obj`],
      'rock-3': [`${base}/Rock_Medium_3.obj`],
      // expanded families
      'birch-1': [`${base}/Birch_1.obj`],
      'birch-2': [`${base}/Birch_2.obj`],
      'birch-3': [`${base}/Birch_3.obj`],
      'birch-4': [`${base}/Birch_4.obj`],
      'birch-5': [`${base}/Birch_5.obj`],
      'cherry-1': [`${base}/CherryBlossom_1.obj`],
      'cherry-2': [`${base}/CherryBlossom_2.obj`],
      'cherry-3': [`${base}/CherryBlossom_3.obj`],
      'cherry-4': [`${base}/CherryBlossom_4.obj`],
      'cherry-5': [`${base}/CherryBlossom_5.obj`],
      'giant-pine-1': [`${base}/GiantPine_1.obj`],
      'giant-pine-2': [`${base}/GiantPine_2.obj`],
      'giant-pine-3': [`${base}/GiantPine_3.obj`],
      'giant-pine-4': [`${base}/GiantPine_4.obj`],
      'giant-pine-5': [`${base}/GiantPine_5.obj`],
      'dead-tree-1': [`${base}/DeadTree_1.obj`],
      'dead-tree-2': [`${base}/DeadTree_2.obj`],
      'dead-tree-3': [`${base}/DeadTree_3.obj`],
      'dead-tree-4': [`${base}/DeadTree_4.obj`],
      'dead-tree-5': [`${base}/DeadTree_5.obj`],
      'ground-cover-fern-2': [`${base}/Fern_2.obj`],
      'tall-thick-1': [`${base}/TallThick_1.obj`],
      'tall-thick-2': [`${base}/TallThick_2.obj`],
      'tall-thick-3': [`${base}/TallThick_3.obj`],
      'tall-thick-4': [`${base}/TallThick_4.obj`],
      'tall-thick-5': [`${base}/TallThick_5.obj`],
      'bush-common': [`${base}/Bush_Common.obj`],
      'bush-common-flowers': [`${base}/Bush_Common_Flowers.obj`],
      'bush-large': [`${base}/Bush_Large.obj`],
      'bush-large-flowers': [`${base}/Bush_Large_Flowers.obj`],
      'bush-long-1': [`${base}/Bush_Long_1.obj`],
      'bush-long-2': [`${base}/Bush_Long_2.obj`],
      'flower-1-group': [`${base}/Flower_1_Group.obj`],
      'flower-1-single': [`${base}/Flower_1_Single.obj`],
      'flower-2-group': [`${base}/Flower_2_Group.obj`],
      'flower-2-single': [`${base}/Flower_2_Single.obj`],
      'flower-3-group': [`${base}/Flower_3_Group.obj`],
      'flower-3-single': [`${base}/Flower_3_Single.obj`],
      'flower-4-group': [`${base}/Flower_4_Group.obj`],
      'flower-4-single': [`${base}/Flower_4_Single.obj`],
      'flower-6': [`${base}/Flower_6.obj`],
      'flower-6-2': [`${base}/Flower_6_2.obj`],
      'flower-7-group': [`${base}/Flower_7_Group.obj`],
      'flower-7-single': [`${base}/Flower_7_Single.obj`],
      'mushroom-common': [`${base}/Mushroom_Common.obj`],
      'mushroom-redcap': [`${base}/Mushroom_RedCap.obj`],
      'mushroom-oyster': [`${base}/Mushroom_Oyster.obj`],
      'mushroom-laetiporus': [`${base}/Mushroom_Laetiporus.obj`],
      'grass-common-short': [`${base}/Grass_Common_Short.obj`],
      'grass-common-tall': [`${base}/Grass_Common_Tall.obj`],
      'grass-wide-short': [`${base}/Grass_Wide_Short.obj`],
      'grass-wide-tall': [`${base}/Grass_Wide_Tall.obj`],
      'grass-wispy-short': [`${base}/Grass_Wispy_Short.obj`],
      'grass-wispy-tall': [`${base}/Grass_Wispy_Tall.obj`],
      'grass-wheat': [`${base}/Grass_Wheat.obj`],
      'rock-medium-4': [`${base}/Rock_Medium_4.obj`],
      'rock-big-1': [`${base}/Rock_Big_1.obj`],
      'rock-big-2': [`${base}/Rock_Big_2.obj`],
      'pebble-round-1': [`${base}/Pebble_Round_1.obj`],
      'pebble-round-2': [`${base}/Pebble_Round_2.obj`],
      'pebble-round-3': [`${base}/Pebble_Round_3.obj`],
      'pebble-round-4': [`${base}/Pebble_Round_4.obj`],
      'pebble-round-5': [`${base}/Pebble_Round_5.obj`],
      'pebble-square-1': [`${base}/Pebble_Square_1.obj`],
      'pebble-square-2': [`${base}/Pebble_Square_2.obj`],
      'pebble-square-3': [`${base}/Pebble_Square_3.obj`],
      'pebble-square-4': [`${base}/Pebble_Square_4.obj`],
      'pebble-square-5': [`${base}/Pebble_Square_5.obj`],
      'pebble-square-6': [`${base}/Pebble_Square_6.obj`],
    };
    Object.assign(this._registry, {
      'tropical-palm-a': makeTropicalEntry(
        'Palm_B08a',
        {
          baseColor: 'T_MZRa_Palm_B08a_BC.png',
        },
        {
          foliageAlphaTest: 0.05,
        }
      ),
      'tropical-palm-b': makeTropicalEntry(
        'Palm_B08b',
        {
          baseColor: 'T_MZRa_Palm_B08b_BC.png',
          normal: 'T_MZRa_Palm_B08b_N.png',
          roughness: 'T_MZRa_Palm_B08b_R.png',
        },
        {
          foliageAlphaTest: 0.05,
        }
      ),
      'tropical-banana-a': makeTropicalEntry(
        'Banana_B09a',
        {
          baseColor: 'T_MZRa_Banana_B09a_BC.png',
          normal: 'T_MZRa_Banana_B09_N.png',
          roughness: 'T_MZRa_Banana_B09_M.png',
        },
        {
          foliageAlphaTest: 0.32,
        }
      ),
      'tropical-banana-b': makeTropicalEntry(
        'Banana_B09b',
        {
          baseColor: 'T_MZRa_Banana_B09_BC.png',
          normal: 'T_MZRa_Banana_B09_N.png',
          roughness: 'T_MZRa_Banana_B09_M.png',
        },
        {
          foliageAlphaTest: 0.32,
        }
      ),
      'tropical-monstera-a': makeTropicalEntry(
        'Monstera_B07a1',
        {
          baseColor: 'MI_MZRa_Monstera_B07a1_BC.png',
        },
        {
          foliageAlphaTest: 0.05,
        }
      ),
      'tropical-monstera-b': makeTropicalEntry(
        'Monstera_B07b',
        {
          baseColor: 'T_MZRa_Monstera_B07b_BC.png',
          normal: 'T_MZRa_Monstera_B07b_N.png',
          roughness: 'T_MZRa_Monstera_B07b_R.png',
        },
        {
          foliageAlphaTest: 0.05,
        }
      ),
      'tropical-fern-a': makeTropicalEntry(
        'Fern_B051',
        {
          baseColor: 'T_MZRa_Fern_B051_BC.png',
          opacity: 'T_MZRa_Fern_B051_O.png',
        },
        {
          foliageAlphaTest: 0.06,
        }
      ),
      'tropical-fern-b': makeTropicalEntry(
        'Fern_B052',
        {
          baseColor: 'T_MZRa_Fern_B052_BC.png',
          opacity: 'T_MZRa_Fern_B052_O.png',
        },
        {
          foliageAlphaTest: 0.06,
        }
      ),
      'tropical-fern-c': makeTropicalEntry(
        'Fern_B053',
        {
          baseColor: 'T_MZRa_Fern_B053_BC.png',
          opacity: 'T_MZRa_Fern_B053_O.png',
        },
        {
          foliageAlphaTest: 0.06,
        }
      ),
    });
    this._legacyToCanonical = {
      'tree-oak-1': 'common-broadleaf-1',
      'tree-oak-2': 'common-broadleaf-2',
      'tree-oak-3': 'common-broadleaf-3',
      'tree-birch-1': 'common-broadleaf-4',
      'tree-birch-2': 'common-broadleaf-5',
      'tree-birch-3': 'twisted-bare-1',
      'tree-bare-deciduous-a': 'twisted-bare-1',
      'tree-pine-1': 'pine-conifer-1',
      'tree-pine-2': 'pine-conifer-2',
      'tree-pine-3': 'pine-conifer-3',
      'tree-fir-1': 'pine-conifer-4',
      'tree-fir-2': 'pine-conifer-5',
      'tree-fir-3': 'twisted-bare-2',
      'fern-1': 'ground-cover-clover-1',
      'fern-2': 'ground-cover-clover-2',
      'fern-3': 'ground-cover-fern-1',
      'rock-1': 'rock-medium-1',
      'rock-2': 'rock-medium-2',
      'rock-3': 'rock-medium-3',
    };
    Object.assign(this._legacyToCanonical, {
      'palm-single-a': 'tropical-palm-a',
      'palm-double-a': 'tropical-palm-b',
    });
  }

  setThree(three) {
    this._three = three;
  }

  hasKey(key) {
    return !!this._registry[this._resolveKey(key)];
  }

  _resolveKey(key) {
    return this._legacyToCanonical[key] || key;
  }

  _buildPathVariants(basePath, format = 'OBJ') {
    if (!basePath) return [];
    const normalizedFormat = String(format || 'OBJ').toUpperCase();
    const encodableFormats = normalizedFormat === 'OBJ' || normalizedFormat === 'FBX';
    const variants = new Set();
    const push = (candidate) => {
      if (!candidate) return;
      variants.add(candidate);
      if (encodableFormats && candidate.includes('3d Assets'))
        variants.add(candidate.replace('3d Assets', '3d%20Assets'));
    };
    push(basePath);
    if (!basePath.startsWith('./')) push(`./${basePath}`);
    if (!basePath.startsWith('/')) push(`/${basePath}`);
    // re-run space encoding on newly added variants
    [...variants].forEach((candidate) => {
      if (encodableFormats && candidate.includes('3d Assets'))
        variants.add(candidate.replace('3d Assets', '3d%20Assets'));
    });
    return [...variants];
  }

  _loadRegistryEntry(key) {
    const raw = this._registry[key];
    if (!raw) return null;
    if (Array.isArray(raw)) {
      const path = raw[0];
      if (!path) return null;
      return {
        key,
        format: 'OBJ',
        path,
        variants: this._buildPathVariants(path, 'OBJ'),
        textures: null,
        textureBase: DEFAULT_TEXTURE_BASE,
      };
    }
    if (typeof raw !== 'object') return null;
    const entry = { ...raw };
    const format = String(entry.format || 'OBJ').toUpperCase();
    entry.format = format;
    entry.textureBase = entry.textureBase || DEFAULT_TEXTURE_BASE;
    if (entry.foliageAlphaTest !== undefined)
      entry.foliageAlphaTest = clampAlphaTest(entry.foliageAlphaTest);
    entry.variants = this._buildPathVariants(entry.path, format);
    return entry;
  }

  async _ensureThreeAndLoader() {
    if (this._three) return this._three;
    try {
      const threeNS = (await import('three')).default || (await import('three'));
      this._three = threeNS;
      return this._three;
    } catch {
      return null;
    }
  }

  async getModel(key) {
    key = this._resolveKey(key);
    if (this._cache.has(key)) return this._cache.get(key).clone(true);
    if (this._loading.has(key)) return (await this._loading.get(key)).clone(true);
    const descriptor = this._loadRegistryEntry(key);
    if (!descriptor || !descriptor.path) return null;
    if (!this._three) await this._ensureThreeAndLoader();
    let promise;
    if (descriptor.format === 'FBX') {
      promise = this._loadFBX(this._three, key, descriptor);
    } else {
      const primaryPath = descriptor.variants?.[0] || descriptor.path;
      promise = this._loadOBJ(this._three, key, primaryPath, descriptor);
    }
    this._loading.set(key, promise);
    const obj = await promise;
    this._loading.delete(key);
    if (obj) this._cache.set(key, obj);
    else {
      logger.warn(
        'Model asset failed to load',
        {
          key,
          path: descriptor.path,
        },
        MODEL_LOG_CATEGORY
      );
    }
    return obj ? obj.clone(true) : null;
  }

  async _loadOBJ(three, key, path, descriptor) {
    if (!three) return null;
    let OBJLoaderMod = null;
    try {
      OBJLoaderMod = await import('three/examples/jsm/loaders/OBJLoader.js');
    } catch (e) {
      try {
        OBJLoaderMod = await import(
          'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/loaders/OBJLoader.js'
        );
        logModelDebug('OBJLoader CDN fallback used');
      } catch (e2) {
        logger.error(
          'OBJLoader import failed',
          {
            error: toErrorPayload(e),
            fallbackError: toErrorPayload(e2),
          },
          MODEL_LOG_CATEGORY
        );
        return null;
      }
    }
    const OBJLoader = OBJLoaderMod.OBJLoader || OBJLoaderMod.default;
    if (!OBJLoader) return null;
    const attempted = new Set();
    const variants =
      (descriptor && descriptor.variants && descriptor.variants.length
        ? descriptor.variants
        : this._buildPathVariants(path, 'OBJ')) || [];
    const tryLoad = (i) =>
      new Promise((resolve) => {
        if (i >= variants.length) return resolve(null);
        const url = variants[i];
        attempted.add(url);
        let loader;
        try {
          loader = new OBJLoader();
        } catch {
          return resolve(null);
        }
        let done = false;
        const finish = (o) => {
          if (done) return;
          done = true;
          resolve(o);
        };
        try {
          loader.load(
            url,
            (root) => {
              try {
                this._postProcess(three, root, key, url, 'OBJ', descriptor);
              } catch (postErr) {
                // ignore post-process error for individual variant
              }
              if (url !== path) {
                logModelDebug('OBJ fallback path succeeded', { key, url });
              }
              finish(root);
            },
            undefined,
            () => {
              logModelDebug('OBJ variant failed to load', { key, url });
              tryLoad(i + 1).then(finish);
            }
          );
        } catch (loadErr) {
          // loader invocation failed; attempt next variant
          tryLoad(i + 1).then(finish);
        }
      });
    const result = await tryLoad(0);
    if (!result) {
      logger.error(
        'All OBJ load variants failed',
        {
          key,
          variants: [...attempted],
        },
        MODEL_LOG_CATEGORY
      );
    }
    return result;
  }

  async _ensureFBXLoaderCtor() {
    if (this._fbxLoaderCtorPromise) return this._fbxLoaderCtorPromise;
    this._fbxLoaderCtorPromise = (async () => {
      try {
        const mod = await import('three/examples/jsm/loaders/FBXLoader.js');
        return mod.FBXLoader || mod.default || null;
      } catch (err) {
        try {
          const fallback = await import(
            'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/loaders/FBXLoader.js'
          );
          if (logger.isInfoEnabled()) {
            logger.info('FBXLoader CDN fallback used', {}, MODEL_LOG_CATEGORY);
          }
          return fallback.FBXLoader || fallback.default || null;
        } catch (err2) {
          logger.error(
            'FBXLoader import failed',
            {
              error: toErrorPayload(err),
              fallbackError: toErrorPayload(err2),
            },
            MODEL_LOG_CATEGORY
          );
          return null;
        }
      }
    })();
    return this._fbxLoaderCtorPromise;
  }

  async _loadFBX(three, key, descriptor) {
    if (!three || !descriptor?.path) return null;
    const FBXLoaderCtor = await this._ensureFBXLoaderCtor();
    if (!FBXLoaderCtor) return null;
    const variants =
      (descriptor.variants && descriptor.variants.length
        ? descriptor.variants
        : this._buildPathVariants(descriptor.path, 'FBX')) || [];
    const attempted = new Set();
    const tryLoad = (index) =>
      new Promise((resolve) => {
        if (index >= variants.length) return resolve(null);
        const url = variants[index];
        attempted.add(url);
        let loader;
        try {
          loader = new FBXLoaderCtor();
        } catch {
          return resolve(null);
        }
        try {
          const resource = descriptor.resourcePath || descriptor.textureBase;
          if (resource && loader.setResourcePath) {
            const normalized = resource.endsWith('/') ? resource : `${resource}/`;
            loader.setResourcePath(normalized);
          }
        } catch (_) {
          /* ignore resource path normalization issues */
        }
        let settled = false;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          resolve(value);
        };
        try {
          loader.load(
            url,
            (root) => {
              let result = root;
              try {
                result = this._selectFBXNode(three, root, descriptor, key) || root;
              } catch (_) {
                result = root;
              }
              try {
                this._pruneFBXArtifacts(result, descriptor);
              } catch (_) {
                /* pruning best-effort */
              }
              try {
                this._postProcess(three, result, key, url, 'FBX', descriptor);
              } catch (_) {
                /* post-processing errors are non-fatal */
              }
              if (descriptor?.centerAndGround) {
                try {
                  this._centerAndGround(three, result, descriptor.centerAndGround);
                } catch (_) {
                  /* align optional */
                }
              }
              if (url !== descriptor.path) {
                logModelDebug('FBX fallback path succeeded', { key, url });
              }
              finish(result);
            },
            undefined,
            () => {
              tryLoad(index + 1).then(finish);
            }
          );
        } catch (loadErr) {
          tryLoad(index + 1).then(finish);
        }
      });
    const result = await tryLoad(0);
    if (!result) {
      logger.error(
        'All FBX load variants failed',
        {
          key,
          variants: [...attempted],
        },
        MODEL_LOG_CATEGORY
      );
    }
    return result;
  }

  _selectFBXNode(three, root, descriptor, key) {
    if (!root || !descriptor?.node) return root;
    const target = String(descriptor.node || '').toLowerCase();
    const matches = [];
    try {
      root.traverse?.((child) => {
        const name = String(child?.name || '').toLowerCase();
        if (!name) return;
        if (name === target || name.startsWith(`${target}_`) || name.includes(target)) {
          matches.push(child);
        }
      });
    } catch (_) {
      /* traversal failure falls back to full root */
    }
    if (!matches.length) return root;
    const group = new three.Group();
    group.name = `FBX:${key}:${descriptor.node}`;
    const seen = new Set();
    matches.forEach((node) => {
      if (!node) return;
      let parent = node.parent;
      while (parent) {
        if (matches.includes(parent)) return;
        parent = parent.parent;
      }
      const clone = node.clone(true);
      if (clone && !seen.has(clone.uuid)) {
        seen.add(clone.uuid);
        group.add(clone);
      }
    });
    return group.children.length ? group : root;
  }

  _pruneFBXArtifacts(root, descriptor) {
    if (!root) return;
    const patterns = [];
    if (Array.isArray(descriptor?.prune)) {
      descriptor.prune.forEach((pat) => {
        if (!pat) return;
        if (pat instanceof RegExp) {
          patterns.push(pat);
        } else if (typeof pat === 'string') {
          const trimmed = pat.trim();
          if (!trimmed) return;
          const escaped = trimmed.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
          patterns.push(new RegExp(escaped, 'i'));
        }
      });
    }
    if (!patterns.length) {
      patterns.push(/\bbg\b/i, /background/i, /gradient/i, /plane/i, /circle/i);
    }
    const removals = [];
    root.traverse?.((child) => {
      if (!child || child === root) return;
      const name = String(child.name || '');
      if (!name) return;
      const lower = name.toLowerCase();
      if (patterns.some((re) => re.test(lower))) removals.push(child);
    });
    removals.forEach((node) => {
      try {
        node.parent?.remove(node);
      } catch (_) {
        /* ignore detach failure */
      }
    });
  }

  _centerAndGround(three, root, options = {}) {
    if (!three || !root) return;
    try {
      const box = new three.Box3().setFromObject(root);
      if (!box) return;
      const center = new three.Vector3();
      box.getCenter(center);
      const alignXZ = options.alignXZ !== false;
      const alignY = options.alignY !== false;
      const nextPosition = root.position.clone?.() || new three.Vector3();
      if (alignXZ) {
        nextPosition.x -= center.x;
        nextPosition.z -= center.z;
      }
      if (alignY) nextPosition.y -= box.min.y;
      root.position.copy(nextPosition);
      root.updateMatrixWorld?.(true);
    } catch (_) {
      /* positioning best effort */
    }
  }

  _postProcess(three, root, key, path, kind, descriptor) {
    return _postProcess(this, three, root, key, path, kind, descriptor);
  }

  _computeTargetHeight(key) {
    return _computeTargetHeight(key);
  }

  _autoScaleModel(three, root, targetHeight = 6) {
    return _autoScaleModel(three, root, targetHeight);
  }
}

export default ModelAssetCache;
