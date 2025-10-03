import { logger, LOG_CATEGORY } from '../../../utils/Logger.js';
import { GameValidators } from '../../../utils/Validation.js';
import { TerrainPixiUtils } from '../../../utils/TerrainPixiUtils.js';
import { TERRAIN_CONFIG } from '../../../config/TerrainConstants.js';
import { lightenColor, darkenColor } from '../../../utils/ColorUtils.js';
import { getBiomeColorHex } from '../../../config/BiomePalettes.js';
import { TerrainHeightUtils } from '../../../utils/TerrainHeightUtils.js';

/** Validate tile creation inputs with container state checks. */
export function validateTileCreationInputs(m, x, y) {
  // ENHANCED: Validate container state before tile creation
  m.validateContainerState();

  // Validate coordinates
  const coordValidation = GameValidators.coordinates(x, y);
  if (!coordValidation.isValid) {
    throw new Error(`Invalid tile coordinates: ${coordValidation.getErrorMessage()}`);
  }
}

/** Cleanup existing tile at the given key with centralized helpers. */
export function cleanupExistingTile(m, tileKey) {
  if (m.terrainTiles.has(tileKey)) {
    const existingTile = m.terrainTiles.get(tileKey);

    // Use centralized cleanup utility for consistency
    const cleanupSuccess = TerrainPixiUtils.cleanupTerrainTile(
      existingTile,
      m.terrainContainer,
      tileKey,
      'TerrainManager.createTerrainTile'
    );

    if (!cleanupSuccess) {
      logger.warn(
        'Tile cleanup had partial failures, continuing with creation',
        {
          context: 'TerrainManager.createTerrainTile',
          coordinates: { x: existingTile.gridX, y: existingTile.gridY },
          tileKey,
        },
        LOG_CATEGORY.RENDERING
      );
    }

    m.terrainTiles.delete(tileKey);
  }
}

/** Create base PIXI.Graphics for a terrain tile. */
export function createBaseTerrainGraphics(m, x, y, height) {
  const terrainTile = new PIXI.Graphics();
  terrainTile.isTerrainTile = true;
  terrainTile.gridX = x;
  terrainTile.gridY = y;
  terrainTile.terrainHeight = height;
  terrainTile.depthValue = x + y;
  terrainTile.zIndex = terrainTile.depthValue * 100 + 20;
  terrainTile.shadowTile = null;
  terrainTile.depressionOverlay = null;
  terrainTile.sideFaces = null;
  return terrainTile;
}

/** Internal: get fill color for height, matching manager logic. */
export function getColorForHeightInternal(m, height) {
  try {
    if (
      !m.terrainCoordinator?.isTerrainModeActive &&
      typeof window !== 'undefined' &&
      window.selectedBiome
    ) {
      const gx = 0;
      const gy = 0;
      const mapFreq =
        (typeof window !== 'undefined' && window.richShadingSettings?.mapFreq) || 0.05;
      const seed = (m.terrainCoordinator?._biomeSeed ?? 1337) >>> 0;
      return getBiomeColorHex(window.selectedBiome, height, gx, gy, {
        moisture: 0.5,
        slope: 0,
        aspectRad: 0,
        seed,
        mapFreq,
      });
    }
  } catch (_) {
    /* ignore */
  }
  const colorKey = height.toString();
  return TERRAIN_CONFIG.HEIGHT_COLOR_SCALE[colorKey] || TERRAIN_CONFIG.HEIGHT_COLOR_SCALE['0'];
}

