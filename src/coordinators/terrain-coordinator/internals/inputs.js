// Internal input/event helpers for TerrainCoordinator. Zero functional change.
import {
  ErrorHandler,
  ERROR_CATEGORY,
  ERROR_SEVERITY,
  GameErrors,
} from '../../../utils/ErrorHandler.js';
import { CoordinateUtils } from '../../../utils/CoordinateUtils.js';

/**
 * Get grid coordinates from mouse event using interaction manager when available.
 * Mirrors TerrainCoordinator.getGridCoordinatesFromEvent behavior.
 */
export function getGridCoordinatesFromEvent(c, event) {
  try {
    if (c.gameManager?.is3DModeActive?.()) {
      const picking = c.gameManager?.pickingService;
      if (picking && typeof picking.pickGroundSync === 'function') {
        const targetElement =
          c.gameManager?.threeSceneManager?.canvas ||
          c.gameManager?.app?.view ||
          (event?.currentTarget ?? null);
        const ground = picking.pickGroundSync(event.clientX, event.clientY, targetElement);
        if (ground && ground.grid) {
          const gridXf = Number(ground.grid.gx);
          const gridYf = Number(ground.grid.gy);
          if (Number.isFinite(gridXf) && Number.isFinite(gridYf)) {
            let gridX = Math.round(gridXf);
            let gridY = Math.round(gridYf);
            if (!c.isValidGridPosition(gridX, gridY)) {
              const cols = Number.isInteger(c?.gameManager?.cols) ? c.gameManager.cols : null;
              const rows = Number.isInteger(c?.gameManager?.rows) ? c.gameManager.rows : null;
              if (Number.isInteger(cols) && Number.isInteger(rows)) {
                const clamped = CoordinateUtils.clampToGrid(gridX, gridY, cols, rows);
                gridX = clamped.gridX;
                gridY = clamped.gridY;
              }
            }
            if (c.isValidGridPosition(gridX, gridY)) {
              return { gridX, gridY };
            }
            return null;
          }
        }
      }
    }

    if (
      c.gameManager.interactionManager &&
      typeof c.gameManager.interactionManager.getGridCoordinatesFromClick === 'function'
    ) {
      return c.gameManager.interactionManager.getGridCoordinatesFromClick(event);
    }

    const rect = c.gameManager.app.view.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    const gridRelativeX = mouseX - c.gameManager.gridContainer.x;
    const gridRelativeY = mouseY - c.gameManager.gridContainer.y;

    const scale = c.gameManager.interactionManager?.gridScale || 1.0;
    const localX = gridRelativeX / scale;
    const localY = gridRelativeY / scale;

    const gridCoords = c.gameManager.interactionManager?.convertToGridCoordinates({
      localX,
      localY,
    });
    if (!gridCoords || !c.isValidGridPosition(gridCoords.gridX, gridCoords.gridY)) {
      return null;
    }
    return gridCoords;
  } catch (error) {
    new ErrorHandler().handle(error, ERROR_SEVERITY.MEDIUM, ERROR_CATEGORY.INPUT, {
      context: 'TerrainCoordinator.getGridCoordinatesFromEvent',
      stage: 'coordinate_conversion',
      hasInteractionManager: !!c.gameManager.interactionManager,
    });
    return null;
  }
}

/**
 * Modify terrain height at specified position.
 * Mirrors TerrainCoordinator.modifyTerrainAtPosition behavior.
 */
export function modifyTerrainAtPosition(c, gridX, gridY) {
  try {
    // Only allow modification when terrain mode is active and coordinator is in a drag session
    if (!c.isTerrainModeActive || !c.isDragging) {
      return;
    }
    // Do not modify while grid panning is active or Space bar is held
    const im = c.gameManager?.interactionManager;
    if (im && (im.isDragging || im.isSpacePressed)) {
      return;
    }
    if (!c.isValidGridPosition(gridX, gridY)) {
      return;
    }
    const changed = c.brush.applyAt(gridX, gridY);
    if (changed) {
      // Update 2D terrain visuals immediately
      if (c.terrainManager) {
        c.terrainManager.updateTerrainDisplay(gridX, gridY, c.brushSize);
      }
      // NEW: schedule / debounce 3D terrain mesh rebuild & height resync (GameManager handles debouncing)
      try {
        c.gameManager?.notifyTerrainHeightsChanged?.();
      } catch (_) {
        /* non-fatal */
      }
    }
    return changed;
  } catch (error) {
    try {
      GameErrors.input(error, {
        stage: 'modifyTerrainAtPosition',
        coordinates: { gridX, gridY },
        tool: c.currentTerrainTool,
        brushSize: c.brushSize,
      });
    } catch (_) {
      new ErrorHandler().handle(error, ERROR_SEVERITY.LOW, ERROR_CATEGORY.INPUT, {
        context: 'TerrainCoordinator.modifyTerrainAtPosition',
      });
    }
  }
}
