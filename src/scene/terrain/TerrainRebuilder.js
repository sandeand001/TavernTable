// NOTE: Formatting managed by Prettier via lint:fix script.
// TerrainRebuilder.js - Debounced orchestrator to rebuild the terrain mesh.
// Applies elevation + biome-based vertex coloring.

// Simplified: expressive/atlas modes removed. Use 2D biome palette directly.
import { TERRAIN_CONFIG } from '../../config/terrain/TerrainConstants.js';
import { GRID_CONFIG } from '../../config/GameConstants.js';
import { getBiomeColorWithHydrology } from '../../config/biome/BiomePalettes.js';
import { TerrainVolumeMeshBuilder } from './TerrainVolumeMeshBuilder.js';
import { BoundaryWallCutaway, dungeonBoundaryWalls } from './BoundaryWallCutaway.js';
import { syncWaterSurface } from './WaterSurface.js';
import {
  getTerrainLayerColor,
  getBuildingFloorAppearance,
  getTerrainMaterialStyle,
} from './TerrainMaterialFactory.js';
import { createInteriorCutaway, clipFloorSurfaceOverlap } from './InteriorCutaway.js';
import {
  cavernRockColor,
  getCavernSurfaceColor,
} from '../../terrain/generation/CavernInteriors.js';
import { CAVERN_BIOME_KEYS } from '../../config/biome/BiomeConstants.js';
import {
  configureConstructionMaterial,
  hasConstructionMaterials,
} from './ConstructionMaterials.js';
import { GameErrors } from '../../utils/error/ErrorHandler.js';
import { buildConstructionDetails } from './ConstructionDetails.js';
import { updateLogicalPassageMarkers } from './LogicalPassageMarkers.js';
import {
  buildConstructionAssets,
  clipConstructionReplacementFace,
  isDungeonWall,
  isVillageExterior,
  releaseConstructionAssets,
} from './ConstructionAssets.js';

export class TerrainRebuilder {
  // ── Constructor ───────────────────────────────────────────────────

  constructor({ gameManager, builder, debounceMs = 120 } = {}) {
    this.gameManager = gameManager;
    this.builder = builder; // instance of TerrainMeshBuilder
    this.debounceMs = debounceMs;
    this._timer = null;
    this._lastArgs = null;
    this._lastFlushTime = Number.NEGATIVE_INFINITY;
    this._constructionAssetRequest = null;
    this._constructionSpecs = null;
  }

  // ── Debounce / Request ─────────────────────────────────────────────

  request(args = {}) {
    this._lastArgs = this._mergeArgs(this._lastArgs, args);
    const safeDebounce = Number.isFinite(this.debounceMs) ? this.debounceMs : 0;
    const interval = Math.max(0, safeDebounce || 0);
    const rawNow = Date.now();
    const now = Number.isFinite(rawNow) ? rawNow : 0;
    let elapsed = now - this._lastFlushTime;
    if (!Number.isFinite(elapsed) || elapsed < 0) {
      elapsed = Number.POSITIVE_INFINITY;
    }
    if (elapsed >= interval) {
      if (this._timer) {
        clearTimeout(this._timer);
        this._timer = null;
      }
      this._flush();
      return;
    }
    const remaining = interval - elapsed;
    const delay = Number.isFinite(remaining) ? Math.max(0, remaining) : 0;
    if (!this._timer) {
      this._timer = setTimeout(() => this._flush(), delay);
      if (typeof this._timer.unref === 'function') this._timer.unref();
    }
  }

  _flush() {
    const args = this._lastArgs || {};
    this._timer = null;
    this._lastFlushTime = Date.now();
    try {
      this.rebuild(args);
    } catch (error) {
      GameErrors.gameState(error, { component: 'TerrainRebuilder', operation: 'rebuild' });
    }
  }