/** Apply rich shading and stroke styling onto a terrain tile. */
export function applyTerrainStyling(m, terrainTile, height) {
  const isDefaultHeight = height === TERRAIN_CONFIG.DEFAULT_HEIGHT;
  const color = getColorForHeightInternal(m, height);
  try {
    if (terrainTile.paintLayer) {
      terrainTile.removeChild(terrainTile.paintLayer);
      if (
        typeof terrainTile.paintLayer.destroy === 'function' &&
        !terrainTile.paintLayer.destroyed
      ) {
        terrainTile.paintLayer.destroy({ children: true });
      }
      terrainTile.paintLayer = null;
    }
    if (terrainTile.paintMask) {
      try {
        terrainTile.removeChild(terrainTile.paintMask);
      } catch {
        /* ignore */
      }
      if (typeof terrainTile.paintMask.destroy === 'function' && !terrainTile.paintMask.destroyed) {
        terrainTile.paintMask.destroy();
      }
      terrainTile.paintMask = null;
    }
  } catch (_) {
    /* best-effort */
  }

  if (isDefaultHeight) {
    terrainTile.lineStyle(1, 0x666666, 0.3);
  } else {
    const borderColor = (() => {
      const baseColor = color;
      if (height > 0) return lightenColor(baseColor, 0.3);
      if (height < 0) return darkenColor(baseColor, 0.3);
      return baseColor;
    })();
    terrainTile.lineStyle(
      TERRAIN_CONFIG.HEIGHT_BORDER_WIDTH,
      borderColor,
      TERRAIN_CONFIG.HEIGHT_BORDER_ALPHA
    );
  }

  terrainTile.moveTo(0, m.gameManager.tileHeight / 2);
  terrainTile.lineTo(m.gameManager.tileWidth / 2, 0);
  terrainTile.lineTo(m.gameManager.tileWidth, m.gameManager.tileHeight / 2);
  terrainTile.lineTo(m.gameManager.tileWidth / 2, m.gameManager.tileHeight);
  terrainTile.lineTo(0, m.gameManager.tileHeight / 2);

  const paint = new PIXI.Container();
  paint.x = 0;
  paint.y = 0;
  const w = m.gameManager.tileWidth;
  const h = m.gameManager.tileHeight;
  const settings =
    typeof window !== 'undefined' && window.richShadingSettings ? window.richShadingSettings : null;
  const shadingEnabled = settings ? !!settings.enabled : true;
  const intensityMul = settings && Number.isFinite(settings.intensity) ? settings.intensity : 1.0;
  const densityMul = settings && Number.isFinite(settings.density) ? settings.density : 1.0;
  const simplify = settings ? !!settings.performance : false;
  const terrainModeActive = !!m.terrainCoordinator?.isTerrainModeActive;
  const baseAlphaRaw = terrainModeActive
    ? isDefaultHeight
      ? (TERRAIN_CONFIG.TERRAIN_MODE_OVERLAY_BASE_ALPHA ?? 0.12)
      : (TERRAIN_CONFIG.TERRAIN_MODE_OVERLAY_ALPHA ?? TERRAIN_CONFIG.HEIGHT_ALPHA)
    : isDefaultHeight
      ? 0.12
      : TERRAIN_CONFIG.HEIGHT_ALPHA;
  const baseAlpha = Math.max(0, Math.min(1, baseAlphaRaw * intensityMul));
  const mask = new PIXI.Graphics();
  mask.beginFill(0xffffff, 1);
  mask.moveTo(0, h / 2);
  mask.lineTo(w / 2, 0);
  mask.lineTo(w, h / 2);
  mask.lineTo(w / 2, h);
  mask.lineTo(0, h / 2);
  mask.endFill();

  const biome =
    !m.terrainCoordinator?.isTerrainModeActive &&
    typeof window !== 'undefined' &&
    window.selectedBiome
      ? String(window.selectedBiome)
      : '';
  const seed =
    (terrainTile.gridX * 73856093) ^ (terrainTile.gridY * 19349663) ^ ((height || 0) * 83492791);
  void densityMul;
  void simplify;
  void seed;

  if (!shadingEnabled) {
    const center = new PIXI.Graphics();
    center.beginFill(color, Math.min(1, baseAlpha + 0.05));
    center.moveTo(w / 2, h * 0.18);
    center.lineTo(w * 0.85, h / 2);
    center.lineTo(w / 2, h * 0.82);
    center.lineTo(w * 0.15, h / 2);
    center.closePath();
    center.endFill();
    paint.addChild(center);
  } else if (/desert|dune|salt|thorn|savanna|steppe/i.test(biome)) {
    // Kept default simple fill here to avoid circular import of shading helpers; manager still draws detailed patterns
    const center = new PIXI.Graphics();
    center.beginFill(color, baseAlpha);
    center.drawRect(w * 0.2, h * 0.35, w * 0.6, h * 0.3);
    center.endFill();
    paint.addChild(center);
  } else {
    const lighter = lightenColor(color, 0.15);
    const darker = darkenColor(color, 0.15);
    const topTri = new PIXI.Graphics();
    topTri.beginFill(lighter, baseAlpha);
    topTri.moveTo(w / 2, 0);
    topTri.lineTo(w, h / 2);
    topTri.lineTo(0, h / 2);
    topTri.closePath();
    topTri.endFill();
    paint.addChild(topTri);
    const bottomTri = new PIXI.Graphics();
    bottomTri.beginFill(darker, baseAlpha);
    bottomTri.moveTo(w / 2, h);
    bottomTri.lineTo(w, h / 2);
    bottomTri.lineTo(0, h / 2);
    bottomTri.closePath();
    bottomTri.endFill();
    paint.addChild(bottomTri);
    const center = new PIXI.Graphics();
    center.beginFill(color, Math.min(1, baseAlpha + 0.05));
    center.moveTo(w / 2, h * 0.18);
    center.lineTo(w * 0.85, h / 2);
    center.lineTo(w / 2, h * 0.82);
    center.lineTo(w * 0.15, h / 2);
    center.closePath();
    center.endFill();
    paint.addChild(center);
  }

  paint.mask = mask;
  terrainTile.addChild(mask);
  terrainTile.addChild(paint);
  terrainTile.paintLayer = paint;
  terrainTile.paintMask = mask;
}

