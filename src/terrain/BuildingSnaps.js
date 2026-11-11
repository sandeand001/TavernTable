import {
  createStructure,
  replaceStructureGeometry,
  structureVolumes,
} from './ConstructionBlueprints.js';
import {
  buildingDimensions,
  buildingLocalToFeet,
  buildingLevels,
  buildingLevelHeight,
} from './BuildingModel.js';
import { boundsOverlap, clipCellToBounds } from './ConvexGeometry.js';
import { volumeCell } from './TerrainVolumeShape.js';

const SNAP_DISTANCE_FEET = 10;
const MIN_SHARED_FACE_FEET = 10;

export function isBuildingJoinConnection(connection, ownerMapId) {
  return (
    connection.kind === 'opening' &&
    connection.feature?.mapId === ownerMapId &&
    Array.isArray(connection.feature.volumeIds) &&
    connection.feature.volumeIds.length > 0 &&
    connection.feature.volumeIds.every((id) => id.startsWith('compound-opening-'))
  );
}

export function isGeneratedBuildingJoin(connection, ownerMapId, geometry, getMap) {
  if (!isBuildingJoinConnection(connection, ownerMapId)) return false;
  const volumes = new Map(geometry.volumes.map((volume) => [volume.id, volume])),
    structures = new Map((geometry.structures || []).map((spec) => [spec.id, spec]));
  return (
    connection.feature.volumeIds.every((id) => volumes.get(id)?.source === 'generated') &&
    connection.ends.every((end) => {
      const map = getMap(end.mapId);
      return (
        map?.building?.ownerMapId === ownerMapId &&
        structures.get(map.building.structureId)?.source === 'generated'
      );
    })
  );
}

function footprint(spec) {
  const { length, width } = buildingDimensions(spec);
  const corners = [-1, 1].flatMap((x) =>
    [-1, 1].map((z) => buildingLocalToFeet(spec, { x: (x * length) / 2, y: 0, z: (z * width) / 2 }))
  );
  return {
    minX: Math.min(...corners.map((p) => p.x)),
    maxX: Math.max(...corners.map((p) => p.x)),
    minZ: Math.min(...corners.map((p) => p.z)),
    maxZ: Math.max(...corners.map((p) => p.z)),
  };
}

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export function previewBuildingSnap(
  structures,
  id,
  changes,
  { targetId = null, source = 'manual' } = {}
) {
  if (!['manual', 'generated'].includes(source))
    throw new Error('A building snap requires valid construction provenance');
  const original = structures.find((spec) => spec.id === id);
  if (!original?.building || original.kind !== 'building')
    throw new Error('Choose a rectangular building to snap');
  if (
    !changes ||
    typeof changes !== 'object' ||
    Array.isArray(changes) ||
    Object.keys(changes).some((key) => !['xFeet', 'zFeet', 'angleRadians'].includes(key))
  )
    throw new Error('A building snap requires position or rotation changes');
  const proposed = createStructure({ ...original, ...changes, source });
  const moving = footprint(proposed);
  const targets = structures.filter(
    (spec) =>
      spec.id !== id &&
      spec.kind === 'building' &&
      spec.building &&
      (targetId === null || spec.id === targetId)
  );
  if (targetId !== null && !targets.length)
    throw new Error('Choose another rectangular building as the snap target');
  const candidates = [];
  for (const target of targets) {
    const fixed = footprint(target);
    for (const [axis, delta, low, high, coordinate, direction] of [
      [
        'x',
        fixed.maxX - moving.minX,
        Math.max(fixed.minZ, moving.minZ),
        Math.min(fixed.maxZ, moving.maxZ),
        fixed.maxX,
        1,
      ],
      [
        'x',
        fixed.minX - moving.maxX,
        Math.max(fixed.minZ, moving.minZ),
        Math.min(fixed.maxZ, moving.maxZ),
        fixed.minX,
        -1,
      ],
      [
        'z',
        fixed.maxZ - moving.minZ,
        Math.max(fixed.minX, moving.minX),
        Math.min(fixed.maxX, moving.maxX),
        fixed.maxZ,
        1,
      ],
      [
        'z',
        fixed.minZ - moving.maxZ,
        Math.max(fixed.minX, moving.minX),
        Math.min(fixed.maxX, moving.maxX),
        fixed.minZ,
        -1,
      ],
    ]) {
      if (Math.abs(delta) > SNAP_DISTANCE_FEET || high - low < MIN_SHARED_FACE_FEET) continue;
      candidates.push({
        target,
        axis,
        delta,
        low,
        high,
        coordinate,
        direction,
        distance: Math.abs(delta),
      });
    }
  }
  candidates.sort((a, b) => a.distance - b.distance || a.target.id.localeCompare(b.target.id));
  const snap = candidates[0];
  if (!snap) throw new Error('No compatible building face is within snapping range');
  return freeze({
    structure: createStructure({
      ...proposed,
      [snap.axis === 'x' ? 'xFeet' : 'zFeet']:
        proposed[snap.axis === 'x' ? 'xFeet' : 'zFeet'] + snap.delta,
    }),
    targetId: snap.target.id,
    face: {
      axis: snap.axis,
      coordinate: snap.coordinate,
      low: snap.low,
      high: snap.high,
      sourceDirection: snap.direction,
    },
  });
}

