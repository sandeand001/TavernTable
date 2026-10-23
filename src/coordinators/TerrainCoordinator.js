/**
 * TerrainCoordinator.js — Thin wiring layer (ADR-0001)
 *
 * Owns no terrain logic. Holds sub-controllers and delegates every public
 * call to an internal module. Its only structural job is to create the
 * collaborators in the constructor and expose the public API surface that
 * GameManager, UIController, SidebarController, and tests depend on.
 */

import { logger, LOG_CATEGORY } from '../utils/logger/Logger.js';
import { GameErrors } from '../utils/error/ErrorHandler.js';
import { TERRAIN_CONFIG } from '../config/terrain/TerrainConstants.js';
import { TerrainDataStore } from '../terrain/TerrainDataStore.js';
import { TerrainBrushController } from '../terrain/brush/TerrainBrushController.js';

import { TerrainInputHandlers } from './terrain-coordinator/TerrainInputHandlers.js';
import { ElevationScaleController } from './terrain-coordinator/ElevationScaleController.js';
import { ActivationHelpers } from './terrain-coordinator/ActivationHelpers.js';
import { BiomeShadingController } from './terrain-coordinator/BiomeShadingController.js';
import { TileLifecycleController } from './terrain-coordinator/TileLifecycleController.js';

import {
  validateTerrainSystemState as _validateSystemState,
  validateTerrainDataConsistency as _validateDataConsistency,
} from './terrain-coordinator/internals/validation.js';
import {
  validateApplicationRequirements as _validateApplyReqs,
  initializeBaseHeights as _initBaseHeights,
  processAllGridTiles as _processAllTiles,
  logCompletion as _logApplyComplete,
  handleApplicationError as _handleApplyError,
} from './terrain-coordinator/internals/activation/apply.js';
import {
  getGridCoordinatesFromEvent as _getCoordsFromEvent,
  modifyTerrainAtPosition as _modifyAtPos,
} from './terrain-coordinator/internals/brush/inputs.js';
import {
  setRichShadingEnabled as _setRichShadingEnabled,
  setBiomeSeed as _setBiomeSeed,
} from './terrain-coordinator/internals/rendering/biome.js';
import { getBiomeOrBaseColor as _getBiomeOrBaseColorInternal } from './terrain-coordinator/internals/rendering/color.js';
import { handleGridResize as _handleResize } from './terrain-coordinator/internals/spatial/resize.js';
import { getTerrainHeight as _getHeight } from './terrain-coordinator/internals/spatial/height.js';
import { isValidGridPosition as _isValidPos } from './terrain-coordinator/internals/spatial/coords.js';
import { modifyTerrainHeightAtCell as _modifyAtCell } from './terrain-coordinator/internals/brush/brush.js';
import {
  setTerrainTool as _setTool,
  getBrushSize as _getBrushSize,
  setBrushSize as _setBrushSize,
  increaseBrushSize as _incBrush,
  decreaseBrushSize as _decBrush,
} from './terrain-coordinator/internals/brush/tools.js';
import {
  updateBaseGridTileInPlace as _updateBaseGridTileInPlace,
  replaceBaseGridTile as _replaceBaseGridTile,
} from './terrain-coordinator/internals/rendering/baseGridUpdates.js';
import { resetTerrain as _resetTerrain } from './terrain-coordinator/internals/activation/reset.js';
import { loadBaseTerrainIntoWorkingState as _loadBaseIntoWorking } from './terrain-coordinator/internals/activation/state.js';
import { validateDependencies as _validateDeps } from './terrain-coordinator/internals/deps.js';
import { initializeTerrainData as _initTerrainData } from './terrain-coordinator/internals/activation/init.js';
import {
  clearAllBiomeFlora as _clearAllBiomeFlora,
  logPlaceableInstancingState as _logPlaceableInstancingState,
  generateBiomeElevationIfFlat as _generateBiomeElevationIfFlat,
  generateBiomeElevation as _generateBiomeElevation,
} from './terrain-coordinator/internals/activation/generation.js';
import {
  applyTerrainModeGridTint as _applyGridTint,
  restoreTerrainModeGridTint as _restoreGridTint,
} from './terrain-coordinator/internals/rendering/gridTint.js';
import {
  getSelectedPlaceable as _getSelectedPlaceable,
  setSelectedPlaceable as _setSelectedPlaceable,
  isPlaceablesPanelVisible as _isPlaceablesPanelVisible,
  setPlaceablesPanelVisible as _setPlaceablesPanelVisible,
  setPlaceableRemovalMode as _setPlaceableRemovalMode,
  isPlaceableRemovalMode as _isPlaceableRemovalMode,
} from './terrain-coordinator/internals/placeableUI.js';
import {
  getTreeDensityMultiplier as _getTreeDensity,
  setTreeDensityMultiplier as _setTreeDensity,
} from './terrain-coordinator/internals/treeDensity.js';

export class TerrainCoordinator {
  // ── Constructor ─────────────────────────────────────────────

