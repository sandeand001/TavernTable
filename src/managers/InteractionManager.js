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

    // Track active pointer drag state so right-drag panning persists outside the canvas
    this._activeDragButton = null;
    this._globalMouseMoveListening = false;
    this._globalMouseUpListening = false;
    this._boundGlobalMouseMove = this._handleGlobalMouseMove.bind(this);
    this._boundGlobalMouseUp = this._handleGlobalMouseUp.bind(this);
    this._pointerScratch = { x: 0, y: 0 };
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
    this.gameManager.app.view.addEventListener('contextmenu', (event) => {
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
   * Handle mouse down events
   */
  setupMouseDown() {
    const view = this.gameManager.app.view;
    view.addEventListener('mousedown', (event) => {
      if (event.button === 2) {
        // Right mouse button mirrors space+left behavior for panning/rotation
        this._activeDragButton = 2;
        const threeMgr = this.gameManager?.threeSceneManager;
        if (threeMgr && threeMgr.camera) {
          this.start3DRotation(event, threeMgr);
        } else {
          this.startGridDragging(event);
        }
        this._ensureGlobalDragListeners();
        return;
      }

      if (event.button !== 0) {
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
    const view = this.gameManager.app.view;
    view.addEventListener('mousemove', (event) => {
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
    const view = this.gameManager.app.view;
    view.addEventListener('mouseup', (event) => {
      if (event.button === 2) {
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
    const view = this.gameManager.app.view;
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
    });

    document.addEventListener('keyup', (event) => {
      if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
        this.gameManager?.token3DAdapter?.setShiftModifier?.(false);
      }
    });
  }

  /** Begin 3D camera rotation (right mouse drag) */
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
    this._activeDragButton = null;
    this._removeGlobalDragListeners();
    this.gameManager.app.view.style.cursor = 'default';
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

  _shouldIgnoreKeyTarget(target) {
    if (!target) return false;
    try {
      if (target.isContentEditable) return true;
      const tag = (target.tagName || '').toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        return true;
      }
    } catch (_) {
      /* ignore target introspection errors */
    }
    return false;
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
          this.gameManager.app.view.style.cursor = 'not-allowed';
        } catch (_) {
          /* ignore */
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
            const result = adapter.navigateToGrid(selectedToken, gridX, gridY);
            if (result) {
              return;
            }
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

  async _resolvePointerTarget(event) {
    const gm = this.gameManager;
    let gridX = null;
    let gridY = null;
    let token = null;

    const spriteToken = this._pickTokenBySprite(event);
    if (spriteToken) {
      token = spriteToken;
      if (Number.isFinite(spriteToken.gridX)) {
        gridX = spriteToken.gridX;
      }
      if (Number.isFinite(spriteToken.gridY)) {
        gridY = spriteToken.gridY;
      }
    }

    const canUse3D =
      typeof gm?.is3DModeActive === 'function' &&
      gm.is3DModeActive() &&
      gm.pickingService &&
      typeof gm.pickingService.pickGround === 'function';

    let groundPick = null;
    if (canUse3D) {
      try {
        groundPick = await gm.pickingService.pickGround(event.clientX, event.clientY);
      } catch (_) {
        groundPick = null;
      }

      if (groundPick?.token && !token) {
        token = groundPick.token;
      }

      if (groundPick?.grid) {
        const gx = Math.round(groundPick.grid.gx);
        const gy = Math.round(groundPick.grid.gy);
        if (Number.isFinite(gx) && Number.isFinite(gy)) {
          gridX = gx;
          gridY = gy;
        }
      }
    }

    if ((!Number.isFinite(gridX) || !Number.isFinite(gridY)) && token) {
      if (Number.isFinite(token.gridX)) {
        gridX = token.gridX;
      }
      if (Number.isFinite(token.gridY)) {
        gridY = token.gridY;
      }
    }

    if (!Number.isFinite(gridX) || !Number.isFinite(gridY)) {
      const gridCoords = this.getGridCoordinatesFromClick(event);
      if (gridCoords) {
        gridX = gridCoords.gridX;
        gridY = gridCoords.gridY;
      }
    }

    if (!token && Number.isFinite(gridX) && Number.isFinite(gridY)) {
      try {
        token = gm?.tokenManager?.findExistingTokenAt?.(gridX, gridY) || null;
      } catch (_) {
        token = null;
      }
    }

    return {
      gridX: Number.isFinite(gridX) ? gridX : null,
      gridY: Number.isFinite(gridY) ? gridY : null,
      token,
    };
  }

  _pickTokenBySprite(event) {
    try {
      const gm = this.gameManager;
      const tokens = gm?.placedTokens;
      if (!tokens || !tokens.length) {
        return null;
      }

      const renderer = gm?.app?.renderer;
      const interaction = renderer?.plugins?.interaction;
      if (!interaction || typeof interaction.mapPositionToPoint !== 'function') {
        return null;
      }

      const point = this._pointerScratch;
      point.x = 0;
      point.y = 0;
      interaction.mapPositionToPoint(point, event.clientX, event.clientY);

      const spriteMap = new WeakMap();
      const register = (displayObject, tokenEntry) => {
        if (!displayObject) return;
        spriteMap.set(displayObject, tokenEntry);
        const children = displayObject.children;
        if (Array.isArray(children)) {
          for (const child of children) {
            register(child, tokenEntry);
          }
        }
      };

      for (const token of tokens) {
        const sprite = token?.creature?.sprite;
        if (sprite) {
          register(sprite, token);
        }
      }

      const stage = gm?.app?.stage;
      if (stage && typeof interaction.hitTest === 'function') {
        const hit = interaction.hitTest(point, stage, event);
        let current = hit;
        while (current) {
          const tokenEntry = spriteMap.get(current) || current.tokenData || null;
          if (tokenEntry) {
            return tokenEntry;
          }
          current = current.parent;
        }
      }

      let bestToken = null;
      let bestScore = -Infinity;

      for (const tokenEntry of tokens) {
        const sprite = tokenEntry?.creature?.sprite;
        if (!sprite || !sprite.parent || !sprite.visible) {
          continue;
        }
        if (sprite.worldAlpha <= 0 || sprite.renderable === false) {
          continue;
        }
        if (typeof sprite.getBounds !== 'function') {
          continue;
        }

        let bounds;
        try {
          bounds = sprite.getBounds(false);
        } catch (_) {
          bounds = null;
        }
        if (!bounds || !bounds.contains(point.x, point.y)) {
          continue;
        }

        const score = Number.isFinite(sprite.zIndex)
          ? sprite.zIndex
          : Number.isFinite(sprite.y)
            ? sprite.y
            : 0;
        if (bestToken == null || score >= bestScore) {
          bestToken = tokenEntry;
          bestScore = score;
        }
      }

      return bestToken;
    } catch (_) {
      return null;
    }
  }

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
