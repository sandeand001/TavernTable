// Prettier enabled: previously disabled for iterative edits; restored for standard formatting
/**
 * InteractionManager.js - Manages user interactions with the grid
 *
 * Extracted from GameManager to follow single responsibility principle
 * Handles all user input interactions including mouse, keyboard, and zoom
 */

import { logger, LOG_LEVEL, LOG_CATEGORY } from '../utils/Logger.js';
import { ErrorHandler, ERROR_SEVERITY, ERROR_CATEGORY } from '../utils/ErrorHandler.js';
import { CoordinateUtils } from '../utils/CoordinateUtils.js';
import { TerrainHeightUtils } from '../utils/TerrainHeightUtils.js';
import {
  isPointInCellDiamond as _isPointInCellDiamond,
  pickTopmostGridCellAt as _pickTopmost,
} from './interaction-manager/internals/picking.js';
import {
  startGridDragging as _startDrag,
  updateGridDragPosition as _updateDrag,
  stopGridDragging as _stopDrag,
} from './interaction-manager/internals/pan.js';
import {
  handleZoomWheel as _handleZoomWheel,
  applyZoom as _applyZoom,
  resetZoom as _resetZoom,
} from './interaction-manager/internals/zoom.js';

export class InteractionManager {
  constructor(gameManager) {
    // Core refs
    this.gameManager = gameManager;

    // Grid panning variables
    this.isDragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.gridStartX = 0;
    this.gridStartY = 0;
    this.isSpacePressed = false;

    // 3D rotation (when Three scene active)
    this.isRotating3D = false;
    this.rotateStartX = 0;
    this.rotateStartY = 0;
    this.startYaw = 0;
    this.startPitchDeg = 0;
    this.rotationSensitivity = 0.35; // degrees per pixel vertical
    this.yawSensitivity = 0.5; // degrees per pixel horizontal

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
      if (event.button === 0) {
        // Left mouse button
        if (this.isSpacePressed) {
          // If 3D manager present, rotate camera instead of panning the 2D grid.
          const threeMgr = this.gameManager?.threeSceneManager;
          if (threeMgr && threeMgr.camera) {
            this.start3DRotation(event, threeMgr);
          } else {
            this.startGridDragging(event);
          }
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
      if (this.isRotating3D) {
        this.update3DRotation(event);
      } else if (this.isDragging) {
        this.updateGridDragPosition(event);
      }
    });
  }

  /**
   * Handle mouse up events
   */
  setupMouseUp() {
    this.gameManager.app.view.addEventListener('mouseup', (event) => {
      if (event.button === 0) {
        if (this.isRotating3D) {
          this.stop3DRotation();
        } else if (this.isDragging) {
          this.stopGridDragging();
        }
      }
    });
  }

  /**
   * Handle mouse leave events
   */
  setupMouseLeave() {
    this.gameManager.app.view.addEventListener('mouseleave', () => {
      if (this.isRotating3D) {
        this.stop3DRotation();
      } else if (this.isDragging) {
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
        if (!this.isDragging && !this.isRotating3D) {
          this.gameManager.app.view.style.cursor = 'grab'; // initial visual; switches to grabbing when active
        }
        event.preventDefault();
      }
    });

    document.addEventListener('keyup', (event) => {
      if (event.code === 'Space') {
        this.isSpacePressed = false;
        if (!this.isDragging && !this.isRotating3D) {
          this.gameManager.app.view.style.cursor = 'default';
        }
      }
    });
  }

  /** Begin 3D camera rotation (space + drag) */
  start3DRotation(event, threeMgr) {
    try {
      this.isRotating3D = true;
      this.rotateStartX = event.clientX;
      this.rotateStartY = event.clientY;
      // Capture starting yaw/pitch from manager private fields if accessible
      this.startYaw = threeMgr._isoYaw || 0;
      const startPitchRad = threeMgr._isoPitch != null ? threeMgr._isoPitch : 0.6;
      this.startPitchDeg = (startPitchRad * 180) / Math.PI;
      this.gameManager.app.view.style.cursor = 'grabbing';
      event.preventDefault();
      event.stopPropagation();
    } catch (e) {
      this.isRotating3D = false;
    }
  }

