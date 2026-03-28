import { Graphics } from '../../../utils/stubs/PixiStub.js';
import { logger } from '../../../utils/logger/Logger.js';
import { GameErrors } from '../../../utils/error/ErrorHandler.js';
import { TERRAIN_CONFIG } from '../../../config/terrain/TerrainConstants.js';
import { lightenColor, darkenColor } from '../../../utils/color/ColorUtils.js';
import { traceDiamondPath } from '../../../utils/geometry/GeometryUtils.js';
import { getBiomeColorHex } from '../../../config/biome/BiomePalettes.js';
import { TerrainHeightUtils } from '../../../utils/terrain/TerrainHeightUtils.js';

export function getColorForHeight(mgr, height) {
  // Terrain mode should not be affected by biome selection
  try {
    if (
      !mgr.terrainCoordinator?.isTerrainModeActive &&
      typeof window !== 'undefined' &&
      window.selectedBiome
    ) {
      const gx = 0; // Manager has no per-tile eval context outside coordinator; use 0 for stability
      const gy = 0;
      const mapFreq =
        (typeof window !== 'undefined' && window.richShadingSettings?.mapFreq) || 0.05;
      const seed = (mgr.terrainCoordinator?._biomeSeed ?? 1337) >>> 0;
      return getBiomeColorHex(window.selectedBiome, height, gx, gy, {
        moisture: 0.5,
        slope: 0,
        aspectRad: 0,
        seed,
        mapFreq,
      });
    }
  } catch (_) {
    /* fall back */
  }
  const colorKey = height.toString();
  return TERRAIN_CONFIG.HEIGHT_COLOR_SCALE[colorKey] || TERRAIN_CONFIG.HEIGHT_COLOR_SCALE['0'];
}

export function getBorderColorForHeight(mgr, height) {
  const baseColor = getColorForHeight(mgr, height);

  // For positive heights, lighten the border
  // For negative heights, darken the border
  if (height > 0) {
    return lightenColor(baseColor, 0.3);
  } else if (height < 0) {
    return darkenColor(baseColor, 0.3);
  } else {
    return baseColor;
  }
}

export function addElevationShadow(mgr, terrainTile, height, x, y) {
  try {
    // Create a shadow tile slightly offset and darker
    const shadowTile = new Graphics();
    const shadowColor = 0x000000; // Black shadow
    const shadowAlpha = (0.2 * height) / TERRAIN_CONFIG.MAX_HEIGHT; // Stronger shadow for higher terrain

    shadowTile.beginFill(shadowColor, shadowAlpha);

    // Draw same diamond shape as main tile (shared helper)
    traceDiamondPath(shadowTile, mgr.gameManager.tileWidth, mgr.gameManager.tileHeight);
    shadowTile.endFill();

    // Position shadow slightly offset (down and right for 3D effect)
    shadowTile.x = terrainTile.x + 2;
    shadowTile.y = terrainTile.y + 2;

    // Set depth value for shadow (same as main tile but mark as shadow)
    shadowTile.depthValue = terrainTile.depthValue;
    shadowTile.isShadowTile = true;
    // Position shadows below faces/tiles at same depth
    shadowTile.zIndex = (shadowTile.depthValue || 0) * 100 + 0;

    // Add shadow using depth sorting (shadows should appear behind their main tiles)
    mgr.addTileWithDepthSorting(shadowTile);

    // Store reference for cleanup
    terrainTile.shadowTile = shadowTile;
  } catch (error) {
    // Don't fail tile creation if shadow fails
    logger.warn('Failed to create elevation shadow', {
      coordinates: { x, y },
      height,
      error: error.message,
    });
  }
}

export function addDepressionEffect(mgr, terrainTile, height) {
  try {
    // Create overlay to darken the tile
    const overlay = new Graphics();
    const overlayAlpha = (0.3 * Math.abs(height)) / TERRAIN_CONFIG.MAX_HEIGHT; // Darker for deeper depressions

    overlay.beginFill(0x000000, overlayAlpha); // Semi-transparent black

    // Draw same diamond shape as main tile (shared helper)
    traceDiamondPath(overlay, mgr.gameManager.tileWidth, mgr.gameManager.tileHeight);
    overlay.endFill();

    // Position overlay exactly on top of tile
    overlay.x = 0;
    overlay.y = 0;

    // Add overlay as child of the terrain tile
    terrainTile.addChild(overlay);

    // Store reference for cleanup
    terrainTile.depressionOverlay = overlay;
  } catch (error) {
    // Don't fail tile creation if overlay fails
    logger.warn('Failed to create depression effect', {
      height,
      error: error.message,
    });
  }
}

