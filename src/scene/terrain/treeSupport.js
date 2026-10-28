const MIN_TREE_SCALE = 0.65;
const SUPPORT_HEIGHT_TOLERANCE = 1e-4;

/** Largest supported uniform scale, or null when the site would require a miniature tree. */
export function fitGeneratedTreeScale(gameManager, placeable, bounds) {
  const { gridX, gridY } = placeable;
  const { cols, rows, spatial } = gameManager;
  const tileSize = spatial?.tileWorldSize;
  if (
    !Number.isInteger(gridX) ||
    !Number.isInteger(gridY) ||
    !Number.isInteger(cols) ||
    !Number.isInteger(rows) ||
    cols <= 0 ||
    rows <= 0 ||
    gridX < 0 ||
    gridY < 0 ||
    gridX >= cols ||
    gridY >= rows ||
    !Number.isFinite(tileSize) ||
    tileSize <= 0
  ) {
    throw new Error('Generated tree support requires a valid grid and tile size');
  }
  const limits = [bounds?.min.x, bounds?.max.x, bounds?.min.z, bounds?.max.z];
  if (
    !limits.every(Number.isFinite) ||
    bounds.min.x > 0 ||
    bounds.max.x < 0 ||
    bounds.min.z > 0 ||
    bounds.max.z < 0
  ) {
    throw new Error('Generated tree support bounds must enclose the root anchor');
  }
  const baseHeight = gameManager.getTerrainHeight(gridX, gridY);
  if (!Number.isFinite(baseHeight)) throw new Error('Generated tree support height is not finite');
  const center = spatial.gridToWorld(gridX + 0.5, gridY + 0.5, 0);
  const origin = spatial.gridToWorld(0, 0, 0);
  if (![center.x, center.z, origin.x, origin.z].every(Number.isFinite)) {
    throw new Error('Generated tree support requires finite world coordinates');
  }
  const clearance = tileSize * 0.01;
  const fits = (scale) => {
    const minX = Math.floor((center.x - origin.x + bounds.min.x * scale - clearance) / tileSize);
    const maxX = Math.floor((center.x - origin.x + bounds.max.x * scale + clearance) / tileSize);
    const minY = Math.floor((center.z - origin.z + bounds.min.z * scale - clearance) / tileSize);
    const maxY = Math.floor((center.z - origin.z + bounds.max.z * scale + clearance) / tileSize);
    if (minX < 0 || minY < 0 || maxX >= cols || maxY >= rows) return false;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const height = gameManager.getTerrainHeight(x, y);
        if (!Number.isFinite(height))
          throw new Error('Generated tree support height is not finite');
        if (Math.abs(height - baseHeight) > SUPPORT_HEIGHT_TOLERANCE) return false;
      }
    }
    return true;
  };
  if (fits(1)) return 1;
  if (!fits(MIN_TREE_SCALE)) return null;
  let supported = MIN_TREE_SCALE;
  let unsupported = 1;
  for (let i = 0; i < 24; i++) {
    const scale = (supported + unsupported) / 2;
    if (fits(scale)) supported = scale;
    else unsupported = scale;
  }
  return supported;
}
