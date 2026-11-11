import CampaignWorld from './CampaignWorld.js';
import { validateScene } from './CampaignScene.js';
import { campaignFeetBounds, mapFeetToCampaign } from './CampaignCoordinates.js';
import {
  createCavernInterior,
  sculptCavernPassage,
  cavernEndpoint,
  CAVERN_SIDES,
  oppositeCavernSide,
} from '../terrain/generation/CavernInteriors.js';
import { mapLocationId } from './CampaignLocations.js';

const copy = (value) => JSON.parse(JSON.stringify(value));

// -- Area authoring --

export function isCavernConnection(connection) {
  return connection.cavern !== undefined;
}

export function addCavernArea(
  input,
  context,
  mapId,
  { side, kind = 'chamber', name = '', source = 'manual', id = null } = {}
) {
  if (
    !CAVERN_SIDES.includes(side) ||
    !['chamber', 'tunnel'].includes(kind) ||
    !['generated', 'manual'].includes(source) ||
    typeof name !== 'string' ||
    name.trim().length > 100
  )
    throw new Error('Choose a valid cavern area, direction and name of at most 100 characters');
  const scene = input.version === 3 ? copy(input) : CampaignWorld.fromScene(input, context).save();
  const parent = scene.maps.find((map) => map.id === mapId);
  if (!parent?.terrain.cavern || parent.building)
    throw new Error('Side tunnels and chambers can be added only from a cavern interior');
  if (parent.terrain.cavern.version < 2)
    throw new Error('Generate the elevation-based cavern before adding new areas');
  if (scene.maps.length >= 128) throw new Error('The campaign has reached its 128-area limit');
  if (
    (scene.connections || []).some(
      (connection) =>
        connection.cavern &&
        connection.ends.some((end) => end.mapId === mapId) &&
        (connection.cavern.parentMapId === mapId
          ? connection.cavern.side
          : oppositeCavernSide(connection.cavern.side)) === side
    )
  )
    throw new Error('This side already has a connected cavern area');
  const rootId = parent.cavern?.ownerMapId ?? parent.id;
  const cols =
    kind === 'tunnel'
      ? ['east', 'west'].includes(side)
        ? 13
        : 7
      : Math.max(5, Math.min(30, Math.round(parent.grid.cols * 0.75)));
  const rows =
    kind === 'tunnel'
      ? ['east', 'west'].includes(side)
        ? 7
        : 13
      : Math.max(5, Math.min(30, Math.round(parent.grid.rows * 0.75)));
  const seed =
    (parent.terrain.cavern.seed ^ Math.imul(CAVERN_SIDES.indexOf(side) + 1, 0x9e3779b1)) >>> 0;
  const interior = createCavernInterior({
    biomeKey: parent.terrain.biome,
    seed,
    cols,
    rows,
    kind,
    feetPerLevel: (parent.terrain.worldElevationUnit * 5) / parent.grid.tileWorldSize,
    exits: [oppositeCavernSide(side)],
  });
  const width = parent.grid.cols * 5,
    depth = parent.grid.rows * 5,
    w = cols * 5,
    d = rows * 5;
  const [x, z] = {
    north: [(width - w) / 2, -d],
    east: [width, (depth - d) / 2],
    south: [(width - w) / 2, depth],
    west: [-w, (depth - d) / 2],
  }[side];
  const area = {
    id: id ?? `cavern:${crypto.randomUUID()}`,
    name:
      name.trim() ||
      `${side[0].toUpperCase() + side.slice(1)} ${kind === 'tunnel' ? 'winding tunnel' : 'cavern chamber'}`,
    originFeet: mapFeetToCampaign(parent, { x, y: 0, z }),
    quarterTurns: parent.quarterTurns,
    base: 'ground',
    grid: { cols, rows, tileWorldSize: parent.grid.tileWorldSize },
    ...(parent.locationId !== undefined ? { locationId: parent.locationId } : {}),
    cavern: {
      version: 1,
      ownerMapId: rootId,
      parentMapId: parent.id,
      side,
      source,
      seed: scene.maps.find((map) => map.id === rootId).terrain.cavern.seed,
    },
    terrain: {
      ...copy(parent.terrain),
      heights: interior.heights,
      geometry: interior.geometry,
      cavern: interior.cavern,
      seed,
      treeDensity: 0,
      placeables: [],
      sightBounds: [],
    },
  };
  delete area.terrain.coverBounds;
  if (!interior.geometry.volumes.length) delete area.terrain.geometry;
  if (scene.maps.some((map) => map.id === area.id))
    throw new Error('The cavern area ID is already in use');
  const bounds = areaBounds(area);
  for (const map of scene.maps) {
    if (mapLocationId(map) !== mapLocationId(parent)) continue;
    const other = areaBounds(map);
    if (
      bounds.min.x < other.max.x - 1e-6 &&
      bounds.max.x > other.min.x + 1e-6 &&
      bounds.min.z < other.max.z - 1e-6 &&
      bounds.max.z > other.min.z + 1e-6
    )
      throw new Error('The new cavern area would overlap another map; choose a different side');
  }
  parent.terrain.heights = sculptCavernPassage(parent.terrain.heights, side);
  parent.terrain.cavern.exits = [...new Set([...parent.terrain.cavern.exits, side])];
  scene.maps.push(area);
  scene.connections = [...(scene.connections || []), cavernConnection(parent, area, side, source)];
  return validateScene(scene, context);
}

// -- Reconciliation --

