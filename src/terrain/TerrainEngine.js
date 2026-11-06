import { logger, LOG_LEVEL, LOG_CATEGORY } from '../utils/logger/Logger.js';
import { TERRAIN_CONFIG } from '../config/terrain/TerrainConstants.js';
import { TerrainDataStore } from './TerrainDataStore.js';
import { TerrainBrushController } from './brush/TerrainBrushController.js';
import { computeBrushFootprint, normalizeBrushSize } from './brush/BrushCommon.js';
import {
  generateBiomeElevationField,
  getBiomeElevationScaleHint,
  isAllDefaultHeight,
} from './generation/BiomeElevationGenerator.js';
import { TerrainHeightUtils } from '../utils/terrain/TerrainHeightUtils.js';
import { TerrainGeometry } from './TerrainGeometry.js';
import { createStructure, structureVolumes } from './ConstructionBlueprints.js';
import { generateBiomeStructures } from './generation/BiomeStructures.js';
import { buildingForHeight } from './BuildingModel.js';

function validateDimensions(cols, rows) {
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) {
    throw new RangeError('Terrain dimensions must be positive integers');
  }
}

function validateHeights(heights) {
  if (!Array.isArray(heights) || !heights.length || !Array.isArray(heights[0])) {
    throw new TypeError('Terrain heights must be a non-empty rectangular array');
  }
  const rows = heights.length;
  const cols = heights[0].length;
  validateDimensions(cols, rows);
  if (
    heights.some(
      (row) =>
        !Array.isArray(row) ||
        row.length !== cols ||
        row.some(
          (height) =>
            !Number.isFinite(height) ||
            height < TERRAIN_CONFIG.MIN_HEIGHT ||
            height > TERRAIN_CONFIG.MAX_HEIGHT
        )
    )
  ) {
    throw new RangeError('Terrain heights must be rectangular and within the supported range');
  }
  return { cols, rows };
}

function validateSeed(seed) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new RangeError('The biome seed must be an unsigned 32-bit integer');
  }
}

function validateBiome(biomeKey) {
  if (biomeKey !== null && (typeof biomeKey !== 'string' || !biomeKey.trim())) {
    throw new TypeError('The biome must be a non-empty key or null');
  }
}

function validateScale(scale) {
  if (!Number.isFinite(scale) || scale < 0) {
    throw new RangeError('Elevation scale must be a finite non-negative number');
  }
}

function validateDensity(density) {
  if (!Number.isFinite(density) || density < 0) {
    throw new RangeError('Tree density must be a finite non-negative number');
  }
}

export class TerrainEngine {
  constructor(cols, rows, baseHeights = null) {
    validateDimensions(cols, rows);
    if (baseHeights !== null) {
      const dimensions = validateHeights(baseHeights);
      if (dimensions.cols !== cols || dimensions.rows !== rows) {
        throw new Error('Initial terrain heights do not match the grid dimensions');
      }
    }
    this._dataStore = new TerrainDataStore(cols, rows);
    if (baseHeights !== null) this._dataStore.restoreHeights(baseHeights);
    this._brush = new TerrainBrushController(this._dataStore);
    this._isActive = false;
    this._stroke = null;
    this._constructionTool = null;
    this._hover = null;
    this._undo = [];
    this._redo = [];
    this._isGenerating = false;
    this._biomeKey = null;
    this._structureGenerationEnabled = true;
    const settings = typeof window !== 'undefined' ? window.richShadingSettings : null;
    this._biomeSeed = Number.isInteger(settings?.seed)
      ? settings.seed >>> 0
      : Math.floor(Math.random() * 0x100000000) >>> 0;
    this._elevationScale = TERRAIN_CONFIG.ELEVATION_SHADOW_OFFSET;
    this._richShadingEnabled = !!settings?.enabled;
    const density = typeof window !== 'undefined' ? window.treeDensityMultiplier : null;
    this._treeDensityMultiplier = Number.isFinite(density) && density >= 0 ? density : 1;
    this._selectedPlaceable = null;
    this._placeablesPanelVisible = false;
    this._placeableRemovalMode = false;
    this._ptBrushSize = this._brush.brushSize;
    this._feetPerLevel = 2.5;
    this._geometry = this._createGeometry(cols, rows);
    this._visibleLayers = null;
    this._geometryValidators = new Set();
    this._geometryParticipant = null;
    this._geometryReceipts = new WeakMap();
    this._listeners = Object.fromEntries(
      [
        'tileChanged',
        'heightChanged',
        'brushMoved',
        'brushCommitted',
        'activationChanged',
        'placeableChanged',
        'biomeChanged',
        'biomeGenerated',
        'resized',
        'scaleChanged',
        'changed',
        'editorChanged',
      ].map((event) => [event, new Set()])
    );
  }

