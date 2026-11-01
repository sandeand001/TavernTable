import { TERRAIN_PLACEABLES } from '../../config/terrain/TerrainPlaceables.js';
import { BRUSH_COLORS } from '../../terrain/brush/BrushCommon.js';
import { autoPopulateBiomeFlora } from '../../coordinators/terrain-coordinator/internals/flora.js';
import { GameErrors } from '../../utils/error/ErrorHandler.js';

export class TerrainEngineSceneAdapter {
  constructor({ engine, gameManager, threeSceneManager } = {}) {
    if (!engine || !gameManager || !threeSceneManager) {
      throw new Error('Terrain scene wiring requires the engine, game manager and 3D scene');
    }
    this.engine = engine;
    this.gameManager = gameManager;
    this.scene = threeSceneManager;
    this._unsubs = [];
  }

  attach() {
    if (this._unsubs.length) return;
    const e = this.engine;
    const gm = this.gameManager;
    this._unsubs.push(
      e.onChanged(({ kind }) => {
        if (kind !== 'treeDensity') gm.notifyTerrainHeightsChanged();
      }),
      e.onBrushMoved((preview) => this._renderPreview(preview)),
      e.onActivationChanged(({ active }) => {
        if (!active) this.scene.clearTerrainBrushPreview();
      }),
      e.onBiomeChanged(({ biomeKey, biomeSeed }) => {
        if (typeof window !== 'undefined') {
          window.selectedBiome = biomeKey;
          window.richShadingSettings ??= {};
          window.richShadingSettings.seed = biomeSeed;
        }
        gm.__biomeVersion = (gm.__biomeVersion || 0) + 1;
      }),
      e.onScaleChanged(() => gm.sync3DElevationScaling({ rebuild: false })),
      e.onBiomeGenerated((biome) => this._populateFlora(biome)),
      e.onPlaceableChanged((placement) => this._changePlaceable(placement))
    );
  }

  detach() {
    for (const unsubscribe of this._unsubs) unsubscribe();
    this._unsubs = [];
    this.scene.clearTerrainBrushPreview();
  }

  _renderPreview({ cells, tool, heightStep }) {
    const e = this.engine;
    const visible = e.isActive || (e.getSelectedPlaceable() && e.isPlaceablesPanelVisible());
    if (!visible || !cells.length) {
      this.scene.clearTerrainBrushPreview();
      return;
    }
    this.scene.setTerrainBrushPreview(cells, {
      color: BRUSH_COLORS.preview,
      fillAlpha: 0.12,
      lineAlpha: 0.9,
      lineWidth: 2,
      previewMode: 'terrain-height',
      brushTool: tool,
      heightStep,
    });
  }

  _populateFlora({ biomeKey, biomeSeed }) {
    const gm = this.gameManager;
    const pool = gm.placeableMeshPool;
    if (!pool) return;
    pool.purgeAll();
    autoPopulateBiomeFlora(
      {
        gameManager: gm,
        getTerrainHeight: (x, y) => this.engine.getHeightAt(x, y),
        getTreeDensityMultiplier: () => this.engine.treeDensityMultiplier,
        _biomeSeed: biomeSeed,
      },
      biomeKey,
      biomeSeed
    );
    if (pool.whenSettled) {
      void pool.whenSettled().catch((error) => {
        GameErrors.gameState(error, { component: 'TerrainEngineSceneAdapter', operation: 'flora' });
      });
    }
  }

  _changePlaceable({ gridX, gridY, placeableId, variant }) {
    const pool = this.gameManager.placeableMeshPool;
    if (!pool) throw new Error('The terrain placement renderer is unavailable');
    if (placeableId === null) {
      pool.removePlantsAt(gridX, gridY);
      return;
    }
    const definition = TERRAIN_PLACEABLES[placeableId];
    if (!definition) throw new Error(`Unknown terrain placeable: ${placeableId}`);
    void pool
      .addPlaceable({
        type: definition.type,
        modelKey: definition.modelKey,
        variantKey: variant || placeableId,
        placeableId,
        gridX,
        gridY,
        biomeKey: this.engine.biomeKey,
        biomeSeed: this.engine.biomeSeed,
      })
      .then((handle) => {
        if (!handle) throw new Error(`Terrain placeable "${placeableId}" could not be placed`);
      })
      .catch((error) => {
        GameErrors.gameState(error, {
          component: 'TerrainEngineSceneAdapter',
          operation: 'place',
          placeableId,
          gridX,
          gridY,
        });
      });
  }
}