export function buildingSnapOpenings(preview, target) {
  const source = preview.structure,
    face = preview.face,
    center = (face.low + face.high) / 2,
    width = Math.min(10, face.high - face.low - 2),
    volumes = [],
    joins = [];
  for (const first of buildingLevels(source, { includeDeck: false }))
    for (const second of buildingLevels(target, { includeDeck: false })) {
      const elevation = source.baseFeet + first.elevationFeet;
      if (Math.abs(elevation - target.baseFeet - second.elevationFeet) > 1e-5) continue;
      const height = Math.min(
        8,
        buildingLevelHeight(source, first.id) - 0.5,
        buildingLevelHeight(target, second.id) - 0.5
      );
      if (height < 6) continue;
      const ids = [`${source.id}-f${first.id}`, `${target.id}-f${second.id}`].sort();
      const id = `compound-opening-${ids.map((token) => `${token.length}-${token}`).join('-')}`;
      const min = {
        x: face.axis === 'x' ? face.coordinate - 2.5 : center - width / 2,
        y: elevation,
        z: face.axis === 'z' ? face.coordinate - 2.5 : center - width / 2,
      };
      const max = {
        x: face.axis === 'x' ? face.coordinate + 2.5 : center + width / 2,
        y: elevation + height,
        z: face.axis === 'z' ? face.coordinate + 2.5 : center + width / 2,
      };
      volumes.push({
        id,
        layerId: 'castle',
        operation: 'subtract',
        source: source.source,
        bounds: { min, max },
      });
      const point = (direction) => ({
        x: face.axis === 'x' ? face.coordinate + direction * 2.5 : center,
        y: elevation,
        z: face.axis === 'z' ? face.coordinate + direction * 2.5 : center,
      });
      joins.push({
        id,
        sourceId: source.id,
        targetId: target.id,
        sourceFloor: first.id,
        targetFloor: second.id,
        sourcePoint: point(face.sourceDirection),
        targetPoint: point(-face.sourceDirection),
        volumeIds: [id],
      });
    }
  if (!joins.length) throw new Error('The buildings have no compatible walkable floor elevations');
  return { volumes, joins };
}

export function buildingSnapGeometry(snapshot, preview) {
  const target = snapshot.structures.find((spec) => spec.id === preview.targetId);
  if (!target) throw new Error('The building snap target no longer exists');
  const openings = buildingSnapOpenings(preview, target);
  const members = new Set([preview.structure.id, target.id]),
    cuts = [
      ...openings.volumes,
      ...structureVolumes(preview.structure).filter((volume) => volume.operation === 'subtract'),
    ];
  if (
    snapshot.volumes.some(
      (volume) =>
        volume.operation === 'add' &&
        !members.has(volume.structureId) &&
        (preview.structure.source === 'manual' || volume.source !== 'generated') &&
        cuts.some(
          (cut) =>
            boundsOverlap(volume.bounds, cut.bounds) &&
            clipCellToBounds(volumeCell(volume), cut.bounds)
        )
    )
  )
    throw new Error('Protected construction occupies this snap destination; choose another face');
  const geometry = replaceStructureGeometry(snapshot, preview.structure);
  geometry.structures = geometry.structures.map((spec) =>
    spec.id === target.id ? createStructure({ ...spec, source: preview.structure.source }) : spec
  );
  geometry.volumes = geometry.volumes.map((volume) =>
    volume.structureId === target.id ? { ...volume, source: preview.structure.source } : volume
  );
  const ids = new Set(openings.volumes.map((volume) => volume.id));
  geometry.volumes = geometry.volumes.filter((volume) => !ids.has(volume.id));
  geometry.volumes.push(...openings.volumes);
  return { geometry, joins: openings.joins };
}

export function createBuildingSnapPreview(snapshot, id, changes, options = {}) {
  const preview = previewBuildingSnap(snapshot.structures || [], id, changes, options);
  const plan = buildingSnapGeometry(snapshot, preview);
  return freeze({ ...preview, geometry: plan.geometry, joins: plan.joins });
}

export function withBuildingSnapContext(preview, context) {
  if (
    typeof context?.ownerMapId !== 'string' ||
    !Array.isArray(context.maps) ||
    !Array.isArray(context.connections)
  )
    throw new Error('The building snap preview requires valid member-floor topology');
  return freeze({ ...preview, buildingContext: JSON.parse(JSON.stringify(context)) });
}