  _mergeArgs(existing, incoming) {
    const base = existing && typeof existing === 'object' ? { ...existing } : {};
    if (incoming && typeof incoming === 'object') {
      Object.keys(incoming).forEach((key) => {
        const value = incoming[key];
        if (value !== undefined) {
          base[key] = value;
        }
      });
    }
    return base;
  }

  // ── Rebuild Logic ─────────────────────────────────────────────────

  rebuild({ three } = {}) {
    if (!this.gameManager || !this.builder) return null;
    if (!this.gameManager.threeSceneManager || !this.gameManager.threeSceneManager.scene) {
      return null;
    }
    // Fallback to the globally imported three namespace if caller did not pass it.
    const threeNs = three || this.gameManager.threeSceneManager.three;
    const forceStandard = typeof window !== 'undefined' && window.__TT_TERRAIN_STANDARD__;
    const gm = this.gameManager;
    gm.threeSceneManager._boundaryWallCutaway?.restore();
    const cols = gm.cols;
    const rows = gm.rows;
    const getHeight = (x, y) => gm.getTerrainHeight(x, y);
    const t0 = (typeof performance !== 'undefined' && performance.now()) || Date.now();
    const neutralColor = GRID_CONFIG?.TILE_COLOR ?? 0x444444;
    const floorAppearance = getBuildingFloorAppearance(gm.campaignWorld, gm.campaignMapId);
    const cavernStyle =
      gm.terrainEngine?.cavern?.version >= 2 ||
      (gm.campaignMapId &&
        gm.campaignWorld?.getMap(gm.campaignMapId).terrain.renderStyle === 'cavern');
    const gmBiomeGetter = (gx, gy, elev) => {
      const h = Number.isFinite(elev) ? elev : 0;
      const terrainModeActive = gm.terrainEngine
        ? gm.terrainEngine.isActive
        : typeof gm.isTerrainModeActive === 'function' && gm.isTerrainModeActive();
      if (terrainModeActive) {
        const palette = TERRAIN_CONFIG.HEIGHT_COLOR_SCALE || {};
        const clamped = Math.max(
          TERRAIN_CONFIG.MIN_HEIGHT ?? -Infinity,
          Math.min(TERRAIN_CONFIG.MAX_HEIGHT ?? Infinity, Math.round(h))
        );
        let color = palette[clamped];
        if (color == null) color = palette[String(clamped)];
        if (color == null) color = palette[0];
        if (color == null) color = palette['0'];
        if (color == null) color = 0x6b7280;
        return color;
      }
      if (floorAppearance) return floorAppearance.floorColor;
      const biomeKey = gm.terrainEngine
        ? gm.terrainEngine.biomeKey
        : typeof window !== 'undefined' && window.selectedBiome;
      if (cavernStyle && CAVERN_BIOME_KEYS.includes(biomeKey))
        return getCavernSurfaceColor(gx * 5, gy * 5, h, {
          materialColor: cavernRockColor(biomeKey),
        });
      const userSelectedBiome =
        typeof window !== 'undefined' && window.__TT_USER_SELECTED_BIOME__ === true;
      if (!biomeKey || (!gm.terrainEngine && !userSelectedBiome)) {
        return neutralColor;
      }
      try {
        // Prefer hydrology-enhanced color if available
        return getBiomeColorWithHydrology(biomeKey, h);
      } catch (_) {
        const key = h.toString();
        if (Object.prototype.hasOwnProperty.call(TERRAIN_CONFIG.HEIGHT_COLOR_SCALE, key)) {
          return TERRAIN_CONFIG.HEIGHT_COLOR_SCALE[key];
        }
        return TERRAIN_CONFIG.HEIGHT_COLOR_SCALE['0'] || neutralColor;
      }
    };
    const wallColor = (x, z, height) =>
      cavernStyle &&
      !gm.terrainEngine?.isActive &&
      CAVERN_BIOME_KEYS.includes(gm.terrainEngine?.biomeKey)
        ? getCavernSurfaceColor(x * 5, z * 5, height, {
            materialColor: cavernRockColor(gm.terrainEngine.biomeKey),
          })
        : 0x050505;
    const activeMap =
      gm.campaignMapId && gm.campaignWorld ? gm.campaignWorld.getMap(gm.campaignMapId) : null;
    const geometry = gm.terrainEngine?.geometry;
    const buildingInterior =
      !!activeMap?.building ||
      !!activeMap?.floorContext ||
      Number.isFinite(geometry?.terrainThicknessFeet);
    const dungeonBoundary =
      gm.terrainEngine?.biomeKey === 'dungeon' &&
      geometry?.hasVolumes &&
      !buildingInterior &&
      gm.threeSceneManager.camera &&
      gm.spatial
        ? dungeonBoundaryWalls({
            geometry,
            cols,
            rows,
            tileWorldSize: gm.spatial.tileWorldSize,
          })
        : null;
    const boundaryCutaway =
      (dungeonBoundary ||
        (cavernStyle &&
          CAVERN_BIOME_KEYS.includes(gm.terrainEngine?.biomeKey) &&
          !buildingInterior)) &&
      gm.threeSceneManager.camera &&
      gm.spatial
        ? new BoundaryWallCutaway({
            cols,
            rows,
            getHeight,
            tileWorldSize: gm.spatial.tileWorldSize,
            elevationUnit: gm.spatial.elevationUnit,
            three: threeNs,
            boundary: dungeonBoundary,
          })
        : null;
    const getBoundaryWallCell = boundaryCutaway
      ? (x, z, span) => boundaryCutaway.boundaryCell(x, z, span)
      : null;
    const wantsWalls = !!(threeNs && threeNs.BufferGeometry);
    const cutaway = gm.terrainEngine?.geometry.hasVolumes ? createInteriorCutaway(gm) : null;
    const scene = gm.threeSceneManager.scene;
    const specs = this._readConstructionSpecs(geometry);
    const assets = this._prepareConstructionAssets({
      scene,
      specs,
      three: threeNs,
      worldUnitsPerFoot: specs.length ? gm.spatial.tileWorldSize / 5 : null,
      visibleLayers: gm.terrainEngine?.visibleLayers ?? null,
      modelAssetCache: gm.modelAssetCache,
    });
    const visualReplacements = assets?.userData.replacements ?? [];
    const clipFace = visualReplacements.length
      ? (source, points) =>
          clipConstructionReplacementFace({
            source,
            points,
            replacements: visualReplacements,
          })
      : null;
    let geo = gm.terrainEngine?.geometry.hasVolumes
      ? new TerrainVolumeMeshBuilder().build({
          geometry: cutaway
            ? cutaway.query(
                gm.terrainEngine.geometry,
                cutaway.map,
                gm.terrainEngine.geometry.getPartition(),
                { includeFloor: true }
              )
            : gm.terrainEngine.geometry,
          three: threeNs,
          worldUnitsPerFoot: gm.spatial.tileWorldSize / 5,
          visibleLayers: gm.terrainEngine.visibleLayers,
          clipFace,
          getBoundaryWallCell,
          getDungeonLintelBounds: dungeonBoundary?.lintelBoundsFor ?? null,
          getStyle: (_x, _z, _y, span) =>
            getTerrainMaterialStyle(span, floorAppearance, gm.terrainEngine.biomeKey),
          getColor: (x, z, height, span) => {
            if (
              cavernStyle &&
              span.id === 'terrain' &&
              CAVERN_BIOME_KEYS.includes(gm.terrainEngine.biomeKey)
            )
              return getCavernSurfaceColor(x, z, height, {
                materialColor: cavernRockColor(gm.terrainEngine.biomeKey),
              });
            if (span.materialColor !== undefined)
              return getTerrainLayerColor(
                span.layerId,
                gm.terrainEngine.biomeKey,
                span.materialRole,
                span.materialColor
              );
            if (floorAppearance) return floorAppearance.floorColor;
            if (span.id === 'terrain') {
              const feetPerLevel = (gm.spatial.elevationUnit * 5) / gm.spatial.tileWorldSize;
              return gmBiomeGetter(
                Math.floor(x / 5),
                Math.floor(z / 5),
                feetPerLevel > 0 ? height / feetPerLevel : 0
              );
            }
            return getTerrainLayerColor(
              span.layerId,
              gm.terrainEngine.biomeKey,
              span.materialRole,
              span.materialColor
            );
          },
        })
      : this.builder.build({
          cols,
          rows,
          getHeight,
          three: threeNs,
          getBiomeColor: gmBiomeGetter,
          getWallColor: wantsWalls ? wallColor : undefined,
          getBoundaryWallCell,
        });
    if (
      (floorAppearance || gm.terrainEngine?.biomeKey === 'dungeon') &&
      !geo.getAttribute('constructionMaterial')
    )
      geo.setAttribute(
        'constructionMaterial',
        new threeNs.Float32BufferAttribute(
          new Float32Array(geo.getAttribute('position').count).fill(
            getTerrainMaterialStyle({ id: 'terrain' }, floorAppearance, gm.terrainEngine.biomeKey)
          ),
          1
        )
      );
    if (gm.campaignWorld && !Number.isFinite(gm.terrainEngine.geometry.terrainThicknessFeet)) {
      const clipped = clipFloorSurfaceOverlap(geo, {
        world: gm.campaignWorld,
        map: gm.campaignWorld.getMap(gm.campaignMapId),
        three: threeNs,
      });
      if (clipped !== geo) geo.dispose();
      geo = clipped;
    }
    // Debug sample of first vertex color to help diagnose "all black" issues.
    try {
      if (typeof window !== 'undefined' && !window.__TT_LAST_TERRAIN_COLOR_SAMPLE__) {
        const colAttr = geo.getAttribute('color');
        if (colAttr && colAttr.count > 0) {
          const r = Math.round(colAttr.array[0] * 255);
          const g2 = Math.round(colAttr.array[1] * 255);
          const b = Math.round(colAttr.array[2] * 255);
          const sampleHex = (r << 16) | (g2 << 8) | b;
          window.__TT_LAST_TERRAIN_COLOR_SAMPLE__ = sampleHex;
          // eslint-disable-next-line no-console
          console.info('[TerrainRebuilder] Sample vertex color hex:', sampleHex.toString(16));
        }
      }
    } catch (_) {
      /* ignore debug sampling */
    }
    let mesh = scene.getObjectByName('TerrainMesh');
    if (!mesh) {
      let material;
      // Prefer Lambert (simpler diffuse) unless explicitly overridden to Standard via flag.
      const forceStandard = typeof window !== 'undefined' && window.__TT_TERRAIN_STANDARD__;
      try {
        if (!forceStandard && threeNs?.MeshLambertMaterial) {
          material = new threeNs.MeshLambertMaterial({ vertexColors: true });
        } else if (threeNs?.MeshStandardMaterial) {
          material = new threeNs.MeshStandardMaterial({
            vertexColors: true,
            flatShading: false,
            roughness: 0.92,
            metalness: 0.0,
          });
        }
      } catch (_) {
        /* fallback below */
      }
      if (!material) {
        const FallbackMaterial = threeNs?.MeshBasicMaterial || function Dummy() {};
        material = new FallbackMaterial({ vertexColors: true });
      }
      try {
        if (geo.getAttribute('color') && material && material.isMaterial) {
          material.vertexColors = true;
        }
        if (material && material.isMaterial && threeNs?.DoubleSide) {
          material.side = threeNs.DoubleSide;
        }
      } catch (_) {
        /* ignore */
      }
      mesh = new threeNs.Mesh(geo, material);
      mesh.name = 'TerrainMesh';
      mesh.position.set(0, 0, 0);
      // Enable ground to receive shadows from directional light (flora, tokens)
      try {
        mesh.receiveShadow = true;
      } catch (_) {
        /* ignore shadow flag set failure */
      }
      scene.add(mesh);
    } else {
      mesh.geometry.dispose();
      mesh.geometry = geo;
      try {
        // If current material is Basic, upgrade to Standard once for lighting.
        if (
          threeNs?.MeshLambertMaterial &&
          !forceStandard &&
          (!mesh.material ||
            mesh.material.isMeshBasicMaterial ||
            mesh.material.isMeshStandardMaterial)
        ) {
          try {
            mesh.material.dispose?.();
          } catch (_) {
            /* ignore */
          }
          try {
            mesh.material = new threeNs.MeshLambertMaterial({ vertexColors: true });
          } catch (_) {
            /* ignore */
          }
        } else if (
          forceStandard &&
          threeNs?.MeshStandardMaterial &&
          (!mesh.material ||
            mesh.material.isMeshBasicMaterial ||
            mesh.material.isMeshLambertMaterial)
        ) {
          try {
            mesh.material.dispose?.();
          } catch (_) {
            /* ignore */
          }
          try {
            mesh.material = new threeNs.MeshStandardMaterial({
              vertexColors: true,
              flatShading: false,
              roughness: 0.92,
              metalness: 0.0,
            });
          } catch (_) {
            mesh.material = new threeNs.MeshBasicMaterial({ vertexColors: true });
          }
        }
      } catch (_) {
        /* ignore material swap */
      }
      try {
        if (geo.getAttribute('color') && mesh.material) {
          mesh.material.vertexColors = true;
          if (threeNs?.DoubleSide) mesh.material.side = threeNs.DoubleSide;
          mesh.material.needsUpdate = true;
        }
      } catch (_) {
        /* ignore */
      }
      try {
        if (mesh.position && (mesh.position.x !== 0 || mesh.position.z !== 0)) {
          mesh.position.set(0, 0, 0);
        }
      } catch (_) {
        /* ignore reposition */
      }
    }
    if (hasConstructionMaterials(geo))
      configureConstructionMaterial(mesh.material, gm.spatial.tileWorldSize / 5);
    mesh.castShadow = !!gm.terrainEngine?.geometry.hasVolumes;
    const detailsInput =
      typeof geometry?.constructionDetailsSignature === 'string'
        ? geometry.constructionDetailsSignature
        : specs;
    const detailsSignature = JSON.stringify([
      detailsInput,
      gm.spatial?.tileWorldSize,
      gm.terrainEngine?.visibleLayers,
      visualReplacements.map((entry) => entry.structureId),
    ]);
    if (detailsSignature !== mesh.userData?.constructionDetailsSignature) {
      mesh.userData ??= {};
      const old = mesh.getObjectByName?.('ConstructionDetails');
      if (old) {
        old.geometry.dispose();
        old.removeFromParent();
      }
      if (specs.length) {
        const detailsGeometry = buildConstructionDetails({
          specs,
          three: threeNs,
          worldUnitsPerFoot: gm.spatial.tileWorldSize / 5,
          visibleLayers: gm.terrainEngine.visibleLayers,
          cladStructureIds: new Set(visualReplacements.map((entry) => entry.structureId)),
        });
        if (detailsGeometry) {
          const details = new threeNs.Mesh(detailsGeometry, mesh.material);
          details.name = 'ConstructionDetails';
          details.raycast = () => {};
          details.userData.renderOnly = true;
          details.castShadow = true;
          details.receiveShadow = true;
          mesh.add(details);
        }
      }
      mesh.userData.constructionDetailsSignature = detailsSignature;
    }
    const details = mesh.getObjectByName?.('ConstructionDetails');
    if (details) details.material = mesh.material;
    const previousAssets = mesh.getObjectByName?.('ConstructionAssets');
    if (previousAssets !== assets) {
      releaseConstructionAssets(previousAssets);
      if (assets) mesh.add(assets);
    }
    const layers = gm.terrainEngine?.visibleLayers;
    syncWaterSurface(mesh, {
      biomeKey:
        !buildingInterior && (!layers || layers.includes('ground'))
          ? gm.terrainEngine?.biomeKey
          : null,
      cols,
      rows,
      getHeight,
      tileWorldSize: gm.spatial?.tileWorldSize,
      three: threeNs,
    });
    boundaryCutaway?.attach(mesh);
    boundaryCutaway?.attachWallModels(assets, dungeonBoundary?.structureIds);
    gm.threeSceneManager._boundaryWallCutaway = boundaryCutaway;
    boundaryCutaway?.update(gm.threeSceneManager.camera);
    updateLogicalPassageMarkers(mesh, gm, threeNs);
    try {
      const currentOpacity = Number.isFinite(gm?.threeSceneManager?._terrainMeshOpacity)
        ? gm.threeSceneManager._terrainMeshOpacity
        : 1;
      gm?.threeSceneManager?.setTerrainMeshOpacity?.(currentOpacity);
    } catch (_) {
      /* ignore opacity sync */
    }
    try {
      gm?.threeSceneManager?.syncGridOverlayToTerrain?.();
    } catch (_) {
      /* ignore grid overlay sync */
    }
    try {
      const t1 = (typeof performance !== 'undefined' && performance.now()) || Date.now();
      const dt = t1 - t0;
      if (typeof window !== 'undefined') {
        window.__TT_METRICS__ = window.__TT_METRICS__ || {};
        window.__TT_METRICS__.terrain = window.__TT_METRICS__.terrain || {};
        window.__TT_METRICS__.terrain.lastRebuildMs = dt;
        window.__TT_METRICS__.terrain.lastRebuildCols = cols;
        window.__TT_METRICS__.terrain.lastRebuildRows = rows;
        window.__TT_METRICS__.terrain.rebuildCount =
          (window.__TT_METRICS__.terrain.rebuildCount || 0) + 1;
      }
    } catch (_) {
      /* ignore metrics errors */
    }
    try {
      gm?.threeSceneManager?.registerTerrainGeometryBasis?.(mesh?.geometry);
    } catch (_) {
      /* ignore terrain basis registration */
    }
    return mesh;
  }