  /** Update 3D rotation given current mouse */
  update3DRotation(event) {
    try {
      if (!this.isRotating3D) return;
      const threeMgr = this.gameManager?.threeSceneManager;
      if (!threeMgr) return;
      const dx = event.clientX - this.rotateStartX;
      const dy = event.clientY - this.rotateStartY;
      // Horizontal drag adjusts yaw
      const yawDeltaDeg = dx * this.yawSensitivity;
      let newYaw = this.startYaw + (yawDeltaDeg * Math.PI) / 180;
      // Normalize yaw into [0, 2PI)
      const TAU = Math.PI * 2;
      newYaw = ((newYaw % TAU) + TAU) % TAU;
      // Vertical drag adjusts pitch (dragging up now lowers pitch; dragging down increases pitch)
      const pitchDeltaDeg = dy * this.rotationSensitivity;
      let newPitchDeg = this.startPitchDeg + pitchDeltaDeg;
      if (newPitchDeg < 0) newPitchDeg = 0;
      if (newPitchDeg > 89.9) newPitchDeg = 89.9;
      // Apply new spherical orientation
      threeMgr.setIsoAngles({ yaw: newYaw, pitch: (newPitchDeg * Math.PI) / 180 });
      if (!threeMgr._isoMode) {
        // In free mode maintain orientation via general pitch setter
        threeMgr.setCameraPitchDegrees(newPitchDeg);
      }
    } catch (_) {
      /* ignore */
    }
  }

  /** End 3D rotation */
  stop3DRotation() {
    this.isRotating3D = false;
    this.gameManager.app.view.style.cursor = this.isSpacePressed ? 'grab' : 'default';
  }

  /**
   * Start grid dragging interaction
   * @param {MouseEvent} event - Mouse event
   */
  startGridDragging(event) {
    return _startDrag(this, event);
  }

  /**
   * Update grid position during drag
   * @param {MouseEvent} event - Mouse event
   */
  updateGridDragPosition(event) {
    return _updateDrag(this, event);
  }

  /**
   * Stop grid dragging interaction
   */
  stopGridDragging() {
    return _stopDrag(this);
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
    return _handleZoomWheel(this, event);
  }

  /**
   * Apply zoom transformation
   * @param {number} newScale - New scale value
   * @param {number} mouseX - Mouse X position
   * @param {number} mouseY - Mouse Y position
   */
  applyZoom(newScale, mouseX, mouseY) {
    return _applyZoom(this, newScale, mouseX, mouseY);
  }

  /**
   * Reset zoom to default scale and center grid
   */
  resetZoom() {
    return _resetZoom(this);
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

      // Check if terrain mode is active OR a placeable is actively selected (and panel visible)
      const terrainActive =
        this.gameManager.isTerrainModeActive && this.gameManager.isTerrainModeActive();
      // Only treat placeables as blocking when a placeable is actually selected AND the Placeable Tiles panel is visible.
      const placeableSelected =
        this.gameManager &&
        this.gameManager.terrainCoordinator &&
        typeof this.gameManager.terrainCoordinator.getSelectedPlaceable === 'function'
          ? !!this.gameManager.terrainCoordinator.getSelectedPlaceable()
          : false;
      const panelVisible =
        this.gameManager &&
        this.gameManager.terrainCoordinator &&
        typeof this.gameManager.terrainCoordinator.isPlaceablesPanelVisible === 'function'
          ? !!this.gameManager.terrainCoordinator.isPlaceablesPanelVisible()
          : false;

      if (terrainActive || (placeableSelected && panelVisible)) {
        // Terrain mode active or a placeable is selected, token placement is disabled
        logger.log('Token placement blocked - state', LOG_LEVEL.INFO, LOG_CATEGORY.INTERACTION, {
          terrainActive: !!terrainActive,
          placeableSelected: !!placeableSelected,
          placeablesPanelVisible: !!panelVisible,
        });

        // Provide visual feedback through cursor change or similar
        try {
          this.gameManager.app.view.style.cursor = 'not-allowed';
        } catch (_) {
          /* ignore UI failures */
        }
        const t = setTimeout(() => {
          try {
            this.gameManager.app.view.style.cursor = terrainActive ? 'crosshair' : 'default';
          } catch (_) {
            /* ignore */
          }
        }, 200);
        if (typeof t?.unref === 'function') t.unref();

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
            event: { x: event.clientX, y: event.clientY },
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
        event: { button: event.button, x: event.clientX, y: event.clientY },
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

      // Enhanced picking: prefer visually topmost tile at pointer, honoring elevation
      const picked = this.pickTopmostGridCellAt(localCoords.localX, localCoords.localY);
      if (!picked) {
        return null;
      }

      if (!this.isValidGridPosition(picked)) {
        return null;
      }
      return picked;
    } catch (error) {
      new ErrorHandler().handle(error, ERROR_SEVERITY.MEDIUM, ERROR_CATEGORY.INPUT, {
        context: 'getGridCoordinatesFromClick',
        stage: 'coordinate_conversion',
        event: event ? { x: event.clientX, y: event.clientY } : null,
      });
      return null;
    }
  }

