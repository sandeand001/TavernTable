
/**
 * TerrainCoordinator.js - Manages terrain height modification system
 * Follows the established coordinator pattern for the TavernTable application
 * Handles terrain height data management, rendering coordination, and system lifecycle
 */
import { logger, LOG_CATEGORY } from '../utils/Logger.js';
import { GameErrors } from '../utils/ErrorHandler.js';
import { TERRAIN_CONFIG } from '../config/TerrainConstants.js';
import { TerrainDataStore } from '../terrain/TerrainDataStore.js';
import { TerrainBrushController } from '../terrain/TerrainBrushController.js';
import { TerrainFacesRenderer } from '../terrain/TerrainFacesRenderer.js';
import { TerrainInputHandlers } from './terrain-coordinator/TerrainInputHandlers.js';
import { ElevationScaleController } from './terrain-coordinator/ElevationScaleController.js';
import { ActivationHelpers } from './terrain-coordinator/ActivationHelpers.js';
import { BiomeShadingController } from './terrain-coordinator/BiomeShadingController.js';
import { TileLifecycleController } from './terrain-coordinator/TileLifecycleController.js';
import { ElevationVisualsController } from './terrain-coordinator/ElevationVisualsController.js';
import { validateTerrainSystemState as _validateSystemState, validateTerrainDataConsistency as _validateDataConsistency } from './terrain-coordinator/internals/validation.js';
import { validateApplicationRequirements as _validateApplyReqs, initializeBaseHeights as _initBaseHeights, processAllGridTiles as _processAllTiles, logCompletion as _logApplyComplete, handleApplicationError as _handleApplyError } from './terrain-coordinator/internals/apply.js';
import { getGridCoordinatesFromEvent as _getCoordsFromEvent, modifyTerrainAtPosition as _modifyAtPos } from './terrain-coordinator/internals/inputs.js';
import { setRichShadingEnabled as _setRichShadingEnabled, setBiomeSeed as _setBiomeSeed } from './terrain-coordinator/internals/biome.js';
import { getBiomeOrBaseColor as _getBiomeOrBaseColorInternal } from './terrain-coordinator/internals/color.js';
import { handleGridResize as _handleResize } from './terrain-coordinator/internals/resize.js';
import { getTerrainHeight as _getHeight } from './terrain-coordinator/internals/height.js';
import { isValidGridPosition as _isValidPos } from './terrain-coordinator/internals/coords.js';
import { modifyTerrainHeightAtCell as _modifyAtCell } from './terrain-coordinator/internals/brush.js';
import { setTerrainTool as _setTool, getBrushSize as _getBrushSize, setBrushSize as _setBrushSize, increaseBrushSize as _incBrush, decreaseBrushSize as _decBrush } from './terrain-coordinator/internals/tools.js';
import { updateBaseGridTileInPlace as _updateBaseGridTileInPlace, replaceBaseGridTile as _replaceBaseGridTile } from './terrain-coordinator/internals/baseGridUpdates.js';
import { resetTerrain as _resetTerrain } from './terrain-coordinator/internals/reset.js';
import { loadBaseTerrainIntoWorkingState as _loadBaseIntoWorking } from './terrain-coordinator/internals/state.js';
import { initializeTerrainData as _initTerrainData } from './terrain-coordinator/internals/init.js';
import { validateDependencies as _validateDeps } from './terrain-coordinator/internals/deps.js';

export class TerrainCoordinator {
	constructor(gameManager) {
		this.gameManager = gameManager;
		this.terrainManager = null;
		this.validateDependencies();
		this.isTerrainModeActive = false;
		this.dataStore = new TerrainDataStore(this.gameManager.cols, this.gameManager.rows);
		this.brush = new TerrainBrushController(this.dataStore);
		this.faces = new TerrainFacesRenderer(this.gameManager);
		this._inputHandlers = new TerrainInputHandlers(this);
		this._elevationScaleController = new ElevationScaleController(this);
		this._activationHelpers = new ActivationHelpers(this);
		this._tileLifecycle = new TileLifecycleController(this);
		this._elevationVisuals = new ElevationVisualsController(this);
		this.isDragging = false;
		this.lastModifiedCell = null;
		this._elevationScale = TERRAIN_CONFIG.ELEVATION_SHADOW_OFFSET;
		this._biomeCanvas = null;
		this._biomeShading = new BiomeShadingController(this);
		this._biomeSeed = (typeof window !== 'undefined' && Number.isFinite(window.richShadingSettings?.seed))
			? (window.richShadingSettings.seed >>> 0)
			: (Math.floor(Math.random() * 1e9) >>> 0);
		logger.debug('TerrainCoordinator initialized', {
			context: 'TerrainCoordinator.constructor',
			stage: 'initialization',
			defaultTool: this.brush.tool,
			defaultBrushSize: this.brush.brushSize,
			timestamp: new Date().toISOString()
		}, LOG_CATEGORY.SYSTEM);
	}
	validateDependencies() { return _validateDeps(this); }
	async initialize() {
		try {
			if (!this.gameManager.gridContainer) {
				throw new Error('Grid container must be created before terrain system initialization');
			}
			const { TerrainManager } = await import('../managers/TerrainManager.js');
			this.terrainManager = new TerrainManager(this.gameManager, this);
			this.initializeTerrainData();
			this.terrainManager.initialize();
			this.setupTerrainInputHandlers();
			logger.info('Terrain system initialized', {
				context: 'TerrainCoordinator.initialize',
				stage: 'initialization_complete',
				gridDimensions: {
					cols: this.gameManager.cols,
					rows: this.gameManager.rows
				},
				terrainManagerReady: !!this.terrainManager,
				inputHandlersConfigured: true,
				timestamp: new Date().toISOString()
			}, LOG_CATEGORY.SYSTEM);
		} catch (error) {
			logger.error('Terrain system failed to initialize', {
				context: 'TerrainCoordinator.initialize',
				error: error.message,
				stack: error.stack
			}, LOG_CATEGORY.SYSTEM);
			throw error;
		}
	}
	// ...existing code...
}
