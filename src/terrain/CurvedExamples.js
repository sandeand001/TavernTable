import {
  createDomeVolumes,
  createTubeVolumes,
  createCastleWallVolumes,
  createRoundTowerVolumes,
} from './StructureShapes.js';

export function createCurvedExamples({ widthFeet, depthFeet }) {
  if (
    !Number.isFinite(widthFeet) ||
    !Number.isFinite(depthFeet) ||
    widthFeet < 125 ||
    depthFeet < 125
  )
    throw new Error('The curved structures require at least 25 by 25 squares of empty map');
  const bounds = (x0, y0, z0, x1, y1, z1) => ({
    min: { x: x0, y: y0, z: z0 },
    max: { x: x1, y: y1, z: z1 },
  });
  const cave = [
    ...createDomeVolumes({
      id: 'curved-cave',
      layerId: 'cave',
      wallFeet: 3,
      bounds: bounds(10, 0, 10, 55, 20, 55),
    }),
    ...createTubeVolumes({
      id: 'curved-tunnel',
      bounds: bounds(25, 0, 40, 45, 12, 75),
    }),
  ];
  const result = [
    ...cave.filter((volume) => volume.operation === 'add'),
    ...cave.filter((volume) => volume.operation === 'subtract'),
    {
      id: 'curved-cave-side-room',
      operation: 'subtract',
      layerId: 'cave',
      bounds: bounds(37.5, 0, 27.5, 52.5, 9, 42.5),
      shape: {
        kind: 'ellipsoid',
        center: { x: 45, y: 0, z: 35 },
        radii: { x: 7.5, y: 9, z: 7.5 },
      },
    },
    ...createDomeVolumes({
      id: 'curved-dome',
      bounds: bounds(75, 0, 10, 115, 15, 50),
    }),
    ...createCastleWallVolumes({
      id: 'curved-battlement',
      bounds: bounds(10, 0, 95, 90, 10, 110),
    }),
    ...createRoundTowerVolumes({
      id: 'curved-tower',
      bounds: bounds(85, 0, 85, 120, 10, 120),
    }),
  ];
  const cut = (id, box, layerId = 'castle') =>
    result.push({ id: `curved-${id}`, operation: 'subtract', layerId, bounds: box });
  cut('dome-door', bounds(90, 0, 30, 100, 8, 50), 'dome');
  cut('tower-door', bounds(97.5, 0, 85, 107.5, 8, 102.5));
  cut('tower-walkway-access', bounds(85, 10, 97.5, 92.5, 13, 107.5));
  cut('battlement-stair-access', bounds(60, 10, 95, 65, 13, 97.5));
  for (let i = 0; i < 8; i++) {
    result.push({
      id: `curved-battlement-stair-${i}`,
      operation: 'add',
      layerId: 'castle',
      bounds: bounds(20 + i * 5, 0, 90, 25 + i * 5, (i + 1) * 1.25, 95),
    });
  }
  result.push({
    id: 'curved-battlement-landing',
    operation: 'add',
    layerId: 'castle',
    bounds: bounds(60, 0, 90, 65, 10, 100),
  });
  return result;
}
