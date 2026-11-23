import { TERRAIN_PLACEABLES } from '../../config/terrain/TerrainPlaceables.js';
import { BRUSH_COLORS } from '../../terrain/brush/BrushCommon.js';
import { GameErrors } from '../../utils/error/ErrorHandler.js';
import { validateConstructionEdit } from '../../campaigns/CampaignConstruction.js';
import { CampaignBuildingEditor } from '../../campaigns/CampaignBuildingEditor.js';
import { getModelSupportBounds } from '../../core/ModelPostProcessing.js';
import { getPurePolyAsset } from '../../config/assets/PurePolyAssets.js';
import { fitTreeScale } from './treeSupport.js';
import { resolveCavernSceneryClearance } from './CavernSceneryClearance.js';
import {
  cavernEntranceCells,
  naturalCavernRoutes,
} from '../../terrain/generation/CavernInteriors.js';

export class TerrainEngineSceneAdapter {
  constructor({ engine, gameManager, threeSceneManager } = {}) {
    if (!engine || !gameManager || !threeSceneManager) {
      throw new Error('Terrain scene wiring requires the engine, game manager and 3D scene');
    }
    this.engine = engine;
    this.gameManager = gameManager;
    this.scene = threeSceneManager;
    this._unsubs = [];
    this._treeChoices = new Map();
    this._treeBounds = new Map();
    this._pendingPlaceables = new Map();
    this._previewRevision = 0;
    this._lastTreePreview = null;
    this._previewRefreshQueued = false;
    this._treeSupportNoticeQueued = false;
  }

  attach() {
    if (this._unsubs.length) return;
    const e = this.engine;
    const gm = this.gameManager;
    const buildings = new CampaignBuildingEditor(gm);
    this._unsubs.push(
      e.participateInGeometryEdits(buildings),
      e.validateGeometryEdits((geometry, _snapshot, context) =>
        validateConstructionEdit(gm, geometry, context)
      ),
      e.onChanged(({ kind }) => {
        buildings.publish();
        if (kind === 'generationSettings') return;
        if (kind === 'visibility') {
          gm.terrainRebuilder?.request();
          if (gm.token3DAdapter) gm.token3DAdapter._movementRangeDirty = true;
          return;
        }
        if (kind !== 'treeDensity') {
          if (kind === 'generation' && gm.campaignWorld)
            e.configureGeometryBase(
              gm.campaignWorld.getMap(gm.campaignMapId).base === 'floor' ? 0.5 : null
            );
          e.configureGeometryScale((gm.spatial.elevationUnit * 5) / gm.spatial.tileWorldSize);
          gm.notifyTerrainHeightsChanged();
        }
      }),
      e.onBrushMoved((preview) => this._renderPreview(preview)),
      e.onActivationChanged(({ active }) => {
        if (!active) this.scene.clearTerrainBrushPreview();
      }),
      e.onBiomeChanged(({ biomeKey, biomeSeed }) => {
        this.scene.setSceneLightingBiome?.(biomeKey);
        if (typeof window !== 'undefined') {
          window.selectedBiome = biomeKey;
          window.richShadingSettings ??= {};
          window.richShadingSettings.seed = biomeSeed;
        }
        gm.__biomeVersion = (gm.__biomeVersion || 0) + 1;
      }),
      e.onScaleChanged(({ source }) => {
        // Snapshot loading already supplies the canonical physical scale.
        if (source !== 'load') gm.sync3DElevationScaling({ rebuild: false });
      }),
      e.onBiomeGenerated((biome) => this._populateFlora(biome)),
      e.onPlaceableChanged((placement) => this._changePlaceable(placement))
    );
  }

  detach() {
    for (const unsubscribe of this._unsubs) unsubscribe();
    this._unsubs = [];
    this._previewRevision++;
    this._lastTreePreview = null;
    this._treeChoices.clear();
    this._treeBounds.clear();
    for (const pending of this._pendingPlaceables.values()) {
      for (const controller of pending) controller.abort();
    }
    this._pendingPlaceables.clear();
    this.scene.clearTerrainBrushPreview();
  }

