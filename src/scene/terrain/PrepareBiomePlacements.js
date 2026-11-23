import { PlaceableMeshPool } from './PlaceableMeshPool.js';
import { readPlaceablePlacements } from '../SceneSnapshotReaders.js';
import { resolveCavernSceneryClearance } from './CavernSceneryClearance.js';
import {
  cavernEntranceCells,
  naturalCavernRoutes,
} from '../../terrain/generation/CavernInteriors.js';

export async function prepareBiomePlacements(
  gameManager,
  plan,
  { elevationUnit, modelAssetCache = gameManager?.modelAssetCache, isTerrainSupported = null } = {}
) {
  const heights = plan?.heights;
  const rows = heights?.length;
  const cols = heights?.[0]?.length;
  const spatial = gameManager?.spatial;
  const worldElevationUnit = elevationUnit ?? spatial?.elevationUnit;
  if (
    !Number.isInteger(rows) ||
    rows < 1 ||
    !Number.isInteger(cols) ||
    cols < 1 ||
    heights.some(
      (row) =>
        !Array.isArray(row) || row.length !== cols || row.some((height) => !Number.isFinite(height))
    ) ||
    !Array.isArray(plan.placements) ||
    !Number.isFinite(spatial?.tileWorldSize) ||
    spatial.tileWorldSize <= 0 ||
    !Number.isFinite(worldElevationUnit) ||
    worldElevationUnit < 0 ||
    (isTerrainSupported !== null && typeof isTerrainSupported !== 'function') ||
    typeof spatial.gridToWorld !== 'function'
  )
    throw new Error('Biome placement preparation requires a valid planned grid');
  if (
    plan.placements.some(
      (placement) =>
        !placement ||
        typeof placement !== 'object' ||
        !Number.isInteger(placement.gridX) ||
        !Number.isInteger(placement.gridY) ||
        placement.gridX < 0 ||
        placement.gridX >= cols ||
        placement.gridY < 0 ||
        placement.gridY >= rows
    )
  )
    throw new Error('A planned terrain placement is outside its grid');
  if (
    plan.placements.some((placement) => placement.modelKey) &&
    typeof modelAssetCache?.getModel !== 'function'
  )
    throw new Error('The terrain model cache is unavailable');
  if (!plan.placements.length) return { placements: [], sightBounds: [], coverBounds: [] };

  const { Scene } = await import('three');
  const stagedManager = {
    cols,
    rows,
    tileWidth: gameManager.tileWidth,
    tileHeight: gameManager.tileHeight,
    modelAssetCache,
    terrainEngine: { biomeKey: plan.biomeKey, biomeSeed: plan.seed },
    isTerrainSupported,
    is3DModeActive: () => true,
    threeSceneManager: { scene: new Scene() },
    spatial: {
      tileWorldSize: spatial.tileWorldSize,
      elevationUnit: worldElevationUnit,
      gridToWorld: (x, y, level = 0) => {
        const world = spatial.gridToWorld(x, y, 0);
        return { ...world, y: level * worldElevationUnit };
      },
    },
    getTerrainHeight: (x, y) => {
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= cols || y >= rows)
        throw new RangeError('A planned terrain placement is outside its grid');
      return heights[y][x];
    },
  };
  const pool = new PlaceableMeshPool({ gameManager: stagedManager, publishMetrics: false });
  try {
    const results = await Promise.allSettled(
      plan.placements.map((placement) => pool.addPlaceable({ ...placement }, { strict: true }))
    );
    const failed = results.find((result) => result.status === 'rejected');
    if (failed) {
      const cause =
        failed.reason instanceof Error ? failed.reason : new Error(String(failed.reason));
      throw new Error(`Biome asset preparation failed: ${cause.message}`, {
        cause,
      });
    }
    if (plan.cavern) {
      const routeCells = naturalCavernRoutes({
        cols,
        rows,
        getHeight: (x, z) => heights[z][x],
        exits: plan.cavern.exits,
        seed: plan.cavern.seed,
      }).flatMap(({ cells }) => cells);
      routeCells.push(
        ...plan.cavern.exits.flatMap((side) => cavernEntranceCells(side, cols, rows))
      );
      resolveCavernSceneryClearance(pool, {
        routeCells,
        tileWorldSize: spatial.tileWorldSize,
        checkSupport: true,
        biomeKey: plan.biomeKey,
      });
    }
    return {
      placements: readPlaceablePlacements(pool),
      sightBounds: pool.sightBlockingBounds(),
      coverBounds: pool.targetingCoverBounds(),
    };
  } finally {
    pool.dispose();
  }
}
