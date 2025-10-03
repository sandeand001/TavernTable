import { GRID_CONFIG } from '../../../config/GameConstants.js';

// Create and return a PIXI isometric grid tile
export function drawIsometricTile(c, x, y, color = GRID_CONFIG.TILE_COLOR) {
  const tile = new PIXI.Graphics();
  tile.lineStyle(1, GRID_CONFIG.TILE_BORDER_COLOR, GRID_CONFIG.TILE_BORDER_ALPHA);
  const fillAlpha =
    typeof GRID_CONFIG?.TILE_FILL_ALPHA === 'number' ? GRID_CONFIG.TILE_FILL_ALPHA : 1;
  tile.beginFill(color, fillAlpha);

  // Diamond shape
  tile.moveTo(0, c.gameManager.tileHeight / 2);
  tile.lineTo(c.gameManager.tileWidth / 2, 0);
  tile.lineTo(c.gameManager.tileWidth, c.gameManager.tileHeight / 2);
  tile.lineTo(c.gameManager.tileWidth / 2, c.gameManager.tileHeight);
  tile.lineTo(0, c.gameManager.tileHeight / 2);
  tile.endFill();

  // Position in iso space
  tile.x = (x - y) * (c.gameManager.tileWidth / 2);
  tile.y = (x + y) * (c.gameManager.tileHeight / 2);
  tile.baseIsoY = tile.y; // baseline Y (pre-elevation)
  tile.depthValue = x + y;
  tile.zIndex = tile.depthValue * 100;

  // Metadata
  tile.isGridTile = true;
  tile.gridX = x;
  tile.gridY = y;

  c.gameManager.gridContainer.addChild(tile);
  return tile;
}

// Remove all grid tiles (keep tokens/others)
export function clearGridTiles(c) {
  const gc = c.gameManager.gridContainer;
  if (!gc || !gc.children) return;
  const toRemove = [];
  for (const ch of gc.children) {
    if (ch && ch.isGridTile) toRemove.push(ch);
  }
  for (const tile of toRemove) {
    gc.removeChild(tile);
  }
}
