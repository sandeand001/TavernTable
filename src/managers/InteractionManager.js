/**
 * InteractionManager.js - Manages user interactions with the grid
 * 
 * Extracted from GameManager to follow single responsibility principle
 * Handles all user input interactions including mouse, keyboard, and zoom
 */

import { logger, LOG_LEVEL, LOG_CATEGORY } from '../utils/Logger.js';
import { ErrorHandler, ERROR_SEVERITY, ERROR_CATEGORY } from '../utils/ErrorHandler.js';
import { GameValidators } from '../utils/Validation.js';
import { CoordinateUtils } from '../utils/CoordinateUtils.js';

export class InteractionManager {
  constructor(gameManager) {
    this.gameManager = gameManager;
    
    // Grid panning variables
    this.isDragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.gridStartX = 0;
    this.gridStartY = 0;
    this.isSpacePressed = false;
    
    // Grid zoom variables
    this.gridScale = 1.0;
    this.minScale = 0.2;
    this.maxScale = 3.0;
    this.zoomSpeed = 0.1;
  }

  /**
   * Set up all grid interactions
   */
  setupGridInteraction() {
    this.setupContextMenu();
    this.setupMouseInteractions();
    this.setupKeyboardInteractions();
    this.setupZoomInteraction();
  }

  /**
   * Disable browser context menu
   */
  setupContextMenu() {
    this.gameManager.app.view.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });
  }

  /**
   * Set up mouse interaction handlers
   */
  setupMouseInteractions() {
    this.setupMouseDown();
    this.setupMouseMove();
    this.setupMouseUp();
    this.setupMouseLeave();
  }

  /**
   * Handle mouse down events
   */
  setupMouseDown() {
    this.gameManager.app.view.addEventListener('mousedown', (event) => {
      if (event.button === 0) { // Left mouse button
        if (this.isSpacePressed) {
          // Space + left click = panning
          this.startGridDragging(event);
        } else {
          // Regular left click = token placement
          this.handleLeftClick(event);
        }
      }
    });
  }

  /**
   * Handle mouse move events
   */
  setupMouseMove() {
    this.gameManager.app.view.addEventListener('mousemove', (event) => {
      if (this.isDragging) {
        this.updateGridDragPosition(event);
      }
    });
  }

  /**
   * Handle mouse up events
   */
  setupMouseUp() {
    this.gameManager.app.view.addEventListener('mouseup', (event) => {
      if (this.isDragging && event.button === 0) {
        this.stopGridDragging();
      }
    });
  }

  /**
   * Handle mouse leave events
   */
  setupMouseLeave() {
    this.gameManager.app.view.addEventListener('mouseleave', () => {
      if (this.isDragging) {
        this.stopGridDragging();
      }
    });
  }

  /**
   * Set up keyboard interactions
   */
  setupKeyboardInteractions() {
    // Space bar for panning
    document.addEventListener('keydown', (event) => {
      if (event.code === 'Space' && !event.repeat) {
        this.isSpacePressed = true;
        if (!this.isDragging) {
          this.gameManager.app.view.style.cursor = 'grab';
        }
        event.preventDefault();
      }
    });

    document.addEventListener('keyup', (event) => {
      if (event.code === 'Space') {
        this.isSpacePressed = false;
        if (!this.isDragging) {
          this.gameManager.app.view.style.cursor = 'default';
        }
      }
    });
  }

  /**
   * Start grid dragging interaction
   * @param {MouseEvent} event - Mouse event
   */
  startGridDragging(event) {
    this.isDragging = true;
    this.dragStartX = event.clientX;
    this.dragStartY = event.clientY;
    this.gridStartX = this.gameManager.gridContainer.x;
    this.gridStartY = this.gameManager.gridContainer.y;
    this.gameManager.app.view.style.cursor = 'grabbing';
    
    logger.log(LOG_LEVEL.TRACE, 'Grid dragging started', LOG_CATEGORY.USER, {
      startPosition: { x: this.dragStartX, y: this.dragStartY },
      gridPosition: { x: this.gridStartX, y: this.gridStartY },
      currentScale: this.gridScale
    });
    
    event.preventDefault();
    event.stopPropagation();
  }

  /**
   * Update grid position during drag
   * @param {MouseEvent} event - Mouse event
   */
  updateGridDragPosition(event) {
    const deltaX = event.clientX - this.dragStartX;
    const deltaY = event.clientY - this.dragStartY;
    this.gameManager.gridContainer.x = this.gridStartX + deltaX;
    this.gameManager.gridContainer.y = this.gridStartY + deltaY;
  }

  /**
   * Stop grid dragging interaction
   */
  stopGridDragging() {
    this.isDragging = false;
    this.gameManager.app.view.style.cursor = this.isSpacePressed ? 'grab' : 'default';
  }

  /**
   * Set up zoom interaction handlers
   */
  setupZoomInteraction() {
    this.gameManager.app.view.addEventListener('wheel', (event) => {
      event.preventDefault();
      this.handleZoomWheel(event);
    });
  }

  /**
   * Handle zoom wheel events
   * @param {WheelEvent} event - Wheel event
   */
  handleZoomWheel(event) {
    const rect = this.gameManager.app.view.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    
    const zoomDirection = event.deltaY > 0 ? -1 : 1;
    const zoomFactor = 1 + (this.zoomSpeed * zoomDirection);
    const newScale = this.gridScale * zoomFactor;
    
    if (newScale < this.minScale || newScale > this.maxScale) {
      return;
    }
    
    this.applyZoom(newScale, mouseX, mouseY);
    logger.log(LOG_LEVEL.DEBUG, 'Zoom applied', LOG_CATEGORY.USER, {
      zoomDirection,
      zoomFactor,
      previousScale: this.gridScale / zoomFactor,
      newScale: this.gridScale,
      zoomPercentage: `${(this.gridScale * 100).toFixed(0)}%`,
      mousePosition: { x: mouseX, y: mouseY },
      bounds: { min: this.minScale, max: this.maxScale }
    });
  }

  /**
   * Apply zoom transformation
   * @param {number} newScale - New scale value
   * @param {number} mouseX - Mouse X position
   * @param {number} mouseY - Mouse Y position
   */
  applyZoom(newScale, mouseX, mouseY) {
    const localX = (mouseX - this.gameManager.gridContainer.x) / this.gridScale;
    const localY = (mouseY - this.gameManager.gridContainer.y) / this.gridScale;
    
    this.gridScale = newScale;
    this.gameManager.gridContainer.scale.set(this.gridScale);
    
    this.gameManager.gridContainer.x = mouseX - localX * this.gridScale;
    this.gameManager.gridContainer.y = mouseY - localY * this.gridScale;
  }

  /**
   * Reset zoom to default scale and center grid
   */
  resetZoom() {
    try {
      this.gridScale = 1.0;
      this.gameManager.gridContainer.scale.set(this.gridScale);
      this.gameManager.centerGrid();
      logger.debug('Grid zoom reset to default', {
        newScale: this.gridScale
      }, LOG_CATEGORY.USER);
    } catch (error) {
      const errorHandler = new ErrorHandler();
      errorHandler.handle(error, ERROR_SEVERITY.ERROR, ERROR_CATEGORY.RENDERING, { 
        stage: 'resetZoom' 
      });
    }
  }

  /**
   * Handle left mouse click for token interactions
   * @param {MouseEvent} event - Mouse click event
   */
  handleLeftClick(event) {
    try {
      if (event.button !== 0) {
        return;
      }
      
      const gridCoords = this.getGridCoordinatesFromClick(event);
      if (!gridCoords) {
        const errorHandler = new ErrorHandler();
        errorHandler.handle(
          new Error('Click outside valid grid area'), 
          ERROR_SEVERITY.INFO, 
          ERROR_CATEGORY.VALIDATION, 
          {
            event: { x: event.clientX, y: event.clientY }
          }
        );
        return;
      }
      
      const { gridX, gridY } = gridCoords;
      this.gameManager.handleTokenInteraction(gridX, gridY);
    } catch (error) {
      const errorHandler = new ErrorHandler();
      errorHandler.handle(error, ERROR_SEVERITY.ERROR, ERROR_CATEGORY.INPUT, {
        stage: 'handleLeftClick',
        event: { button: event.button, x: event.clientX, y: event.clientY }
      });
    }
  }

  /**
   * Get grid coordinates from mouse click event
   * @param {MouseEvent} event - Mouse click event
   * @returns {Object|null} Grid coordinates or null if invalid
   */
  getGridCoordinatesFromClick(event) {
    try {
      const mouseCoords = this.getMousePosition(event);
      const localCoords = this.convertToLocalCoordinates(mouseCoords);
      const gridCoords = this.convertToGridCoordinates(localCoords);
      
      if (!this.isValidGridPosition(gridCoords)) {
        return null;
      }
      
      return gridCoords;
    } catch (error) {
      new ErrorHandler().handle(error, ERROR_SEVERITY.MEDIUM, ERROR_CATEGORY.INPUT, {
        context: 'getGridCoordinatesFromClick',
        stage: 'coordinate_conversion',
        event: event ? { x: event.clientX, y: event.clientY } : null
      });
      return null;
    }
  }

  /**
   * Get mouse position relative to canvas
   * @param {MouseEvent} event - Mouse event
   * @returns {Object} Mouse coordinates
   */
  getMousePosition(event) {
    const rect = this.gameManager.app.view.getBoundingClientRect();
    return {
      mouseX: event.clientX - rect.left,
      mouseY: event.clientY - rect.top
    };
  }

  /**
   * Convert to local grid coordinates
   * @param {Object} mouseCoords - Mouse coordinates
   * @returns {Object} Local coordinates
   */
  convertToLocalCoordinates({ mouseX, mouseY }) {
    const gridRelativeX = mouseX - this.gameManager.gridContainer.x;
    const gridRelativeY = mouseY - this.gameManager.gridContainer.y;
    
    return {
      localX: gridRelativeX / this.gridScale,
      localY: gridRelativeY / this.gridScale
    };
  }

  /**
   * Convert to grid coordinates
   * @param {Object} localCoords - Local coordinates
   * @returns {Object} Grid coordinates
   */
  convertToGridCoordinates({ localX, localY }) {
    return CoordinateUtils.isometricToGrid(
      localX, 
      localY, 
      this.gameManager.tileWidth, 
      this.gameManager.tileHeight
    );
  }

  /**
   * Validate if grid position is within bounds
   * @param {Object} gridCoords - Grid coordinates
   * @returns {boolean} True if position is valid
   */
  isValidGridPosition({ gridX, gridY }) {
    const coordValidation = GameValidators.coordinates(gridX, gridY);
    return coordValidation.isValid && 
           CoordinateUtils.isValidGridPosition(gridX, gridY, this.gameManager.cols, this.gameManager.rows);
  }

  // Getters for backward compatibility
  getGridScale() {
    return this.gridScale;
  }

  setGridScale(scale) {
    this.gridScale = scale;
  }

  getIsDragging() {
    return this.isDragging;
  }

  getIsSpacePressed() {
    return this.isSpacePressed;
  }
}
