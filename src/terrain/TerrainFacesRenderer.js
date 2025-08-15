// TerrainFacesRenderer.js - Draws neighbor-aware 3D side faces for tiles
// Shared between TerrainManager (overlay) and TerrainCoordinator (base tiles)

import { GRID_CONFIG } from '../config/GameConstants.js';
import { TERRAIN_CONFIG } from '../config/TerrainConstants.js';
import { TerrainHeightUtils } from '../utils/TerrainHeightUtils.js';
import { darkenColor } from '../utils/ColorUtils.js';

export class TerrainFacesRenderer {
  constructor(gameManager) {
    this.gameManager = gameManager;
  }

  addOverlayFaces(container, tile, getHeight, x, y, height, faceBaseColor = GRID_CONFIG.TILE_COLOR) {
    // Computes diffs vs neighbors and adds faces into given container behind tile
    // Use a darkened variant of the overlay tile color for clearer contrast
    const faces = this._buildFaces(getHeight, x, y, height, faceBaseColor, false);
    if (!faces) return;
    faces.x = tile.x;
    faces.y = tile.y;
  // Tag for sorting/cleanup
  faces.isOverlayFace = true;
  faces.depthValue = tile.depthValue;
  // If parent supports zIndex sorting, set faces between shadows (0) and tiles (100)
  faces.zIndex = (tile.depthValue || 0) * 100 + 5;

    const parent = tile.parent || container;
    let idx = 0;
    try { if (parent && typeof parent.getChildIndex === 'function') idx = parent.getChildIndex(tile); } catch { idx = 0; }
    if (parent && typeof parent.addChildAt === 'function') parent.addChildAt(faces, Math.max(0, idx));
    else if (parent && typeof parent.addChild === 'function') parent.addChild(faces);
    tile.sideFaces = faces;
  }

  addBaseFaces(tile, x, y, height, getBaseHeight) {
    const baseTop = GRID_CONFIG.TILE_COLOR;
    const faces = this._buildFaces(getBaseHeight, x, y, height, baseTop, false);
    if (!faces) return;
    faces.x = tile.x;
    faces.y = tile.y;
    const parent = tile.parent;
    if (!parent) { tile.baseSideFaces = faces; return; }
    let idx = 0; try { if (typeof parent.getChildIndex === 'function') idx = parent.getChildIndex(tile); } catch { idx = 0; }
    if (typeof parent.addChildAt === 'function') parent.addChildAt(faces, Math.max(0, idx));
    else if (typeof parent.addChild === 'function') parent.addChild(faces);
    // If parent sorts by zIndex, ensure base faces render just UNDER the tile at its depth
    // Grid tiles use zIndex = depth*100, so place faces slightly lower to stay behind the top face
    if (parent.sortableChildren) {
      faces.zIndex = (tile.depthValue || (x + y)) * 100 - 1;
    }
    tile.baseSideFaces = faces;
  }

  _buildFaces(getNeighborHeight, x, y, hHere, baseTopColor, shaded) {
  const unit = TerrainHeightUtils.getElevationUnit();
    const hRight = getNeighborHeight(x + 1, y);
    const hBottom = getNeighborHeight(x, y + 1);
    const hLeft = getNeighborHeight(x - 1, y);
    const hTop = getNeighborHeight(x, y - 1);

    const diffR = Math.max(0, hHere - hRight);
    const diffB = Math.max(0, hHere - hBottom);
    const diffL = Math.max(0, hHere - hLeft);
    const diffT = Math.max(0, hHere - hTop);

    if (diffR + diffB + diffL + diffT === 0) return null;

    const w = this.gameManager.tileWidth;
    const h = this.gameManager.tileHeight;
    const top = { x: w / 2, y: 0 };
    const right = { x: w, y: h / 2 };
    const bottom = { x: w / 2, y: h };
    const left = { x: 0, y: h / 2 };

    const faces = new PIXI.Graphics();
    const colors = shaded
      ? { r: baseTopColor, b: baseTopColor, l: baseTopColor, t: baseTopColor }
      : {
        r: darkenColor(baseTopColor, 0.25),
        b: darkenColor(baseTopColor, 0.4),
        l: darkenColor(baseTopColor, 0.35),
        t: darkenColor(baseTopColor, 0.2)
      };

    const drawFace = (from, to, down, color) => {
      const fromD = { x: from.x, y: from.y + down };
      const toD = { x: to.x, y: to.y + down };
      faces.beginFill(color, 1.0);
      faces.moveTo(from.x, from.y);
      faces.lineTo(to.x, to.y);
      faces.lineTo(toD.x, toD.y);
      faces.lineTo(fromD.x, fromD.y);
      faces.closePath();
      faces.endFill();
    };

  // Correct edge mapping for iso diamonds (x_screen=(x-y), y_screen=(x+y)):
  // East (x+1,y): right -> bottom; South (x,y+1): bottom -> left;
  // West (x-1,y): left -> top; North (x,y-1): top -> right
  if (diffR > 0) drawFace(right, bottom, diffR * unit, colors.r); // East neighbor lower
  if (diffB > 0) drawFace(bottom, left, diffB * unit, colors.b);  // South neighbor lower
  if (diffL > 0) drawFace(left, top, diffL * unit, colors.l);     // West neighbor lower
  if (diffT > 0) drawFace(top, right, diffT * unit, colors.t);    // North neighbor lower

    return faces;
  }
}
