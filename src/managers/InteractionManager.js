// Prettier enabled: previously disabled for iterative edits; restored for standard formatting
/**
 * InteractionManager.js - Manages user interactions with the grid
 *
 * Extracted from GameManager to follow single responsibility principle
 * Handles all user input interactions including mouse, keyboard, and zoom
 */

import { logger, LOG_LEVEL, LOG_CATEGORY } from '../utils/logger/Logger.js';
import { ErrorHandler, ERROR_SEVERITY, ERROR_CATEGORY } from '../utils/error/ErrorHandler.js';
import { CoordinateUtils } from '../utils/coordinates/CoordinateUtils.js';
import { TerrainHeightUtils } from '../utils/terrain/TerrainHeightUtils.js';
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
import {
  handleTokenRotationKeyDown as _handleRotationDown,
  handleTokenRotationKeyUp as _handleRotationUp,
  handleTokenMovementKeyDown as _handleMovementDown,
  handleTokenMovementKeyUp as _handleMovementUp,
  shouldIgnoreKeyTarget as _shouldIgnoreKey,
} from './interaction-manager/internals/keyboard.js';
import {
  start3DRotation as _start3DRotation,
  update3DRotation as _update3DRotation,
  stop3DRotation as _stop3DRotation,
} from './interaction-manager/internals/rotation.js';
import {
  resolvePointerTarget as _resolveTarget,
  tryCaptureRadialTrigger as _captureRadial,
  dispatchRadialMenuRequest as _dispatchRadial,
  pick3DTarget as _pick3D,
  pickSpriteTarget as _pickSprite,
  pickTokenBySprite as _pickBySprite,
  get3DTokenScreenPosition as _get3DScreenPos,
} from './interaction-manager/internals/target-resolution.js';

export class InteractionManager {
  // ── Constructor ─────────────────────────────────────────────
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

