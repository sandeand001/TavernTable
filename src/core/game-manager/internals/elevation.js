import { TerrainHeightUtils } from '../../../utils/terrain/TerrainHeightUtils.js';

function calculateElevationUnit(gm, rawPixelsPerLevel, { hardSet = false } = {}) {
  const pixelsPerLevel2D =
    Number.isFinite(rawPixelsPerLevel) && rawPixelsPerLevel >= 0
      ? rawPixelsPerLevel
      : gm._defaultElevationPixelsPerLevel;
  const defaultPixels = gm._defaultElevationPixelsPerLevel || 1;
  const baselineWorldUnit =
    Number.isFinite(gm._baselineWorldElevationUnit) && gm._baselineWorldElevationUnit > 0
      ? gm._baselineWorldElevationUnit
      : Number.isFinite(gm.spatial?.elevationUnit)
        ? gm.spatial.elevationUnit
        : 0.5;
  const attenuation =
    Number.isFinite(gm._worldElevationAttenuation) && gm._worldElevationAttenuation > 0
      ? gm._worldElevationAttenuation
      : 1;
  let worldElevationUnit =
    defaultPixels > 0 ? (baselineWorldUnit * pixelsPerLevel2D) / defaultPixels : 0;
  worldElevationUnit *= attenuation;
  if (!Number.isFinite(worldElevationUnit)) worldElevationUnit = baselineWorldUnit;
  else if (worldElevationUnit < 0) worldElevationUnit = 0;
  const previous = gm.spatial?.elevationUnit;
  if (Number.isFinite(previous) && previous > 0 && !hardSet)
    worldElevationUnit = previous * 0.2 + worldElevationUnit * 0.8;
  const unchanged =
    Number.isFinite(previous) &&
    previous > 0 &&
    Math.abs(worldElevationUnit - previous) / Math.abs(previous) < 0.005;
  return {
    pixelsPerLevel2D,
    defaultPixels,
    baselineWorldUnit,
    attenuation,
    worldElevationUnit,
    unchanged,
  };
}

export function preview3DElevationUnit(gm, pixelsPerLevel, options = {}) {
  if (!gm?.is3DModeActive?.() || !gm.threeSceneManager) return gm?.spatial?.elevationUnit;
  const result = calculateElevationUnit(gm, pixelsPerLevel, options);
  return result.unchanged || result.worldElevationUnit <= 0
    ? gm.spatial.elevationUnit
    : result.worldElevationUnit;
}

// ── Public API ──────────────────────────────────────────────────
/**
 * Sync the 3D world elevation unit (world Y per level) so that one elevation level
 * produces the same on-screen vertical pixel displacement as the 2D isometric elevation effect.
 */
export function sync3DElevationScaling(gm, options = {}) {
  try {
    if (!gm.is3DModeActive()) return false;
    const tsm = gm.threeSceneManager;
    if (!tsm) return false;

    const {
      pixelsPerLevel2D,
      defaultPixels,
      baselineWorldUnit,
      attenuation,
      worldElevationUnit,
      unchanged,
    } = calculateElevationUnit(gm, TerrainHeightUtils.getElevationUnit(), options);
    if (unchanged) return false;

    gm.spatial.reconfigure({ elevationUnit: worldElevationUnit });
    gm.terrainEngine?.configureGeometryScale(
      (gm.spatial.elevationUnit * 5) / gm.spatial.tileWorldSize
    );
    gm._lastAppliedWorldElevationUnit = worldElevationUnit;
    gm._lastPixelsPerLevelApplied = pixelsPerLevel2D;
    if (gm.terrainRebuilder?.builder) {
      gm.terrainRebuilder.builder.elevationUnit = worldElevationUnit;
    }
    if (options.rebuild !== false) {
      try {
        if (typeof window !== 'undefined' && window.requestTerrain3DRebuild) {
          window.requestTerrain3DRebuild('elevation-sync');
        }
      } catch (_) {
        /* ignore */
      }
    }
    try {
      gm.placeableMeshPool?._markAllDirty?.();
      gm.placeableMeshPool?.refreshAll?.();
    } catch (_) {
      /* ignore */
    }
    try {
      gm.token3DAdapter?.refreshAll?.();
    } catch (_) {
      /* ignore */
    }
    if (typeof window !== 'undefined') {
      window.__TT_METRICS__ = window.__TT_METRICS__ || {};
      window.__TT_METRICS__.elevationSync = {
        pixelsPerLevel2D,
        worldElevationUnit,
        baselineWorldUnit,
        defaultPixels,
        attenuation,
        relativeScale:
          Number.isFinite(pixelsPerLevel2D) && defaultPixels > 0
            ? pixelsPerLevel2D / defaultPixels
            : null,
        timestamp: Date.now(),
      };
      window.sync3DElevationScaling = () =>
        gm.sync3DElevationScaling({ rebuild: true, hardSet: true });
    }
    return true;
  } catch (err) {
    return false;
  }
}
