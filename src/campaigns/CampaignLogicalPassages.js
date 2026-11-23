import { DEFAULT_LOCATION_ID, mapLocationId } from './CampaignLocations.js';
import { CAVERN_SIDES, oppositeCavernSide } from '../terrain/generation/CavernInteriors.js';

const identifier = (value) =>
  typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,299}$/.test(value);
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const only = (value, keys) =>
  record(value) && Object.keys(value).every((key) => keys.includes(key));
const copy = (value) => JSON.parse(JSON.stringify(value));

export function validateLogicalPassages(passages, maps, connections = []) {
  if (passages === undefined) return;
  const invalid = () => {
    throw new Error('The saved campaign has invalid logical cavern passages');
  };
  if (!Array.isArray(passages) || passages.length > 2000) invalid();
  const byId = new Map(maps.map((map) => [map.id, map]));
  const ids = new Set((connections || []).map((connection) => connection.id));
  const used = new Set();
  for (const connection of connections || []) {
    if (!connection.cavern) continue;
    for (const end of connection.ends) {
      const side =
        connection.cavern.parentMapId === end.mapId
          ? connection.cavern.side
          : oppositeCavernSide(connection.cavern.side);
      used.add(`${end.mapId}:${side}`);
    }
  }
  for (const passage of passages) {
    if (
      !only(passage, ['version', 'id', 'kind', 'ends']) ||
      passage.version !== 1 ||
      !identifier(passage.id) ||
      ids.has(passage.id) ||
      !['chamber', 'outside'].includes(passage.kind) ||
      !Array.isArray(passage.ends) ||
      passage.ends.length !== 2 ||
      passage.ends.some(
        (end) =>
          !only(end, ['mapId', 'side']) || !byId.has(end.mapId) || !CAVERN_SIDES.includes(end.side)
      ) ||
      passage.ends[0].mapId === passage.ends[1].mapId ||
      mapLocationId(byId.get(passage.ends[0].mapId)) ===
        mapLocationId(byId.get(passage.ends[1].mapId))
    )
      invalid();
    ids.add(passage.id);
    for (const end of passage.ends) {
      const key = `${end.mapId}:${end.side}`;
      if (used.has(key)) invalid();
      used.add(key);
    }
  }
}

export function connectedCavernMapIds(scene, mapId) {
  if (!scene.maps?.some((map) => map.id === mapId))
    throw new Error('The cavern map is no longer available');
  const pairs = [
    ...(scene.connections || []).filter((connection) => connection.cavern),
    ...(scene.logicalPassages || []).filter((passage) => passage.kind === 'chamber'),
  ].map((connection) => connection.ends.map((end) => end.mapId));
  const visited = new Set([mapId]);
  const pending = [mapId];
  for (let index = 0; index < pending.length; index++)
    for (const [a, b] of pairs) {
      const other = a === pending[index] ? b : b === pending[index] ? a : null;
      if (other && !visited.has(other)) {
        visited.add(other);
        pending.push(other);
      }
    }
  return pending;
}

export function occupiedCavernSides(scene, mapId) {
  const sides = new Set();
  for (const connection of scene.connections || []) {
    if (!connection.cavern || !connection.ends.some((end) => end.mapId === mapId)) continue;
    sides.add(
      connection.cavern.parentMapId === mapId
        ? connection.cavern.side
        : oppositeCavernSide(connection.cavern.side)
    );
  }
  for (const passage of scene.logicalPassages || []) {
    const end = passage.ends.find((entry) => entry.mapId === mapId);
    if (end) sides.add(end.side);
  }
  return sides;
}

export function cavernNetworkDefaults(scene, mapId) {
  const outside = (scene.logicalPassages || []).filter(
    (passage) => passage.kind === 'outside' && passage.ends[0].mapId === mapId
  );
  const destinations = new Set(
    outside.map((passage) => passage.ends.find((end) => end.mapId !== mapId).mapId)
  );
  return {
    totalChambers: connectedCavernMapIds(scene, mapId).length,
    outsideSides: outside.map((passage) => passage.ends.find((end) => end.mapId === mapId).side),
    outsideMode: outside.length > 1 && destinations.size === 1 ? 'shared' : 'separate',
  };
}