export function reapplyElevationScaleToOverlay(mgr) {
  try {
    if (!mgr.terrainContainer || !mgr.terrainTiles || mgr.terrainTiles.size === 0) return;

    const w = mgr.gameManager.tileWidth;
    const h = mgr.gameManager.tileHeight;

    for (const [key, tile] of mgr.terrainTiles) {
      if (!tile) continue;

      const [x, y] = key.split(',').map(Number);

      // Reset base iso position, then apply new elevation offset
      tile.x = (x - y) * (w / 2);
      tile.y = (x + y) * (h / 2);

      let height;
      if (Number.isFinite(tile.terrainHeight)) {
        height = tile.terrainHeight;
      } else {
        height = mgr.terrainCoordinator.getTerrainHeight(x, y);
      }
      const offset = TerrainHeightUtils.calculateElevationOffset(height);
      tile.y += offset;

      // Clear and rebuild side faces/shadows/depressions to match new scale
      try {
        if (tile.shadowTile && tile.parent?.children?.includes(tile.shadowTile)) {
          tile.parent.removeChild(tile.shadowTile);
          if (typeof tile.shadowTile.destroy === 'function' && !tile.shadowTile.destroyed) {
            tile.shadowTile.destroy();
          }
        }
      } catch {
        /* ignore */
      }
      tile.shadowTile = null;

      try {
        if (tile.depressionOverlay && tile.children?.includes(tile.depressionOverlay)) {
          tile.removeChild(tile.depressionOverlay);
          if (
            typeof tile.depressionOverlay.destroy === 'function' &&
            !tile.depressionOverlay.destroyed
          ) {
            tile.depressionOverlay.destroy();
          }
        }
      } catch {
        /* ignore */
      }
      tile.depressionOverlay = null;

      try {
        if (tile.sideFaces && tile.parent?.children?.includes(tile.sideFaces)) {
          tile.parent.removeChild(tile.sideFaces);
          if (typeof tile.sideFaces.destroy === 'function' && !tile.sideFaces.destroyed) {
            tile.sideFaces.destroy();
          }
        }
      } catch {
        /* ignore */
      }
      tile.sideFaces = null;

      mgr._addVisualEffects(tile, height, x, y);
    }

    try {
      mgr.terrainContainer.sortChildren?.();
    } catch {
      /* no-op */
    }

    mgr.ensurePreviewLayerOnTop();

    // After updating overlay positions, ensure tokens and placeables are visible above it
    try {
      const parent = mgr.gameManager?.gridContainer;
      const previewZ = mgr.previewContainer?.zIndex;
      const overlayZ = mgr.terrainContainer?.zIndex;
      const desired = Number.isFinite(previewZ)
        ? previewZ + 1
        : Number.isFinite(overlayZ)
          ? overlayZ + 11
          : null;
      if (Number.isFinite(desired) && parent?.children) {
        // Raise tokens
        if (Array.isArray(mgr.gameManager?.tokenManager?.placedTokens)) {
          for (const t of mgr.gameManager.tokenManager.placedTokens) {
            const s = t?.creature?.sprite;
            if (!s) continue;
            if (!Number.isFinite(s.zIndex) || s.zIndex < desired) s.zIndex = desired;
          }
        }
        // Raise placeables managed by TerrainManager
        if (mgr.placeables && mgr.placeables.size) {
          for (const [, list] of mgr.placeables) {
            if (!Array.isArray(list)) continue;
            for (const s of list) {
              if (!s) continue;
              if (!Number.isFinite(s.zIndex) || s.zIndex < desired) s.zIndex = desired;
            }
          }
        }
        try {
          parent.sortableChildren = true;
          parent.sortChildren?.();
        } catch (_) {
          /* ignore */
        }
      }
    } catch (_) {
      /* best-effort */
    }
  } catch (error) {
    GameErrors.rendering(error, {
      stage: 'TerrainManager.reapplyElevationScaleToOverlay',
      tiles: mgr.terrainTiles?.size,
    });
  }
}
