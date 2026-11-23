import { CAVERN_BIOME_KEYS } from '../../config/biome/BiomeConstants.js';
import { getPurePolyAsset, isCaveFormationModel } from '../../config/assets/PurePolyAssets.js';
import { requiresCavernRouteClearance } from '../../terrain/PlaceableCollision.js';
import { isTerrainCellSupported } from '../../terrain/TerrainSupport.js';

export function resolveCavernSceneryClearance(
  pool,
  { routeCells = [], tileWorldSize = null, checkSupport = false, biomeKey = null } = {}
) {
  if (!pool?._groups || !pool?._metadata)
    throw new Error('Generated cavern clearance requires loaded terrain models');
  if (
    !Array.isArray(routeCells) ||
    ((routeCells.length || checkSupport) && (!Number.isFinite(tileWorldSize) || tileWorldSize <= 0))
  )
    throw new Error('Generated cavern routes require a valid physical scale');
  if (!pool._metadata.size) return 0;
  const three = pool._three;
  if (!three) throw new Error('Generated cavern clearance requires loaded terrain models');
  const rocks = [];
  const formations = [];
  const routeScenery = [];
  const protectedBounds = routeCells.map(({ x, z }) => {
    if (!Number.isInteger(x) || !Number.isInteger(z))
      throw new Error('A generated cavern route contains an invalid cell');
    const height = pool.gameManager.getTerrainHeight(x, z);
    if (!Number.isFinite(height)) throw new Error('A generated cavern route has no valid floor');
    const y = height * pool.gameManager.spatial.elevationUnit;
    return {
      min: { x: x * tileWorldSize, y, z: z * tileWorldSize },
      max: { x: (x + 1) * tileWorldSize, y: y + tileWorldSize, z: (z + 1) * tileWorldSize },
    };
  });
  const matrix = new three.Matrix4();
  for (const [key, entries] of pool._metadata) {
    const relevant = [...entries].filter(([, entry]) => {
      const source = entry.source;
      return (
        source?.generatedBiome &&
        CAVERN_BIOME_KEYS.includes(source.biomeKey) &&
        (biomeKey === null || source.biomeKey === biomeKey) &&
        ((source.biomeKey === 'cavern' &&
          (/^rock-medium-[234]$/.test(source.modelKey || '') ||
            getPurePolyAsset(source.modelKey)?.kind === 'rock')) ||
          isCaveFormationModel(source.modelKey) ||
          (routeCells.length && requiresCavernRouteClearance(source)))
      );
    });
    if (!relevant.length) continue;
    const group = pool._groups.get(key);
    const mesh = group?.instancedMesh;
    if (!mesh) throw new Error('A generated cavern model group is missing');
    let bounds = mesh.geometry.boundingBox;
    if (!bounds) {
      mesh.geometry.computeBoundingBox();
      bounds = mesh.geometry.boundingBox;
    }
    if (!bounds || bounds.isEmpty()) throw new Error('A generated cavern model has no bounds');
    mesh.updateWorldMatrix(true, false);
    for (const [index, entry] of relevant) {
      const source = entry.source;
      const model = source.modelKey || '';
      const rock =
        source.biomeKey === 'cavern' &&
        (/^rock-medium-[234]$/.test(model) || getPurePolyAsset(model)?.kind === 'rock');
      const formation = isCaveFormationModel(model);
      mesh.getMatrixAt(index, matrix);
      matrix.premultiply(mesh.matrixWorld);
      const item = { key, index, source, bounds: bounds.clone().applyMatrix4(matrix) };
      if (
        !['x', 'y', 'z'].every(
          (axis) => Number.isFinite(item.bounds.min[axis]) && Number.isFinite(item.bounds.max[axis])
        )
      )
        throw new Error('A generated cavern model has invalid bounds');
      if (rock) rocks.push(item);
      if (formation) {
        if (checkSupport) {
          if (!group.supportBounds)
            throw new Error('A generated cave formation has no measurable ground support');
          item.support = group.supportBounds.clone().applyMatrix4(matrix);
        }
        formations.push(item);
      }
      if (routeCells.length && requiresCavernRouteClearance(source)) routeScenery.push(item);
    }
  }
  const overlap = (a, b) =>
    ['x', 'y', 'z'].every(
      (axis) => Math.min(a.max[axis], b.max[axis]) - Math.max(a.min[axis], b.min[axis]) > 1e-6
    );
  const removed = new Set();
  const supported = (item) => {
    if (!checkSupport) return true;
    const gm = pool.gameManager;
    const origin = gm.spatial.gridToWorld(0, 0, 0);
    const lowX = Math.floor((item.support.min.x - origin.x + 1e-6) / tileWorldSize);
    const highX = Math.max(
      lowX,
      Math.floor((item.support.max.x - origin.x - 1e-6) / tileWorldSize)
    );
    const lowZ = Math.floor((item.support.min.z - origin.z + 1e-6) / tileWorldSize);
    const highZ = Math.max(
      lowZ,
      Math.floor((item.support.max.z - origin.z - 1e-6) / tileWorldSize)
    );
    if (lowX < 0 || lowZ < 0 || highX >= gm.cols || highZ >= gm.rows) return false;
    const height = gm.getTerrainHeight(item.source.gridX, item.source.gridY);
    if (!Number.isFinite(height)) throw new Error('A generated formation has no valid floor');
    for (let z = lowZ; z <= highZ; z++)
      for (let x = lowX; x <= highX; x++) {
        const actual = gm.getTerrainHeight(x, z);
        if (!Number.isFinite(actual)) throw new Error('A generated formation has no valid support');
        if (Math.abs(actual - height) > 1e-4) return false;
        if (typeof gm.isTerrainSupported === 'function' && !gm.isTerrainSupported(x, z, actual))
          return false;
        if (
          typeof gm.isTerrainSupported !== 'function' &&
          Number.isFinite(gm.terrainEngine?.geometry?.terrainThicknessFeet) &&
          !isTerrainCellSupported(
            gm.terrainEngine.geometry,
            x,
            z,
            (actual * gm.spatial.elevationUnit * 5) / tileWorldSize
          )
        )
          return false;
      }
    return true;
  };
  for (const item of routeScenery)
    if (protectedBounds.some((bounds) => overlap(item.bounds, bounds))) removed.add(item);
  formations.sort(
    (a, b) =>
      (a.source.gridY ?? 0) - (b.source.gridY ?? 0) ||
      (a.source.gridX ?? 0) - (b.source.gridX ?? 0) ||
      a.source.modelKey.localeCompare(b.source.modelKey)
  );
  const accepted = [];
  for (const formation of formations) {
    if (
      removed.has(formation) ||
      !supported(formation) ||
      rocks.some(
        (rock) =>
          rock.source.biomeKey === formation.source.biomeKey &&
          !removed.has(rock) &&
          overlap(formation.bounds, rock.bounds)
      ) ||
      accepted.some(
        (other) =>
          other.source.biomeKey === formation.source.biomeKey &&
          overlap(formation.bounds, other.bounds)
      )
    )
      removed.add(formation);
    else accepted.push(formation);
  }
  for (const item of removed)
    pool.removePlaceable({ __meshPoolHandle: { key: item.key, index: item.index } });
  return removed.size;
}
