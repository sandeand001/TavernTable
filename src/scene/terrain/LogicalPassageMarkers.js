import { logicalPassageEndpoint } from '../../campaigns/CampaignLogicalPassageTravel.js';

function release(group) {
  const geometries = new Set();
  const materials = new Set();
  for (const child of group.children) {
    if (child.geometry) geometries.add(child.geometry);
    if (child.material) materials.add(child.material);
  }
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  group.removeFromParent();
}

export function updateLogicalPassageMarkers(terrainMesh, gm, three) {
  const previous = terrainMesh.getObjectByName('LogicalPassageMarkers');
  const world = gm.campaignWorld;
  const mapId = gm.campaignMapId;
  const passages = world?.getLogicalPassages?.(mapId) || [];
  if (!passages.length) {
    if (previous) release(previous);
    return;
  }
  const map = world.getMap(mapId);
  const entries = passages.map((passage) => {
    const end = passage.ends?.find((entry) => entry.mapId === mapId) || passage;
    return {
      id: passage.id,
      side: end.side,
      position: logicalPassageEndpoint(
        map,
        end.side,
        (x, y) => gm.terrainEngine.getHeightAt(x, y),
        gm.spatial?.elevationUnit
      ).world,
    };
  });
  const signature = JSON.stringify([map.grid.tileWorldSize, entries]);
  if (previous?.userData.signature === signature) return;
  if (previous) release(previous);
  const group = new three.Group();
  group.name = 'LogicalPassageMarkers';
  group.userData = { signature, renderOnly: true };
  const tile = map.grid.tileWorldSize;
  const geometry = new three.CircleGeometry(tile * 0.39, 24);
  const material = new three.MeshBasicMaterial({
    color: 0xe7bd6a,
    side: three.DoubleSide,
    transparent: true,
    opacity: 0.65,
    depthWrite: false,
  });
  for (const entry of entries) {
    const marker = new three.Mesh(geometry, material);
    marker.name = `LogicalPassage:${entry.id}`;
    marker.userData.passageId = entry.id;
    marker.rotation.x = -Math.PI / 2;
    marker.position.set(entry.position.x, entry.position.y + tile * 0.03, entry.position.z);
    group.add(marker);
  }
  terrainMesh.add(group);
}