  activate() {
    if (this._isActive) return;
    this._isActive = true;
    this._emit('activationChanged', { active: true });
    this.refreshAppearance();
  }

  deactivate() {
    this.cancelBrushStroke();
    this.setConstructionTool(null);
    if (!this._isActive) return;
    this._isActive = false;
    this._emit('activationChanged', { active: false });
    this.refreshAppearance();
  }

  resize(cols, rows) {
    validateDimensions(cols, rows);
    this.cancelBrushStroke();
    if (cols === this.cols && rows === this.rows) return false;
    const geometry = this._createGeometry(cols, rows);
    const volumes = this.geometry
      .save()
      .volumes.map((volume) => ({
        ...volume,
        bounds: {
          min: { ...volume.bounds.min },
          max: {
            ...volume.bounds.max,
            x: Math.min(cols * 5, volume.bounds.max.x),
            z: Math.min(rows * 5, volume.bounds.max.z),
          },
        },
      }))
      .filter(({ bounds }) => bounds.min.x < bounds.max.x && bounds.min.z < bounds.max.z);
    const remaining = new Set(
      volumes
        .filter((volume) => volume.operation === 'add')
        .map((volume) => volume.structureId)
        .filter(Boolean)
    );
    const structures = this.geometry.getStructures().filter((spec) => remaining.has(spec.id));
    geometry.load({
      version: 3,
      volumes: volumes.filter((volume) => !volume.structureId || remaining.has(volume.structureId)),
      structures,
    });
    this._dataStore.resize(cols, rows);
    this._geometry = geometry;
    this._visibleLayers = null;
    this._clearHistory();
    this._emit('resized', { cols, rows });
    this._emitAllTiles();
    this._changed('resize');
    return true;
  }

