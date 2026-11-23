export function isTerrainCellSupported(geometry, gridX, gridY, elevationFeet) {
  if (
    typeof geometry?.findSupport !== 'function' ||
    !Number.isInteger(gridX) ||
    !Number.isInteger(gridY) ||
    !Number.isFinite(elevationFeet)
  )
    throw new Error('Terrain support requires valid geometry, a grid cell and an elevation');
  return [
    [2.5, 2.5],
    [0.01, 0.01],
    [0.01, 4.99],
    [4.99, 0.01],
    [4.99, 4.99],
  ].every(([dx, dz]) => {
    const support = geometry.findSupport(gridX * 5 + dx, gridY * 5 + dz, {
      belowFeet: elevationFeet + 1e-5,
    });
    return !!support && Math.abs(support.heightFeet - elevationFeet) < 1e-4;
  });
}
