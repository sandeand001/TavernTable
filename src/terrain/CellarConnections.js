import {
  buildingDimensions,
  buildingFeetToLocal,
  buildingLocalToFeet,
  cellarAccessLayout,
} from './BuildingModel.js';

const EPSILON = 1e-6;

export function cellarConnectionFits(cellar, target) {
  if (
    cellar?.kind !== 'cellar' ||
    !target?.building ||
    target.kind === 'cellar' ||
    Math.abs(cellar.baseFeet - target.baseFeet) > EPSILON
  )
    return false;
  const spec =
    cellar.building.access.kind === 'none'
      ? {
          ...cellar,
          building: { ...cellar.building, access: { ...cellar.building.access, kind: 'ladder' } },
        }
      : cellar;
  const layout = cellarAccessLayout(spec),
    { length, width } = buildingDimensions(spec);
  const corners = [
    { x: layout.hole.min.x, z: layout.hole.min.z },
    { x: layout.hole.min.x, z: layout.hole.max.z },
    { x: layout.hole.max.x, z: layout.hole.min.z },
    { x: layout.hole.max.x, z: layout.hole.max.z },
    ...[-0.5, 0.5].flatMap((x) =>
      [-0.5, 0.5].map((z) => ({ x: layout.exit.x + x, z: layout.exit.z + z }))
    ),
  ];
  const targetSize = buildingDimensions(target);
  return corners.every((point) => {
    const world = buildingLocalToFeet(spec, {
      x: point.x - length / 2,
      y: 0,
      z: point.z - width / 2,
    });
    const local = buildingFeetToLocal(target, world);
    if (target.kind === 'turret') {
      const apothem = (target.diameterFeet / 2 - 2) * Math.cos(Math.PI / 16);
      return Array.from({ length: 16 }, (_, i) => (i * Math.PI) / 8).every(
        (angle) => local.x * Math.cos(angle) + local.z * Math.sin(angle) <= apothem + EPSILON
      );
    }
    return (
      Math.abs(local.x) <= targetSize.length / 2 - 1 + EPSILON &&
      Math.abs(local.z) <= targetSize.width / 2 - 1 + EPSILON
    );
  });
}

export function cellarConnectionCandidates(cellar, structures) {
  return structures.filter((target) => cellarConnectionFits(cellar, target));
}