function ensureLocations(scene) {
  if (scene.locations) return;
  scene.locations = [{ id: DEFAULT_LOCATION_ID, name: 'Main location' }];
  for (const map of scene.maps) map.locationId = DEFAULT_LOCATION_ID;
  for (const effect of scene.combat.effects || [])
    if (effect.locationId === undefined) effect.locationId = DEFAULT_LOCATION_ID;
}

function addBlankMap(scene, source, label) {
  const locationId = `location:${crypto.randomUUID()}`;
  const id = `map:${crypto.randomUUID()}`;
  scene.locations.push({ id: locationId, name: label });
  scene.maps.push({
    id,
    locationId,
    name: label,
    originFeet: { x: 0, y: 0, z: 0 },
    quarterTurns: 0,
    base: 'ground',
    grid: { ...source.grid },
    terrain: {
      heights: Array.from({ length: source.grid.rows }, () => Array(source.grid.cols).fill(0)),
      biome: null,
      seed: source.terrain.seed,
      elevationScale: source.terrain.elevationScale,
      worldElevationUnit: source.terrain.worldElevationUnit,
      treeDensity: 0,
      richShading: {},
      placeables: [],
      sightBounds: [],
    },
  });
  return id;
}

export function addLogicalCavernArea(
  input,
  { mapId, side, kind = 'chamber', outsideMapId = null, name = '' } = {}
) {
  if (
    input?.version !== 3 ||
    !Array.isArray(input.maps) ||
    !CAVERN_SIDES.includes(side) ||
    !['chamber', 'outside'].includes(kind) ||
    (outsideMapId !== null && (kind !== 'outside' || !identifier(outsideMapId))) ||
    typeof name !== 'string' ||
    name.trim().length > 100
  )
    throw new Error('Choose a valid cavern entrance and destination');
  const scene = copy(input);
  const source = scene.maps.find((map) => map.id === mapId);
  if (!source?.terrain.cavern || source.building || !source.terrain.cavern.exits.includes(side))
    throw new Error('Choose an existing main entrance on a natural cavern map');
  if (occupiedCavernSides(scene, mapId).has(side))
    throw new Error('This cavern entrance is already connected');
  if (
    outsideMapId !== null &&
    !(scene.logicalPassages || []).some(
      (passage) => passage.kind === 'outside' && passage.ends[1].mapId === outsideMapId
    )
  )
    throw new Error('Choose an existing outside destination');
  if (outsideMapId === null && (scene.maps.length >= 128 || (scene.locations?.length ?? 1) >= 128))
    throw new Error('The campaign has reached its map limit');
  ensureLocations(scene);
  const label =
    name.trim() ||
    (kind === 'chamber'
      ? `Cavern chamber ${connectedCavernMapIds(scene, mapId).length + 1}`
      : 'Outside area');
  const target = outsideMapId ?? addBlankMap(scene, source, label);
  if (mapLocationId(source) === mapLocationId(scene.maps.find((map) => map.id === target)))
    throw new Error('A logical passage requires a separate destination location');
  const occupied = occupiedCavernSides(scene, target);
  const targetSide = [oppositeCavernSide(side), ...CAVERN_SIDES].find(
    (candidate) => !occupied.has(candidate)
  );
  if (!targetSide) throw new Error('The outside map has no available entrance');
  scene.logicalPassages ||= [];
  scene.logicalPassages.push({
    version: 1,
    id: `passage:${crypto.randomUUID()}`,
    kind,
    ends: [
      { mapId, side },
      { mapId: target, side: targetSide },
    ],
  });
  return scene;
}

