// Clean minimal ModelAssetCache implementation (fully sanitized / formatted)
class ModelAssetCache {
  constructor() {
    this._three = null;
    this._cache = new Map();
    this._loading = new Map();
    // IMPORTANT: Directory name contains a space. Previous iteration used URL-encoded '%20' which
    // does not match the actual folder name on disk, causing silent 404s and empty model loads.
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
      // Reserve additional twisted variants for future biome variety (mapped but unused yet)
      'twisted-bare-3': [`${base}/TwistedTree_3.obj`],
      'twisted-bare-4': [`${base}/TwistedTree_4.obj`],
      'twisted-bare-5': [`${base}/TwistedTree_5.obj`],
      'ground-cover-clover-1': [`${base}/Clover_1.obj`],
      'ground-cover-clover-2': [`${base}/Clover_2.obj`],
      'ground-cover-fern-1': [`${base}/Fern_1.obj`],
      'rock-medium-1': [`${base}/Rock_Medium_1.obj`],
      'rock-medium-2': [`${base}/Rock_Medium_2.obj`],
      'rock-medium-3': [`${base}/Rock_Medium_3.obj`],
      // Backward compatibility aliases
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
      'tree-fir-3': 'twisted-bare-2', // legacy mapping; can randomize among 2..5 later
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

  /** Returns true if a (possibly legacy) key exists in the registry */
  hasKey(key) {
    key = this._resolveKey(key);
    return !!this._registry[key];
  }

  /** Lazy-import three.js if not already set (used by UI thumbnails / fallback paths). */
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

  _resolveKey(key) {
    return this._legacyToCanonical[key] || key;
  }

  async getModel(key) {
    key = this._resolveKey(key);
    if (this._cache.has(key)) return this._cache.get(key).clone(true);
    if (this._loading.has(key)) return (await this._loading.get(key)).clone(true);
    const paths = this._registry[key];
    if (!paths || !paths.length) return null;
    if (!this._three) {
      // Attempt to lazy-acquire three namespace so offscreen usages (e.g., thumbnails) work.
      await this._ensureThreeAndLoader();
    }
    const promise = this._loadOBJ(this._three, key, paths[0]);
    this._loading.set(key, promise);
    const obj = await promise;
    this._loading.delete(key);
    if (obj) {
      this._cache.set(key, obj);
    } else if (typeof console !== 'undefined') {
      console.warn('[ModelAssetCache] Failed to load model', { key, path: paths[0] });
    }
    return obj ? obj.clone(true) : null;
  }

  async _loadOBJ(three, key, path) {
    if (!three) return null;
    let OBJLoaderMod = null;
    try {
      OBJLoaderMod = await import('three/examples/jsm/loaders/OBJLoader.js');
    } catch (e) {
      let secondErr = null;
      try {
        // CDN fallback (works in environments without import maps like tests / Node w/ network)
        OBJLoaderMod = await import(
          'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/loaders/OBJLoader.js'
        );
        if (typeof console !== 'undefined') {
          console.info('[ModelAssetCache] OBJLoader loaded via CDN fallback');
        }
      } catch (e2) {
        secondErr = e2;
      }
      if (!OBJLoaderMod) {
        if (typeof console !== 'undefined') {
          console.error('[ModelAssetCache] OBJLoader dynamic import failed', e, secondErr);
          if (typeof document !== 'undefined') {
            const hasImportMap = !!document.querySelector('script[type="importmap"]');
            if (!hasImportMap) {
              console.warn(
                '[ModelAssetCache] No import map found; add mapping for three and examples loaders.'
              );
            }
          }
        }
        return null; // loader failed
      }
    }
    const OBJLoader = OBJLoaderMod.OBJLoader || OBJLoaderMod.default;
    if (!OBJLoader) return null;
    const attempted = new Set();
    const buildVariants = (p) => {
      const variants = [p];
      if (p.includes('3d Assets')) variants.push(p.replace('3d Assets', '3d%20Assets'));
      if (!p.startsWith('./')) variants.push('./' + p);
      if (!p.startsWith('/')) variants.push('/' + p);
      // Add encoded + prefixed combos
      variants.slice().forEach((v) => {
        if (v.includes('3d Assets')) variants.push(v.replace('3d Assets', '3d%20Assets'));
      });
      // Deduplicate
      return [...new Set(variants)];
    };

    const variants = buildVariants(path);
    const tryLoad = (urlIdx) =>
      new Promise((resolve) => {
        if (urlIdx >= variants.length) return resolve(null);
        const url = variants[urlIdx];
        attempted.add(url);
        let loader;
        try {
          loader = new OBJLoader();
        } catch {
          return resolve(null);
        }
        let settled = false;
        const finish = (obj) => {
          if (settled) return;
          settled = true;
          resolve(obj);
        };
        try {
          loader.load(
            url,
            (root) => {
              try {
                this._postProcess(three, root, key, url, 'OBJ');
              } catch {
                /* ignore post process error */
              }
              if (typeof console !== 'undefined' && url !== path) {
                console.info('[ModelAssetCache] Loaded via fallback path', { key, url });
              }
              finish(root);
            },
            undefined,
            () => {
              // Failure -> attempt next variant
              if (typeof console !== 'undefined') {
                console.warn('[ModelAssetCache] OBJ load attempt failed', { key, url });
              }
              tryLoad(urlIdx + 1).then(finish);
            }
          );
        } catch {
          tryLoad(urlIdx + 1).then(finish);
        }
      });

    const result = await tryLoad(0);
    if (!result && typeof console !== 'undefined') {
      console.error('[ModelAssetCache] All load variants failed', {
        key,
        variants: [...attempted],
      });
      // Fallback: attempt manual fetch + parse to get more concrete HTTP status diagnostics.
      try {
        const manualVariants = [...attempted];
        for (const raw of manualVariants) {
          // Ensure leading slash variant also tested for manual fetch
          const candidates = raw.startsWith('/') ? [raw] : [raw, '/' + raw];
          for (const url of candidates) {
            try {
              const res = await fetch(url, { method: 'GET' });
              if (!res.ok) {
                console.warn('[ModelAssetCache] Manual fetch failed', {
                  key,
                  url,
                  status: res.status,
                  statusText: res.statusText,
                });
                continue;
              }
              const text = await res.text();
              if (!text || text.length < 32) {
                console.warn('[ModelAssetCache] Manual fetch returned suspiciously small OBJ', {
                  key,
                  url,
                  length: text.length,
                });
              }
              let parsed = null;
              try {
                const loader = new OBJLoader();
                parsed = loader.parse(text);
              } catch (e) {
                console.error('[ModelAssetCache] OBJ parse failed after fetch', { key, url, e });
                continue;
              }
              try {
                this._postProcess(three, parsed, key, url, 'OBJ(fetch-parse)');
              } catch (_) {
                /* ignore post process error */
              }
              console.info('[ModelAssetCache] Loaded via manual fetch+parse fallback', {
                key,
                url,
              });
              return parsed;
            } catch (fetchErr) {
              console.warn('[ModelAssetCache] Fetch attempt errored', { key, raw, fetchErr });
            }
          }
        }
      } catch (diagnosticErr) {
        console.error('[ModelAssetCache] Manual fetch diagnostic failed', { key, diagnosticErr });
      }
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
            // --- Texture auto-assignment (MTL absolute path sanitization) ---
            // Exported MTLs reference textures like "C:/Leaves_NormalTree_C.png" which are invalid in the browser.
            // If a material has no map yet, infer the intended texture from its name and load from our Textures dir.
            if (!mat.map) {
              if (!this._textureLoader) this._textureLoader = new three.TextureLoader();
              if (!this._textureCache) this._textureCache = new Map();
              const texBase = 'assets/terrain/3d Assets/Textures';
              const nameLc = (mat.name || '').toLowerCase();
              const pickTextureFile = () => {
                if (/leaves_twistedtree/.test(nameLc)) return 'Leaves_TwistedTree_C.png';
                if (/leaves_normaltree/.test(nameLc)) return 'Leaves_NormalTree_C.png';
                if (/leaves_giantpine/.test(nameLc)) return 'Leaves_GiantPine_C.png';
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
              const file = pickTextureFile();
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
                  } catch (_) {
                    /* ignore texture load failure */
                  }
                }
                if (tex) {
                  mat.map = tex;
                  mat.needsUpdate = true;
                }
              }
            }
            if (mat.map && 'colorSpace' in mat.map && three.SRGBColorSpace) {
              mat.map.colorSpace = three.SRGBColorSpace;
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
            if (!mat.userData) mat.userData = {};
            mat.userData.__foliageCandidate = true;
            mat.transparent = true;
            if (typeof mat.alphaTest !== 'number' || mat.alphaTest < 0.05) mat.alphaTest = 0.12;
            if (mat.alphaTest > 0.4) mat.alphaTest = 0.4;
            mat.depthWrite = false;
            mat.side = three.DoubleSide;
            if (/twisted/.test(tag) && mat.map && !mat.userData.__twistedAlphaRelaxed) {
              try {
                const img = mat.map.image;
                if (img && img.width && img.height && img.width <= 2048 && img.height <= 2048) {
                  const cvs = document.createElement('canvas');
                  cvs.width = img.width;
                  cvs.height = img.height;
                  const ctx = cvs.getContext('2d');
                  ctx.drawImage(img, 0, 0);
                  const d = ctx.getImageData(0, 0, img.width, img.height).data;
                  let cov = 0,
                    strong = 0;
                  for (let i = 0; i < d.length; i += 32) {
                    const a = d[i + 3];
                    if (a > 8) {
                      cov++;
                      if (a > 170) strong++;
                    }
                  }
                  const density = cov ? strong / cov : 0;
                  if (density < 0.2) {
                    mat.alphaTest = Math.max(0.02, mat.alphaTest * 0.5);
                    mat.userData.__twistedAlphaRelaxed = true;
                    mat.needsUpdate = true;
                  }
                }
              } catch {
                /* ignore twisted relax error */
              }
            }
            mat.userData.__foliageStrategy = 'cutout-lite';
            mat.needsUpdate = true;
          } catch {
            /* ignore per-material post process error */
          }
        });
        child.castShadow = true;
        child.receiveShadow = true;
      });
    } catch {
      /* ignore traversal error */
    }
    try {
      this._autoScaleModel(three, root);
    } catch {
      /* ignore autoscale */
    }
    try {
      if (!this.__loggedKeys) this.__loggedKeys = new Set();
      if (!this.__loggedKeys.has(key)) {
        this.__loggedKeys.add(key);
        const fileName = (path || '').split('/')?.pop() || path;
        console.info('[ModelAssetCache] Loaded', { key, resolvedFile: fileName, path, kind });
      }
    } catch {
      /* ignore log error */
    }
  }

  _autoScaleModel(three, root, targetHeight = 6) {
    try {
      const box = new three.Box3().setFromObject(root);
      const size = new three.Vector3();
      box.getSize(size);
      const h = size.y || 1;
      const s = targetHeight / h;
      if (s > 0 && Number.isFinite(s)) root.scale.setScalar(s);
    } catch {
      /* ignore scale */
    }
  }
}

export default ModelAssetCache;