  constructor(gameManager, _terrainManager = null, biomeShadingController = null, domPorts = {}) {
    this.gameManager = gameManager;
    this.terrainManager = null;
    this.biomeShadingController = biomeShadingController;

    // DOM accessors injected to avoid layering violations in submodules.
    this.domPorts = {
      getTerrainHeightDisplay:
        domPorts.getTerrainHeightDisplay ||
        (() =>
          typeof document !== 'undefined'
            ? document.getElementById('terrain-height-display')
            : null),
      getScaleMarks:
        domPorts.getScaleMarks ||
        (() => (typeof document !== 'undefined' ? document.querySelectorAll('.scale-mark') : [])),
      getGameContainer:
        domPorts.getGameContainer ||
        (() =>
          typeof document !== 'undefined' ? document.getElementById('game-container') : null),
    };

    _validateDeps(this);

    // Core terrain data & brush
    this.isTerrainModeActive = false;
    this.dataStore = new TerrainDataStore(this.gameManager.cols, this.gameManager.rows);
    this.brush = new TerrainBrushController(this.dataStore);

    // Sub-controllers
    this._inputHandlers = new TerrainInputHandlers(this);
    this._elevationScaleController = new ElevationScaleController(this);
    this._activationHelpers = new ActivationHelpers(this);
    this._tileLifecycle = new TileLifecycleController(this);
    this._biomeShading = new BiomeShadingController(this);

    // Runtime state
    this.isDragging = false;
    this.lastModifiedCell = null;
    this._gridTintApplied = false;
    this._elevationScale = TERRAIN_CONFIG.ELEVATION_SHADOW_OFFSET;
    this._biomeCanvas = null;
    this._biomeSeed =
      typeof window !== 'undefined' && Number.isFinite(window.richShadingSettings?.seed)
        ? window.richShadingSettings.seed >>> 0
        : Math.floor(Math.random() * 1e9) >>> 0;
    this._treeDensityMultiplier =
      typeof window !== 'undefined' && Number.isFinite(window.treeDensityMultiplier)
        ? Math.max(0, window.treeDensityMultiplier)
        : 1;
    if (typeof window !== 'undefined') {
      window.treeDensityMultiplier = this._treeDensityMultiplier;
    }
    this._selectedPlaceable = null;
    this._placeablesPanelVisible = false;
    this._ptBrushSize = this.brush?.brushSize || 1;
    this._placeableRemovalMode = false;

    logger.debug(
      'TerrainCoordinator initialized',
      {
        context: 'TerrainCoordinator.constructor',
        defaultTool: this.brush.tool,
        defaultBrushSize: this.brush.brushSize,
      },
      LOG_CATEGORY.SYSTEM
    );
  }

  // ── Lifecycle ───────────────────────────────────────────────

  async initialize() {
    _initTerrainData(this);
    this._setupInputHandlers();
  }

  initializeTerrainData() {
    return _initTerrainData(this);
  }
  validateDependencies() {
    return _validateDeps(this);
  }
  validateTerrainSystemState() {
    return _validateSystemState(this);
  }
  validateTerrainDataConsistency() {
    return _validateDataConsistency(this);
  }

  _setupInputHandlers() {
    try {
      this._inputHandlers.setup();
    } catch (error) {
      GameErrors.initialization(error, { stage: 'setupTerrainInputHandlers' });
      throw error;
    }
  }

  // ── Placeable UI State ──────────────────────────────────────

  getSelectedPlaceable() {
    return _getSelectedPlaceable(this);
  }
  setSelectedPlaceable(id) {
    return _setSelectedPlaceable(this, id);
  }
  isPlaceablesPanelVisible() {
    return _isPlaceablesPanelVisible(this);
  }
  setPlaceablesPanelVisible(v) {
    return _setPlaceablesPanelVisible(this, v);
  }
  setPlaceableRemovalMode(e) {
    return _setPlaceableRemovalMode(this, e);
  }
  isPlaceableRemovalMode() {
    return _isPlaceableRemovalMode(this);
  }

  // ── Terrain Mode ────────────────────────────────────────────

  enableTerrainMode() {
    return this._activationHelpers.enableTerrainMode();
  }
  disableTerrainMode() {
    return this._activationHelpers.disableTerrainMode();
  }
  applyTerrainModeGridTint() {
    _applyGridTint(this);
  }
  restoreTerrainModeGridTint() {
    _restoreGridTint(this);
  }

  loadBaseTerrainIntoWorkingState() {
    return _loadBaseIntoWorking(this);
  }

  applyTerrainToBaseGrid() {
    try {
      _validateApplyReqs(this);
      _initBaseHeights(this);
      const modified = _processAllTiles(this);
      _logApplyComplete(this, modified);
      return modified;
    } catch (error) {
      _handleApplyError(error);
    }
  }

  // ── Brush & Tools ───────────────────────────────────────────

