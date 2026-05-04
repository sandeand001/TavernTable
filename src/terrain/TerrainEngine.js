/**
 * TerrainEngine.js — Single authoritative module for all terrain state and logic.
 *
 * Owns: height data, brush state, biome, placeables selection, activation state.
 * Does NOT own: any rendering (PIXI, Three.js). Communicates outward via events only.
 *
 * See docs/adr/ADR-0001-terrain-engine-event-seam.md
 */

// ── Imports ────────────────────────────────────────────────────────────────
import { logger, LOG_LEVEL, LOG_CATEGORY } from '../utils/logger/Logger.js';
import { TERRAIN_CONFIG } from '../config/terrain/TerrainConstants.js';
import { TerrainDataStore } from './TerrainDataStore.js';
import { TerrainBrushController } from './brush/TerrainBrushController.js';
import {
  generateBiomeElevationField,
  getBiomeElevationScaleHint,
  isAllDefaultHeight,
} from './generation/BiomeElevationGenerator.js';
import { TerrainHeightUtils } from '../utils/terrain/TerrainHeightUtils.js';

// ── Constants ──────────────────────────────────────────────────────────────
const DEFAULT_BIOME_SEED = () =>
  typeof window !== 'undefined' && Number.isFinite(window.richShadingSettings?.seed)
    ? window.richShadingSettings.seed >>> 0
    : Math.floor(Math.random() * 1e9) >>> 0;

// ── TerrainEngine ──────────────────────────────────────────────────────────
export class TerrainEngine {
  // ── Constructor ───────────────────────────────────────────────────────────

