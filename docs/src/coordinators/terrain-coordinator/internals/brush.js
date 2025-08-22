/**
 * Apply brush at a specific grid cell. Mirrors TerrainCoordinator.modifyTerrainHeightAtCell.
 */
export function modifyTerrainHeightAtCell(c, gridX, gridY) {
    // Delegate directly to the brush controller
    c.brush.applyAt(gridX, gridY);
}