  /**
   * Hit test an isometric diamond at grid cell (gx, gy) against a local point (lx, ly)
   * Accounts for elevation offset so the test matches the visually shifted tile.
   */
  _isPointInCellDiamond(gx, gy, lx, ly) {
    return _isPointInCellDiamond(this, gx, gy, lx, ly);
  }

  /**
   * Pick the topmost grid cell under local pointer, considering elevation and depth order.
   * Returns { gridX, gridY } or null.
   */
  pickTopmostGridCellAt(localX, localY) {
    return _pickTopmost(this, localX, localY);
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
      mouseY: event.clientY - rect.top,
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
      localY: gridRelativeY / this.gridScale,
    };
  }

  /**
   * Convert to grid coordinates
   * @param {Object} localCoords - Local coordinates
   * @returns {Object} Grid coordinates
   */
  convertToGridCoordinates({ localX, localY }) {
    // If in top-down view mode, apply orthographic inversion (center-aligned)
    if (this.gameManager.getViewMode && this.gameManager.getViewMode() === 'topdown') {
      const gx = Math.round(localX / this.gameManager.tileWidth - 0.5);
      const gy = Math.round(localY / this.gameManager.tileHeight - 0.5);
      return { gridX: gx, gridY: gy };
    }

    // Isometric path: Convert to continuous (fractional) grid coordinates first. This avoids
    // premature rounding which can flip tiles when the pointer is near diamond boundaries.
    let gridCoords = CoordinateUtils.isometricToGrid(
      localX,
      localY,
      this.gameManager.tileWidth,
      this.gameManager.tileHeight
    );

    // If a fractional result was provided, prefer it for nearby-candidate tests.
    const gridXf = typeof gridCoords.gridXf === 'number' ? gridCoords.gridXf : gridCoords.gridX;
    const gridYf = typeof gridCoords.gridYf === 'number' ? gridCoords.gridYf : gridCoords.gridY;

    // Elevation-aware refinement: if the candidate cell has elevation, adjust
    // the localY before converting so the fractional coords align with visual.
    try {
      const candidateX = Math.round(gridXf);
      const candidateY = Math.round(gridYf);
      const height = this.gameManager?.terrainCoordinator?.dataStore?.get(candidateX, candidateY);
      if (Number.isFinite(height) && height !== 0) {
        const elevOffset = TerrainHeightUtils.calculateElevationOffset(height);
        if (elevOffset !== 0) {
          const refined = CoordinateUtils.isometricToGrid(
            localX,
            localY - elevOffset, // remove visual shift to recover baseline before inversion
            this.gameManager.tileWidth,
            this.gameManager.tileHeight
          );
          // prefer fractional refined values when available
          gridCoords = refined;
        }
      }
    } catch (_) {
      /* graceful fallback if terrain not initialized */
    }

    return gridCoords;
  }

  /**
   * Validate if grid position is within bounds
   * @param {Object} gridCoords - Grid coordinates
   * @returns {boolean} True if position is valid
   */
  isValidGridPosition({ gridX, gridY }) {
    // Consolidated validation: coordinates must be integers within grid bounds
    return CoordinateUtils.isValidGridPosition(
      gridX,
      gridY,
      this.gameManager.cols,
      this.gameManager.rows
    );
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
