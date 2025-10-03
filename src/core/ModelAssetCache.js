// Clean minimal ModelAssetCache implementation (readable + properly indented)
class ModelAssetCache {
  constructor() {
    this._three = null;
    this._cache = new Map();
    this._loading = new Map();
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
    const paths = this._registry[key];
    if (!paths || !paths.length) return null;
    if (!this._three) await this._ensureThreeAndLoader();
    const promise = this._loadOBJ(this._three, key, paths[0]);
    this._loading.set(key, promise);
    const obj = await promise;
    this._loading.delete(key);
    if (obj) this._cache.set(key, obj);
    else if (typeof console !== 'undefined') {
      console.warn('[ModelAssetCache] Failed to load', {
        key,
        path: paths[0],
      });
    }
    return obj ? obj.clone(true) : null;
  }

  async _loadOBJ(three, key, path) {
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
    const buildVariants = (p) => {
      const out = [p];
      if (p.includes('3d Assets')) out.push(p.replace('3d Assets', '3d%20Assets'));
      if (!p.startsWith('./')) out.push('./' + p);
      if (!p.startsWith('/')) out.push('/' + p);
      out.slice().forEach((v) => {
        if (v.includes('3d Assets')) out.push(v.replace('3d Assets', '3d%20Assets'));
      });
      return [...new Set(out)];
    };
    const variants = buildVariants(path);
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
                this._postProcess(three, root, key, url, 'OBJ');
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

  _postProcess(three, root, key, path, kind) {
    try {
      root.traverse((child) => {
        if (!child.isMesh) return;
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((mat) => {
          if (!mat) return;
          try {
            if (!mat.map) {
              if (!this._textureLoader) this._textureLoader = new three.TextureLoader();
              if (!this._textureCache) this._textureCache = new Map();
              const texBase = 'assets/terrain/3d Assets/Textures';
              const nameLc = (mat.name || '').toLowerCase();
              const pick = () => {
                if (/leaves_birch|birch_leaves/.test(nameLc)) return 'Leaves_Birch_C.png';
                if (/bark_birch/.test(nameLc)) return 'Bark_BirchTree.png';
                if (/leaves_twistedtree/.test(nameLc)) return 'Leaves_TwistedTree_C.png';
                if (/leaves_normaltree/.test(nameLc)) return 'Leaves_NormalTree_C.png';
                if (/leaves_giantpine/.test(nameLc)) return 'Leaves_GiantPine_C.png';
                // Explicit cherry blossom detection (some source OBJ materials may have generic names like 'leaves' or color variants)
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
                const full = `${texBase}/${file}`;
                let tex = this._textureCache.get(full);
                if (!tex) {
                  try {
                    tex = this._textureLoader.load(full, () => {
                      if (tex && 'colorSpace' in tex && three.SRGBColorSpace) {
                        tex.colorSpace = three.SRGBColorSpace;
                        tex.needsUpdate = true;
                      }
                    });
                    this._textureCache.set(full, tex);
                  } catch (textureErr) {
                    // ignore individual texture load error
                  }
                }
                if (tex) {
                  mat.map = tex;
                  mat.needsUpdate = true;
                }
              }
            }
            if (mat.map) {
              try {
                // Handle absolute paths like C:/Leaves_NormalTree_C.png by reloading from our local texture folder.
                const src = mat.map.image?.src || mat.map.source?.data?.src || '';
                if (/^[a-zA-Z]:\//.test(src)) {
                  const file = src.split(/[/\\]/).pop();
                  const texBase = 'assets/terrain/3d Assets/Textures';
                  const local = `${texBase}/${file}`;
                  if (!this._textureLoader) this._textureLoader = new three.TextureLoader();
                  if (!this._textureCache) this._textureCache = new Map();
                  let tex = this._textureCache.get(local);
                  if (!tex) {
                    tex = this._textureLoader.load(local, () => {
                      if (tex && 'colorSpace' in tex && three.SRGBColorSpace) {
                        tex.colorSpace = three.SRGBColorSpace;
                        tex.needsUpdate = true;
                      }
                    });
                    this._textureCache.set(local, tex);
                  }
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
            const tag = (
              (mat.name || '') +
              ' ' +
              (mat.map?.name || '') +
              ' ' +
              (mat.map?.image?.src || '')
            ).toLowerCase();
            const isLeaf =
              /(leaf|leaves|foliage|canopy|crown|autumn|orange|yellow|red)/.test(tag) &&
              !/(bark|trunk|branch|rock|stone|ground|dirt)/.test(tag);
            if (!isLeaf) return;
            // If this is foliage and STILL no texture map was resolved, apply a generic leaf texture.
            if (!mat.map) {
              try {
                if (!this._textureLoader) this._textureLoader = new three.TextureLoader();
                const genericLeaf = 'assets/terrain/3d Assets/Textures/Leaves_NormalTree_C.png';
                let tex = this._textureCache?.get?.(genericLeaf);
                if (!tex) {
                  if (!this._textureCache) this._textureCache = new Map();
                  tex = this._textureLoader.load(genericLeaf, () => {
                    if (tex && 'colorSpace' in tex && three.SRGBColorSpace) {
                      tex.colorSpace = three.SRGBColorSpace;
                      tex.needsUpdate = true;
                    }
                  });
                  this._textureCache.set(genericLeaf, tex);
                }
                if (tex) {
                  mat.map = tex;
                  mat.needsUpdate = true;
                }
              } catch (_) {
                /* ignore leaf fallback failure */
              }
            }
            if (!mat.userData) mat.userData = {};
            mat.userData.__foliageCandidate = true;
            mat.transparent = true;
            // Cherry blossom color correction: if the selected texture is NOT the dedicated cherry texture
            // but the key suggests a cherry asset, apply a soft pink tint multiplier.
            if (
              /cherry/.test(key) &&
              mat.map &&
              /leaves_(normal|twisted|tallthick|giantpine)/.test(mat.map.image?.src || '')
            ) {
              // Apply a material color tint only if it's still default white (to avoid compounding user tints)
              if (mat.color && mat.color.r === 1 && mat.color.g === 1 && mat.color.b === 1) {
                mat.color.setRGB(1.0, 0.78, 0.92); // gentle sakura pink
              }
            }
            if (typeof mat.alphaTest !== 'number' || mat.alphaTest < 0.05) mat.alphaTest = 0.12;
            if (mat.alphaTest > 0.4) mat.alphaTest = 0.4;
            mat.depthWrite = false;
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