  _readConstructionSpecs(geometry) {
    if (!geometry) return [];
    const signature = geometry.constructionDetailsSignature;
    if (typeof signature === 'string' && this._constructionSpecs?.signature === signature)
      return this._constructionSpecs.specs;
    const specs = geometry.getStructures().filter((spec) => spec.appearance);
    if (typeof signature === 'string') this._constructionSpecs = { signature, specs };
    return specs;
  }

  _prepareConstructionAssets({
    scene,
    specs,
    three,
    worldUnitsPerFoot,
    visibleLayers,
    modelAssetCache,
  }) {
    const candidates = specs.filter((spec) => isVillageExterior(spec) || isDungeonWall(spec));
    if (!modelAssetCache?.getModel || !candidates.length) {
      this._constructionAssetRequest = null;
      return null;
    }
    const signature = JSON.stringify([candidates, worldUnitsPerFoot, visibleLayers]);
    const previous = this._constructionAssetRequest;
    if (previous?.signature === signature && previous.scene === scene) return previous.assets;

    const request = { signature, scene, assets: null };
    this._constructionAssetRequest = request;
    buildConstructionAssets({
      specs: candidates,
      three,
      worldUnitsPerFoot,
      visibleLayers,
      modelAssetCache,
    })
      .then((assets) => {
        if (
          this._constructionAssetRequest !== request ||
          this.gameManager.threeSceneManager.scene !== scene
        ) {
          releaseConstructionAssets(assets);
          return;
        }
        if (!assets.children.length) return;
        // Hide the replaced faces only on the rebuild that can also attach the finished kit.
        request.assets = assets;
        this.request({ three });
      })
      .catch((error) => {
        GameErrors.gameState(error, {
          component: 'TerrainRebuilder',
          operation: 'construction-assets',
        });
      });
    return null;
  }
}
