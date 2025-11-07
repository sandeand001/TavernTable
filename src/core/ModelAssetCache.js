// Clean minimal ModelAssetCache implementation (readable + properly indented)
const DEFAULT_TEXTURE_BASE = 'assets/terrain/3d Assets/Textures';
const TROPICAL_FBX_SOURCE = 'assets/terrain/3d Assets/Tropical/source/MZRa_Pack_M02P.fbx';
const TROPICAL_TEXTURE_BASE = 'assets/terrain/3d Assets/Tropical/textures';

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
    else if (typeof console !== 'undefined') {
      console.warn('[ModelAssetCache] Failed to load', {
        key,
        path: descriptor.path,
      });
    }
    return obj ? obj.clone(true) : null;
  }

  async _loadOBJ(three, key, path, descriptor) {
    if (!three) return null;
    let OBJLoaderMod = null;
    const VERBOSE = !!(typeof window !== 'undefined' && window.DEBUG_MODEL_CACHE_VERBOSE);
    try {
      OBJLoaderMod = await import('three/examples/jsm/loaders/OBJLoader.js');
    } catch (e) {
      try {
        OBJLoaderMod = await import(
          'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/loaders/OBJLoader.js'
        );
        if (VERBOSE && typeof console !== 'undefined') {
          console.info('[ModelAssetCache] OBJLoader CDN fallback');
        }
      } catch (e2) {
        if (typeof console !== 'undefined') {
          // Always report hard failure (rare)
          console.error('[ModelAssetCache] OBJLoader import failed', e, e2);
        }
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
              if (VERBOSE && typeof console !== 'undefined' && url !== path)
                console.info('[ModelAssetCache] Fallback path', { key, url });
              finish(root);
            },
            undefined,
            () => {
              if (VERBOSE && typeof console !== 'undefined')
                console.warn('[ModelAssetCache] OBJ fail', { key, url });
              tryLoad(i + 1).then(finish);
            }
          );
        } catch (loadErr) {
          // loader invocation failed; attempt next variant
          tryLoad(i + 1).then(finish);
        }
      });
    const result = await tryLoad(0);
    if (!result && typeof console !== 'undefined') {
      // Keep as error (model truly missing)
      console.error('[ModelAssetCache] All load variants failed', {
        key,
        variants: [...attempted],
      });
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
          if (typeof console !== 'undefined') {
            console.info('[ModelAssetCache] FBXLoader CDN fallback');
          }
          return fallback.FBXLoader || fallback.default || null;
        } catch (err2) {
          if (typeof console !== 'undefined') {
            console.error('[ModelAssetCache] FBXLoader import failed', err, err2);
          }
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
    const VERBOSE = !!(typeof window !== 'undefined' && window.DEBUG_MODEL_CACHE_VERBOSE);
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
              if (VERBOSE && typeof console !== 'undefined' && url !== descriptor.path) {
                console.info('[ModelAssetCache] FBX fallback path', { key, url });
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
    if (!result && typeof console !== 'undefined') {
      console.error('[ModelAssetCache] All FBX load variants failed', {
        key,
        variants: [...attempted],
      });
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
    try {
      const entry = descriptor || {};
      const textureBases = [];
      if (entry.textureBase) textureBases.push(entry.textureBase);
      if (!textureBases.includes(DEFAULT_TEXTURE_BASE)) textureBases.push(DEFAULT_TEXTURE_BASE);
      const uniqueBases = textureBases.filter((base, idx) => textureBases.indexOf(base) === idx);
      const ensureTexture = (file, opts = {}) => {
        if (!file) return null;
        if (!this._textureLoader) this._textureLoader = new three.TextureLoader();
        if (!this._textureCache) this._textureCache = new Map();
        const { colorSpace = 'srgb' } = opts;
        for (const base of uniqueBases) {
          const full = `${base}/${file}`;
          let tex = this._textureCache.get(full);
          if (!tex) {
            try {
              tex = this._textureLoader.load(full, () => {
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
              this._textureCache.set(full, tex);
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
            const mapSrcLc = (
              mat.map?.image?.src ||
              mat.map?.source?.data?.src ||
              ''
            ).toLowerCase();
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
      // Hierarchical scaling: different asset families get distinct canonical heights
      // so relative size relationships (tree > bush > flower/grass > pebble) are preserved.
      const targetH = this._computeTargetHeight(key);
      this._autoScaleModel(three, root, targetH);
    } catch (scaleErr) {
      // scaling failure is non-fatal
    }
    try {
      if (!this.__loggedKeys) this.__loggedKeys = new Set();
      if (!this.__loggedKeys.has(key)) {
        this.__loggedKeys.add(key);
        const fileName = (path || '').split('/')?.pop() || path;
        console.info('[ModelAssetCache] Loaded', { key, resolvedFile: fileName, path, kind });
      }
    } catch (logErr) {
      // ignore logging error
    }
  }

  // Determine canonical target height in scene units for a given registry key.
  // These values were chosen to restore natural relative proportions after the prior
  // uniform auto-scale (which made flowers as tall as trees). Adjust as needed.
  _computeTargetHeight(key) {
    // Order matters: first match wins.
    // Large canopy & special tall forms
    if (/^giant-pine-/.test(key)) return 9.5; // towering giants
    if (/^tall-thick-/.test(key)) return 7.5; // massive thick trunks
    if (/^tropical-palm-/.test(key)) return 6.4;
    if (/^tropical-banana-/.test(key)) return 3.6;
    if (/^tropical-monstera-/.test(key)) return 2.4;
    if (/^tropical-fern-/.test(key)) return 1.1;
    // Standard mature trees (baseline)
    if (/^(common-broadleaf-|pine-conifer-|birch-|cherry-|dead-tree-|twisted-bare-)/.test(key))
      return 6.2;
    // Medium rocks slightly below tree canopy for variety
    if (/^rock-big-/.test(key)) return 4.2;
    if (/^rock-medium-/.test(key)) return 2.8;
    // Bush / shrub layer (waist to head height)
    if (/^bush-long-/.test(key)) return 3.2; // elongated hedge-like
    if (/^bush-large/.test(key)) return 2.8;
    if (/^bush-common/.test(key)) return 2.4;
    // Ground cover (ferns, clover) slightly above grasses
    if (/^ground-cover-/.test(key)) return 1.05;
    // Tall grasses
    if (/^grass-.*-tall$/.test(key)) return 1.0;
    // Short / wide grasses & wheat
    if (/^grass-/.test(key)) return 0.7;
    // Flowers (group vs single share similar vertical span)
    if (/^flower-/.test(key)) return 0.9;
    // Mushrooms generally squat; some shelf types a bit taller
    if (/^mushroom-laetiporus/.test(key)) return 0.9;
    if (/^mushroom-/.test(key)) return 0.75;
    // Pebbles (very small scatter items)
    if (/^pebble-/.test(key)) return 0.35;
    // Fallback: keep prior default (was 6) for unknowns so they appear tree-sized.
    return 6;
  }

  _autoScaleModel(three, root, targetHeight = 6) {
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
}

export default ModelAssetCache;
