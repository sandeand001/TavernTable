// Removed direct import from ui/domHelpers; use injected domPorts with fallbacks
function _getTerrainHeightDisplay(c) {
  if (c?.domPorts?.getTerrainHeightDisplay) return c.domPorts.getTerrainHeightDisplay();
  if (typeof document === 'undefined') return null;
  return document.querySelector('[data-terrain-height]');
}
function _getScaleMarks(c) {
  if (c?.domPorts?.getScaleMarks) return c.domPorts.getScaleMarks();
  if (typeof document === 'undefined') return [];
  return Array.from(document.querySelectorAll('[data-terrain-scale-mark]'));
}
import { buildBrushHighlightDescriptor } from '../../terrain/TerrainBrushHighlighter.js';
import { logger, LOG_LEVEL, LOG_CATEGORY } from '../../utils/Logger.js';
import { ErrorHandler, ERROR_SEVERITY, ERROR_CATEGORY } from '../../utils/ErrorHandler.js';

/**
 * TerrainInputHandlers - Extracted input setup and handlers for TerrainCoordinator
 * Façade-backed: TerrainCoordinator delegates to this module without behavior changes.
 */
export class TerrainInputHandlers {
  constructor(coordinator) {
    this.c = coordinator; // reference to TerrainCoordinator
    // Track last hovered grid coords to support live preview refresh on tool/size changes
    this.lastGridCoords = null;
  }

  /** Small helper to avoid duplicating the scale mark selector */
  _getScaleMarks() {
    return _getScaleMarks(this.c);
  }

  /** Set up terrain-specific input event handlers */
  setup() {
    try {
      // Mouse events for terrain painting
      this.c.gameManager.app.view.addEventListener('mousedown', this.handleMouseDown.bind(this));
      this.c.gameManager.app.view.addEventListener('mousemove', this.handleMouseMove.bind(this));
      this.c.gameManager.app.view.addEventListener('mouseup', this.handleMouseUp.bind(this));
      this.c.gameManager.app.view.addEventListener('mouseleave', this.handleMouseLeave.bind(this));
      // Also listen on window to catch button release outside the canvas
      window.addEventListener('mouseup', this.handleMouseUp.bind(this), true);
      // Extra safety: if the window loses focus during a drag, end the session
      window.addEventListener(
        'blur',
        () => {
          if (this.c.isDragging) {
            this.c.isDragging = false;
            this.c.lastModifiedCell = null;
            // Ensure any pending updates are applied now to avoid lingering visuals
            try {
              this.c.terrainManager?.flushUpdateQueue();
            } catch {
              /* ignore */
            }
          }
        },
        true
      );

      // Keyboard shortcuts for terrain tools
      document.addEventListener('keydown', this.handleKeyDown.bind(this));

      logger.debug(
        'Terrain input handlers configured',
        {
          context: 'TerrainInputHandlers.setup',
          stage: 'input_configuration',
          eventTypes: ['mousedown', 'mousemove', 'mouseup', 'mouseleave', 'keydown'],
          handlersBound: true,
        },
        LOG_CATEGORY.SYSTEM
      );
    } catch (error) {
      new ErrorHandler().handle(error, ERROR_SEVERITY.HIGH, ERROR_CATEGORY.INIT, {
        context: 'TerrainInputHandlers.setup',
        appViewAvailable: !!this.c?.gameManager?.app?.view,
      });
      throw error;
    }
  }

  /** Handle mouse down events for terrain modification */
  handleMouseDown(event) {
    try {
      // Only handle left mouse button and when terrain mode is active
      if (event.button !== 0 || !this.c.isTerrainModeActive) {
        return;
      }

      // Do not start a terrain drag while panning (Space held)
      const im = this.c.gameManager?.interactionManager;
      if (im && im.isSpacePressed) {
        return;
      }

      const gridCoords = this.c.getGridCoordinatesFromEvent(event);
      if (!gridCoords) {
        return;
      }

      // Starting a new paint gesture
      this.c.isDragging = true;
      this.c.lastModifiedCell = null;
      this.c.modifyTerrainAtPosition(gridCoords.gridX, gridCoords.gridY);

      event.preventDefault();
      event.stopPropagation();
    } catch (error) {
      new ErrorHandler().handle(error, ERROR_SEVERITY.MEDIUM, ERROR_CATEGORY.INPUT, {
        context: 'TerrainInputHandlers.handleMouseDown',
        stage: 'terrain_mouse_down',
        isTerrainModeActive: this.c.isTerrainModeActive,
        buttonPressed: event?.button,
      });
    }
  }