export function createLogicalCavernNetwork(
  input,
  { mapId, totalChambers, outsideSides = null, outsideMode = 'separate' } = {}
) {
  if (
    input?.version !== 3 ||
    !Array.isArray(input.maps) ||
    !Number.isInteger(totalChambers) ||
    totalChambers < 1 ||
    totalChambers > 128 ||
    !['shared', 'separate'].includes(outsideMode) ||
    (outsideSides !== null &&
      (!Array.isArray(outsideSides) ||
        new Set(outsideSides).size !== outsideSides.length ||
        outsideSides.some((side) => !CAVERN_SIDES.includes(side))))
  )
    throw new Error('Choose a valid chamber count and outside entrances');
  const scene = copy(input);
  const root = scene.maps.find((map) => map.id === mapId);
  if (!root?.terrain.cavern || root.building)
    throw new Error('Generate a natural cavern before creating its chamber network');
  const connected = connectedCavernMapIds(scene, mapId);
  if (totalChambers < connected.length)
    throw new Error(
      `This network already has ${connected.length} linked areas; preserve them or choose a larger chamber count`
    );
  const existingOutside = (scene.logicalPassages || []).filter(
    (passage) => passage.kind === 'outside' && passage.ends[0].mapId === mapId
  );
  const oldSides = existingOutside.map(
    (passage) => passage.ends.find((end) => end.mapId === mapId).side
  );
  const selectedOutside = outsideSides ?? oldSides;
  if (oldSides.some((side) => !selectedOutside.includes(side)))
    throw new Error('Existing outside entrances must be preserved before changing their selection');
  if (selectedOutside.some((side) => !root.terrain.cavern.exits.includes(side)))
    throw new Error('Choose outside entrances that exist on the generated cavern');
  const oldTargets = new Set(
    existingOutside.map((passage) => passage.ends.find((end) => end.mapId !== mapId).mapId)
  );
  if (
    (outsideMode === 'shared' && oldTargets.size > 1) ||
    (outsideMode === 'separate' && oldTargets.size < existingOutside.length)
  )
    throw new Error(
      'Existing outside destinations must be preserved before changing their grouping'
    );
  const newOutsideSides = selectedOutside.filter((side) => !oldSides.includes(side));
  const occupied = occupiedCavernSides(scene, mapId);
  if (newOutsideSides.some((side) => occupied.has(side)))
    throw new Error('An outside entrance is already connected to another area');
  const outsideMaps =
    outsideMode === 'shared'
      ? newOutsideSides.length && !oldTargets.size
        ? 1
        : 0
      : newOutsideSides.length;
  const newMaps = totalChambers - connected.length + outsideMaps;
  if (scene.maps.length + newMaps > 128 || (scene.locations?.length ?? 1) + newMaps > 128)
    throw new Error('The requested chambers and outside areas exceed the campaign map limit');
  if (!newMaps && !newOutsideSides.length) return scene;
  ensureLocations(scene);
  scene.logicalPassages ||= [];
  let sharedOutside = outsideMode === 'shared' ? [...oldTargets][0] : null;
  for (const side of newOutsideSides) {
    const target =
      outsideMode === 'shared'
        ? (sharedOutside ||= addBlankMap(scene, root, 'Outside area'))
        : addBlankMap(scene, root, 'Outside area');
    const targetSide = CAVERN_SIDES.find(
      (candidate) => !occupiedCavernSides(scene, target).has(candidate)
    );
    if (!targetSide) throw new Error('The shared outside map has no available entrance');
    scene.logicalPassages.push({
      version: 1,
      id: `passage:${crypto.randomUUID()}`,
      kind: 'outside',
      ends: [
        { mapId, side },
        { mapId: target, side: targetSide },
      ],
    });
  }
  while (connected.length < totalChambers) {
    let source = null;
    let side = null;
    for (const id of connected) {
      const map = scene.maps.find((entry) => entry.id === id);
      const candidates = map.terrain.cavern?.exits ?? CAVERN_SIDES;
      const occupiedSides = occupiedCavernSides(scene, id);
      const available = candidates.find((candidate) => !occupiedSides.has(candidate));
      if (!available) continue;
      source = id;
      side = available;
      break;
    }
    if (!source)
      throw new Error(
        'No unused cavern entrance remains; add an entrance before creating chambers'
      );
    const target = addBlankMap(scene, root, `Cavern chamber ${connected.length + 1}`);
    scene.logicalPassages.push({
      version: 1,
      id: `passage:${crypto.randomUUID()}`,
      kind: 'chamber',
      ends: [
        { mapId: source, side },
        { mapId: target, side: oppositeCavernSide(side) },
      ],
    });
    connected.push(target);
  }
  return scene;
}
