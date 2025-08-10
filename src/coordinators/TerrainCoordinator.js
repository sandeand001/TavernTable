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

export class TerrainCoordinator {
  constructor(gameManager) {
    this.gameManager = gameManager;
    this.terrainManager = null;
    
    // Validate dependencies at construction time
    this.validateDependencies();
    
    // Terrain modification state
    this.isTerrainModeActive = false;
    this.currentTerrainTool = 'raise'; // 'raise', 'lower'
    this.brushSize = 1; // Grid cells affected (1 = single cell)
    this.heightStep = 1; // Amount to modify height per operation
    
    // Terrain data storage - 2D array storing height values
    this.terrainHeights = null;
    
    // UI state
    this.isDragging = false;
    this.lastModifiedCell = null;
    
    logger.log(LOG_LEVEL.DEBUG, 'TerrainCoordinator initialized', LOG_CATEGORY.SYSTEM, {
      context: 'TerrainCoordinator.constructor',
      stage: 'initialization',
      defaultTool: this.currentTerrainTool,
      defaultBrushSize: this.brushSize,
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
      
      // Initialize 2D array with default height (0)
      this.terrainHeights = Array(rows).fill(null).map(() => Array(cols).fill(TERRAIN_CONFIG.DEFAULT_HEIGHT));
      
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
          tool: this.currentTerrainTool,
          brushSize: this.brushSize
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
      
      // Apply brush area modification
      for (let dy = -Math.floor(this.brushSize / 2); dy <= Math.floor(this.brushSize / 2); dy++) {
        for (let dx = -Math.floor(this.brushSize / 2); dx <= Math.floor(this.brushSize / 2); dx++) {
          const targetX = gridX + dx;
          const targetY = gridY + dy;
          
          if (this.isValidGridPosition(targetX, targetY)) {
            this.modifyTerrainHeightAtCell(targetX, targetY);
          }
        }
      }
      
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
    const currentHeight = this.terrainHeights[gridY][gridX];
    let newHeight;
    
    if (this.currentTerrainTool === 'raise') {
      newHeight = Math.min(currentHeight + this.heightStep, TERRAIN_CONFIG.MAX_HEIGHT);
    } else if (this.currentTerrainTool === 'lower') {
      newHeight = Math.max(currentHeight - this.heightStep, TERRAIN_CONFIG.MIN_HEIGHT);
    } else {
      return; // Unknown tool
    }
    
    // Only update if height actually changed
    if (newHeight !== currentHeight) {
      this.terrainHeights[gridY][gridX] = newHeight;
      
      logger.log(LOG_LEVEL.TRACE, 'Terrain height modified', LOG_CATEGORY.USER, {
        context: 'TerrainCoordinator.modifyTerrainHeightAtCell',
        coordinates: { gridX, gridY },
        heightChange: { from: currentHeight, to: newHeight },
        tool: this.currentTerrainTool,
        heightStep: this.heightStep
      });
    }
  }

  /**
   * Check if grid position is valid
   * @param {number} gridX - Grid X coordinate
   * @param {number} gridY - Grid Y coordinate
   * @returns {boolean} True if position is valid
   */
  isValidGridPosition(gridX, gridY) {
    return Number.isInteger(gridX) && Number.isInteger(gridY) &&
           gridX >= 0 && gridX < this.gameManager.cols &&
           gridY >= 0 && gridY < this.gameManager.rows;
  }

  /**
   * Enable terrain modification mode
   */
  enableTerrainMode() {
    this.isTerrainModeActive = true;
    
    // Show terrain tiles
    if (this.terrainManager) {
      this.terrainManager.showAllTerrainTiles();
    }
    
    logger.log(LOG_LEVEL.INFO, 'Terrain mode enabled', LOG_CATEGORY.USER, {
      context: 'TerrainCoordinator.enableTerrainMode',
      tool: this.currentTerrainTool,
      brushSize: this.brushSize
    });
  }

  /**
   * Disable terrain modification mode
   */
  disableTerrainMode() {
    this.isTerrainModeActive = false;
    this.isDragging = false;
    this.lastModifiedCell = null;
    
    // Hide terrain tiles
    if (this.terrainManager) {
      this.terrainManager.hideAllTerrainTiles();
    }
    
    // Reset height indicator
    this.resetHeightIndicator();
    
    logger.log(LOG_LEVEL.INFO, 'Terrain mode disabled', LOG_CATEGORY.USER, {
      context: 'TerrainCoordinator.disableTerrainMode'
    });
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
    
    this.currentTerrainTool = sanitizedTool;
    
    logger.log(LOG_LEVEL.DEBUG, 'Terrain tool changed', LOG_CATEGORY.USER, {
      context: 'TerrainCoordinator.setTerrainTool',
      newTool: this.currentTerrainTool,
      previousTool: tool !== sanitizedTool ? tool : 'same',
      validationMethod: typeof Sanitizers?.enum === 'function' ? 'enum' : 'fallback'
    });
  }

  /**
   * Increase brush size
   */
  increaseBrushSize() {
    const newSize = Math.min(this.brushSize + 1, TERRAIN_CONFIG.MAX_BRUSH_SIZE);
    if (newSize !== this.brushSize) {
      this.brushSize = newSize;
      logger.log(LOG_LEVEL.DEBUG, 'Brush size increased', LOG_CATEGORY.USER, {
        context: 'TerrainCoordinator.increaseBrushSize',
        newSize: this.brushSize
      });
    }
  }

  /**
   * Decrease brush size
   */
  decreaseBrushSize() {
    const newSize = Math.max(this.brushSize - 1, TERRAIN_CONFIG.MIN_BRUSH_SIZE);
    if (newSize !== this.brushSize) {
      this.brushSize = newSize;
      logger.log(LOG_LEVEL.DEBUG, 'Brush size decreased', LOG_CATEGORY.USER, {
        context: 'TerrainCoordinator.decreaseBrushSize',
        newSize: this.brushSize
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
    if (!this.isValidGridPosition(gridX, gridY) || !this.terrainHeights) {
      return TERRAIN_CONFIG.DEFAULT_HEIGHT;
    }
    return this.terrainHeights[gridY][gridX];
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
      const oldHeights = this.terrainHeights;
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
            this.terrainHeights[y][x] = oldHeights[y][x];
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
   * Get terrain system statistics
   * @returns {Object} Terrain system statistics
   */
  getTerrainStatistics() {
    if (!this.terrainHeights) {
      return {
        initialized: false,
        gridDimensions: null,
        heightRange: null,
        modifiedCells: 0
      };
    }
    
    let minHeight = TERRAIN_CONFIG.MAX_HEIGHT;
    let maxHeight = TERRAIN_CONFIG.MIN_HEIGHT;
    let modifiedCells = 0;
    
    for (let y = 0; y < this.gameManager.rows; y++) {
      for (let x = 0; x < this.gameManager.cols; x++) {
        const height = this.terrainHeights[y][x];
        minHeight = Math.min(minHeight, height);
        maxHeight = Math.max(maxHeight, height);
        
        if (height !== TERRAIN_CONFIG.DEFAULT_HEIGHT) {
          modifiedCells++;
        }
      }
    }
    
    return {
      initialized: true,
      gridDimensions: { 
        cols: this.gameManager.cols, 
        rows: this.gameManager.rows 
      },
      heightRange: { min: minHeight, max: maxHeight },
      modifiedCells,
      totalCells: this.gameManager.cols * this.gameManager.rows,
      isTerrainModeActive: this.isTerrainModeActive,
      currentTool: this.currentTerrainTool,
      brushSize: this.brushSize
    };
  }
}