  /** Handle mouse move events for continuous terrain painting */
  handleMouseMove(event) {
    try {
      const gridCoords = this.c.getGridCoordinatesFromEvent(event);

      // Update height indicator if in terrain mode
      if (this.c.isTerrainModeActive && gridCoords) {
        this.updateHeightIndicator(gridCoords.gridX, gridCoords.gridY);
        // Render brush preview using highlighter helper; distinct style from raise/lower
        try {
          const desc = buildBrushHighlightDescriptor({
            brush: this.c.brush,
            center: { gridX: gridCoords.gridX, gridY: gridCoords.gridY },
            terrainModeActive: this.c.isTerrainModeActive,
          });
          if (desc.cells.length) {
            this.c.terrainManager?.renderBrushPreview(desc.cells, desc.style);
          }
        } catch (_) {
          /* non-fatal preview */
        }
        // Remember last valid hover position for key-driven updates
        this.lastGridCoords = { x: gridCoords.gridX, y: gridCoords.gridY };
      }

      // Only process if we're actively dragging in terrain mode
      // Also require that the primary button is currently pressed to avoid lingering edits
      // And never edit while the grid panning interaction is active or Space is pressed
      const im = this.c.gameManager?.interactionManager;
      if (
        !this.c.isDragging ||
        !this.c.isTerrainModeActive ||
        !(event.buttons & 1) ||
        (im && (im.isDragging || im.isSpacePressed))
      ) {
        return;
      }

      if (!gridCoords) {
        return;
      }

      // Avoid modifying the same cell repeatedly during a single drag
      const cellKey = `${gridCoords.gridX},${gridCoords.gridY}`;
      if (this.c.lastModifiedCell === cellKey) {
        return;
      }

      this.c.modifyTerrainAtPosition(gridCoords.gridX, gridCoords.gridY);
      this.c.lastModifiedCell = cellKey;
    } catch (error) {
      new ErrorHandler().handle(error, ERROR_SEVERITY.LOW, ERROR_CATEGORY.INPUT, {
        context: 'TerrainInputHandlers.handleMouseMove',
        stage: 'terrain_mouse_move',
        isDragging: this.c.isDragging,
        isTerrainModeActive: this.c.isTerrainModeActive,
      });
    }
  }

  /** Handle mouse up events to stop terrain painting */
  handleMouseUp(event) {
    try {
      if (event.button === 0 && this.c.isDragging) {
        this.c.isDragging = false;
        this.c.lastModifiedCell = null;
        // Complete any pending terrain updates immediately
        try {
          this.c.terrainManager?.flushUpdateQueue();
        } catch {
          /* ignore */
        }
        // Do NOT clear preview on mouse up; keep showing hover footprint per spec

        logger.trace(
          'Terrain painting session completed',
          {
            context: 'TerrainInputHandlers.handleMouseUp',
            stage: 'painting_complete',
            tool: this.c.brush.tool,
            brushSize: this.c.brush.brushSize,
          },
          LOG_CATEGORY.USER
        );
      }
    } catch (error) {
      new ErrorHandler().handle(error, ERROR_SEVERITY.LOW, ERROR_CATEGORY.INPUT, {
        context: 'TerrainInputHandlers.handleMouseUp',
        stage: 'terrain_mouse_up',
        isDragging: this.c.isDragging,
      });
    }
  }

  /** Handle mouse leave events to stop terrain painting */
  handleMouseLeave() {
    if (this.c.isDragging) {
      this.c.isDragging = false;
      this.c.lastModifiedCell = null;
    }
    // If leaving the canvas, finish any pending updates to prevent later application
    try {
      this.c.terrainManager?.flushUpdateQueue();
    } catch {
      /* ignore */
    }
    // Always clear preview on mouse leave
    try {
      this.c.terrainManager?.clearBrushPreview();
    } catch {
      /* ignore */
    }
  }

