import { createTwoFloorTravelScene } from './ConnectedTravelExample.js';
import { createCurvedExamples } from '../../terrain/CurvedExamples.js';
import { TerrainGeometry } from '../../terrain/TerrainGeometry.js';

export function createCurvedStructuresScene(options) {
  const scene = createTwoFloorTravelScene(options);
  const map = scene.maps[0];
  const geometry = new TerrainGeometry({
    widthFeet: 125,
    depthFeet: 125,
    getTerrainHeightFeet: () => 0,
  });
  geometry.load({
    version: 2,
    volumes: createCurvedExamples({ widthFeet: 125, depthFeet: 125 }),
  });
  map.name = 'Caves, domes and battlements';
  map.terrain.geometry = geometry.save();
  scene.maps = [map];
  scene.connections = [];
  const starts = [
    [6, 15],
    [19, 11],
    [3, 17],
  ];
  scene.creatures.forEach((creature, index) => {
    const [gridX, gridY] = starts[index];
    creature.mapId = map.id;
    creature.gridX = gridX;
    creature.gridY = gridY;
    creature.pose = {
      kind: 'ground',
      world: { x: gridX + 0.5, y: 0, z: gridY + 0.5 },
    };
  });
  scene.view.focusTokenId = null;
  scene.view.camera.target = { x: 12.5, y: 0, z: 12.5 };
  scene.view.camera.zoom = 1.1;
  return scene;
}