  _renderPreview(preview) {
    const { cells, tool, heightStep } = preview;
    const e = this.engine;
    const revision = ++this._previewRevision;
    const visible = e.isActive || (e.getSelectedPlaceable() && e.isPlaceablesPanelVisible());
    if (!visible || !cells.length) {
      this._lastTreePreview = null;
      this._treeChoices.clear();
      this.scene.clearTerrainBrushPreview();
      return;
    }
    const style = {
      color: BRUSH_COLORS.preview,
      fillAlpha: 0.12,
      lineAlpha: 0.9,
      lineWidth: 2,
      previewMode: 'terrain-height',
      brushTool: tool,
      heightStep,
    };
    const selected = e.isPlaceablesPanelVisible() ? e.getSelectedPlaceable() : null;
    if (!this._isTreeSelection(selected)) {
      this._lastTreePreview = null;
      this._treeChoices.clear();
      this.scene.setTerrainBrushPreview(cells, style);
      return;
    }
    this._lastTreePreview = preview;
    const activeKeys = new Set(cells.map(({ x, y }) => this._treeChoiceKey(selected, x, y)));
    for (const key of this._treeChoices.keys())
      if (!activeKeys.has(key)) this._treeChoices.delete(key);
    this.scene.clearTerrainBrushPreview();
    void Promise.all(
      cells.map(async (cell) => {
        const id = this._manualVariant(selected, cell.x, cell.y);
        const bounds = await this._treeSupportBounds(TERRAIN_PLACEABLES[id].modelKey);
        const scale = fitTreeScale(this.gameManager, { gridX: cell.x, gridY: cell.y }, bounds);
        return {
          ...cell,
          color:
            scale === null
              ? BRUSH_COLORS.treeBlocked
              : scale < 1 - 1e-6
                ? BRUSH_COLORS.treeScaled
                : BRUSH_COLORS.preview,
        };
      })
    )
      .then((result) => {
        if (revision !== this._previewRevision) return;
        this.scene.setTerrainBrushPreview(result, { ...style, fillAlpha: 0.3 });
      })
      .catch((error) => {
        if (revision !== this._previewRevision) return;
        this.scene.clearTerrainBrushPreview();
        GameErrors.gameState(error, {
          component: 'TerrainEngineSceneAdapter',
          operation: 'tree-preview',
          placeableId: selected,
        });
      });
  }

  _isTreeSelection(id) {
    return (
      /^tree-/.test(id || '') ||
      TERRAIN_PLACEABLES[id]?.type === 'plant-family' ||
      ['cactus', 'rock', 'prop', 'ore', 'light', 'tree'].includes(getPurePolyAsset(id)?.kind)
    );
  }

  _treeChoiceKey(id, x, y) {
    return `${id}:${x},${y}`;
  }

  _manualVariant(id, x, y) {
    const definition = TERRAIN_PLACEABLES[id];
    if (definition?.type !== 'plant-family') return id;
    const key = this._treeChoiceKey(id, x, y);
    if (this._treeChoices.has(key)) return this._treeChoices.get(key);
    const variants = definition.familyVariants;
    if (
      !Array.isArray(variants) ||
      !variants.length ||
      variants.some((variant) => {
        const entry = TERRAIN_PLACEABLES[variant];
        return !/^tree-/.test(variant) || entry?.type !== 'plant' || !entry.modelKey;
      })
    )
      throw new Error(`Tree family "${id}" has no valid model variants`);
    const chosen = variants[Math.floor(Math.random() * variants.length)];
    this._treeChoices.set(key, chosen);
    return chosen;
  }

  _treeSupportBounds(modelKey) {
    const cache = this.gameManager.modelAssetCache;
    const three = this.scene.three;
    if (!cache?.getModel || !three) throw new Error('Tree preview model loading is unavailable');
    if (this._treeBoundsOwner !== cache) {
      this._treeBounds.clear();
      this._treeBoundsOwner = cache;
    }
    if (!this._treeBounds.has(modelKey)) {
      const pending = Promise.resolve(cache.getModel(modelKey))
        .then((model) => {
          if (!model) throw new Error(`Tree model "${modelKey}" could not be loaded`);
          return getModelSupportBounds(three, model);
        })
        .catch((error) => {
          if (this._treeBounds.get(modelKey) === pending) this._treeBounds.delete(modelKey);
          throw error;
        });
      this._treeBounds.set(modelKey, pending);
    }
    return this._treeBounds.get(modelKey);
  }