  /**
   * @param {number} cols
   * @param {number} rows
   * @param {number[][]} [baseHeights] - optional pre-loaded height array
   */
  constructor(cols, rows, baseHeights = null) {
    this._dataStore = new TerrainDataStore(cols, rows, baseHeights);
    this._brush = new TerrainBrushController(this._dataStore);

    // Activation
    this._isActive = false;
    this._isDragging = false;
    this._lastModifiedCell = null;

    // Biome
    this._biomeKey = null;
    this._biomeSeed = DEFAULT_BIOME_SEED();
    this._elevationScale = TERRAIN_CONFIG.ELEVATION_SHADOW_OFFSET;
    this._richShadingEnabled = false;
    this._treeDensityMultiplier =
      typeof window !== 'undefined' && Number.isFinite(window.treeDensityMultiplier)
        ? Math.max(0, window.treeDensityMultiplier)
        : 1;

    // Placeables
    this._selectedPlaceable = null;
    this._placeablesPanelVisible = false;
    this._placeableRemovalMode = false;
    this._ptBrushSize = this._brush.brushSize;

    // Events — arrays of subscriber callbacks
    this._listeners = {
      tileChanged: [],
      heightChanged: [],
      brushMoved: [],
      brushCommitted: [],
      activationChanged: [],
      placeableChanged: [],
      biomeChanged: [],
      resized: [],
    };

    logger.log(LOG_LEVEL.DEBUG, 'TerrainEngine created', LOG_CATEGORY.SYSTEM, {
      context: 'TerrainEngine.constructor',
      cols,
      rows,
    });
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Enter terrain editing mode.
   */
  activate() {
    if (this._isActive) return;
    this._isActive = true;
    this._emit('activationChanged', { active: true });
    logger.log(LOG_LEVEL.DEBUG, 'TerrainEngine activated', LOG_CATEGORY.SYSTEM);
  }

  /**
   * Exit terrain editing mode. Commits any pending stroke.
   */
  deactivate() {
    if (!this._isActive) return;
    this._commitPendingStroke();
    this._isActive = false;
    this._isDragging = false;
    this._lastModifiedCell = null;
    this._emit('activationChanged', { active: false });
    logger.log(LOG_LEVEL.DEBUG, 'TerrainEngine deactivated', LOG_CATEGORY.SYSTEM);
  }

  /**
   * Resize the terrain grid, preserving existing heights where possible.
   * @param {number} cols
   * @param {number} rows
   */
  resize(cols, rows) {
    this._dataStore.resize(cols, rows);
    this._emit('resized', { cols, rows });
    this._emitAllTiles();
  }

  /**
   * Reset all terrain heights to the default value.
   */
  reset() {
    this._dataStore.resetAll();
    this._lastModifiedCell = null;
    this._emitAllTiles();
    logger.log(LOG_LEVEL.DEBUG, 'TerrainEngine reset', LOG_CATEGORY.SYSTEM);
  }

  // ── Public API — Height ───────────────────────────────────────────────────

  /**
   * @param {number} gridX
   * @param {number} gridY
   * @returns {number}
   */
  getHeightAt(gridX, gridY) {
    return this._dataStore.get(gridX, gridY);
  }

  /**
   * Directly set a single cell's height and emit events.
   * @param {number} gridX
   * @param {number} gridY
   * @param {number} height
   */
  setHeightAt(gridX, gridY, height) {
    const clamped = TerrainHeightUtils.clampHeight(height);
    this._dataStore.set(gridX, gridY, clamped);
    this._emitTile(gridX, gridY);
    this._emit('heightChanged', { gridX, gridY, height: clamped });
  }

  // ── Public API — Brush ────────────────────────────────────────────────────

  setTool(tool) {
    this._brush.setTool(tool);
  }

  setBrushSize(size) {
    this._brush.brushSize = size;
  }

  increaseBrush() {
    this._brush.increaseBrush();
  }

  decreaseBrush() {
    this._brush.decreaseBrush();
  }

  /**
   * Returns the grid cells the brush would cover at this position (non-mutating).
   * @param {number} gridX
   * @param {number} gridY
   * @returns {Array<{x: number, y: number}>}
   */
  getBrushFootprint(gridX, gridY) {
    return this._brush.getFootprintCells(gridX, gridY);
  }

  /**
   * Apply the active brush at the given position. Emits events for modified cells.
   * Returns true if any cells changed.
   * @param {number} gridX
   * @param {number} gridY
   * @returns {boolean}
   */
  applyBrushAt(gridX, gridY) {
    // Snapshot before-heights for the footprint so we can diff after the stroke.
    const footprint = this._brush.getFootprintCells(gridX, gridY);
    const snapshot = footprint.map((cell) => ({
      x: cell.x,
      y: cell.y,
      before: this._dataStore.get(cell.x, cell.y),
    }));

    // applyAt handles the full footprint internally — call it exactly once.
    const changed = this._brush.applyAt(gridX, gridY);

    if (changed) {
      for (const s of snapshot) {
        const after = this._dataStore.get(s.x, s.y);
        if (after !== s.before) {
          this._emitTile(s.x, s.y);
          this._emit('heightChanged', { gridX: s.x, gridY: s.y, height: after });
        }
      }
    }

    this._lastModifiedCell = { x: gridX, y: gridY };
    this._isDragging = true;
    return !!changed;
  }

  /**
   * Signal that the brush has moved to a new hover position without applying.
   * Renderers use this to show a preview.
   * @param {number} gridX
   * @param {number} gridY
   */
  moveBrushTo(gridX, gridY) {
    const cells = this._brush.getFootprintCells(gridX, gridY);
    this._emit('brushMoved', { gridX, gridY, cells });
  }

  /**
   * Commit the current working heights to the base (end of a drag stroke).
   */
  commitBrushStroke() {
    this._commitPendingStroke();
  }

  // ── Public API — Biome ────────────────────────────────────────────────────

  /**
   * Set the active biome and optionally generate terrain elevation if the grid
   * is still at its default height.
   * @param {string} biomeKey
   * @param {{ seed?: number, generateIfFlat?: boolean }} [options]
   */
  setBiome(biomeKey, options = {}) {
    this._biomeKey = biomeKey;

    if (options.seed !== undefined) {
      this._biomeSeed = options.seed;
    }

    const hint = getBiomeElevationScaleHint(biomeKey);
    if (hint) {
      this._elevationScale = hint;
      TerrainHeightUtils.setElevationUnit(hint);
    }

    const shouldGenerate =
      options.generateIfFlat !== false && isAllDefaultHeight(this._dataStore.working);

    if (shouldGenerate) {
      this.generateBiomeElevation(biomeKey, options);
    }

    this._emit('biomeChanged', { biomeKey, biomeSeed: this._biomeSeed });
    this._emitAllTiles();
  }

  /**
   * Overwrite the entire height map with generated biome elevation.
   * @param {string} biomeKey
   * @param {{ seed?: number, relief?: number, roughness?: number }} [options]
   */
  generateBiomeElevation(biomeKey, options = {}) {
    const seed = options.seed ?? this._biomeSeed;
    const { rows, cols } = this._dataStore;
    const newHeights = generateBiomeElevationField(biomeKey, rows, cols, { ...options, seed });

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        this._dataStore.set(x, y, newHeights[y][x]);
      }
    }
    this._dataStore.applyWorkingToBase();
    this._emitAllTiles();
    logger.log(LOG_LEVEL.DEBUG, 'TerrainEngine: biome elevation generated', LOG_CATEGORY.SYSTEM, {
      biomeKey,
      seed,
    });
  }

  /**
   * @param {number} seed
   */
  setBiomeSeed(seed) {
    this._biomeSeed = seed >>> 0;
  }

  setRichShadingEnabled(enabled) {
    this._richShadingEnabled = !!enabled;
    this._emitAllTiles();
  }

  setTreeDensityMultiplier(value) {
    this._treeDensityMultiplier = Math.max(0, Number.isFinite(value) ? value : 1);
  }

  setElevationScale(pixelsPerLevel) {
    this._elevationScale = pixelsPerLevel;
    TerrainHeightUtils.setElevationUnit(pixelsPerLevel);
    this._emitAllTiles();
  }

  // ── Public API — Placeables ───────────────────────────────────────────────

  getSelectedPlaceable() {
    return this._selectedPlaceable;
  }

  setSelectedPlaceable(id) {
    if (this._placeableRemovalMode) return false;
    if (id === null || id === undefined || id === '') {
      this._selectedPlaceable = null;
      return true;
    }
    if (typeof id === 'string') {
      this._selectedPlaceable = id;
      this._placeableRemovalMode = false;
      return true;
    }
    return false;
  }

  isPlaceablesPanelVisible() {
    return !!this._placeablesPanelVisible;
  }

  setPlaceablesPanelVisible(visible) {
    this._placeablesPanelVisible = !!visible;
    if (!this._placeablesPanelVisible) {
      this._selectedPlaceable = null;
    }
  }

  setPlaceableRemovalMode(enabled) {
    this._placeableRemovalMode = !!enabled;
    if (this._placeableRemovalMode) {
      this._selectedPlaceable = null;
    }
  }

  isPlaceableRemovalMode() {
    return !!this._placeableRemovalMode;
  }

  /**
   * Signal that a placeable was added or removed at a cell.
   * Rendering adapters listen to this to update their mesh pools.
   * @param {number} gridX
   * @param {number} gridY
   * @param {string|null} placeableId - null means removed
   * @param {string} [variant]
   */
  emitPlaceableChanged(gridX, gridY, placeableId, variant = null) {
    this._emit('placeableChanged', { gridX, gridY, placeableId, variant });
  }

  // ── Public API — Persistence ──────────────────────────────────────────────

  /**
   * Serialize current terrain state for save/load.
   * @returns {{ heights: number[][], biomeKey: string|null, biomeSeed: number }}
   */
  save() {
    return {
      heights: this._dataStore.base.map((row) => [...row]),
      biomeKey: this._biomeKey,
      biomeSeed: this._biomeSeed,
    };
  }

  /**
   * Restore terrain state from a previously saved snapshot.
   * @param {{ heights: number[][], biomeKey?: string, biomeSeed?: number }} state
   */
  load(state) {
    if (!state?.heights) return;
    const rows = state.heights.length;
    const cols = state.heights[0]?.length ?? 0;
    if (!rows || !cols) return;

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        this._dataStore.set(x, y, state.heights[y][x]);
      }
    }
    this._dataStore.applyWorkingToBase();

    if (state.biomeKey) this._biomeKey = state.biomeKey;
    if (state.biomeSeed !== undefined) this._biomeSeed = state.biomeSeed;

    this._emitAllTiles();
  }

  // ── Event Subscription ────────────────────────────────────────────────────

  /**
   * Fired when a tile's visual data changes (height, biome, effects).
   * Payload: { gridX, gridY, tileData }
   * tileData: { height, biomeKey, elevationScale }
   */
  onTileChanged(callback) {
    return this._subscribe('tileChanged', callback);
  }

  /**
   * Fired when a cell's height value changes.
   * Payload: { gridX, gridY, height }
   */
  onHeightChanged(callback) {
    return this._subscribe('heightChanged', callback);
  }

  /**
   * Fired when the brush hover position changes (no mutation).
   * Payload: { gridX, gridY, cells: Array<{x,y}> }
   */
  onBrushMoved(callback) {
    return this._subscribe('brushMoved', callback);
  }

  /**
   * Fired when a brush stroke is committed to the base height array.
   * Payload: { affectedCells: Array<{x, y, height}> }
   */
  onBrushCommitted(callback) {
    return this._subscribe('brushCommitted', callback);
  }

  /**
   * Fired when terrain mode activates or deactivates.
   * Payload: { active: boolean }
   */
  onActivationChanged(callback) {
    return this._subscribe('activationChanged', callback);
  }

  /**
   * Fired when a placeable is placed or removed.
   * Payload: { gridX, gridY, placeableId: string|null, variant: string|null }
   */
  onPlaceableChanged(callback) {
    return this._subscribe('placeableChanged', callback);
  }

  /**
   * Fired when the active biome changes.
   * Payload: { biomeKey, biomeSeed }
   */
  onBiomeChanged(callback) {
    return this._subscribe('biomeChanged', callback);
  }

  /**
   * Fired when the grid is resized.
   * Payload: { cols, rows }
   */
  onResized(callback) {
    return this._subscribe('resized', callback);
  }

  // ── Accessors ─────────────────────────────────────────────────────────────

  get cols() {
    return this._dataStore.cols;
  }
  get rows() {
    return this._dataStore.rows;
  }
  get isActive() {
    return this._isActive;
  }
  get biomeKey() {
    return this._biomeKey;
  }
  get biomeSeed() {
    return this._biomeSeed;
  }
  get elevationScale() {
    return this._elevationScale;
  }
  get tool() {
    return this._brush.tool;
  }
  get brushSize() {
    return this._brush.brushSize;
  }
  get treeDensityMultiplier() {
    return this._treeDensityMultiplier;
  }

  // ── Private Helpers ───────────────────────────────────────────────────────

  /**
   * Subscribe to a named event. Returns an unsubscribe function.
   * @param {string} event
   * @param {Function} callback
   * @returns {Function} unsubscribe
   */
  _subscribe(event, callback) {
    if (!this._listeners[event]) {
      logger.log(LOG_LEVEL.WARN, `TerrainEngine: unknown event "${event}"`, LOG_CATEGORY.SYSTEM);
      return () => {};
    }
    this._listeners[event].push(callback);
    return () => {
      this._listeners[event] = this._listeners[event].filter((cb) => cb !== callback);
    };
  }

  /**
   * @param {string} event
   * @param {object} payload
   */
  _emit(event, payload) {
    const subs = this._listeners[event];
    if (!subs?.length) return;
    for (const cb of subs) {
      try {
        cb(payload);
      } catch (err) {
        logger.log(
          LOG_LEVEL.ERROR,
          `TerrainEngine: listener error on "${event}"`,
          LOG_CATEGORY.SYSTEM,
          { err }
        );
      }
    }
  }

  /**
   * Emit a tileChanged event for a single cell with its current data.
   * @param {number} gridX
   * @param {number} gridY
   */
  _emitTile(gridX, gridY) {
    this._emit('tileChanged', {
      gridX,
      gridY,
      tileData: this._buildTileData(gridX, gridY),
    });
  }

  /**
   * Emit tileChanged for every cell in the grid. Used after bulk operations.
   */
  _emitAllTiles() {
    const { cols, rows } = this._dataStore;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        this._emitTile(x, y);
      }
    }
  }

  /**
   * Build the tileData payload for a given cell.
   * @param {number} gridX
   * @param {number} gridY
   * @returns {{ height: number, biomeKey: string|null, elevationScale: number }}
   */
  _buildTileData(gridX, gridY) {
    const height = this._dataStore.get(gridX, gridY);
    const neighborHeights = {
      north: this._dataStore.get(gridX, gridY - 1),
      south: this._dataStore.get(gridX, gridY + 1),
      east: this._dataStore.get(gridX + 1, gridY),
      west: this._dataStore.get(gridX - 1, gridY),
    };
    return {
      height,
      biomeKey: this._biomeKey,
      elevationScale: this._elevationScale,
      richShading: this._richShadingEnabled,
      neighborHeights,
    };
  }

  /**
   * Commit the working height array to base and fire brushCommitted.
   */
  _commitPendingStroke() {
    if (!this._isDragging && this._lastModifiedCell === null) return;

    const { cols, rows } = this._dataStore;
    const affected = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const working = this._dataStore.get(x, y);
        const base = this._dataStore.base[y]?.[x];
        if (working !== base) {
          affected.push({ x, y, height: working });
        }
      }
    }

    this._dataStore.applyWorkingToBase();
    this._isDragging = false;
    this._lastModifiedCell = null;

    if (affected.length > 0) {
      this._emit('brushCommitted', { affectedCells: affected });
    }
  }
}
