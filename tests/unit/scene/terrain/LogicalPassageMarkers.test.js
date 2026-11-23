import * as three from 'three';
import { updateLogicalPassageMarkers } from '../../../../src/scene/terrain/LogicalPassageMarkers.js';

test('only active-map logical entrances render and move with their grid edge', () => {
  const mesh = new three.Group();
  const map = {
    id: 'main',
    grid: { cols: 5, rows: 5, tileWorldSize: 1 },
    terrain: {
      heights: Array.from({ length: 5 }, () => Array(5).fill(0)),
      worldElevationUnit: 0.3,
    },
  };
  const gm = {
    campaignMapId: 'main',
    campaignWorld: {
      getMap: () => map,
      getLogicalPassages: () => [
        {
          id: 'passage-1',
          ends: [
            { mapId: 'main', side: 'east' },
            { mapId: 'secret', side: 'west' },
          ],
        },
      ],
    },
    terrainEngine: { getHeightAt: (x, y) => map.terrain.heights[y][x] },
  };
  updateLogicalPassageMarkers(mesh, gm, three);
  const markers = mesh.getObjectByName('LogicalPassageMarkers');
  expect(markers.children).toHaveLength(1);
  expect(markers.children[0].userData.passageId).toBe('passage-1');
  expect(markers.children[0].position.x).toBe(4.5);
  map.grid.cols = 8;
  for (const row of map.terrain.heights) row.push(0, 0, 0);
  updateLogicalPassageMarkers(mesh, gm, three);
  expect(mesh.getObjectByName('LogicalPassageMarkers').children[0].position.x).toBe(7.5);
  map.terrain.heights[2][7] = 3;
  gm.spatial = { elevationUnit: 0.6 };
  updateLogicalPassageMarkers(mesh, gm, three);
  expect(mesh.getObjectByName('LogicalPassageMarkers').children[0].position.y).toBeCloseTo(1.83);
});
