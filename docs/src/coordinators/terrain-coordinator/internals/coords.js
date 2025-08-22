import { CoordinateUtils } from '../../../utils/CoordinateUtils.js';

/**
 * Check if grid position is within bounds of the current game grid.
 * Mirrors TerrainCoordinator.isValidGridPosition behavior.
 */
export function isValidGridPosition(c, gridX, gridY) {
    return CoordinateUtils.isValidGridPosition(
        gridX,
        gridY,
        c?.gameManager?.cols,
        c?.gameManager?.rows
    );
}