  reset() {
    this.cancelBrushStroke();
    const changes = [];
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const before = this.getHeightAt(x, y);
        if (before !== TERRAIN_CONFIG.DEFAULT_HEIGHT) {
          changes.push({ x, y, before, after: TERRAIN_CONFIG.DEFAULT_HEIGHT });
        }
      }
    }
    if (!changes.length) {
      this._emitAllTiles();
      return false;
    }
    return this._commitChanges(changes, 'Reset terrain', { allTiles: true });
  }

  isValidGridPosition(x, y) {
    return (
      Number.isInteger(x) &&
      Number.isInteger(y) &&
      x >= 0 &&
      y >= 0 &&
      x < this.cols &&
      y < this.rows
    );
  }

  getHeightAt(x, y) {
    return this._dataStore.get(x, y);
  }

  setHeightAt(x, y, height) {
    this._validatePosition(x, y);
    if (!Number.isFinite(height)) throw new TypeError('Terrain height must be finite');
    if (this._stroke) throw new Error('Finish or cancel the terrain preview before editing');
    const after = TerrainHeightUtils.clampHeight(height);
    const before = this.getHeightAt(x, y);
    if (after === before) return false;
    return this._commitChanges([{ x, y, before, after }], 'Set terrain height');
  }

  setTool(tool) {
    if (!['raise', 'lower', 'wall'].includes(tool)) {
      throw new RangeError(`Unknown terrain tool: ${tool}`);
    }
    this.setConstructionTool(null);
    if (this.tool === tool) return;
    this._changeBrush(() => this._brush.setTool(tool));
  }

  get constructionTool() {
    return this._constructionTool;
  }

  setConstructionTool(tool) {
    if (
      tool !== null &&
      tool !== 'select' &&
      !['wall', 'turret', 'dome', 'building', 'cave', 'cellar', 'tunnel'].includes(tool)
    )
      throw new Error('Choose a supported construction tool');
    if (this._constructionTool === tool) return;
    this.cancelBrushStroke();
    this._constructionTool = tool;
    if (tool) {
      this._selectedPlaceable = null;
      this._placeableRemovalMode = false;
    }
    this._editorChanged();
  }

  setBrushSize(size) {
    const normalized = normalizeBrushSize(size);
    if (this.brushSize === normalized) return;
    this._changeBrush(() => {
      this._brush.brushSize = normalized;
    });
  }

  increaseBrush() {
    this.setBrushSize(this.brushSize + 1);
  }

  decreaseBrush() {
    this.setBrushSize(this.brushSize - 1);
  }

  setWallTopLevel(level) {
    if (
      !Number.isInteger(level) ||
      level < TERRAIN_CONFIG.MIN_HEIGHT ||
      level > TERRAIN_CONFIG.MAX_HEIGHT
    ) {
      throw new RangeError('Wall top level must be an integer within the terrain range');
    }
    if (this.wallTopLevel === level) return;
    this._brush.setWallTopLevel(level);
    this._refreshWallPreview();
  }

  setWallFillMode(mode) {
    if (!['filled', 'outline'].includes(mode)) {
      throw new RangeError('Wall box style must be Filled or Outline');
    }
    if (this.wallFillMode === mode) return;
    this._brush.setWallFillMode(mode);
    this._refreshWallPreview();
  }

  getBrushFootprint(x, y) {
    return this._brush.getFootprintCells(x, y);
  }

  getPlaceableBrushFootprint(x, y) {
    return computeBrushFootprint(x, y, this._ptBrushSize, {
      cols: this.cols,
      rows: this.rows,
    });
  }

  setPlaceableBrushSize(size) {
    this._ptBrushSize = normalizeBrushSize(size);
    this._editorChanged();
    this._refreshPreview();
  }

  beginBrushStroke(x, y) {
    this._validatePosition(x, y);
    this.cancelBrushStroke();
    this._stroke = { changes: new Map(), lastCell: null };
    if (this.tool === 'wall') this._brush.beginWallStroke(x, y);
    return this.updateBrushStroke(x, y);
  }

  updateBrushStroke(x, y) {
    this._validatePosition(x, y);
    if (!this._stroke) throw new Error('A terrain preview must begin before it can be updated');
    const key = `${x},${y}`;
    if (this._stroke.lastCell === key) return false;
    if (this.tool === 'wall') this._stroke.changes.clear();
    let changed = false;
    for (const cell of this.getBrushFootprint(x, y)) {
      const cellKey = `${cell.x},${cell.y}`;
      const previous = this._stroke.changes.get(cellKey);
      const before = previous?.before ?? this.getHeightAt(cell.x, cell.y);
      const current = previous?.after ?? before;
      const after = this._brush.getPreviewHeight(cell.x, cell.y, current);
      this._stroke.changes.set(cellKey, { ...cell, before, after });
      changed ||= after !== current;
    }
    this._stroke.lastCell = key;
    this._hover = { x, y };
    this._editorChanged();
    this._refreshPreview();
    return changed;
  }

  applyBrushAt(x, y) {
    if (this._stroke) return this.updateBrushStroke(x, y);
    this.beginBrushStroke(x, y);
    return this.commitBrushStroke();
  }

  commitBrushStroke() {
    if (!this._stroke) return false;
    const changes = [...this._stroke.changes.values()].filter((cell) => cell.before !== cell.after);
    this._stroke = null;
    this._brush.cancelWallStroke();
    if (!changes.length) {
      this._editorChanged();
      this._refreshPreview();
      return false;
    }
    const label = { raise: 'Raise terrain', lower: 'Lower terrain', wall: 'Draw terrain wall' }[
      this.tool
    ];
    this._commitChanges(changes, label);
    this._emit('brushCommitted', {
      affectedCells: changes.map(({ x, y, after }) => ({ x, y, height: after })),
    });
    return true;
  }

  cancelBrushStroke() {
    const pending = !!this._stroke;
    this._stroke = null;
    this._brush.cancelWallStroke();
    this.clearBrushPreview();
    if (pending) this._editorChanged();
    return pending;
  }

  moveBrushTo(x, y) {
    this._validatePosition(x, y);
    this._hover = { x, y };
    this._refreshPreview();
  }

  clearBrushPreview() {
    this._hover = null;
    this._emit('brushMoved', { cells: [] });
  }

  undo() {
    if (this._stroke) return this.cancelBrushStroke();
    const edit = this._undo.at(-1);
    if (!edit) return false;
    const geometry =
      edit.geometry && this._validatedGeometry(edit.geometry.before, edit.context?.before);
    if (geometry) this._applyValidatedGeometry(geometry);
    this._undo.pop();
    this._redo.push(edit);
    if (edit.geometry) {
      this._changed('geometry');
      return true;
    }
    const changes = edit.changes.map(({ x, y, before, after }) => ({
      x,
      y,
      before: after,
      after: before,
    }));
    return this._commitChanges(changes, edit.label, { history: false, kind: 'undo' });
  }

  redo() {
    if (this._stroke) return false;
    const edit = this._redo.at(-1);
    if (!edit) return false;
    const geometry =
      edit.geometry && this._validatedGeometry(edit.geometry.after, edit.context?.after);
    if (geometry) this._applyValidatedGeometry(geometry);
    this._redo.pop();
    this._undo.push(edit);
    if (edit.geometry) {
      this._changed('geometry');
      return true;
    }
    return this._commitChanges(edit.changes, edit.label, { history: false, kind: 'redo' });
  }

  setBiome(biomeKey, options = {}) {
    validateBiome(biomeKey);
    const seed = options.seed ?? this._biomeSeed;
    validateSeed(seed);
    if (
      options.generateIfFlat !== false &&
      !this.isActive &&
      isAllDefaultHeight(this._dataStore.working) &&
      biomeKey !== null
    ) {
      return this.generateBiomeElevation(biomeKey, { ...options, seed });
    }
    this._biomeKey = biomeKey;
    this._biomeSeed = seed;
    this._emit('biomeChanged', { biomeKey, biomeSeed: seed });
    this.refreshAppearance();
    return true;
  }

  generateBiomeElevationIfFlat(biomeKey, options = {}) {
    if (this.isActive || this.isGenerating || !isAllDefaultHeight(this._dataStore.working)) {
      return false;
    }
    return this.generateBiomeElevation(biomeKey, options);
  }

  generateBiomeElevation(biomeKey, options = {}) {
    if (this.isActive || this.isGenerating) return false;
    validateBiome(biomeKey);
    if (biomeKey === null) throw new Error('Choose a biome before generating terrain');
    if (options.structures !== undefined && typeof options.structures !== 'boolean')
      throw new TypeError('Structure generation must be enabled or disabled');
    const seed = options.seed ?? this._biomeSeed;
    validateSeed(seed);
    this._isGenerating = true;
    try {
      const heights = generateBiomeElevationField(biomeKey, this.rows, this.cols, {
        ...options,
        seed,
      });
      validateHeights(heights);
      const previous = this.save();
      const plan = generateBiomeStructures({
        biomeKey,
        seed,
        heights,
        previousHeights: previous.heights,
        geometry: this.geometry.save(),
        feetPerLevel: this._feetPerLevel,
        enabled:
          options.structures === undefined ? this._structureGenerationEnabled : options.structures,
      });
      this.cancelBrushStroke();
      try {
        this._dataStore.restoreHeights(plan.heights);
        this._biomeKey = biomeKey;
        this._biomeSeed = seed;
        const geometry = this._validatedGeometry(plan.geometry);
        this._applyValidatedGeometry(geometry);
      } catch (error) {
        this._dataStore.restoreHeights(previous.heights);
        this._biomeKey = previous.biomeKey;
        this._biomeSeed = previous.biomeSeed;
        this._geometry.invalidate();
        throw error;
      }
      this._biomeKey = biomeKey;
      this._biomeSeed = seed;
      this._clearHistory();
      const hint = getBiomeElevationScaleHint(biomeKey);
      if (!this.geometry.hasVolumes && Number.isFinite(hint) && hint !== this._elevationScale) {
        this._elevationScale = hint;
        TerrainHeightUtils.setElevationUnit(hint);
        this._emit('scaleChanged', { elevationScale: hint });
      }
      this._emit('biomeChanged', { biomeKey, biomeSeed: seed });
      this._emitAllTiles();
      this._emit('biomeGenerated', { biomeKey, biomeSeed: seed });
      this._changed('generation');
      return true;
    } finally {
      this._isGenerating = false;
      this._editorChanged();
    }
  }

  setBiomeSeed(seed) {
    validateSeed(seed);
    this._biomeSeed = seed;
    this._emit('biomeChanged', { biomeKey: this.biomeKey, biomeSeed: seed });
    this.refreshAppearance();
  }

  get structureGenerationEnabled() {
    return this._structureGenerationEnabled;
  }

  setStructureGeneration(enabled) {
    if (typeof enabled !== 'boolean')
      throw new TypeError('Structure generation must be enabled or disabled');
    this._structureGenerationEnabled = enabled;
    this._changed('generationSettings');
  }

  setRichShadingEnabled(enabled) {
    this._richShadingEnabled = !!enabled;
    this.refreshAppearance();
  }

  setTreeDensityMultiplier(value) {
    validateDensity(value);
    if (this._treeDensityMultiplier === value) return;
    this._treeDensityMultiplier = value;
    this._changed('treeDensity');
  }

  setElevationScale(scale) {
    validateScale(scale);
    if (this._elevationScale === scale) return;
    this.cancelBrushStroke();
    this._elevationScale = scale;
    TerrainHeightUtils.setElevationUnit(scale);
    this._emit('scaleChanged', { elevationScale: scale });
    this._emitAllTiles();
    this._changed('scale');
  }

  refreshAppearance() {
    this._emitAllTiles();
    this._changed('appearance');
  }

  getSelectedPlaceable() {
    return this._selectedPlaceable;
  }

  setSelectedPlaceable(id) {
    if (this._placeableRemovalMode) return false;
    if (id !== null && id !== undefined && id !== '' && typeof id !== 'string') {
      throw new TypeError('A selected placeable must be a key or null');
    }
    this.cancelBrushStroke();
    if (id) this._constructionTool = null;
    this._selectedPlaceable = id || null;
    this._editorChanged();
    return true;
  }

  isPlaceablesPanelVisible() {
    return this._placeablesPanelVisible;
  }

  setPlaceablesPanelVisible(visible) {
    this._placeablesPanelVisible = !!visible;
    if (!visible) this._selectedPlaceable = null;
    this.cancelBrushStroke();
    this._editorChanged();
  }

  setPlaceableRemovalMode(enabled) {
    this._placeableRemovalMode = !!enabled;
    if (enabled) this._selectedPlaceable = null;
    if (enabled) this._constructionTool = null;
    this.cancelBrushStroke();
    this._editorChanged();
  }

  isPlaceableRemovalMode() {
    return this._placeableRemovalMode;
  }

  emitPlaceableChanged(gridX, gridY, placeableId, variant = null) {
    this._validatePosition(gridX, gridY);
    this._emit('placeableChanged', { gridX, gridY, placeableId, variant });
  }

  configureGeometryScale(feetPerLevel) {
    if (!Number.isFinite(feetPerLevel) || feetPerLevel < 0) {
      throw new RangeError('Map geometry requires a finite non-negative terrain scale');
    }
    if (this._feetPerLevel !== feetPerLevel) {
      this._feetPerLevel = feetPerLevel;
      this.geometry.invalidate();
    }
  }

  configureGeometryBase(terrainThicknessFeet) {
    if (
      terrainThicknessFeet !== null &&
      (!Number.isFinite(terrainThicknessFeet) || terrainThicknessFeet <= 0)
    )
      throw new RangeError('A floor slab requires a positive finite thickness');
    this.geometry.terrainThicknessFeet = terrainThicknessFeet;
  }

  addVolume(volume, operation = 'add') {
    if (!['add', 'subtract'].includes(operation)) {
      throw new RangeError('Choose Add or Subtract for a volume edit');
    }
    return this.addVolumes([{ ...volume, operation }]);
  }

  addVolumes(volumes) {
    if (!Array.isArray(volumes) || volumes.length === 0) {
      throw new TypeError('At least one solid or cut volume is required');
    }
    this.cancelBrushStroke();
    const before = this.geometry.save();
    const after = { ...before, version: 3, volumes: [...before.volumes, ...volumes] };
    return this._commitGeometry(
      after,
      volumes.length > 1
        ? 'Add structure group'
        : volumes[0].operation === 'add'
          ? 'Add solid volume'
          : 'Carve volume'
    );
  }

  validateGeometryEdits(validate) {
    if (typeof validate !== 'function')
      throw new TypeError('Geometry validation requires a function');
    this._geometryValidators.add(validate);
    return () => this._geometryValidators.delete(validate);
  }

  participateInGeometryEdits(participant) {
    if (this._geometryParticipant)
      throw new Error('Geometry edits already have a world participant');
    if (typeof participant?.prepare !== 'function')
      throw new Error('Geometry edits require a prepare participant');
    this._geometryParticipant = participant;
    return () => {
      if (this._geometryParticipant === participant) this._geometryParticipant = null;
    };
  }

  _validatedGeometry(snapshot, context = null) {
    const geometry = this._createGeometry(this.cols, this.rows);
    geometry.load(snapshot);
    if (geometry.hasCurves) geometry.getSolidCells();
    for (const validate of this._geometryValidators) validate(geometry, snapshot);
    const receipt = this._geometryParticipant?.prepare(geometry, context);
    if (receipt) this._geometryReceipts.set(geometry, receipt);
    return geometry;
  }

  _applyValidatedGeometry(geometry) {
    const before = this._geometry,
      receipt = this._geometryReceipts.get(geometry);
    this._geometry = geometry;
    try {
      receipt?.apply();
    } catch (error) {
      this._geometry = before;
      receipt?.rollback();
      throw error;
    }
    return receipt;
  }

  _commitGeometry(after, label) {
    const before = this.geometry.save();
    const geometry = this._validatedGeometry(after);
    this.cancelBrushStroke();
    const receipt = this._applyValidatedGeometry(geometry);
    this._undo.push({
      label,
      geometry: { before, after },
      ...(receipt ? { context: { before: receipt.before, after: receipt.after } } : {}),
    });
    if (this._undo.length > TERRAIN_CONFIG.HISTORY_LIMIT) this._undo.shift();
    this._redo = [];
    this._changed('geometry');
    return true;
  }

  placeStructure(input) {
    const spec = createStructure(input);
    const before = this.geometry.save();
    if (this.geometry.getStructures().some((entry) => entry.id === spec.id))
      throw new Error('This structure ID is already on the map');
    return this._commitGeometry(
      {
        version: 3,
        structures: [...this.geometry.getStructures(), spec],
        volumes: [...before.volumes, ...structureVolumes(spec)],
      },
      `Build ${spec.kind}`
    );
  }

  resizeStructure(id, changes) {
    const structures = this.geometry.getStructures();
    const existing = structures.find((spec) => spec.id === id);
    if (!existing) throw new Error('Choose an editable structure on this map');
    if (
      Object.keys(changes).some(
        (key) =>
          ![
            'kind',
            'wallStairs',
            'wallStairVersion',
            'wallStairLayout',
            'wallStairDirection',
            'wallStairSide',
            'wallStairOffsetFeet',
            'wallStairExit',
            'heightFeet',
            'diameterFeet',
            'lengthFeet',
            'widthFeet',
            'style',
            'angleRadians',
            'opening',
            'openingWidthFeet',
            'openingHeightFeet',
            'openingShape',
            'ruined',
            'building',
            'xFeet',
            'zFeet',
            'name',
            'appearance',
          ].includes(key)
      )
    )
      throw new Error('Only structure dimensions, openings and appearance can be changed');
    if (
      changes.kind !== undefined &&
      changes.kind !== existing.kind &&
      (!['building', 'turret'].includes(existing.kind) ||
        !['building', 'turret'].includes(changes.kind))
    )
      throw new Error('Only a building or turret can change between rectangular and round bases');
    if (
      Object.entries(changes).every(([key, value]) =>
        value && typeof value === 'object'
          ? JSON.stringify(existing[key]) === JSON.stringify(value)
          : existing[key] === value
      )
    )
      return false;
    const adjusted = { ...existing, ...changes, source: 'manual' };
    if (adjusted.building && changes.heightFeet !== undefined)
      adjusted.building = buildingForHeight(adjusted.building, changes.heightFeet);
    const spec = createStructure(adjusted, { legacy: !adjusted.building });
    const before = this.geometry.save();
    const replacement = structureVolumes(spec);
    const first = before.volumes.findIndex((volume) => volume.structureId === id);
    const owned = new Set(
      before.volumes.filter((volume) => volume.structureId === id).map((volume) => volume.id)
    );
    // Keep interleaved CSG cuts in place so edits cannot seal neighbouring passages.
    const scattered = before.volumes
      .slice(first, first + owned.size)
      .some((volume) => volume.structureId !== id);
    const byId = new Map(replacement.map((volume) => [volume.id, volume]));
    const last = before.volumes.findLastIndex((volume) => volume.structureId === id);
    const volumes = [];
    for (let i = 0; i < before.volumes.length; i++) {
      const volume = before.volumes[i];
      if (!scattered && i === first) volumes.push(...replacement);
      if (volume.structureId !== id) volumes.push(volume);
      else if (scattered) {
        if (byId.has(volume.id)) volumes.push(byId.get(volume.id));
        if (i === last) volumes.push(...replacement.filter((entry) => !owned.has(entry.id)));
      }
    }
    return this._commitGeometry(
      {
        version: 3,
        structures: structures.map((entry) => (entry.id === id ? spec : entry)),
        volumes,
      },
      `Resize ${spec.kind}`
    );
  }

  removeStructure(id) {
    const before = this.geometry.save();
    const structures = this.geometry.getStructures();
    if (!structures.some((spec) => spec.id === id))
      throw new Error('Choose an editable structure on this map');
    return this._commitGeometry(
      {
        version: 3,
        structures: structures.filter((spec) => spec.id !== id),
        volumes: before.volumes.filter((volume) => volume.structureId !== id),
      },
      'Remove structure'
    );
  }

  setVisibleLayers(layers) {
    if (
      layers !== null &&
      (!Array.isArray(layers) || layers.some((layer) => typeof layer !== 'string' || !layer.trim()))
    ) {
      throw new TypeError('Visible layers must be named layers or null for all layers');
    }
    this._visibleLayers = layers === null ? null : [...new Set(layers)];
    this._changed('visibility');
  }

  save() {
    return {
      version: 1,
      heights: this._dataStore.base.map((row) => [...row]),
      biomeKey: this._biomeKey,
      biomeSeed: this._biomeSeed,
      elevationScale: this._elevationScale,
      treeDensityMultiplier: this._treeDensityMultiplier,
      richShadingEnabled: this._richShadingEnabled,
      ...(!this._structureGenerationEnabled ? { structureGenerationEnabled: false } : {}),
      ...(this.geometry.hasVolumes || Number.isFinite(this.geometry.terrainThicknessFeet)
        ? { geometry: this.geometry.save() }
        : {}),
    };
  }

  load(state) {
    if (!state || (state.version !== undefined && state.version !== 1)) {
      throw new Error('Unsupported terrain snapshot version');
    }
    const { cols, rows } = validateHeights(state.heights);
    const geometry = this._createGeometry(cols, rows);
    if (state.geometry !== undefined) geometry.load(state.geometry);
    const biomeKey = state.biomeKey ?? null;
    const biomeSeed = state.biomeSeed ?? this._biomeSeed;
    const elevationScale = state.elevationScale ?? TERRAIN_CONFIG.ELEVATION_SHADOW_OFFSET;
    const treeDensity = state.treeDensityMultiplier ?? 1;
    if (
      state.structureGenerationEnabled !== undefined &&
      typeof state.structureGenerationEnabled !== 'boolean'
    )
      throw new TypeError('Saved structure generation must be enabled or disabled');
    validateBiome(biomeKey);
    validateSeed(biomeSeed);
    validateScale(elevationScale);
    validateDensity(treeDensity);
    if (state.richShadingEnabled !== undefined && typeof state.richShadingEnabled !== 'boolean') {
      throw new TypeError('Saved terrain shading state must be a boolean');
    }
    this.cancelBrushStroke();
    this.setConstructionTool(null);
    const resized = cols !== this.cols || rows !== this.rows;
    if (resized) this._dataStore.resize(cols, rows);
    this._dataStore.restoreHeights(state.heights);
    this._geometry = geometry;
    this._visibleLayers = null;
    this._biomeKey = biomeKey;
    this._biomeSeed = biomeSeed;
    this._elevationScale = elevationScale;
    this._treeDensityMultiplier = treeDensity;
    this._structureGenerationEnabled = state.structureGenerationEnabled ?? true;
    this._richShadingEnabled = state.richShadingEnabled ?? false;
    this._clearHistory();
    if (resized) this._emit('resized', { cols, rows });
    this._emit('biomeChanged', { biomeKey, biomeSeed });
    TerrainHeightUtils.setElevationUnit(elevationScale);
    this._emit('scaleChanged', { elevationScale });
    this._emitAllTiles();
    this._changed('load');
  }

  getStatistics() {
    const heights = this._dataStore.working.flat();
    return {
      cols: this.cols,
      rows: this.rows,
      modifiedCells: heights.filter((height) => height !== TERRAIN_CONFIG.DEFAULT_HEIGHT).length,
      minHeight: Math.min(...heights),
      maxHeight: Math.max(...heights),
      tool: this.tool,
      brushSize: this.brushSize,
      active: this.isActive,
    };
  }

  onTileChanged(callback) {
    return this._subscribe('tileChanged', callback);
  }
  onHeightChanged(callback) {
    return this._subscribe('heightChanged', callback);
  }
  onBrushMoved(callback) {
    return this._subscribe('brushMoved', callback);
  }
  onBrushCommitted(callback) {
    return this._subscribe('brushCommitted', callback);
  }
  onActivationChanged(callback) {
    return this._subscribe('activationChanged', callback);
  }
  onPlaceableChanged(callback) {
    return this._subscribe('placeableChanged', callback);
  }
  onBiomeChanged(callback) {
    return this._subscribe('biomeChanged', callback);
  }
  onBiomeGenerated(callback) {
    return this._subscribe('biomeGenerated', callback);
  }
  onResized(callback) {
    return this._subscribe('resized', callback);
  }
  onScaleChanged(callback) {
    return this._subscribe('scaleChanged', callback);
  }
  onChanged(callback) {
    return this._subscribe('changed', callback);
  }
  onEditorChanged(callback) {
    return this._subscribe('editorChanged', callback);
  }

  get cols() {
    return this._dataStore.cols;
  }
  get geometry() {
    return this._geometry;
  }
  get visibleLayers() {
    return this._visibleLayers === null ? null : [...this._visibleLayers];
  }

  _createGeometry(cols, rows) {
    return new TerrainGeometry({
      widthFeet: cols * 5,
      depthFeet: rows * 5,
      terrainThicknessFeet: this._geometry?.terrainThicknessFeet ?? null,
      getTerrainHeightFeet: (x, z) =>
        this.getHeightAt(Math.floor(x / 5), Math.floor(z / 5)) * this._feetPerLevel,
    });
  }
  get rows() {
    return this._dataStore.rows;
  }
  get isActive() {
    return this._isActive;
  }
  get hasPendingStroke() {
    return this._stroke !== null;
  }
  get isGenerating() {
    return this._isGenerating;
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
  get wallTopLevel() {
    return this._brush.wallTopLevel;
  }
  get wallFillMode() {
    return this._brush.wallFillMode;
  }
  get ptBrushSize() {
    return this._ptBrushSize;
  }
  get treeDensityMultiplier() {
    return this._treeDensityMultiplier;
  }
  get canUndo() {
    return this.hasPendingStroke || this._undo.length > 0;
  }
  get canRedo() {
    return !this.hasPendingStroke && this._redo.length > 0;
  }
  get undoLabel() {
    return this.hasPendingStroke ? 'Cancel preview' : this._undo.at(-1)?.label;
  }
  get redoLabel() {
    return this._redo.at(-1)?.label;
  }

  _validatePosition(x, y) {
    if (!this.isValidGridPosition(x, y)) {
      throw new RangeError(`Terrain position (${x}, ${y}) is outside the grid`);
    }
  }

  _changeBrush(change) {
    const hover = this._hover;
    this.cancelBrushStroke();
    change();
    this._hover = hover;
    this._editorChanged();
    this._refreshPreview();
  }

  _refreshWallPreview() {
    if (this._stroke && this.tool === 'wall' && this._hover) {
      this._stroke.lastCell = null;
      this.updateBrushStroke(this._hover.x, this._hover.y);
    } else {
      this._editorChanged();
      this._refreshPreview();
    }
  }

  _commitChanges(changes, label, { history = true, allTiles = false, kind = 'edit' } = {}) {
    if (!changes.length) return false;
    for (const { x, y, after } of changes) this._dataStore.set(x, y, after);
    this._dataStore.applyWorkingToBase();
    this.geometry.invalidate();
    if (history) {
      this._undo.push({ label, changes });
      if (this._undo.length > TERRAIN_CONFIG.HISTORY_LIMIT) this._undo.shift();
      this._redo = [];
    }
    for (const { x, y, after } of changes) {
      this._emit('heightChanged', { gridX: x, gridY: y, height: after });
      if (!allTiles) this._emitTile(x, y);
    }
    if (allTiles) this._emitAllTiles();
    this._changed(kind, changes);
    this._refreshPreview();
    return true;
  }

  _clearHistory() {
    this._undo = [];
    this._redo = [];
  }

  _refreshPreview() {
    if (!this._hover) return;
    const { x, y } = this._hover;
    const placeable =
      this._placeableRemovalMode || (this._selectedPlaceable && this._placeablesPanelVisible);
    const cells = this._stroke
      ? [...this._stroke.changes.values()].map(({ x, y, before, after }) => ({
          x,
          y,
          currentHeight: before,
          previewHeight: after,
        }))
      : (placeable ? this.getPlaceableBrushFootprint(x, y) : this.getBrushFootprint(x, y)).map(
          (cell) => {
            const currentHeight = this.getHeightAt(cell.x, cell.y);
            return {
              ...cell,
              currentHeight,
              previewHeight: placeable
                ? currentHeight
                : this._brush.getPreviewHeight(cell.x, cell.y, currentHeight),
            };
          }
        );
    this._emit('brushMoved', {
      gridX: x,
      gridY: y,
      cells,
      tool: this.tool,
      heightStep: placeable ? 0 : this._brush.heightStep,
    });
  }

  _editorChanged() {
    this._emit('editorChanged', {
      active: this.isActive,
      tool: this.tool,
      brushSize: this.brushSize,
      wallTopLevel: this.wallTopLevel,
      wallFillMode: this.wallFillMode,
      pending: this.hasPendingStroke,
      canUndo: this.canUndo,
      canRedo: this.canRedo,
      undoLabel: this.undoLabel,
      redoLabel: this.redoLabel,
    });
  }

  _changed(kind, changes = []) {
    if (
      !['geometry', 'appearance', 'visibility', 'treeDensity', 'generationSettings'].includes(kind)
    )
      this.geometry.invalidate();
    this._editorChanged();
    this._emit('changed', {
      kind,
      affectedCells: changes.map(({ x, y, after }) => ({ x, y, height: after })),
    });
  }

  _subscribe(event, callback) {
    if (typeof callback !== 'function') throw new TypeError('Terrain listeners must be functions');
    this._listeners[event].add(callback);
    return () => this._listeners[event].delete(callback);
  }

  _emit(event, payload) {
    for (const callback of [...this._listeners[event]]) {
      try {
        callback(payload);
      } catch (error) {
        logger.log(LOG_LEVEL.ERROR, `Terrain listener failed: ${event}`, LOG_CATEGORY.SYSTEM, {
          error,
        });
      }
    }
  }

  _emitTile(x, y) {
    this._emit('tileChanged', {
      gridX: x,
      gridY: y,
      tileData: {
        height: this.getHeightAt(x, y),
        biomeKey: this.biomeKey,
        elevationScale: this.elevationScale,
        richShading: this._richShadingEnabled,
        neighborHeights: {
          north: this.getHeightAt(x, y - 1),
          south: this.getHeightAt(x, y + 1),
          east: this.getHeightAt(x + 1, y),
          west: this.getHeightAt(x - 1, y),
        },
      },
    });
  }

  _emitAllTiles() {
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) this._emitTile(x, y);
    }
  }
}