  setTerrainTool(tool) {
    return _setTool(this, tool);
  }
  get brushSize() {
    return _getBrushSize(this);
  }
  set brushSize(v) {
    _setBrushSize(this, v);
  }
  increaseBrushSize() {
    return _incBrush(this);
  }
  decreaseBrushSize() {
    return _decBrush(this);
  }

  get ptBrushSize() {
    return this._ptBrushSize;
  }
  set ptBrushSize(value) {
    try {
      const min = TERRAIN_CONFIG.MIN_BRUSH_SIZE || 1;
      const max = TERRAIN_CONFIG.MAX_BRUSH_SIZE || 5;
      const n = Math.trunc(Number(value));
      if (Number.isFinite(n)) this._ptBrushSize = Math.max(min, Math.min(max, n));
    } catch (_) {
      /* leave as-is */
    }
  }

  // ── Terrain Data ────────────────────────────────────────────

  getTerrainHeight(gx, gy) {
    return _getHeight(this, gx, gy);
  }
  resetTerrain() {
    return _resetTerrain(this);
  }

  modifyTerrainAtPosition(gx, gy) {
    return _modifyAtPos(this, gx, gy) || false;
  }

  modifyTerrainHeightAtCell(gx, gy) {
    const changed = _modifyAtCell(this, gx, gy);
    if (changed && typeof this.gameManager?.notifyTerrainHeightsChanged === 'function') {
      this.gameManager.notifyTerrainHeightsChanged();
    }
    return changed;
  }

  isValidGridPosition(gx, gy) {
    return _isValidPos(this, gx, gy);
  }

  handleGridResize(newCols, newRows) {
    const result = _handleResize(this, newCols, newRows);
    try {
      this.gameManager?.notifyTerrainHeightsChanged?.();
    } catch (_) {
      /* ignore */
    }
    return result;
  }

  // ── Elevation Scale ─────────────────────────────────────────

  getElevationScale() {
    return this._elevationScale;
  }
  setElevationScale(unit, opts = {}) {
    return this._elevationScaleController.apply(unit, opts);
  }

  // ── Tree Density ────────────────────────────────────────────

  getTreeDensityMultiplier() {
    return _getTreeDensity(this);
  }
  setTreeDensityMultiplier(m) {
    return _setTreeDensity(this, m);
  }

  // ── Rendering & Biome ───────────────────────────────────────

  getGridCoordinatesFromEvent(e) {
    return _getCoordsFromEvent(this, e);
  }
  setRichShadingEnabled(e) {
    return _setRichShadingEnabled(this, e);
  }
  setBiomeSeed(seed) {
    return _setBiomeSeed(this, seed);
  }
  applyBiomePaletteToBaseGrid() {
    return this._biomeShading.applyToBaseGrid();
  }
  _getBiomeOrBaseColor(h) {
    return _getBiomeOrBaseColorInternal(this, h);
  }
  getColorForHeight(h) {
    return this._getBiomeOrBaseColor(h);
  }
  _toggleBaseTileVisibility(s) {
    return this._biomeShading.toggleBaseTileVisibility(s);
  }
  updateBaseGridTileInPlace(x, y, h) {
    return _updateBaseGridTileInPlace(this, x, y, h);
  }
  replaceBaseGridTile(x, y, h) {
    return _replaceBaseGridTile(this, x, y, h);
  }
  addVisualElevationEffect() {
    /* no-op: 3D scene adapter handles elevation visuals */
  }

  // ── Biome Generation ────────────────────────────────────────

  generateBiomeElevationIfFlat(key, opts = {}) {
    return _generateBiomeElevationIfFlat(this, key, opts);
  }
  generateBiomeElevation(key, opts = {}) {
    return _generateBiomeElevation(this, key, opts);
  }

  // ── Input Event Handlers ────────────────────────────────────

  handleTerrainMouseUp(e) {
    if (this.gameManager?.getViewMode?.() === 'topdown') return false;
    return this._inputHandlers.handleMouseUp(e);
  }
  handleTerrainMouseLeave() {
    if (this.gameManager?.getViewMode?.() === 'topdown') return false;
    return this._inputHandlers.handleMouseLeave();
  }
  handleTerrainKeyDown(e) {
    if (this.gameManager?.getViewMode?.() === 'topdown') return false;
    return this._inputHandlers.handleKeyDown(e);
  }
  updateHeightIndicator(gx, gy) {
    return this._inputHandlers.updateHeightIndicator(gx, gy);
  }
  resetHeightIndicator() {
    return this._inputHandlers.resetHeightIndicator();
  }

  // ── Private Helpers (delegated) ─────────────────────────────

  _clearAllBiomeFlora() {
    _clearAllBiomeFlora(this);
  }
  _logPlaceableInstancingState(stage = 'unknown') {
    _logPlaceableInstancingState(this, stage);
  }

  // Legacy alias kept for callers (TerrainInputHandlers)
  setupTerrainInputHandlers() {
    return this._setupInputHandlers();
  }
}
