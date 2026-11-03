import { createTwoFloorTravelScene } from './ConnectedTravelExample.js';

export function createOpeningsTravelScene(options) {
  const scene = createTwoFloorTravelScene(options);
  const shell = scene.maps[0].terrain.geometry;
  for (const volume of shell.volumes.filter((volume) => volume.operation === 'add')) {
    if (volume.id === 'roof') volume.bounds.min.y = 29.5;
    volume.bounds.max.y = 30;
  }
  const volume = (id, operation, min, max, layerId = 'ground') => ({
    id,
    operation,
    layerId,
    bounds: {
      min: { x: min[0], y: min[1], z: min[2] },
      max: { x: max[0], y: max[1], z: max[2] },
    },
  });
  shell.volumes.push(
    volume('balcony', 'add', [45, 9.5, 47.5], [55, 10, 57.5], 'balcony'),
    volume('balcony-west-rail', 'add', [45, 10, 47.5], [45.5, 13, 50], 'balcony'),
    volume('balcony-west-rail-south', 'add', [45, 10, 55], [45.5, 13, 57.5], 'balcony'),
    volume('balcony-north-rail', 'add', [45, 10, 47.5], [55, 13, 48], 'balcony'),
    volume('balcony-south-rail', 'add', [45, 10, 57], [55, 13, 57.5], 'balcony'),
    volume('balcony-door', 'subtract', [54.5, 10, 50], [56.5, 17, 55]),
    volume('high-window', 'subtract', [54.5, 22, 27.5], [56.5, 27, 37.5]),
    volume('open-arch', 'subtract', [75, 0, 19.5], [80, 8, 21.5]),
    volume('high-wall-opening', 'subtract', [93.5, 20, 45], [95.5, 27, 50])
  );
  const high = JSON.parse(JSON.stringify(scene.maps[2]));
  high.id = 'high-floor';
  high.name = 'High window floor';
  high.originFeet.y = 20;
  high.terrain.geometry = { version: 1, volumes: [] };
  scene.maps.push(high);
  for (const [id, name, insideMapId, outsideZ] of [
    ['ground-window', 'Ground window', 'ground-floor', 32.5],
    ['upper-window', 'Upper window', 'upper-floor', 27],
    ['high-window', 'High window', 'high-floor', 27],
  ])
    scene.connections.push({
      id,
      name,
      kind: 'window',
      outsideMapId: 'map-main',
      feature: { mapId: 'map-main', volumeIds: [id] },
      ends: [
        { mapId: 'map-main', positionFeet: { x: 52.5, y: 0, z: outsideZ } },
        { mapId: insideMapId, positionFeet: { x: 2.5, y: 0, z: 12.5 } },
      ],
      pathFeet: [],
    });
  scene.connections.push(
    {
      id: 'balcony-door',
      name: 'Balcony doorway',
      kind: 'door',
      feature: { mapId: 'map-main', volumeIds: ['balcony-door'] },
      ends: [
        { mapId: 'map-main', positionFeet: { x: 52.5, y: 10, z: 52.5 } },
        { mapId: 'upper-floor', positionFeet: { x: 2.5, y: 0, z: 32.5 } },
      ],
      pathFeet: [],
    },
    {
      id: 'open-arch',
      name: 'Open wall arch',
      kind: 'opening',
      feature: { mapId: 'map-main', volumeIds: ['open-arch'] },
      ends: [
        { mapId: 'map-main', positionFeet: { x: 77.5, y: 0, z: 17.5 } },
        { mapId: 'ground-floor', positionFeet: { x: 22.5, y: 0, z: 2.5 } },
      ],
      pathFeet: [],
    }
  );
  scene.connections.push({
    id: 'high-wall-opening',
    name: 'High wall opening',
    kind: 'window',
    outsideMapId: 'map-main',
    feature: { mapId: 'map-main', volumeIds: ['high-wall-opening'] },
    ends: [
      { mapId: 'map-main', positionFeet: { x: 97.5, y: 0, z: 44.5 } },
      { mapId: 'high-floor', positionFeet: { x: 37.5, y: 0, z: 27.5 } },
    ],
    pathFeet: [],
  });
  const place = (creature, mapId, x, z) => {
    Object.assign(creature, { mapId, gridX: Math.floor(x), gridY: Math.floor(z) });
    creature.pose.world = { x, y: 0, z };
  };
  place(scene.creatures[0], 'map-main', 7.5, 6.5);
  place(scene.creatures[1], 'high-floor', 2.5, 4.5);
  place(scene.creatures[2], 'ground-floor', 4.5, 7.5);
  scene.view.camera.target = { x: 9.5, y: 0, z: 6.5 };
  return scene;
}
