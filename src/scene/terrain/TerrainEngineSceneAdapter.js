/**
 * TerrainEngineSceneAdapter.js — Bridges TerrainEngine events to the 3D scene.
 *
 * Pure wiring: subscribes to TerrainEngine outbound events and translates them
 * into ThreeSceneManager / TerrainRebuilder calls. Holds no state of its own
 * beyond the unsubscribe handles.
 *
 * See docs/adr/ADR-0001-terrain-engine-event-seam.md
 */

import { logger, LOG_LEVEL, LOG_CATEGORY } from '../../utils/logger/Logger.js';
import { TERRAIN_CONFIG } from '../../config/terrain/TerrainConstants.js';

export class TerrainEngineSceneAdapter {
  /**
   * @param {object} opts
   * @param {import('../../terrain/TerrainEngine.js').TerrainEngine} opts.engine
   * @param {object} opts.threeSceneManager
   * @param {object} [opts.rebuilder] - optional TerrainRebuilder instance
   */
  constructor({ engine, threeSceneManager, rebuilder = null } = {}) {
    if (!engine) throw new Error('TerrainEngineSceneAdapter requires an engine');
    if (!threeSceneManager) {
      throw new Error('TerrainEngineSceneAdapter requires a threeSceneManager');
    }

    this._engine = engine;
    this._three = threeSceneManager;
    this._rebuilder = rebuilder;
    this._unsubs = [];
    this._attached = false;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  attach() {
    if (this._attached) return;
    const e = this._engine;

    this._unsubs.push(e.onHeightChanged(() => this._requestRebuild()));
    this._unsubs.push(e.onBrushCommitted(() => this._requestRebuild()));
    this._unsubs.push(e.onResized(() => this._requestRebuild()));
    this._unsubs.push(e.onBiomeChanged(() => this._requestRebuild()));

    this._unsubs.push(e.onBrushMoved((payload) => this._renderBrushPreview(payload)));

    this._unsubs.push(
      e.onActivationChanged((payload) => {
        if (!payload?.active) this._clearBrushPreview();
      })
    );

    this._attached = true;
    logger.log(LOG_LEVEL.DEBUG, 'TerrainEngineSceneAdapter attached', LOG_CATEGORY.SYSTEM);
  }

  detach() {
    for (const off of this._unsubs) {
      try {
        off();
      } catch (_) {
        /* ignore */
      }
    }
    this._unsubs = [];
    this._attached = false;
  }

  // ── Internal Routing ──────────────────────────────────────────────────────

  _requestRebuild() {
    try {
      if (this._rebuilder?.request) {
        this._rebuilder.request({});
        return;
      }
      // Fallback: many ThreeSceneManagers expose a direct rebuild path.
      const fn =
        this._three?.requestTerrainRebuild ||
        this._three?.rebuildTerrain ||
        this._three?.scheduleTerrainRebuild;
      if (typeof fn === 'function') fn.call(this._three);
    } catch (err) {
      logger.log(LOG_LEVEL.WARN, 'TerrainEngineSceneAdapter rebuild failed', LOG_CATEGORY.SYSTEM, {
        err,
      });
    }
  }

  _renderBrushPreview({ cells } = {}) {
    if (!this._engine.isActive) return;
    if (typeof this._three.setTerrainBrushPreview !== 'function') return;
    if (!Array.isArray(cells) || cells.length === 0) {
      this._clearBrushPreview();
      return;
    }
    try {
      const tool = this._engine.tool;
      const isLower = tool === 'lower';
      const maxH = Number.isFinite(TERRAIN_CONFIG?.MAX_HEIGHT)
        ? TERRAIN_CONFIG.MAX_HEIGHT
        : Infinity;
      const minH = Number.isFinite(TERRAIN_CONFIG?.MIN_HEIGHT)
        ? TERRAIN_CONFIG.MIN_HEIGHT
        : -Infinity;

      const enriched = cells.map((c) => {
        const x = c.x ?? c.gridX ?? 0;
        const y = c.y ?? c.gridY ?? 0;
        const currentHeight = this._engine.getHeightAt(x, y) ?? 0;
        const previewHeight = isLower
          ? Math.max(currentHeight - 1, minH)
          : Math.min(currentHeight + 1, maxH);
        return { x, y, currentHeight, previewHeight };
      });
      this._three.setTerrainBrushPreview(enriched, {
        previewMode: 'terrain-height',
        brushTool: tool,
        heightStep: 1,
      });
    } catch (err) {
      logger.log(LOG_LEVEL.WARN, 'TerrainEngineSceneAdapter preview failed', LOG_CATEGORY.SYSTEM, {
        err,
      });
    }
  }

  _clearBrushPreview() {
    try {
      this._three.clearTerrainBrushPreview?.();
    } catch (_) {
      /* ignore */
    }
  }
}
