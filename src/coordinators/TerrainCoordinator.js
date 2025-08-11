/**
 * TerrainCoordinator.js - Manages terrain height modification system
 * 
 * Follows the established coordinator pattern for the TavernTable application
 * Handles terrain height data management, rendering coordination, and system lifecycle
 */

import { logger, LOG_LEVEL, LOG_CATEGORY } from '../utils/Logger.js';
import { ErrorHandler, ERROR_SEVERITY, ERROR_CATEGORY, GameErrors } from '../utils/ErrorHandler.js';
import { GameValidators, Sanitizers } from '../utils/Validation.js';
import { TERRAIN_CONFIG } from '../config/TerrainConstants.js';
import { GRID_CONFIG } from '../config/GameConstants.js';
// import { TerrainHeightUtils } from '../utils/TerrainHeightUtils.js';
import { darkenColor } from '../utils/ColorUtils.js';
import { TerrainValidation } from '../utils/TerrainValidation.js';
import { TerrainDataStore } from '../terrain/TerrainDataStore.js';
import { TerrainBrushController } from '../terrain/TerrainBrushController.js';
import { TerrainFacesRenderer } from '../terrain/TerrainFacesRenderer.js';
import { TerrainPixiUtils } from '../utils/TerrainPixiUtils.js';
import { TerrainHeightUtils } from '../utils/TerrainHeightUtils.js';

