// CoordinateUtils.js - Utility for coordinates
export const CoordinateUtils = {
  toGrid: (x, y, tileWidth, tileHeight) => ({
    col: Math.floor(x / tileWidth),
    row: Math.floor(y / tileHeight),
  }),
  toPixel: (col, row, tileWidth, tileHeight) => ({
    x: col * tileWidth,
    y: row * tileHeight,
  }),
};
