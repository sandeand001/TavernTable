import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import MapProjectionTerrain from '../token-adapter/MapProjectionTerrain.js';
import { TerrainVolumeMeshBuilder } from './TerrainVolumeMeshBuilder.js';
import { createInteriorCutaway, clipFloorSurfaceOverlap } from './InteriorCutaway.js';
import { getMapTerrainAppearance } from './TerrainMaterialFactory.js';
import TerrainSightMask from './TerrainSightMask.js';

export function buildPlayerTerrainView({ world, map, observer, visibleMapIds, obstacles, three }) {
  const reference = world.getMapGeometry(map.id);
  const gm = {
    campaignWorld: world,
    campaignMapId: map.id,
    playerVisibleMapIds: visibleMapIds,
    playerSightObstacles: obstacles,
    cols: map.grid.cols,
    rows: map.grid.rows,
    spatial: {
      tileWorldSize: map.grid.tileWorldSize,
      elevationUnit: map.terrain.worldElevationUnit,
    },
    terrainEngine: {
      geometry: reference,
      getHeightAt: (x, z) => map.terrain.heights[z][x],
      onChanged: () => () => {},
    },
    threeSceneManager: { three, scene: new three.Scene() },
  };
  const projection = new MapProjectionTerrain(gm);
  const pieces = [];
  let merged;
  try {
    const cutaway = createInteriorCutaway(gm);
    pieces.push(
      new TerrainVolumeMeshBuilder().build({
        geometry: cutaway
          ? cutaway.query(reference, map, reference.getPartition(), { includeFloor: true })
          : reference,
        three,
        worldUnitsPerFoot: map.grid.tileWorldSize / 5,
        ...getMapTerrainAppearance(world, map),
      })
    );
    if (map.base !== 'floor') {
      const clipped = clipFloorSurfaceOverlap(pieces[0], { world, map, three, visibleMapIds });
      if (clipped !== pieces[0]) pieces[0].dispose();
      pieces[0] = clipped;
    }
    projection.update({ id: observer.id, mapId: observer.mapId, world: observer.pose.world }, []);
    gm.threeSceneManager.scene.updateMatrixWorld(true);
    gm.threeSceneManager.scene.traverseVisible((object) => {
      if (object.isMesh) pieces.push(object.geometry.clone().applyMatrix4(object.matrixWorld));
    });
    merged = mergeGeometries(pieces);
    if (!merged) throw new Error('The player terrain surfaces could not be combined');
    if (map.id === observer.mapId && map.base === 'floor') return merged;
    const toCampaign = projection._transform(map);
    const scale = 5 / map.grid.tileWorldSize;
    toCampaign.scale(new three.Vector3(scale, scale, scale));
    const visible = new TerrainSightMask({
      three,
      observerFeet: world.toCampaignPosition(observer.mapId, observer.pose.world),
      obstacles,
    }).apply(merged, { toCampaign });
    merged.dispose();
    merged = null;
    return visible;
  } catch (error) {
    merged?.dispose();
    throw error;
  } finally {
    for (const geometry of pieces) geometry.dispose();
    projection.dispose();
  }
}