  _refreshTreePreview() {
    if (this._previewRefreshQueued) return;
    this._previewRefreshQueued = true;
    queueMicrotask(() => {
      this._previewRefreshQueued = false;
      if (this._lastTreePreview) this._renderPreview(this._lastTreePreview);
    });
  }

  _populateFlora({ placements }) {
    const gm = this.gameManager;
    const pool = gm.placeableMeshPool;
    if (!pool) return;
    pool.purgeAll();
    for (const placement of placements) pool.addPlaceable(placement);
    if (pool.whenSettled) {
      const epoch = pool._clearEpoch;
      void pool
        .whenSettled()
        .then(() => {
          if (pool._clearEpoch !== epoch || !this.engine.cavern) return;
          const cavern = this.engine.cavern;
          const routeCells = naturalCavernRoutes({
            cols: this.engine.cols,
            rows: this.engine.rows,
            getHeight: (x, z) => this.engine.getHeightAt(x, z),
            exits: cavern.exits,
            seed: cavern.seed,
          }).flatMap(({ cells }) => cells);
          routeCells.push(
            ...cavern.exits.flatMap((side) =>
              cavernEntranceCells(side, this.engine.cols, this.engine.rows)
            )
          );
          resolveCavernSceneryClearance(pool, {
            routeCells,
            tileWorldSize: gm.spatial.tileWorldSize,
            checkSupport: true,
            biomeKey: this.engine.biomeKey,
          });
        })
        .catch((error) => {
          GameErrors.gameState(error, {
            component: 'TerrainEngineSceneAdapter',
            operation: 'flora',
          });
        });
    }
  }

  _changePlaceable({ gridX, gridY, placeableId, variant }) {
    const pool = this.gameManager.placeableMeshPool;
    if (!pool) throw new Error('The terrain placement renderer is unavailable');
    const cell = `${gridX},${gridY}`;
    if (placeableId === null) {
      for (const controller of this._pendingPlaceables.get(cell) || []) controller.abort();
      pool.removeTerrainPlaceablesAt(gridX, gridY);
      return;
    }
    const selected = TERRAIN_PLACEABLES[placeableId];
    if (!selected) throw new Error(`Unknown terrain placeable: ${placeableId}`);
    if (selected.type === 'plant-family' && variant && !selected.familyVariants?.includes(variant))
      throw new Error(`"${variant}" is not a variant of tree family "${placeableId}"`);
    const concreteId =
      selected.type === 'plant-family'
        ? variant || this._manualVariant(placeableId, gridX, gridY)
        : placeableId;
    const definition = TERRAIN_PLACEABLES[concreteId];
    if (selected.type === 'plant-family' && (definition?.type !== 'plant' || !definition.modelKey))
      throw new Error(`Tree family "${placeableId}" has an invalid model variant`);
    const tree = this._isTreeSelection(concreteId);
    this._treeChoices.delete(this._treeChoiceKey(placeableId, gridX, gridY));
    if (tree) this._refreshTreePreview();
    const controller = new AbortController();
    const pending = this._pendingPlaceables.get(cell) || new Set();
    pending.add(controller);
    this._pendingPlaceables.set(cell, pending);
    void pool
      .addPlaceable(
        {
          type: definition.type,
          modelKey: definition.modelKey,
          variantKey: selected.type === 'plant-family' ? concreteId : variant || concreteId,
          placeableId: concreteId,
          gridX,
          gridY,
          biomeKey: this.engine.biomeKey,
          biomeSeed: this.engine.biomeSeed,
        },
        { fitManualTree: tree, strict: true, signal: controller.signal }
      )
      .then((handle) => {
        if (!handle && !controller.signal.aborted)
          throw new Error(`Terrain placeable "${placeableId}" could not be placed`);
      })
      .catch((error) => {
        const context = {
          component: 'TerrainEngineSceneAdapter',
          operation: 'place',
          placeableId,
          gridX,
          gridY,
        };
        if (error.code !== 'tree-support-unavailable') {
          GameErrors.gameState(error, context);
          return;
        }
        if (this._treeSupportNoticeQueued) return;
        this._treeSupportNoticeQueued = true;
        queueMicrotask(() => {
          this._treeSupportNoticeQueued = false;
          GameErrors.input(error, context);
        });
      })
      .finally(() => {
        pending.delete(controller);
        if (!pending.size && this._pendingPlaceables.get(cell) === pending)
          this._pendingPlaceables.delete(cell);
      });
  }
}