  /** Handle keyboard shortcuts for terrain tools */
  handleKeyDown(event) {
    try {
      if (!this.c.isTerrainModeActive) {
        return;
      }

      switch (event.code) {
        case 'KeyR':
          if (!event.ctrlKey && !event.altKey) {
            this.c.setTerrainTool('raise');
            event.preventDefault();
            // Re-render preview at last hover
            this._rerenderPreviewAtLastHover();
          }
          break;
        case 'KeyL':
          if (!event.ctrlKey && !event.altKey) {
            this.c.setTerrainTool('lower');
            event.preventDefault();
            // Re-render preview at last hover
            this._rerenderPreviewAtLastHover();
          }
          break;
        case 'BracketLeft': // [
          this.c.decreaseBrushSize();
          event.preventDefault();
          this._rerenderPreviewAtLastHover();
          break;
        case 'BracketRight': // ]
          this.c.increaseBrushSize();
          event.preventDefault();
          this._rerenderPreviewAtLastHover();
          break;
      }
    } catch (error) {
      new ErrorHandler().handle(error, ERROR_SEVERITY.LOW, ERROR_CATEGORY.INPUT, {
        context: 'TerrainInputHandlers.handleKeyDown',
        stage: 'terrain_keyboard',
        key: event?.code,
        isTerrainModeActive: this.c.isTerrainModeActive,
      });
    }
  }

  /**
   * Re-render the brush preview at the last known hover coordinates
   * if terrain mode is active and a valid position is cached.
   * Keeps preview persistent during painting and key changes.
   */
  _rerenderPreviewAtLastHover() {
    try {
      if (!this.c.isTerrainModeActive || !this.lastGridCoords) return;
      const { x, y } = this.lastGridCoords;
      if (!this.c.isValidGridPosition(x, y)) return;
      const desc = buildBrushHighlightDescriptor({
        brush: this.c.brush,
        center: { gridX: x, gridY: y },
        terrainModeActive: this.c.isTerrainModeActive,
      });
      if (desc.cells.length) {
        this.c.terrainManager?.renderBrushPreview(desc.cells, desc.style);
      }
    } catch (_) {
      /* ignore preview issues */
    }
  }

  /** Update the height indicator in the UI to show terrain level at cursor position */
  updateHeightIndicator(gridX, gridY) {
    try {
      if (!this.c.isValidGridPosition(gridX, gridY)) {
        return;
      }

      const currentHeight = this.c.getTerrainHeight(gridX, gridY);

      // Update height value display
      const heightDisplay = _getTerrainHeightDisplay(this.c);
      if (heightDisplay) {
        heightDisplay.textContent = currentHeight.toString();
        heightDisplay.style.color =
          currentHeight === 0 ? '#6b7280' : currentHeight > 0 ? '#10b981' : '#8b5cf6';
      }

      // Update height scale visual indicator
      const scaleMarks = this._getScaleMarks();
      scaleMarks.forEach((mark) => {
        const markHeight = parseInt(mark.getAttribute('data-height'));
        if (markHeight === currentHeight) {
          mark.classList.add('current');
        } else {
          mark.classList.remove('current');
        }
      });
    } catch (error) {
      new ErrorHandler().handle(error, ERROR_SEVERITY.LOW, ERROR_CATEGORY.UI, {
        context: 'TerrainInputHandlers.updateHeightIndicator',
        coordinates: { gridX, gridY },
        terrainHeight: this.c.getTerrainHeight(gridX, gridY),
      });
    }
  }

  /** Reset the height indicator to default state */
  resetHeightIndicator() {
    try {
      const heightDisplay = _getTerrainHeightDisplay(this.c);
      if (heightDisplay) {
        heightDisplay.textContent = '0';
        heightDisplay.style.color = '#6b7280';
      }

      const scaleMarks = this._getScaleMarks();
      scaleMarks.forEach((mark) => {
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
        context: 'TerrainInputHandlers.resetHeightIndicator',
        error: error.message,
      });
    }
  }
}