    // Track active pointer drag state so right-drag panning persists outside the canvas
    this._activeDragButton = null;
    this._globalMouseMoveListening = false;
    this._globalMouseUpListening = false;
    this._boundGlobalMouseMove = this._handleGlobalMouseMove.bind(this);
    this._boundGlobalMouseUp = this._handleGlobalMouseUp.bind(this);
    this._pointerScratch = { x: 0, y: 0 };
    this._pendingRadialContext = null;
    this._radialDragThresholdSq = 81; // ~9px of pointer travel cancels radial capture
    this._radialProjectVector = null;
  }

  // ── Lifecycle ─────────────────────────────────────────────
  /**
   * Set up all grid interactions
   */
  setupGridInteraction() {
    this.setupContextMenu();
    this.setupMouseInteractions();
    this.setupKeyboardInteractions();
    this.setupZoomInteraction();
  }

  // ── Event Setup ─────────────────────────────────────────────
  /**
   * Disable browser context menu
   */
  setupContextMenu() {
    this.gameManager.getEventCanvas().addEventListener('contextmenu', (event) => {
      event.preventDefault();
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
   * Handle mouse down events with 3D-aware context menu logic
   */
  setupMouseDown() {
    const view = this.gameManager.getEventCanvas();
    view.addEventListener('mousedown', (event) => {
      if (event.button === 2) {
        if (this._tryCaptureRadialTrigger(event)) {
          return;
        }
        this._startRightButtonDrag(event);
        return;
      }

      if (event.button !== 0) {
        return;
      }

      if (this.isSpacePressed) {
        this.startGridDragging(event);
        return;
      }

      // Regular left click = token placement
      this.handleLeftClick(event);
    });
  }

  /**
   * Handle mouse move events
   */
  setupMouseMove() {
    const view = this.gameManager.getEventCanvas();
    view.addEventListener('mousemove', (event) => {
      if (this._pendingRadialContext) {
        this._pendingRadialContext.lastScreenX = event.clientX;
        this._pendingRadialContext.lastScreenY = event.clientY;
        if (event.buttons === 2) {
          const dx = event.clientX - this._pendingRadialContext.originX;
          const dy = event.clientY - this._pendingRadialContext.originY;
          if (dx * dx + dy * dy > this._radialDragThresholdSq) {
            const resumeEvent = this._pendingRadialContext.initialEvent || event;
            this._pendingRadialContext = null;
            this._startRightButtonDrag(resumeEvent);
            return;
          }
        }
      }
      if (this.isRotating3D) {
        this.update3DRotation(event);
        return;
      }

      if (this.isDragging) {
        this.updateGridDragPosition(event);
      }
    });
  }

  /**
   * Handle mouse up events
   */
  setupMouseUp() {
    const view = this.gameManager.getEventCanvas();
    view.addEventListener('mouseup', (event) => {
      if (event.button === 2) {
        if (this._pendingRadialContext) {
          this._dispatchRadialMenuRequest(this._pendingRadialContext);
          this._pendingRadialContext = null;
          event.preventDefault();
          return;
        }
        if (this.isRotating3D) {
          this.stop3DRotation();
        } else if (this.isDragging) {
          this.stopGridDragging();
        }
        event.preventDefault();
        return;
      }

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
    const view = this.gameManager.getEventCanvas();
    view.addEventListener('mouseleave', () => {
      if (this.isDragging || this.isRotating3D) {
        this._ensureGlobalDragListeners();
      }
    });
  }

  /**
   * Set up keyboard interactions
   */
  setupKeyboardInteractions() {
    document.addEventListener('keydown', (event) => {
      if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
        this.gameManager?.token3DAdapter?.setShiftModifier?.(true);
      }

      if (this._handleTokenRotationKeyDown(event) || this._handleTokenMovementKeyDown(event)) {
        event.preventDefault();
      }
    });

    document.addEventListener('keyup', (event) => {
      if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
        this.gameManager?.token3DAdapter?.setShiftModifier?.(false);
      }

      if (this._handleTokenRotationKeyUp(event) || this._handleTokenMovementKeyUp(event)) {
        event.preventDefault();
      }
    });
  }

  /**
   * Set up zoom interaction handlers
   */
  setupZoomInteraction() {
    this.gameManager.getEventCanvas().addEventListener('wheel', (event) => {
      event.preventDefault();
      this.handleZoomWheel(event);
    });
  }

  // ── Mouse Handlers ─────────────────────────────────────────────
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
      const terrainCoordinator = this.gameManager?.terrainCoordinator;
      const placeableSelected =
        typeof terrainCoordinator?.getSelectedPlaceable === 'function'
          ? !!terrainCoordinator.getSelectedPlaceable()
          : false;
      const panelVisible =
        typeof terrainCoordinator?.isPlaceablesPanelVisible === 'function'
          ? !!terrainCoordinator.isPlaceablesPanelVisible()
          : false;

      if (terrainActive || (placeableSelected && panelVisible)) {
        // Terrain mode active or a placeable is selected, token placement is disabled
        logger.log('Token placement blocked - state', LOG_LEVEL.INFO, LOG_CATEGORY.INTERACTION, {
          terrainActive: !!terrainActive,
          placeableSelected: !!placeableSelected,
          placeablesPanelVisible: !!panelVisible,
        });
        try {
          this.gameManager.getEventCanvas().style.cursor = 'not-allowed';
        } catch (_) {
          /* ignore */
        }
        const t = setTimeout(() => {
          try {
            this.gameManager.getEventCanvas().style.cursor = terrainActive
              ? 'crosshair'
              : 'default';
          } catch (_) {
            /* ignore */
          }
        }, 200);
        if (typeof t?.unref === 'function') t.unref();
        return;
      }

      const gm = this.gameManager;
      const selectedTokenType =
        typeof gm?.selectedTokenType === 'string' ? gm.selectedTokenType : null;
      const isRemoveMode = selectedTokenType === 'remove';

      Promise.resolve(this._resolvePointerTarget(event))
        .then((target) => {
          const safeTarget = target || {};
          const gridX = Number.isFinite(safeTarget.gridX) ? safeTarget.gridX : null;
          const gridY = Number.isFinite(safeTarget.gridY) ? safeTarget.gridY : null;
          const tokenEntry = safeTarget.token || null;

          if (isRemoveMode) {
            if (gridX != null && gridY != null) {
              gm.handleTokenInteraction(gridX, gridY);
            }
            return;
          }

          if (tokenEntry) {
            this._selectTokenEntry(tokenEntry);
            return;
          }

          const adapter = gm?.token3DAdapter;
          const selectedToken = adapter?.getSelectedToken?.() || null;
          const canNavigate =
            selectedToken &&
            adapter?.navigateToGrid &&
            typeof adapter.navigateToGrid === 'function' &&
            gm?.is3DModeActive?.() &&
            gridX != null &&
            gridY != null;

          if (canNavigate) {
            const tokenDescriptor = this._describeTokenForLogs(selectedToken);
            logger.log('Token navigation requested', LOG_LEVEL.INFO, LOG_CATEGORY.INTERACTION, {
              source: 'grid-click',
              token: tokenDescriptor,
              target: { gridX, gridY },
            });

            const result = adapter.navigateToGrid(selectedToken, gridX, gridY);
            if (result) {
              logger.log('Token navigation accepted', LOG_LEVEL.INFO, LOG_CATEGORY.INTERACTION, {
                source: 'grid-click',
                token: tokenDescriptor,
                target: { gridX, gridY },
                goal: result.goal ? { gridX: result.goal.gridX, gridY: result.goal.gridY } : null,
                speedMode: result.speedMode || null,
                distance: Number.isFinite(result.distance) ? result.distance : null,
              });
              return;
            }

            logger.log('Token navigation rejected', LOG_LEVEL.WARN, LOG_CATEGORY.INTERACTION, {
              source: 'grid-click',
              token: tokenDescriptor,
              target: { gridX, gridY },
            });
          }

          this._clearTokenSelection();
        })
        .catch((error) => {
          try {
            new ErrorHandler().handle(error, ERROR_SEVERITY.ERROR, ERROR_CATEGORY.INPUT, {
              stage: 'resolvePointerTarget',
              event: { button: event.button, x: event.clientX, y: event.clientY },
            });
          } catch (_) {
            /* ignore secondary errors */
          }
        });
    } catch (error) {
      const errorHandler = new ErrorHandler();
      errorHandler.handle(error, ERROR_SEVERITY.ERROR, ERROR_CATEGORY.INPUT, {
        stage: 'handleLeftClick',
        event: { button: event.button, x: event.clientX, y: event.clientY },
      });
    }
  }

  _startRightButtonDrag(event) {
    this._activeDragButton = 2;
    const gm = this.gameManager;
    const threeMgr = gm?.threeSceneManager;
    if (threeMgr && threeMgr.camera) {
      this.start3DRotation(event, threeMgr);
    } else {
      this.startGridDragging(event);
    }
    this._ensureGlobalDragListeners();
  }

  _handleGlobalMouseMove(event) {
    if (this.isRotating3D) {
      this.update3DRotation(event);
      return;
    }
    if (this.isDragging) {
      this.updateGridDragPosition(event);
    }
  }

  _handleGlobalMouseUp(event) {
    if (this._pendingRadialContext && event.button === 2) {
      this._dispatchRadialMenuRequest(this._pendingRadialContext);
      this._pendingRadialContext = null;
      if (typeof event.preventDefault === 'function') {
        event.preventDefault();
      }
      return;
    }

    if (this._activeDragButton === null) {
      this._removeGlobalDragListeners();
      return;
    }

    const matchingButton = event.button === this._activeDragButton;
    const noButtonsPressed = event.buttons === 0;
    if (!matchingButton && !noButtonsPressed) {
      return;
    }

    if (this._activeDragButton === 0) {
      if (this.isRotating3D) {
        this.stop3DRotation();
      } else if (this.isDragging) {
        this.stopGridDragging();
      } else {
        this._activeDragButton = null;
        this._removeGlobalDragListeners();
      }
      return;
    }

    if (this._activeDragButton === 2 && this.isDragging) {
      this.stopGridDragging();
      return;
    }

    if (this._activeDragButton === 2 && this.isRotating3D) {
      this.stop3DRotation();
      return;
    }

    this._activeDragButton = null;
    this._removeGlobalDragListeners();
  }

  // ── Delegating Methods ─────────────────────────────────────────────
  /** Begin 3D camera rotation (right mouse drag) */
  start3DRotation(event, threeMgr) {
    return _start3DRotation(this, event, threeMgr);
  }

  /** Update 3D rotation given current mouse */
  update3DRotation(event) {
    return _update3DRotation(this, event);
  }

  /** End 3D rotation */
  stop3DRotation() {
    return _stop3DRotation(this);
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
    const result = _stopDrag(this);
    this._activeDragButton = null;
    this._removeGlobalDragListeners();
    return result;
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

  _handleTokenRotationKeyDown(event) {
    return _handleRotationDown(this, event);
  }

  _handleTokenRotationKeyUp(event) {
    return _handleRotationUp(this, event);
  }

  _handleTokenMovementKeyDown(event) {
    return _handleMovementDown(this, event);
  }

  _handleTokenMovementKeyUp(event) {
    return _handleMovementUp(this, event);
  }

  _shouldIgnoreKeyTarget(target) {
    return _shouldIgnoreKey(target);
  }

  /**
   * Pick the topmost grid cell under local pointer, considering elevation and depth order.
   * Returns { gridX, gridY } or null.
   */
  pickTopmostGridCellAt(localX, localY) {
    return _pickTopmost(this, localX, localY);
  }

  /**
   * Hit test an isometric diamond at grid cell (gx, gy) against a local point (lx, ly)
   * Accounts for elevation offset so the test matches the visually shifted tile.
   */
  _isPointInCellDiamond(gx, gy, lx, ly) {
    return _isPointInCellDiamond(this, gx, gy, lx, ly);
  }

  // ── Target Resolution ─────────────────────────────────────────────
  async _resolvePointerTarget(event) {
    return _resolveTarget(this, event);
  }

  _tryCaptureRadialTrigger(event) {
    return _captureRadial(this, event);
  }

  _dispatchRadialMenuRequest(context) {
    return _dispatchRadial(this, context);
  }

  _pick3DTarget(event) {
    return _pick3D(this, event);
  }

  _pickSpriteTarget(event) {
    return _pickSprite(this, event);
  }

  _pickTokenBySprite(event) {
    return _pickBySprite(this, event);
  }

  _get3DTokenScreenPosition(tokenEntry) {
    return _get3DScreenPos(this, tokenEntry);
  }

  // ── Token Selection ─────────────────────────────────────────────
  _selectTokenEntry(tokenEntry) {
    if (!tokenEntry) return;
    const adapter = this.gameManager?.token3DAdapter;
    if (adapter?.setSelectedToken) {
      adapter.setSelectedToken(tokenEntry);
    }
  }

  _clearTokenSelection() {
    const adapter = this.gameManager?.token3DAdapter;
    if (adapter?.setSelectedToken) {
      adapter.setSelectedToken(null);
    }
  }

  // ── Coordinate Helpers ─────────────────────────────────────────────
  /**
   * Get grid coordinates from mouse click event
   * @param {MouseEvent} event - Mouse click event
   * @returns {Object|null} Grid coordinates or null if invalid
   */
  getGridCoordinatesFromClick(event) {
    try {
      const gm = this.gameManager;
      const canUse3D =
        !!gm?.pickingService?.pickGroundSync &&
        typeof gm?.is3DModeActive === 'function' &&
        gm.is3DModeActive();
      const clientX = event?.clientX ?? event?.x ?? null;
      const clientY = event?.clientY ?? event?.y ?? null;
      if (canUse3D && clientX != null && clientY != null) {
        try {
          const targetElement = event?.target || null;
          const ground = gm.pickingService.pickGroundSync(clientX, clientY, targetElement);
          if (ground?.grid) {
            const gx = Math.round(ground.grid.gx);
            const gy = Math.round(ground.grid.gy);
            if (Number.isFinite(gx) && Number.isFinite(gy)) {
              const candidate = { gridX: gx, gridY: gy };
              if (this.isValidGridPosition(candidate)) {
                return candidate;
              }
            }
          }
        } catch (_) {
          /* fallback to 2D conversion */
        }
      }

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
   * Get mouse position relative to canvas
   * @param {MouseEvent} event - Mouse event
   * @returns {Object} Mouse coordinates
   */
  getMousePosition(event) {
    const rect = this.gameManager.getEventCanvas().getBoundingClientRect();
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
    // gridContainer no longer exists in 3D mode; this 2D path is only reached
    // when the 3D pickGroundSync path in getGridCoordinatesFromClick already failed.
    // Return a sentinel that will produce an invalid grid position and be filtered out.
    return { localX: 0, localY: 0 };
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

  // ── Drag Listener Helpers ─────────────────────────────────────────────
  _ensureGlobalDragListeners() {
    if (!this._globalMouseMoveListening) {
      document.addEventListener('mousemove', this._boundGlobalMouseMove);
      this._globalMouseMoveListening = true;
    }
    if (!this._globalMouseUpListening) {
      document.addEventListener('mouseup', this._boundGlobalMouseUp);
      this._globalMouseUpListening = true;
    }
  }

  _removeGlobalDragListeners() {
    if (this._globalMouseMoveListening) {
      document.removeEventListener('mousemove', this._boundGlobalMouseMove);
      this._globalMouseMoveListening = false;
    }
    if (this._globalMouseUpListening) {
      document.removeEventListener('mouseup', this._boundGlobalMouseUp);
      this._globalMouseUpListening = false;
    }
  }

  // ── Backward-Compat Accessors ─────────────────────────────────────────────
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

  // ── Logging ─────────────────────────────────────────────
  _describeTokenForLogs(tokenEntry) {
    if (!tokenEntry) {
      return { id: null, label: null, type: null };
    }
    const typeKey =
      (tokenEntry.type || tokenEntry.creature?.type || tokenEntry.kind || '').toLowerCase() || null;
    const label =
      tokenEntry.name ?? tokenEntry.label ?? tokenEntry.creature?.name ?? tokenEntry.kind ?? null;
    return {
      id: tokenEntry.id ?? tokenEntry.creature?.id ?? null,
      label,
      type: typeKey,
    };
  }
}