export class TerrainCoordinator {
  constructor(gameManager) {
    this.gameManager = gameManager;
    this.terrainManager = null;
    
    // Validate dependencies at construction time
    this.validateDependencies();
    
    // Terrain modification state & helpers
    this.isTerrainModeActive = false;
    this.dataStore = new TerrainDataStore(this.gameManager.cols, this.gameManager.rows);
    this.brush = new TerrainBrushController(this.dataStore);
    this.faces = new TerrainFacesRenderer(this.gameManager);
    
    // UI state
    this.isDragging = false;
    this.lastModifiedCell = null;
    
    logger.log(LOG_LEVEL.DEBUG, 'TerrainCoordinator initialized', LOG_CATEGORY.SYSTEM, {
      context: 'TerrainCoordinator.constructor',
      stage: 'initialization',
      defaultTool: this.brush.tool,
      defaultBrushSize: this.brush.brushSize,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Validate that all required dependencies are available
   * @private
   */
  validateDependencies() {
    const missingDependencies = [];
    
    // Check required utilities
    if (!GameValidators) {
      missingDependencies.push('GameValidators');
    }
    if (!Sanitizers) {
      missingDependencies.push('Sanitizers');
    }
    
    // Check specific methods we need
    if (typeof Sanitizers?.enum !== 'function') {
      logger.warn('Sanitizers.enum method not available', {
        context: 'TerrainCoordinator.validateDependencies',
        sanitizersType: typeof Sanitizers,
        enumType: typeof Sanitizers?.enum,
        availableMethods: Sanitizers ? Object.keys(Sanitizers) : []
      });
    }
    
    if (missingDependencies.length > 0) {
      throw new Error(`Missing required dependencies: ${missingDependencies.join(', ')}`);
    }
    
    logger.log(LOG_LEVEL.DEBUG, 'Dependencies validated', LOG_CATEGORY.SYSTEM, {
      context: 'TerrainCoordinator.validateDependencies',
      sanitizersEnumAvailable: typeof Sanitizers?.enum === 'function',
      allDependenciesValid: missingDependencies.length === 0
    });
  }

  /**
   * Initialize terrain system and create managers
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      // Validate that grid system is ready
      if (!this.gameManager.gridContainer) {
        throw new Error('Grid container must be created before terrain system initialization');
      }
      
      // Import TerrainManager dynamically to avoid circular dependencies
      const { TerrainManager } = await import('../managers/TerrainManager.js');
      this.terrainManager = new TerrainManager(this.gameManager, this);
      
      // Initialize terrain height data array
      this.initializeTerrainData();
      
      // Initialize terrain rendering system
      this.terrainManager.initialize();
      
      // Set up terrain-specific input handlers
      this.setupTerrainInputHandlers();
      
      logger.log(LOG_LEVEL.INFO, 'Terrain system initialized', LOG_CATEGORY.SYSTEM, {
        context: 'TerrainCoordinator.initialize',
        stage: 'initialization_complete',
        gridDimensions: { 
          cols: this.gameManager.cols, 
          rows: this.gameManager.rows 
        },
        terrainManagerReady: !!this.terrainManager,
        inputHandlersConfigured: true,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      GameErrors.initialization(error, {
        stage: 'TerrainCoordinator.initialize',
        gameManagerAvailable: !!this.gameManager,
        gridDimensions: { 
          cols: this.gameManager?.cols, 
          rows: this.gameManager?.rows 
        }
      });
      throw error;
    }
  }

  /**
   * Initialize terrain height data for the current grid
   */
  initializeTerrainData() {
    try {
      const cols = this.gameManager.cols;
      const rows = this.gameManager.rows;
      
      // Validate grid dimensions
      if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols <= 0 || rows <= 0) {
        throw new Error(`Invalid grid dimensions: ${cols}x${rows}`);
      }
      
      // Ensure datastore is sized properly
      this.dataStore.resize(cols, rows);
      
      logger.log(LOG_LEVEL.DEBUG, 'Terrain data initialized', LOG_CATEGORY.SYSTEM, {
        context: 'TerrainCoordinator.initializeTerrainData',
        stage: 'data_initialization',
        gridDimensions: { cols, rows },
        totalCells: cols * rows,
        defaultHeight: TERRAIN_CONFIG.DEFAULT_HEIGHT,
        dataStructure: 'complete'
      });
    } catch (error) {
      GameErrors.initialization(error, {
        stage: 'initializeTerrainData',
        gridDimensions: { 
          cols: this.gameManager?.cols, 
          rows: this.gameManager?.rows 
        }
      });
      throw error;
    }
  }

  /**
   * Set up terrain-specific input event handlers
   */
  setupTerrainInputHandlers() {
    try {
      // Mouse events for terrain painting
      this.gameManager.app.view.addEventListener('mousedown', this.handleTerrainMouseDown.bind(this));
      this.gameManager.app.view.addEventListener('mousemove', this.handleTerrainMouseMove.bind(this));
      this.gameManager.app.view.addEventListener('mouseup', this.handleTerrainMouseUp.bind(this));
      this.gameManager.app.view.addEventListener('mouseleave', this.handleTerrainMouseLeave.bind(this));
      
      // Keyboard shortcuts for terrain tools
      document.addEventListener('keydown', this.handleTerrainKeyDown.bind(this));
      
      logger.log(LOG_LEVEL.DEBUG, 'Terrain input handlers configured', LOG_CATEGORY.SYSTEM, {
        context: 'TerrainCoordinator.setupTerrainInputHandlers',
        stage: 'input_configuration',
        eventTypes: ['mousedown', 'mousemove', 'mouseup', 'mouseleave', 'keydown'],
        handlersBound: true
      });
    } catch (error) {
      GameErrors.initialization(error, {
        stage: 'setupTerrainInputHandlers',
        appViewAvailable: !!this.gameManager?.app?.view
      });
      throw error;
    }
  }

  /**
   * Handle mouse down events for terrain modification
   * @param {MouseEvent} event - Mouse event
   */
  handleTerrainMouseDown(event) {
    try {
      // Only handle left mouse button and when terrain mode is active
      if (event.button !== 0 || !this.isTerrainModeActive) {
        return;
      }
      
      const gridCoords = this.getGridCoordinatesFromEvent(event);
      if (!gridCoords) {
        return;
      }
      
      this.isDragging = true;
      this.modifyTerrainAtPosition(gridCoords.gridX, gridCoords.gridY);
      
      event.preventDefault();
      event.stopPropagation();
    } catch (error) {
      new ErrorHandler().handle(error, ERROR_SEVERITY.MEDIUM, ERROR_CATEGORY.INPUT, {
        context: 'TerrainCoordinator.handleTerrainMouseDown',
        stage: 'terrain_mouse_down',
        isTerrainModeActive: this.isTerrainModeActive,
        buttonPressed: event?.button
      });
    }
  }

  /**
   * Handle mouse move events for continuous terrain painting
   * @param {MouseEvent} event - Mouse event
   */
  handleTerrainMouseMove(event) {
    try {
      const gridCoords = this.getGridCoordinatesFromEvent(event);
      
      // Update height indicator if in terrain mode
      if (this.isTerrainModeActive && gridCoords) {
        this.updateHeightIndicator(gridCoords.gridX, gridCoords.gridY);
      }
      
      // Only process if we're actively dragging in terrain mode
      if (!this.isDragging || !this.isTerrainModeActive) {
        return;
      }
      
      if (!gridCoords) {
        return;
      }
      
      // Avoid modifying the same cell repeatedly during a single drag
      const cellKey = `${gridCoords.gridX},${gridCoords.gridY}`;
      if (this.lastModifiedCell === cellKey) {
        return;
      }
      
      this.modifyTerrainAtPosition(gridCoords.gridX, gridCoords.gridY);
      this.lastModifiedCell = cellKey;
    } catch (error) {
      new ErrorHandler().handle(error, ERROR_SEVERITY.LOW, ERROR_CATEGORY.INPUT, {
        context: 'TerrainCoordinator.handleTerrainMouseMove',
        stage: 'terrain_mouse_move',
        isDragging: this.isDragging,
        isTerrainModeActive: this.isTerrainModeActive
      });
    }
  }

  /**
   * Handle mouse up events to stop terrain painting
   * @param {MouseEvent} event - Mouse event
   */
  handleTerrainMouseUp(event) {
    try {
      if (event.button === 0 && this.isDragging) {
        this.isDragging = false;
        this.lastModifiedCell = null;
        
        logger.log(LOG_LEVEL.TRACE, 'Terrain painting session completed', LOG_CATEGORY.USER, {
          context: 'TerrainCoordinator.handleTerrainMouseUp',
          stage: 'painting_complete',
          tool: this.brush.tool,
          brushSize: this.brush.brushSize
        });
      }
    } catch (error) {
      new ErrorHandler().handle(error, ERROR_SEVERITY.LOW, ERROR_CATEGORY.INPUT, {
        context: 'TerrainCoordinator.handleTerrainMouseUp',
        stage: 'terrain_mouse_up',
        isDragging: this.isDragging
      });
    }
  }

  /**
   * Handle mouse leave events to stop terrain painting
   */
  handleTerrainMouseLeave() {
    if (this.isDragging) {
      this.isDragging = false;
      this.lastModifiedCell = null;
    }
  }

  /**
   * Handle keyboard shortcuts for terrain tools
   * @param {KeyboardEvent} event - Keyboard event
   */
  handleTerrainKeyDown(event) {
    try {
      if (!this.isTerrainModeActive) {
        return;
      }
      
      switch (event.code) {
      case 'KeyR':
        if (!event.ctrlKey && !event.altKey) {
          this.setTerrainTool('raise');
          event.preventDefault();
        }
        break;
      case 'KeyL':
        if (!event.ctrlKey && !event.altKey) {
          this.setTerrainTool('lower');
          event.preventDefault();
        }
        break;
      case 'BracketLeft': // [
        this.decreaseBrushSize();
        event.preventDefault();
        break;
      case 'BracketRight': // ]
        this.increaseBrushSize();
        event.preventDefault();
        break;
      }
    } catch (error) {
      new ErrorHandler().handle(error, ERROR_SEVERITY.LOW, ERROR_CATEGORY.INPUT, {
        context: 'TerrainCoordinator.handleTerrainKeyDown',
        stage: 'terrain_keyboard',
        key: event?.code,
        isTerrainModeActive: this.isTerrainModeActive
      });
    }
  }

  /**
   * Update the height indicator in the UI to show terrain level at cursor position
   * @param {number} gridX - Grid X coordinate
   * @param {number} gridY - Grid Y coordinate
   */
  updateHeightIndicator(gridX, gridY) {
    try {
      if (!this.isValidGridPosition(gridX, gridY)) {
        return;
      }
      
      const currentHeight = this.getTerrainHeight(gridX, gridY);
      
      // Update height value display
      const heightDisplay = document.getElementById('terrain-height-display');
      if (heightDisplay) {
        heightDisplay.textContent = currentHeight.toString();
        heightDisplay.style.color = currentHeight === 0 ? '#6b7280' : 
          currentHeight > 0 ? '#10b981' : '#8b5cf6';
      }
      
      // Update height scale visual indicator
      const scaleMarks = document.querySelectorAll('.scale-mark');
      scaleMarks.forEach(mark => {
        const markHeight = parseInt(mark.getAttribute('data-height'));
        if (markHeight === currentHeight) {
          mark.classList.add('current');
        } else {
          mark.classList.remove('current');
        }
      });
      
    } catch (error) {
      new ErrorHandler().handle(error, ERROR_SEVERITY.LOW, ERROR_CATEGORY.UI, {
        context: 'TerrainCoordinator.updateHeightIndicator',
        coordinates: { gridX, gridY },
        terrainHeight: this.getTerrainHeight(gridX, gridY)
      });
    }
  }

  /**
   * Reset the height indicator to default state
   */
  resetHeightIndicator() {
    try {
      const heightDisplay = document.getElementById('terrain-height-display');
      if (heightDisplay) {
        heightDisplay.textContent = '0';
        heightDisplay.style.color = '#6b7280';
      }
      
      const scaleMarks = document.querySelectorAll('.scale-mark');
      scaleMarks.forEach(mark => {
        const markHeight = parseInt(mark.getAttribute('data-height'));
        if (markHeight === 0) {
          mark.classList.add('current');
        } else {
          mark.classList.remove('current');
        }
      });
    } catch (error) {
      // Silently handle UI errors
      logger.log(LOG_LEVEL.DEBUG, 'Error resetting height indicator', LOG_CATEGORY.UI, {
        context: 'TerrainCoordinator.resetHeightIndicator',
        error: error.message
      });
    }
  }

  /**
   * Get grid coordinates from mouse event
   * @param {MouseEvent} event - Mouse event
   * @returns {Object|null} Grid coordinates or null if invalid
   */
  getGridCoordinatesFromEvent(event) {
    try {
      // Reuse existing interaction manager coordinate conversion
      if (this.gameManager.interactionManager && 
          typeof this.gameManager.interactionManager.getGridCoordinatesFromClick === 'function') {
        return this.gameManager.interactionManager.getGridCoordinatesFromClick(event);
      }
      
      // Fallback coordinate calculation if interaction manager not available
      const rect = this.gameManager.app.view.getBoundingClientRect();
      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;
      
      // Convert to local grid coordinates
      const gridRelativeX = mouseX - this.gameManager.gridContainer.x;
      const gridRelativeY = mouseY - this.gameManager.gridContainer.y;
      
      const scale = this.gameManager.interactionManager?.gridScale || 1.0;
      const localX = gridRelativeX / scale;
      const localY = gridRelativeY / scale;
      
      // Convert to grid coordinates
      const gridCoords = this.gameManager.interactionManager?.convertToGridCoordinates({ localX, localY });
      
      if (!gridCoords || !this.isValidGridPosition(gridCoords.gridX, gridCoords.gridY)) {
        return null;
      }
      
      return gridCoords;
    } catch (error) {
      new ErrorHandler().handle(error, ERROR_SEVERITY.MEDIUM, ERROR_CATEGORY.INPUT, {
        context: 'TerrainCoordinator.getGridCoordinatesFromEvent',
        stage: 'coordinate_conversion',
        hasInteractionManager: !!this.gameManager.interactionManager
      });
      return null;
    }
  }

  /**
   * Modify terrain height at specified position
   * @param {number} gridX - Grid X coordinate
   * @param {number} gridY - Grid Y coordinate
   */
  modifyTerrainAtPosition(gridX, gridY) {
    try {
      // Validate coordinates
      if (!this.isValidGridPosition(gridX, gridY)) {
        return;
      }
      
      // Apply brush area modification via controller
      this.brush.applyAt(gridX, gridY);
      
      // Update visual representation
      if (this.terrainManager) {
        this.terrainManager.updateTerrainDisplay(gridX, gridY, this.brushSize);
      }
    } catch (error) {
      GameErrors.input(error, {
        stage: 'modifyTerrainAtPosition',
        coordinates: { gridX, gridY },
        tool: this.currentTerrainTool,
        brushSize: this.brushSize
      });
    }
  }

  /**
   * Modify height at a specific cell
   * @param {number} gridX - Grid X coordinate
   * @param {number} gridY - Grid Y coordinate
   */
  modifyTerrainHeightAtCell(gridX, gridY) {
  // Delegate to brush controller (kept for compatibility of method name)
    this.brush.applyAt(gridX, gridY);
  }

  /**
   * Check if grid position is valid
   * @param {number} gridX - Grid X coordinate
   * @param {number} gridY - Grid Y coordinate
   * @returns {boolean} True if position is valid
   */
  isValidGridPosition(gridX, gridY) {
    const result = TerrainValidation.validateTerrainCoordinates(
      gridX,
      gridY,
      { cols: this.gameManager.cols, rows: this.gameManager.rows }
    );
    return !!result?.isValid;
  }

  /**
   * Enable terrain modification mode with base terrain loading
   */
  /**
   * NEW METHOD: Comprehensive terrain system state validation
   * Validates all critical components before terrain operations
   * @throws {Error} If terrain system state is corrupted or invalid
   * @returns {boolean} True if all validations pass
   */
  validateTerrainSystemState() {
    try {
      // Use centralized validation utility for consistent system state checking
      const validationResult = TerrainValidation.validateTerrainSystemState(this, this.terrainManager);
      
      if (!validationResult.isValid) {
        const errorMessage = TerrainValidation.getErrorMessage(validationResult);
        logger.error('Terrain system state validation failed', {
          context: 'TerrainCoordinator.validateTerrainSystemState',
          errors: validationResult.errors,
          warnings: validationResult.warnings,
          details: validationResult.details
        });
        throw new Error(`Terrain system state corrupted: ${errorMessage}`);
      }
      
      // Log any warnings even if validation passes
      const warnings = TerrainValidation.getWarningMessages(validationResult);
      if (warnings.length > 0) {
        logger.log(LOG_LEVEL.WARN, 'Terrain system validation warnings', LOG_CATEGORY.SYSTEM, {
          context: 'TerrainCoordinator.validateTerrainSystemState',
          warnings
        });
      }
      
      logger.log(LOG_LEVEL.DEBUG, 'Terrain system state validation passed', LOG_CATEGORY.SYSTEM, {
        context: 'TerrainCoordinator.validateTerrainSystemState',
        details: validationResult.details
      });
      
      return true;
    } catch (error) {
      logger.error('Critical error during terrain system validation', {
        context: 'TerrainCoordinator.validateTerrainSystemState',
        error: error.message
      });
      throw error;
    }
  }

  /**
   * NEW METHOD: Validate terrain data array consistency
   * @returns {boolean} True if terrain data structures are consistent
   */
  validateTerrainDataConsistency() {
    try {
      if (!this.dataStore?.working || !this.dataStore?.base) {
        return false;
      }
      
      const expectedRows = this.gameManager.rows;
      const expectedCols = this.gameManager.cols;
      
      // Check terrainHeights dimensions
      if (this.dataStore.working.length !== expectedRows) {
        return false;
      }
      
      for (let i = 0; i < this.dataStore.working.length; i++) {
        if (!Array.isArray(this.dataStore.working[i]) || this.dataStore.working[i].length !== expectedCols) {
          return false;
        }
      }
      
      // Check baseTerrainHeights dimensions
      if (this.dataStore.base.length !== expectedRows) {
        return false;
      }
      
      for (let i = 0; i < this.dataStore.base.length; i++) {
        if (!Array.isArray(this.dataStore.base[i]) || this.dataStore.base[i].length !== expectedCols) {
          return false;
        }
      }
      
      return true;
    } catch (error) {
      logger.warn('Error validating terrain data consistency', {
        context: 'TerrainCoordinator.validateTerrainDataConsistency',
        error: error.message
      });
      return false;
    }
  }

  enableTerrainMode() {
    try {
      this._validateTerrainSystemForActivation();
      this._resetTerrainContainerSafely();
      this._validateContainerIntegrity();
      // Ensure base grid visuals are neutralized so overlay doesn't appear stacked
      this._prepareBaseGridForEditing();
      this._activateTerrainMode();
      this._loadTerrainStateAndDisplay();
      
      logger.log(LOG_LEVEL.INFO, 'Terrain mode enabled with enhanced safety checks', LOG_CATEGORY.USER, {
        context: 'TerrainCoordinator.enableTerrainMode',
        tool: this.brush.tool,
        brushSize: this.brush.brushSize,
        baseTerrainLoaded: true,
        terrainManagerReady: !!this.terrainManager,
        containerIntegrity: 'validated',
        safetyEnhancements: 'applied'
      });
    } catch (error) {
      this._handleTerrainModeActivationError(error);
    }
  }

  /**
   * DECOMPOSED METHOD: Prepare base grid visuals for editing overlay
   * Resets per-tile elevation offsets, shadows, and base 3D faces so
   * the editing overlay is the sole visual representation of height.
   * @private
   */
  _prepareBaseGridForEditing() {
    try {
      if (this.gameManager?.gridContainer?.children) {
        this.gameManager.gridContainer.children.forEach(child => {
          if (child && child.isGridTile) {
            // Reset tile Y to baseline to avoid double elevation with overlay
            if (typeof child.baseIsoY === 'number') {
              child.y = child.baseIsoY;
            }

            // Remove any existing shadow tiles
            if (child.shadowTile && child.parent?.children?.includes(child.shadowTile)) {
              child.parent.removeChild(child.shadowTile);
              if (typeof child.shadowTile.destroy === 'function' && !child.shadowTile.destroyed) {
                child.shadowTile.destroy();
              }
              child.shadowTile = null;
            }

            // Remove any depression overlays mistakenly attached to base tiles
            if (child.depressionOverlay) {
              try {
                if (child.children?.includes(child.depressionOverlay)) {
                  child.removeChild(child.depressionOverlay);
                }
                if (typeof child.depressionOverlay.destroy === 'function' && !child.depressionOverlay.destroyed) {
                  child.depressionOverlay.destroy();
                }
              } catch (_) { /* best-effort */ }
              child.depressionOverlay = null;
            }

            // Remove any existing base 3D faces
            if (child.baseSideFaces && child.parent?.children?.includes(child.baseSideFaces)) {
              child.parent.removeChild(child.baseSideFaces);
              if (typeof child.baseSideFaces.destroy === 'function' && !child.baseSideFaces.destroyed) {
                child.baseSideFaces.destroy();
              }
              child.baseSideFaces = null;
            }

            // Remove any overlay side faces accidentally lingering on base tiles
            if (child.sideFaces && child.parent?.children?.includes(child.sideFaces)) {
              child.parent.removeChild(child.sideFaces);
              if (typeof child.sideFaces.destroy === 'function' && !child.sideFaces.destroyed) {
                child.sideFaces.destroy();
              }
              child.sideFaces = null;
            }
          }
        });
      }
    } catch (error) {
      logger.log(LOG_LEVEL.DEBUG, 'Error preparing base grid for editing', LOG_CATEGORY.RENDERING, {
        context: 'TerrainCoordinator._prepareBaseGridForEditing',
        error: error.message
      });
    }
  }

  /**
   * DECOMPOSED METHOD: Validate terrain system before activation
   * @private
   */
  _validateTerrainSystemForActivation() {
    // CRITICAL: Validate terrain system state before proceeding
    this.validateTerrainSystemState();
  }

  /**
   * DECOMPOSED METHOD: Reset terrain container state safely
   * @private
   */
  _resetTerrainContainerSafely() {
    // CONTAINER RESET STRATEGY: Clean up terrain container state before reuse
    if (this.terrainManager?.terrainContainer) {
      logger.log(LOG_LEVEL.DEBUG, 'Resetting terrain container for safe reuse', LOG_CATEGORY.SYSTEM, {
        context: 'TerrainCoordinator.enableTerrainMode',
        containerChildrenBefore: this.terrainManager.terrainContainer.children.length,
        tilesMapSizeBefore: this.terrainManager.terrainTiles.size
      });
      
      // Force clear terrain container safely using centralized utility
      try {
        TerrainPixiUtils.resetContainer(
          this.terrainManager.terrainContainer,
          'terrainContainer',
          'TerrainCoordinator.enableTerrainMode.reset'
        );
      } catch (containerError) {
        logger.warn('Error during container reset, continuing', {
          context: 'TerrainCoordinator.enableTerrainMode',
          error: containerError.message
        });
      }

      // Clear manager state
      this.terrainManager.terrainTiles.clear();
      this.terrainManager.updateQueue.clear();
      this.terrainManager.isUpdating = false;
    }
  }

  /**
   * DECOMPOSED METHOD: Validate container integrity after reset
   * @private
   */
  _validateContainerIntegrity() {
    // Validate container integrity after reset
    if (this.gameManager.gridContainer?.destroyed) {
      throw new Error('Grid container corrupted - requires application reload');
    }

    if (this.terrainManager?.terrainContainer?.destroyed) {
      logger.warn('Terrain container was destroyed, recreating', {
        context: 'TerrainCoordinator.enableTerrainMode'
      });
      // Recreate terrain container
      this.terrainManager.terrainContainer = new PIXI.Container();
      this.gameManager.gridContainer.addChild(this.terrainManager.terrainContainer);
    }

    // Ensure terrain overlay container is on top of base tiles
    try {
      const parent = this.gameManager.gridContainer;
      const overlay = this.terrainManager?.terrainContainer;
      if (parent && overlay && parent.children?.length) {
        const topIndex = parent.children.length - 1;
        if (typeof parent.setChildIndex === 'function') {
          parent.setChildIndex(overlay, topIndex);
        } else {
          // Fallback: remove and re-add to bring to front
          if (parent.children.includes(overlay)) {
            parent.removeChild(overlay);
          }
          parent.addChild(overlay);
        }
      }
    } catch (zErr) {
      logger.log(LOG_LEVEL.WARN, 'Failed to raise terrain overlay container to top', LOG_CATEGORY.RENDERING, {
        context: 'TerrainCoordinator._validateContainerIntegrity',
        error: zErr.message
      });
    }
  }

  /**
   * DECOMPOSED METHOD: Activate terrain mode state
   * @private
   */
  _activateTerrainMode() {
    this.isTerrainModeActive = true;
  }

  /**
   * DECOMPOSED METHOD: Load terrain state and display
   * @private
   */
  _loadTerrainStateAndDisplay() {
    // Load current base terrain state into working terrain heights
    this.loadBaseTerrainIntoWorkingState();
    
    // Show terrain tiles for current state with clean container
    if (this.terrainManager) {
      this.terrainManager.showAllTerrainTiles();
    }
  }

  /**
   * DECOMPOSED METHOD: Handle terrain mode activation errors
   * @private
   * @param {Error} error - The error that occurred during activation
   */
  _handleTerrainModeActivationError(error) {
    // Reset terrain mode state on error
    this.isTerrainModeActive = false;
    
    // Enhanced error information for debugging
    const errorContext = {
      stage: 'enableTerrainMode',
      context: 'TerrainCoordinator.enableTerrainMode',
      terrainManagerReady: !!this.terrainManager,
      gridContainerReady: !!this.gameManager?.gridContainer,
      gridContainerDestroyed: this.gameManager?.gridContainer?.destroyed,
      terrainContainerReady: !!this.terrainManager?.terrainContainer,
      terrainContainerDestroyed: this.terrainManager?.terrainContainer?.destroyed,
      dataStructures: {
        terrainHeights: !!this.dataStore?.working,
        baseTerrainHeights: !!this.dataStore?.base
      }
    };
    
  GameErrors.gameState(error, errorContext);
    throw error;
  }

  /**
   * Disable terrain modification mode and apply changes permanently
   */
  disableTerrainMode() {
    try {
      this.isTerrainModeActive = false;
      this.isDragging = false;
      this.lastModifiedCell = null;
      
      // Reset any elevation offsets and remove shadows before applying to base grid
      if (this.gameManager?.gridContainer?.children) {
        this.gameManager.gridContainer.children.forEach(child => {
          if (child.isGridTile) {
            if (typeof child.baseIsoY === 'number') {
              child.y = child.baseIsoY;
            }
            if (child.shadowTile && child.parent?.children?.includes(child.shadowTile)) {
              child.parent.removeChild(child.shadowTile);
              if (typeof child.shadowTile.destroy === 'function' && !child.shadowTile.destroyed) {
                child.shadowTile.destroy();
              }
              child.shadowTile = null;
            }
            // Remove any existing base 3D faces
            if (child.baseSideFaces && child.parent?.children?.includes(child.baseSideFaces)) {
              child.parent.removeChild(child.baseSideFaces);
              if (typeof child.baseSideFaces.destroy === 'function' && !child.baseSideFaces.destroyed) {
                child.baseSideFaces.destroy();
              }
              child.baseSideFaces = null;
            }
          }
        });
      }
      
      // Apply current terrain modifications permanently to base grid
      this.applyTerrainToBaseGrid();
      
      // Clear terrain overlay system completely
      if (this.terrainManager) {
        this.terrainManager.hideAllTerrainTiles();
        this.terrainManager.clearAllTerrainTiles();
      }
      
      // Reset height indicator
      this.resetHeightIndicator();
      
      logger.log(LOG_LEVEL.INFO, 'Terrain mode disabled with permanent grid integration', LOG_CATEGORY.USER, {
        context: 'TerrainCoordinator.disableTerrainMode',
        permanentIntegration: true
      });
    } catch (error) {
      GameErrors.gameState(error, {
        stage: 'disableTerrainMode',
        context: 'TerrainCoordinator.disableTerrainMode'
      });
      throw error;
    }
  }

  /**
   * Set current terrain tool with robust validation
   * @param {string} tool - Tool name ('raise' or 'lower')
   */
  setTerrainTool(tool) {
    // Use Sanitizers.enum if available, otherwise fallback to inline validation
    let sanitizedTool;
    
    if (typeof Sanitizers?.enum === 'function') {
      sanitizedTool = Sanitizers.enum(tool, 'raise', ['raise', 'lower']);
      logger.log(LOG_LEVEL.DEBUG, 'Used Sanitizers.enum for validation', LOG_CATEGORY.SYSTEM, {
        context: 'TerrainCoordinator.setTerrainTool',
        method: 'Sanitizers.enum'
      });
    } else {
      // Fallback validation for browser caching or module loading issues
      const allowedTools = ['raise', 'lower'];
      sanitizedTool = allowedTools.includes(tool) ? tool : 'raise';
      logger.log(LOG_LEVEL.DEBUG, 'Used fallback validation', LOG_CATEGORY.SYSTEM, {
        context: 'TerrainCoordinator.setTerrainTool',
        method: 'inline_validation',
        reason: 'Sanitizers.enum not available'
      });
    }
    
    this.brush.setTool(sanitizedTool);
    
    logger.log(LOG_LEVEL.DEBUG, 'Terrain tool changed', LOG_CATEGORY.USER, {
      context: 'TerrainCoordinator.setTerrainTool',
      newTool: this.brush.tool,
      previousTool: tool !== sanitizedTool ? tool : 'same',
      validationMethod: typeof Sanitizers?.enum === 'function' ? 'enum' : 'fallback'
    });
  }

  /**
   * Brush size proxy for UI and render calls
   * Getter returns current brush size from controller.
   * Setter clamps value within config bounds.
   */
  get brushSize() {
    return this.brush?.brushSize ?? TERRAIN_CONFIG.MIN_BRUSH_SIZE;
  }

  set brushSize(value) {
    if (!Number.isFinite(value)) return;
    const clamped = Math.max(TERRAIN_CONFIG.MIN_BRUSH_SIZE, Math.min(TERRAIN_CONFIG.MAX_BRUSH_SIZE, Math.floor(value)));
    if (this.brush) {
      this.brush.brushSize = clamped;
    }
  }

  /**
   * Increase brush size
   */
  increaseBrushSize() {
    const before = this.brush.brushSize;
    this.brush.increaseBrush();
    if (this.brush.brushSize !== before) {
      logger.log(LOG_LEVEL.DEBUG, 'Brush size increased', LOG_CATEGORY.USER, {
        context: 'TerrainCoordinator.increaseBrushSize',
        newSize: this.brush.brushSize
      });
    }
  }

  /**
   * Decrease brush size
   */
  decreaseBrushSize() {
    const before = this.brush.brushSize;
    this.brush.decreaseBrush();
    if (this.brush.brushSize !== before) {
      logger.log(LOG_LEVEL.DEBUG, 'Brush size decreased', LOG_CATEGORY.USER, {
        context: 'TerrainCoordinator.decreaseBrushSize',
        newSize: this.brush.brushSize
      });
    }
  }

  /**
   * Get terrain height at specific coordinates
   * @param {number} gridX - Grid X coordinate
   * @param {number} gridY - Grid Y coordinate
   * @returns {number} Terrain height
   */
  getTerrainHeight(gridX, gridY) {
  // Defensive bounds checks to avoid out-of-range indexing
    const heights = this.dataStore?.working;
    if (!heights || !Array.isArray(heights)) {
      return TERRAIN_CONFIG.DEFAULT_HEIGHT;
    }
    if (!Number.isInteger(gridX) || !Number.isInteger(gridY)) {
      return TERRAIN_CONFIG.DEFAULT_HEIGHT;
    }
    if (gridY < 0 || gridY >= heights.length) {
      return TERRAIN_CONFIG.DEFAULT_HEIGHT;
    }
    const row = heights[gridY];
    if (!Array.isArray(row)) {
      return TERRAIN_CONFIG.DEFAULT_HEIGHT;
    }
    if (gridX < 0 || gridX >= row.length) {
      return TERRAIN_CONFIG.DEFAULT_HEIGHT;
    }
    return row[gridX];
  }

  /**
   * Reset all terrain heights to default
   */
  resetTerrain() {
    try {
      this.initializeTerrainData();
      
      if (this.terrainManager) {
        this.terrainManager.refreshAllTerrainDisplay();
      }
      
      logger.log(LOG_LEVEL.INFO, 'Terrain reset to default', LOG_CATEGORY.USER, {
        context: 'TerrainCoordinator.resetTerrain',
        gridDimensions: { 
          cols: this.gameManager.cols, 
          rows: this.gameManager.rows 
        },
        defaultHeight: TERRAIN_CONFIG.DEFAULT_HEIGHT
      });
    } catch (error) {
      GameErrors.operation(error, {
        stage: 'resetTerrain',
        gridDimensions: { 
          cols: this.gameManager?.cols, 
          rows: this.gameManager?.rows 
        }
      });
      throw error;
    }
  }

  /**
   * Handle grid resize - reinitialize terrain data
   * @param {number} newCols - New column count
   * @param {number} newRows - New row count
   */
  handleGridResize(newCols, newRows) {
    try {
      // Backup existing terrain data if needed
      const oldHeights = this.dataStore.working;
      const oldCols = this.gameManager.cols;
      const oldRows = this.gameManager.rows;
      
      // Update grid dimensions (this will be done by GameManager)
      // Then reinitialize terrain data with new dimensions
      this.initializeTerrainData();
      
      // Copy over existing height data where possible
      if (oldHeights && oldCols > 0 && oldRows > 0) {
        const copyRows = Math.min(oldRows, newRows);
        const copyCols = Math.min(oldCols, newCols);
        
        for (let y = 0; y < copyRows; y++) {
          for (let x = 0; x < copyCols; x++) {
            this.dataStore.working[y][x] = oldHeights[y][x];
          }
        }
      }
      
      logger.log(LOG_LEVEL.INFO, 'Terrain data resized', LOG_CATEGORY.SYSTEM, {
        context: 'TerrainCoordinator.handleGridResize',
        oldDimensions: { cols: oldCols, rows: oldRows },
        newDimensions: { cols: newCols, rows: newRows },
        dataPreserved: !!(oldHeights && oldCols > 0 && oldRows > 0)
      });
    } catch (error) {
      GameErrors.operation(error, {
        stage: 'handleGridResize',
        oldDimensions: { cols: this.gameManager?.cols, rows: this.gameManager?.rows },
        newDimensions: { cols: newCols, rows: newRows }
      });
      throw error;
    }
  }

  /**
   * Load base terrain state into working terrain heights for editing
   */
  loadBaseTerrainIntoWorkingState() {
    try {
      if (!this.dataStore.base) {
        logger.warn('No base terrain heights available, initializing default state', {
          context: 'TerrainCoordinator.loadBaseTerrainIntoWorkingState'
        });
        this.initializeTerrainData();
        return;
      }
      
      // Deep copy base terrain heights into working state
      this.dataStore.loadBaseIntoWorking();
      
      logger.log(LOG_LEVEL.DEBUG, 'Base terrain loaded into working state', LOG_CATEGORY.SYSTEM, {
        context: 'TerrainCoordinator.loadBaseTerrainIntoWorkingState',
        gridDimensions: { 
          cols: this.gameManager.cols, 
          rows: this.gameManager.rows 
        }
      });
    } catch (error) {
  GameErrors.gameState(error, {
        stage: 'loadBaseTerrainIntoWorkingState',
        context: 'TerrainCoordinator.loadBaseTerrainIntoWorkingState'
      });
      throw error;
    }
  }

  /**
   * Apply terrain modifications permanently to the base grid
   * SAFER APPROACH: Updates existing tiles instead of mass destruction/recreation
   */
  applyTerrainToBaseGrid() {
    try {
      this._validateTerrainApplicationRequirements();
      this._initializeBaseTerrainHeights();
      const modifiedTiles = this._processAllGridTiles();
      this._logTerrainApplicationCompletion(modifiedTiles);
    } catch (error) {
      this._handleTerrainApplicationError(error);
    }
  }

  /**
   * Validate requirements for terrain application to base grid
   * @private
   * @throws {Error} If requirements are not met
   */
  _validateTerrainApplicationRequirements() {
    if (!this.gameManager.gridContainer || !this.dataStore.working) {
      logger.warn('Cannot apply terrain to base grid - missing requirements', {
        context: 'TerrainCoordinator._validateTerrainApplicationRequirements',
        hasGridContainer: !!this.gameManager.gridContainer,
        hasTerrainHeights: !!this.dataStore.working
      });
      throw new Error('Missing requirements for terrain application');
    }
  }

  /**
   * Initialize base terrain heights from current terrain state
   * @private
   */
  _initializeBaseTerrainHeights() {
    // Update base terrain heights with current modifications
    this.dataStore.applyWorkingToBase();
  }

  /**
   * Process all grid tiles with terrain modifications
   * @private
   * @returns {number} Number of modified tiles
   */
  _processAllGridTiles() {
    let modifiedTiles = 0;
    
    // SAFER APPROACH: Update existing tiles in-place when possible
    // Only destroy/recreate when absolutely necessary
    for (let y = 0; y < this.gameManager.rows; y++) {
      for (let x = 0; x < this.gameManager.cols; x++) {
        const height = this.dataStore.base[y][x];
        
        try {
          // Try to update existing tile first (safer)
          const updated = this.updateBaseGridTileInPlace(x, y, height);
          if (!updated) {
            // Fallback to replacement only if update fails
            this.replaceBaseGridTile(x, y, height);
          }
          
          if (height !== TERRAIN_CONFIG.DEFAULT_HEIGHT) {
            modifiedTiles++;
          }
        } catch (tileError) {
          logger.warn('Failed to update tile, skipping', {
            context: 'TerrainCoordinator._processAllGridTiles',
            coordinates: { x, y },
            height,
            error: tileError.message
          });
        }
      }
    }
    
    return modifiedTiles;
  }

  /**
   * Log successful completion of terrain application
   * @private
   * @param {number} modifiedTiles - Number of tiles that were modified
   */
  _logTerrainApplicationCompletion(modifiedTiles) {
    logger.log(LOG_LEVEL.INFO, 'Terrain applied permanently to base grid with safer approach', LOG_CATEGORY.SYSTEM, {
      context: 'TerrainCoordinator.applyTerrainToBaseGrid',
      modifiedTiles,
      totalTiles: this.gameManager.rows * this.gameManager.cols,
      approach: 'safer_in_place_updates'
    });
  }

  /**
   * Handle errors during terrain application
   * @private
   * @param {Error} error - The error that occurred
   * @throws {Error} Re-throws the error after logging
   */
  _handleTerrainApplicationError(error) {
  GameErrors.gameState(error, {
      stage: 'applyTerrainToBaseGrid',
      context: 'TerrainCoordinator.applyTerrainToBaseGrid'
    });
    throw error;
  }

  /**
   * NEW METHOD: Update base grid tile in-place without destruction (SAFER)
   * @param {number} x - Grid X coordinate
   * @param {number} y - Grid Y coordinate  
   * @param {number} height - Terrain height value
   * @returns {boolean} True if tile was updated successfully, false if replacement needed
   */
  updateBaseGridTileInPlace(x, y, height) {
    try {
      // Find existing base grid tile at this position
      let existingTile = null;
      this.gameManager.gridContainer.children.forEach(child => {
        if (child.isGridTile && child.gridX === x && child.gridY === y) {
          existingTile = child;
        }
      });
      
      if (!existingTile) {
        return false; // No existing tile to update, need replacement
      }
      
      // Always reset to baseline before redrawing/applying effects to avoid cumulative offsets
      if (typeof existingTile.baseIsoY === 'number') {
        existingTile.y = existingTile.baseIsoY;
      }
      
      // If there is an existing shadow from a previous non-default height, remove it
      if (existingTile.shadowTile && existingTile.parent?.children?.includes(existingTile.shadowTile)) {
        existingTile.parent.removeChild(existingTile.shadowTile);
        if (typeof existingTile.shadowTile.destroy === 'function' && !existingTile.shadowTile.destroyed) {
          existingTile.shadowTile.destroy();
        }
        existingTile.shadowTile = null;
      }
      // Remove any existing base 3D faces
      if (existingTile.baseSideFaces && existingTile.parent?.children?.includes(existingTile.baseSideFaces)) {
        existingTile.parent.removeChild(existingTile.baseSideFaces);
        if (typeof existingTile.baseSideFaces.destroy === 'function' && !existingTile.baseSideFaces.destroyed) {
          existingTile.baseSideFaces.destroy();
        }
        existingTile.baseSideFaces = null;
      }
      
      // Decide styling based on whether terrain mode is active
      const isEditing = !!this.isTerrainModeActive;
      const fillColor = isEditing ? this.getColorForHeight(height) : GRID_CONFIG.TILE_COLOR;
      const borderColor = GRID_CONFIG.TILE_BORDER_COLOR;
      const borderAlpha = GRID_CONFIG.TILE_BORDER_ALPHA;
      const fillAlpha = isEditing ? 0.8 : 1.0;
      
      // Clear and redraw the tile graphics content
      existingTile.clear();
      existingTile.lineStyle(1, borderColor, borderAlpha);
      existingTile.beginFill(fillColor, fillAlpha);
      
      // Redraw diamond shape
      existingTile.moveTo(0, this.gameManager.tileHeight / 2);
      existingTile.lineTo(this.gameManager.tileWidth / 2, 0);
      existingTile.lineTo(this.gameManager.tileWidth, this.gameManager.tileHeight / 2);
      existingTile.lineTo(this.gameManager.tileWidth / 2, this.gameManager.tileHeight);
      existingTile.lineTo(0, this.gameManager.tileHeight / 2);
      existingTile.endFill();
      
      // Update tile properties
      existingTile.terrainHeight = height;
      
      // Apply elevation effect if needed (position only); visuals remain base color when not editing
      if (height !== TERRAIN_CONFIG.DEFAULT_HEIGHT) {
        this.addVisualElevationEffect(existingTile, height);
      } else if (typeof existingTile.baseIsoY === 'number') {
        // Ensure baseline when default height
        existingTile.y = existingTile.baseIsoY;
      }

      // Always attempt to add neighbor-aware base faces (3D walls)
      // Faces will only render when this tile is higher than a neighbor (including height 0 over negative)
      this._addBase3DFaces(existingTile, x, y, height);
      
      return true; // Successfully updated in-place
    } catch (error) {
      logger.log(LOG_LEVEL.DEBUG, 'In-place tile update failed, will use replacement', LOG_CATEGORY.RENDERING, {
        context: 'TerrainCoordinator.updateBaseGridTileInPlace',
        coordinates: { x, y },
        height,
        error: error.message
      });
      return false; // Update failed, caller should use replacement
    }
  }

  /**
   * Replace a base grid tile with terrain-modified version (ENHANCED SAFETY)
   * @param {number} x - Grid X coordinate
   * @param {number} y - Grid Y coordinate  
   * @param {number} height - Terrain height value
   */
  replaceBaseGridTile(x, y, height) {
    try {
      const tilesToRemove = this._findGridTilesToRemove(x, y);
      this._removeGridTilesSafely(tilesToRemove, x, y);
      const newTile = this._createReplacementTile(x, y, height);
      this._applyTileEffectsAndData(newTile, height, x, y);
      this._logTileReplacementSuccess(x, y, height, tilesToRemove.length);
    } catch (error) {
      this._handleTileReplacementError(error, x, y, height);
    }
  }

  /**
   * Find existing grid tiles at specified coordinates that need removal
   * @private
   * @param {number} x - Grid X coordinate
   * @param {number} y - Grid Y coordinate
   * @returns {Array} Array of tiles to remove
   */
  _findGridTilesToRemove(x, y) {
    const tilesToRemove = [];
    const gridChildren = this.gameManager.gridContainer.children || [];
    
    gridChildren.forEach(child => {
      if (child && child.isGridTile && child.gridX === x && child.gridY === y) {
        // Validate child before adding to removal list
        if (!child.destroyed) {
          tilesToRemove.push(child);
        }
      }
    });
    
    return tilesToRemove;
  }

  /**
   * Safely remove grid tiles with error isolation
   * @private
   * @param {Array} tilesToRemove - Array of tiles to remove
   * @param {number} x - Grid X coordinate for logging
   * @param {number} y - Grid Y coordinate for logging
   */
  _removeGridTilesSafely(tilesToRemove, x, y) {
    tilesToRemove.forEach(tile => {
      try {
        if (this.gameManager.gridContainer.children.includes(tile)) {
          this.gameManager.gridContainer.removeChild(tile);
        }
        
        // Destroy tile safely
        if (tile.destroy && !tile.destroyed) {
          tile.destroy();
        }
      } catch (tileRemovalError) {
        logger.warn('Error removing individual tile during replacement', {
          context: 'TerrainCoordinator._removeGridTilesSafely',
          coordinates: { x, y },
          error: tileRemovalError.message
        });
        // Continue with other tiles even if one fails
      }
    });
  }

  /**
   * Create new terrain tile replacement
   * @private
   * @param {number} x - Grid X coordinate
   * @param {number} y - Grid Y coordinate
   * @param {number} height - Terrain height value
   * @returns {PIXI.Graphics} New tile graphics object
   * @throws {Error} If tile creation fails
   */
  _createReplacementTile(x, y, height) {
    const isEditing = !!this.isTerrainModeActive;
    const color = isEditing ? this.getColorForHeight(height) : GRID_CONFIG.TILE_COLOR;
    const newTile = this.gameManager.gridRenderer.drawIsometricTile(x, y, color);
    
    // Validate new tile before returning
    if (!newTile || newTile.destroyed) {
      throw new Error('Failed to create replacement tile');
    }
    
    return newTile;
  }

  /**
   * Apply elevation effects and store height data on tile
   * @private
   * @param {PIXI.Graphics} newTile - The newly created tile
   * @param {number} height - Terrain height value
   * @param {number} x - Grid X coordinate for logging
   * @param {number} y - Grid Y coordinate for logging
   */
  _applyTileEffectsAndData(newTile, height, x, y) {
    // Add visual elevation effect for non-default heights
    if (height !== TERRAIN_CONFIG.DEFAULT_HEIGHT) {
      try {
        this.addVisualElevationEffect(newTile, height);
      } catch (effectError) {
        logger.warn('Failed to add elevation effect, continuing without it', {
          context: 'TerrainCoordinator._applyTileEffectsAndData',
          coordinates: { x, y },
          height,
          error: effectError.message
        });
      }
    }
    // Always attempt to add neighbor-aware base faces (3D walls) regardless of height
    // Faces will only render when this tile is higher than a neighbor (e.g., 0 vs negative)
    this._addBase3DFaces(newTile, x, y, height);
    
    // Store height information on tile
    newTile.terrainHeight = height;
  }

  /**
   * Log successful tile replacement
   * @private
   * @param {number} x - Grid X coordinate
   * @param {number} y - Grid Y coordinate
   * @param {number} height - Terrain height value
   * @param {number} removedTileCount - Number of tiles removed
   */
  _logTileReplacementSuccess(x, y, height, removedTileCount) {
    logger.log(LOG_LEVEL.TRACE, 'Base grid tile replaced safely', LOG_CATEGORY.RENDERING, {
      context: 'TerrainCoordinator.replaceBaseGridTile',
      coordinates: { x, y },
      height,
      removedTiles: removedTileCount,
      newTileCreated: true
    });
  }

  /**
   * Handle tile replacement errors gracefully
   * @private
   * @param {Error} error - The error that occurred
   * @param {number} x - Grid X coordinate
   * @param {number} y - Grid Y coordinate
   * @param {number} height - Terrain height value
   */
  _handleTileReplacementError(error, x, y, height) {
    logger.error('Error replacing base grid tile', {
      context: 'TerrainCoordinator.replaceBaseGridTile',
      coordinates: { x, y },
      height,
      error: error.message
    });
    
    // Don't throw - log error and continue to prevent cascade failures
    // This allows the rest of the grid to update even if one tile fails
  }

  /**
   * Add visual elevation effect to a tile based on height
   * @param {PIXI.Graphics} tile - The tile graphics object
   * @param {number} height - The terrain height
   */
  addVisualElevationEffect(tile, height) {
    try {
      // Reset to baseline isometric Y before applying elevation to avoid stacking
      if (typeof tile.baseIsoY === 'number') {
        tile.y = tile.baseIsoY;
      }
  const elevationOffset = TerrainHeightUtils.calculateElevationOffset(height);
  tile.y += elevationOffset;
      
      // Add subtle border effect for raised/lowered appearance
      if (height > TERRAIN_CONFIG.DEFAULT_HEIGHT) {
        tile.lineStyle(TERRAIN_CONFIG.HEIGHT_BORDER_WIDTH, 0xFFFFFF, 0.3);
      } else if (height < TERRAIN_CONFIG.DEFAULT_HEIGHT) {
        tile.lineStyle(TERRAIN_CONFIG.HEIGHT_BORDER_WIDTH, 0x000000, 0.3);
      }
      
      // Remove any previous shadow if present to avoid duplicates
      if (tile.shadowTile && tile.parent?.children?.includes(tile.shadowTile)) {
        tile.parent.removeChild(tile.shadowTile);
        if (typeof tile.shadowTile.destroy === 'function' && !tile.shadowTile.destroyed) {
          tile.shadowTile.destroy();
        }
        tile.shadowTile = null;
      }

      // Ensure any previous 3D faces attached to this tile are removed here (faces are managed elsewhere)
      if (tile.sideFaces && tile.parent?.children?.includes(tile.sideFaces)) {
        tile.parent.removeChild(tile.sideFaces);
        if (typeof tile.sideFaces.destroy === 'function' && !tile.sideFaces.destroyed) {
          tile.sideFaces.destroy();
        }
        tile.sideFaces = null;
      }
      
      // Add height-based shadow effect
      if (Math.abs(height) > 1) {
        const shadowAlpha = Math.min(Math.abs(height) * 0.1, 0.4);
        const shadowColor = height > 0 ? 0x000000 : 0x444444;
        
        const shadow = new PIXI.Graphics();
        shadow.beginFill(shadowColor, shadowAlpha);
        
        const tileWidth = this.gameManager.tileWidth;
        const tileHeight = this.gameManager.tileHeight;
        shadow.moveTo(0, tileHeight / 2);
        shadow.lineTo(tileWidth / 2, 0);
        shadow.lineTo(tileWidth, tileHeight / 2);
        shadow.lineTo(tileWidth / 2, tileHeight);
        shadow.lineTo(0, tileHeight / 2);
        shadow.endFill();
        
        shadow.x = tile.x + 2;
        shadow.y = tile.y + 2;
        
        if (tile.parent) {
          const tileIndex = tile.parent.getChildIndex(tile);
          tile.parent.addChildAt(shadow, Math.max(0, tileIndex));
          tile.shadowTile = shadow;
        }
      }
    } catch (error) {
      logger.log(LOG_LEVEL.DEBUG, 'Error adding visual elevation effect', LOG_CATEGORY.RENDERING, {
        context: 'TerrainCoordinator.addVisualElevationEffect',
        height,
        error: error.message
      });
    }
  }

  // Add neighbor-aware 3D faces for base grid tiles (all four sides)
  _addBase3DFaces(tile, x, y, height) {
    try {
      // Cleanup previous base faces if any
      if (tile.baseSideFaces && tile.parent?.children?.includes(tile.baseSideFaces)) {
        tile.parent.removeChild(tile.baseSideFaces);
        if (typeof tile.baseSideFaces.destroy === 'function' && !tile.baseSideFaces.destroyed) {
          tile.baseSideFaces.destroy();
        }
        tile.baseSideFaces = null;
      }

      if (!this.dataStore?.base) return;

      const rows = this.dataStore.base.length;
      const cols = this.dataStore.base[0]?.length || 0;
      const getBase = (gx, gy) => (gx >= 0 && gy >= 0 && gy < rows && gx < cols)
        ? this.dataStore.base[gy][gx]
        : TERRAIN_CONFIG.DEFAULT_HEIGHT;

      // Delegate to shared FacesRenderer for consistency
      this.faces.addBaseFaces(tile, x, y, height, getBase);
    } catch (e) {
      logger.warn('Failed to add base 3D faces', { coordinates: { x, y }, error: e.message }, LOG_CATEGORY.RENDERING);
    }
  }
}