export function reconcileCavernScene(
  input,
  context,
  { ownerMapId = 'map-main', regenerate = false } = {}
) {
  if (!regenerate) return input;
  const scene = input.version === 3 ? copy(input) : CampaignWorld.fromScene(input, context).save();
  const owner = scene.maps.find((map) => map.id === ownerMapId);
  if (!owner || owner.building || owner.cavern?.parentMapId)
    throw new Error('Return to the main cavern area before regenerating its network');
  const recipe = owner.terrain.cavern;
  const removed = new Set(
    scene.maps
      .filter(
        (map) =>
          map.cavern?.ownerMapId === owner.id &&
          map.id !== owner.id &&
          map.cavern.source === 'generated' &&
          (!recipe ||
            map.cavern.seed !== recipe.seed ||
            map.terrain.cavern?.version !== recipe.version ||
            (map.cavern.parentMapId === owner.id && !recipe.exits.includes(map.cavern.side)))
      )
      .map((map) => map.id)
  );
  for (const map of scene.maps)
    if (removed.has(map.id) && hasAuthoredArea(map))
      throw new Error(
        'An edited cavern chamber would be removed; preserve its manual work before regenerating'
      );
  if (scene.creatures.some((token) => removed.has(token.mapId)))
    throw new Error(
      'A creature occupies a cavern area being replaced; move it to a safe area first'
    );
  if (
    scene.maps.some(
      (map) =>
        map.cavern?.source === 'manual' &&
        (removed.has(map.cavern.parentMapId) || (!recipe && map.cavern.ownerMapId === owner.id))
    )
  )
    throw new Error(
      'Manually connected cavern areas must be preserved before replacing their network'
    );
  for (const connection of scene.connections || [])
    if (!isCavernConnection(connection) && connection.ends.some((end) => removed.has(end.mapId)))
      throw new Error('Unlink manual entrances before replacing these cavern areas');
  scene.maps = scene.maps.filter((map) => !removed.has(map.id));
  scene.connections = (scene.connections || []).filter(
    (connection) => !connection.ends.some((end) => removed.has(end.mapId))
  );
  if (scene.view.cameras)
    scene.view.cameras = scene.view.cameras.filter((entry) => !removed.has(entry.mapId));
  if (!recipe) {
    if (owner.cavern) owner.base = 'ground';
    delete owner.cavern;
    return validateScene(scene, context);
  }
  owner.base = 'ground';
  owner.cavern = {
    version: 1,
    ownerMapId: owner.id,
    parentMapId: null,
    side: null,
    source: 'generated',
    seed: recipe.seed,
  };
  if (
    scene.view.mapId === owner.id &&
    !scene.view.focusTokenId &&
    !scene.creatures.some((token) => token.mapId === owner.id)
  ) {
    const camera = scene.view.camera;
    const x = Math.max(
      0,
      Math.min(owner.grid.cols - 1, Math.floor(camera.target.x / owner.grid.tileWorldSize))
    );
    const z = Math.max(
      0,
      Math.min(owner.grid.rows - 1, Math.floor(camera.target.z / owner.grid.tileWorldSize))
    );
    camera.target.y = owner.terrain.heights[z][x] * owner.terrain.worldElevationUnit;
  }
  let next = scene;
  for (const side of recipe.exits) {
    const id = `${owner.id}:cavern:${recipe.seed}:${side}`;
    if (next.maps.some((map) => map.id === id)) continue;
    if (
      next.connections.some(
        (connection) =>
          connection.cavern?.parentMapId === owner.id && connection.cavern.side === side
      )
    )
      continue;
    next = addCavernArea(next, context, owner.id, { side, source: 'generated', id });
  }
  return validateScene(next, context);
}

// -- Helpers --

function cavernConnection(parent, area, side, source) {
  const position = (map, entrySide) => {
    const point = cavernEndpoint(entrySide, map.grid.cols * 5, map.grid.rows * 5);
    return {
      ...point,
      y:
        (map.terrain.heights[Math.floor(point.z / 5)][Math.floor(point.x / 5)] *
          map.terrain.worldElevationUnit *
          5) /
        map.grid.tileWorldSize,
    };
  };
  const entry = position(parent, side);
  return {
    id: `${area.id}:entrance`,
    name: `Passage to ${area.name}`.slice(0, 100),
    kind: 'opening',
    enabled: true,
    cavern: { ownerMapId: area.cavern.ownerMapId, parentMapId: parent.id, side, source },
    feature: {
      mapId: parent.id,
      terrainCells: [{ x: Math.floor(entry.x / 5), z: Math.floor(entry.z / 5) }],
    },
    ends: [
      {
        mapId: parent.id,
        positionFeet: entry,
      },
      {
        mapId: area.id,
        positionFeet: position(area, oppositeCavernSide(side)),
      },
    ],
    pathFeet: [],
  };
}

function hasAuthoredArea(map) {
  const recipe = map.terrain.cavern;
  const expected =
    recipe.version === 1
      ? map.terrain.heights.map((row) => row.map(() => 0))
      : createCavernInterior({
          biomeKey: map.terrain.biome,
          seed: recipe.seed,
          kind: recipe.kind,
          cols: map.grid.cols,
          rows: map.grid.rows,
          exits: recipe.exits,
          recipeVersion: recipe.version,
          feetPerLevel: (map.terrain.worldElevationUnit * 5) / map.grid.tileWorldSize,
        }).heights;
  return (
    map.terrain.placeables.length > 0 ||
    JSON.stringify(map.terrain.heights) !== JSON.stringify(expected) ||
    map.terrain.geometry?.structures?.some((spec) => spec.source === 'manual') ||
    map.terrain.geometry?.volumes.some((volume) => volume.source !== 'generated') ||
    map.name !== `${map.cavern.side[0].toUpperCase() + map.cavern.side.slice(1)} cavern chamber`
  );
}

function areaBounds(map) {
  return campaignFeetBounds(map, {
    min: { x: 0, y: 0, z: 0 },
    max: { x: map.grid.cols * 5, y: 40, z: map.grid.rows * 5 },
  });
}