/** Position a terrain tile in iso space and apply elevation offset. */
export function positionTerrainTile(m, terrainTile, x, y, height) {
  terrainTile.x = (x - y) * (m.gameManager.tileWidth / 2);
  terrainTile.y = (x + y) * (m.gameManager.tileHeight / 2);
  const elevationOffset = TerrainHeightUtils.calculateElevationOffset(height);
  terrainTile.y += elevationOffset;
}

/** Finalize tile: add with depth sorting and store in map. */
export function finalizeTerrainTile(m, terrainTile, x, y, tileKey) {
  m.addTileWithDepthSorting(terrainTile);
  m.terrainTiles.set(tileKey, terrainTile);
}

/** Add elevation/depression overlays and side faces. */
export function addVisualEffects(m, terrainTile, height, x, y) {
  if (height > 0) {
    m.addElevationShadow(terrainTile, height, x, y);
  } else if (height < 0) {
    m.addDepressionEffect(terrainTile, height);
  }
  try {
    if (terrainTile.sideFaces && terrainTile.sideFaces.parent) {
      terrainTile.sideFaces.parent.removeChild(terrainTile.sideFaces);
      if (typeof terrainTile.sideFaces.destroy === 'function' && !terrainTile.sideFaces.destroyed) {
        terrainTile.sideFaces.destroy();
      }
      terrainTile.sideFaces = null;
    }
    const getH = (gx, gy) => m.terrainCoordinator.getTerrainHeight(gx, gy);
    const faceBase = getColorForHeightInternal(m, height);
    m.facesRenderer.addOverlayFaces(m.terrainContainer, terrainTile, getH, x, y, height, faceBase);
  } catch (e) {
    logger.warn(
      'Failed to add 3D faces',
      { coordinates: { x, y }, error: e.message },
      LOG_CATEGORY.RENDERING
    );
  }
}
