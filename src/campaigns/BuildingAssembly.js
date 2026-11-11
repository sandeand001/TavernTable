import CampaignWorld from './CampaignWorld.js';
import { validateScene } from './CampaignScene.js';
import { TerrainGeometry } from '../terrain/TerrainGeometry.js';
import { GRID_CONFIG } from '../config/GameConstants.js';
import {
  buildingDimensions,
  buildingWindows,
  buildingWindowSections,
  buildingWallPoint,
  buildingLocalToFeet,
  buildingFloorId,
  buildingIdentity,
  buildingSignature,
  buildingStairs,
  buildingLevels,
  buildingLevelElevation,
  cellarAccessLayout,
  structureDisplayName,
} from '../terrain/BuildingModel.js';
import { cellarConnectionFits } from '../terrain/CellarConnections.js';
import {
  mapFeetToCampaign,
  campaignToMapFeet,
  localWorldToCampaign,
  campaignToLocalWorld,
} from './CampaignCoordinates.js';

const copy = (value) => JSON.parse(JSON.stringify(value));
const EPS = 1e-6;

function isStructureTranslation(previous, spec) {
  if (!previous?.building) return false;
  const original = JSON.parse(previous.building.signature);
  return (
    (original.xFeet !== spec.xFeet || original.zFeet !== spec.zFeet) &&
    buildingSignature({
      ...original,
      xFeet: spec.xFeet,
      zFeet: spec.zFeet,
      source: spec.source,
    }) === buildingSignature(spec)
  );
}

function transformVolume(volume, oldMap, newMap) {
  const transform = (point) => ({
    ...campaignToMapFeet(newMap, mapFeetToCampaign(oldMap, point)),
    y: point.y,
  });
  const next = copy(volume);
  const corners = [transform(volume.bounds.min), transform(volume.bounds.max)];
  next.bounds = {
    min: Object.fromEntries(
      ['x', 'y', 'z'].map((axis) => [axis, Math.min(...corners.map((p) => p[axis]))])
    ),
    max: Object.fromEntries(
      ['x', 'y', 'z'].map((axis) => [axis, Math.max(...corners.map((p) => p[axis]))])
    ),
  };
  if (next.shape?.kind === 'prism')
    next.shape.points = next.shape.points.map((point) => {
      const p = transform({ ...point, y: 0 });
      return { x: p.x, z: p.z };
    });
  else if (next.shape?.kind === 'polyhedron')
    next.shape.vertices = next.shape.vertices.map(transform);
  else if (next.shape) {
    next.shape.center = transform(next.shape.center);
    next.shape.yawRadians =
      (next.shape.yawRadians || 0) + ((oldMap.quarterTurns - newMap.quarterTurns) * Math.PI) / 2;
  }
  return next;
}

function outsidePolygon(rect, normal, distance) {
  const result = [];
  let a = rect.at(-1),
    da = a.x * normal.x + a.z * normal.z - distance;
  for (const b of rect) {
    const db = b.x * normal.x + b.z * normal.z - distance;
    if (da >= 0 !== db >= 0) {
      const t = da / (da - db);
      result.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    }
    if (db >= 0) result.push(b);
    a = b;
    da = db;
  }
  return result.filter(
    (point, i, all) => i === 0 || Math.hypot(point.x - all[i - 1].x, point.z - all[i - 1].z) > EPS
  );
}

function floorMap(owner, spec, floor, previous) {
  const { length, width } = buildingDimensions(spec),
    unit = owner.grid.tileWorldSize;
  const desired = mapFeetToCampaign(
    owner,
    buildingLocalToFeet(spec, {
      x: -length / 2,
      y: buildingLevelElevation(spec, floor),
      z: -width / 2,
    })
  );
  const quarterTurns = (owner.quarterTurns + Math.round(spec.angleRadians / (Math.PI / 2)) + 4) % 4;
  const translated = isStructureTranslation(previous, spec);
  let contentFrame = previous;
  if (translated) {
    const min = mapFeetToCampaign(previous, {
      x: previous.building.offsetX,
      y: 0,
      z: previous.building.offsetZ,
    });
    contentFrame = {
      ...previous,
      originFeet: {
        x: previous.originFeet.x + desired.x - min.x,
        y: previous.originFeet.y + desired.y - min.y,
        z: previous.originFeet.z + desired.z - min.z,
      },
    };
  }
  const anchor = contentFrame
    ? { ...contentFrame, quarterTurns }
    : {
        originFeet: desired,
        quarterTurns,
        grid: { tileWorldSize: unit },
      };
  const relative = campaignToMapFeet(anchor, desired);
  const shift = {
    x: Math.floor((relative.x + EPS) / 5) * 5,
    y: desired.y - anchor.originFeet.y,
    z: Math.floor((relative.z + EPS) / 5) * 5,
  };
  const originFeet = mapFeetToCampaign(anchor, shift);
  const shell = { originFeet, quarterTurns, grid: { tileWorldSize: unit } };
  const offset = campaignToMapFeet(shell, desired);
  const cols = Math.max(GRID_CONFIG.MIN_COLS, Math.ceil((offset.x + length - EPS) / 5));
  const rows = Math.max(GRID_CONFIG.MIN_ROWS, Math.ceil((offset.z + width - EPS) / 5));
  const id = buildingFloorId(owner.id, spec.id, floor);
  const map = {
    id,
    ...(owner.locationId !== undefined ? { locationId: owner.locationId } : {}),
    name:
      previous?.name ||
      `${structureDisplayName(spec)} · ${floor === 100 ? 'Battlement deck' : spec.kind === 'cellar' ? `Level ${floor + 1}` : `Floor ${floor + 1}`}`,
    originFeet,
    quarterTurns,
    base: 'floor',
    grid: { cols, rows, tileWorldSize: unit },
    building: {
      ownerMapId: owner.id,
      structureId: spec.id,
      floor,
      signature: buildingSignature(spec),
      offsetX: offset.x,
      offsetZ: offset.z,
      lengthFeet: length,
      widthFeet: width,
    },
  };
  const heights = Array.from({ length: rows }, (_, z) =>
    Array.from({ length: cols }, (_, x) => {
      if (!previous) return 0;
      const old = campaignToMapFeet(
        contentFrame,
        mapFeetToCampaign(map, { x: x * 5 + 2.5, y: 0, z: z * 5 + 2.5 })
      );
      return previous.terrain.heights[Math.floor(old.z / 5)]?.[Math.floor(old.x / 5)] ?? 0;
    })
  );
  const terrain = previous
    ? copy(previous.terrain)
    : {
        heights,
        biome: owner.terrain.biome,
        seed: owner.terrain.seed,
        elevationScale: owner.terrain.elevationScale,
        worldElevationUnit: owner.terrain.worldElevationUnit,
        treeDensity: 0,
        richShading: copy(owner.terrain.richShading),
        placeables: [],
      };
  terrain.heights = heights;
  terrain.biome = owner.terrain.biome;
  const prefix = `${id}:auto:`;
  const geometry = new TerrainGeometry({
    widthFeet: cols * 5,
    depthFeet: rows * 5,
    terrainThicknessFeet: 0.5,
    getTerrainHeightFeet: (x, z) =>
      (heights[Math.floor(z / 5)][Math.floor(x / 5)] * terrain.worldElevationUnit * 5) / unit,
  });
  const cut = (name, min, max, shape) =>
    geometry.carve({
      id: `${prefix}${name}`,
      layerId: 'ground',
      bounds: { min, max },
      ...(shape ? { shape } : {}),
    });
  for (const [name, low, high] of [
    ['west', 0, offset.x],
    ['east', offset.x + length, cols * 5],
  ])
    if (high - low > EPS) cut(name, { x: low, y: -1000, z: 0 }, { x: high, y: 1000, z: rows * 5 });
  for (const [name, low, high] of [
    ['north', 0, offset.z],
    ['south', offset.z + width, rows * 5],
  ])
    if (high - low > EPS) cut(name, { x: 0, y: -1000, z: low }, { x: cols * 5, y: 1000, z: high });
  if (spec.kind === 'turret') {
    const rect = [
      { x: 0, z: 0 },
      { x: cols * 5, z: 0 },
      { x: cols * 5, z: rows * 5 },
      { x: 0, z: rows * 5 },
    ];
    const center = { x: offset.x + length / 2, z: offset.z + width / 2 };
    for (let i = 0; i < 16; i++) {
      const normal = { x: Math.cos((i * Math.PI) / 8), z: Math.sin((i * Math.PI) / 8) };
      const distance =
        normal.x * center.x + normal.z * center.z + (length / 2) * Math.cos(Math.PI / 16);
      const points = outsidePolygon(rect, normal, distance);
      if (points.length < 3) continue;
      const min = {
        x: Math.min(...points.map((p) => p.x)),
        y: -1000,
        z: Math.min(...points.map((p) => p.z)),
      };
      const max = {
        x: Math.max(...points.map((p) => p.x)),
        y: 1000,
        z: Math.max(...points.map((p) => p.z)),
      };
      if (max.x - min.x > EPS && max.z - min.z > EPS)
        cut(`round-${i}`, min, max, { kind: 'prism', points });
    }
  }
  const levels = buildingLevels(spec),
    index = levels.findIndex((level) => level.id === floor);
  const incoming =
    index > 0
      ? buildingStairs(spec, levels[index].elevationFeet - levels[index - 1].elevationFeet)
      : null;
  const stairs =
    index < levels.length - 1
      ? buildingStairs(spec, levels[index + 1].elevationFeet - levels[index].elevationFeet)
      : null;
  const move = (point) => ({ x: point.x + offset.x, y: point.y, z: point.z + offset.z });
  if (incoming && spec.building.stairs)
    cut('stairwell', move(incoming.hole.min), move(incoming.hole.max));
  for (const hole of levels[index].openings || [])
    cut(
      `opening-${hole.id}`,
      move({ x: hole.xFeet, y: -1000, z: hole.zFeet }),
      move({ x: hole.xFeet + hole.lengthFeet, y: 1000, z: hole.zFeet + hole.widthFeet })
    );
  if (stairs && spec.building.stairs)
    for (const step of stairs.steps)
      geometry.addSolid({
        id: `${prefix}${step.id}`,
        layerId: 'stairs',
        bounds: { min: move(step.bounds.min), max: move(step.bounds.max) },
      });
  const saved = geometry.save();
  if (previous?.terrain.geometry) {
    const manual = previous.terrain.geometry.volumes.filter(
      (volume) => !volume.id.startsWith(prefix)
    );
    const structures = (previous.terrain.geometry.structures || []).map((record) => {
      const p = campaignToMapFeet(
        map,
        mapFeetToCampaign(contentFrame, { x: record.xFeet, y: record.baseFeet, z: record.zFeet })
      );
      return {
        ...record,
        xFeet: p.x,
        zFeet: p.z,
        baseFeet: record.baseFeet,
        angleRadians:
          record.angleRadians + ((previous.quarterTurns - map.quarterTurns) * Math.PI) / 2,
      };
    });
    saved.version = 3;
    saved.structures = structures;
    saved.volumes.push(...manual.map((volume) => transformVolume(volume, contentFrame, map)));
    geometry.load(saved);
  }
  for (const placement of terrain.placeables) {
    const p = campaignToMapFeet(
      map,
      mapFeetToCampaign(contentFrame, {
        x: (placement.gridX + 0.5) * 5,
        y: 0,
        z: (placement.gridY + 0.5) * 5,
      })
    );
    placement.gridX = Math.floor(p.x / 5);
    placement.gridY = Math.floor(p.z / 5);
    if (
      placement.gridX < 0 ||
      placement.gridY < 0 ||
      placement.gridX >= cols ||
      placement.gridY >= rows
    )
      throw new Error('Interior objects would leave the resized building');
  }
  terrain.geometry = geometry.save();
  map.terrain = terrain;
  return map;
}

function featureConnection(owner, spec, maps, kind, id, side, u, floor, featureId, offset = 2.5) {
  const insideMap = maps.find((map) => map.building.floor === floor);
  const outer = buildingLocalToFeet(
    spec,
    buildingWallPoint(
      spec,
      side,
      u,
      offset,
      kind === 'window' ? 0 : buildingLevelElevation(spec, floor)
    )
  );
  const inner = buildingWallPoint(
    spec,
    side,
    u,
    spec.kind === 'turret' && kind === 'window' ? -3 : -2.5,
    0
  );
  const { length, width } = buildingDimensions(spec);
  const inside = {
    x: inner.x + length / 2 + insideMap.building.offsetX,
    y: 0,
    z: inner.z + width / 2 + insideMap.building.offsetZ,
  };
  if (
    outer.x < 0 ||
    outer.z < 0 ||
    outer.x >= owner.grid.cols * 5 ||
    outer.z >= owner.grid.rows * 5
  )
    throw new Error('Leave space on the map outside building doors and windows');
  if (kind === 'window')
    outer.y =
      (owner.terrain.heights[Math.floor(outer.z / 5)][Math.floor(outer.x / 5)] *
        owner.terrain.worldElevationUnit *
        5) /
      owner.grid.tileWorldSize;
  return {
    id: `${buildingIdentity(owner.id, spec.id)}-${id}`,
    name:
      kind === 'window'
        ? `Floor ${floor + 1} window`
        : kind === 'balcony'
          ? `Floor ${floor + 1} balcony`
          : 'Building entrance',
    kind: kind === 'window' ? 'window' : 'door',
    ...(kind === 'window' ? { outsideMapId: owner.id } : {}),
    building: { ownerMapId: owner.id, structureId: spec.id, floor, kind, featureId: id },
    feature: { mapId: owner.id, volumeIds: [featureId] },
    ends: [
      { mapId: owner.id, positionFeet: outer },
      { mapId: insideMap.id, positionFeet: inside },
    ],
    pathFeet: [],
  };
}

function installCellarAccess(owner, spec, maps, connections) {
  const access = spec.building.access,
    levels = buildingLevels(spec),
    top = levels.at(-1);
  const low = maps.find(
    (map) =>
      map.building?.ownerMapId === owner.id &&
      map.building.structureId === spec.id &&
      map.building.floor === top.id
  );
  const source =
    access.structureId === null
      ? owner
      : maps.find(
          (map) =>
            map.building?.ownerMapId === owner.id &&
            map.building.structureId === access.structureId &&
            map.building.floor === 0
        );
  const target =
    access.structureId &&
    owner.terrain.geometry.structures.find((entry) => entry.id === access.structureId);
  if (target && !cellarConnectionFits(spec, target))
    throw new Error(
      `The cellar hatch and landing must fit inside ${structureDisplayName(target)}; move the access or choose a nearby building`
    );
  if (!source)
    throw new Error(
      'The building linked to this cellar no longer exists; choose another access target'
    );
  if (Math.abs(source.originFeet.y - owner.originFeet.y - spec.baseFeet) > EPS)
    throw new Error('Cellar access must align with the connected surface or building ground floor');
  const { length, width } = buildingDimensions(spec),
    layout = cellarAccessLayout(spec);
  const physical = (point, y) =>
    mapFeetToCampaign(
      owner,
      buildingLocalToFeet(spec, {
        x: point.x - length / 2,
        y,
        z: point.z - width / 2,
      })
    );
  const lower = physical(layout.entry, top.elevationFeet),
    upper = physical(layout.exit, 0);
  const end = campaignToMapFeet(source, upper);
  if (
    end.x < 0.5 ||
    end.z < 0.5 ||
    end.x > source.grid.cols * 5 - 0.5 ||
    end.z > source.grid.rows * 5 - 0.5
  )
    throw new Error('Place the cellar access inside the selected building or surface map');
  const lowGeometry = new TerrainGeometry({
    widthFeet: low.grid.cols * 5,
    depthFeet: low.grid.rows * 5,
    terrainThicknessFeet: 0.5,
    getTerrainHeightFeet: () => 0,
  });
  if (low.terrain.geometry !== undefined) lowGeometry.load(low.terrain.geometry);
  const move = (point) => ({
    ...point,
    x: point.x + low.building.offsetX,
    z: point.z + low.building.offsetZ,
  });
  const prefix = `${low.id}:cellar-access:`;
  for (const step of layout.steps)
    lowGeometry.addSolid({
      id: `${prefix}${step.id}`,
      layerId: 'stairs',
      bounds: { min: move(step.bounds.min), max: move(step.bounds.max) },
    });
  low.terrain.geometry = lowGeometry.save();
  const a = campaignToMapFeet(source, physical(layout.hole.min, 0));
  const b = campaignToMapFeet(source, physical(layout.hole.max, 0));
  const bounds = {
    min: { x: Math.min(a.x, b.x), y: -0.51, z: Math.min(a.z, b.z) },
    max: { x: Math.max(a.x, b.x), y: 0.01, z: Math.max(a.z, b.z) },
  };
  if (
    bounds.min.x < 0 ||
    bounds.min.z < 0 ||
    bounds.max.x > source.grid.cols * 5 ||
    bounds.max.z > source.grid.rows * 5
  )
    throw new Error('The cellar stairwell or ladder hatch must fit inside the connected map');
  if (source !== owner) {
    source.terrain.geometry ??= { version: 1, volumes: [] };
    source.terrain.geometry.volumes.push({
      id: `${source.id}:cellar-access:${spec.id}`,
      operation: 'subtract',
      layerId: 'ground',
      bounds,
    });
  }
  const feature =
    access.kind === 'stairs'
      ? { mapId: low.id, volumeIds: layout.steps.map((step) => `${prefix}${step.id}`) }
      : {
          mapId: owner.id,
          volumeIds: [
            `${spec.id}-access-opening`,
            `${spec.id}-ladder-rail--1`,
            `${spec.id}-ladder-rail-1`,
          ],
        };
  connections.push({
    id: `${buildingIdentity(owner.id, spec.id)}-access`,
    name: access.kind === 'stairs' ? 'Cellar stairs' : 'Cellar ladder',
    kind: access.kind,
    building: {
      ownerMapId: owner.id,
      structureId: spec.id,
      floor: top.id,
      kind: 'access',
      featureId: 'access',
    },
    feature,
    ends: [
      { mapId: low.id, positionFeet: campaignToMapFeet(low, lower) },
      { mapId: source.id, positionFeet: end },
    ],
    pathFeet: layout.path.map((point) => physical(point, top.elevationFeet + point.y)),
  });
}

export function captureBuildingContext(scene, ownerMapId) {
  const maps = (scene.maps || []).filter((map) => map.building?.ownerMapId === ownerMapId),
    ids = new Set(maps.map((map) => map.id));
  return {
    maps: copy(maps),
    cameras: copy((scene.view?.cameras || []).filter((entry) => ids.has(entry.mapId))),
  };
}

export function reconcileBuildingScene(
  input,
  context,
  { ownerMapId = null, restoreContext = null } = {}
) {
  const hasBuildings = (input.version === 3 ? input.maps : [input]).some((map) =>
    map.terrain.geometry?.structures?.some((spec) => spec.building)
  );
  if (!hasBuildings && !(input.version === 3 && input.maps.some((map) => map.building)))
    return input;
  const next = input.version === 3 ? copy(input) : CampaignWorld.fromScene(input, context).save();
  const oldMaps = new Map(next.maps.map((map) => [map.id, map]));
  const restoredCameras = new Set();
  if (restoreContext) {
    const oldIds = new Set(
      next.maps.filter((map) => map.building?.ownerMapId === ownerMapId).map((map) => map.id)
    );
    next.maps = next.maps.filter((map) => map.building?.ownerMapId !== ownerMapId);
    next.maps.push(...copy(restoreContext.maps));
    next.view.cameras = [
      ...(next.view.cameras || []).filter((entry) => !oldIds.has(entry.mapId)),
      ...copy(restoreContext.cameras || []),
    ];
    for (const entry of restoreContext.cameras || []) restoredCameras.add(entry.mapId);
  }
  const previous = new Map(next.maps.map((map) => [map.id, map]));
  const previousDoors = new Map(
    (next.connections || [])
      .filter((connection) => connection.kind === 'door')
      .map((connection) => [connection.id, connection])
  );
  const translatedMaps = new Set();
  const owners = next.maps.filter((map) => !map.building);
  const maps = [...owners],
    connections = next.connections?.filter((connection) => !connection.building) || [];
  for (const owner of owners) {
    for (const spec of owner.terrain.geometry?.structures || []) {
      if (!spec.building) continue;
      const floors = [];
      for (const { id: floor } of buildingLevels(spec)) {
        const id = buildingFloorId(owner.id, spec.id, floor);
        const old = previous.get(id);
        if (isStructureTranslation(oldMaps.get(id), spec)) translatedMaps.add(id);
        if (
          old &&
          (!old.building ||
            old.building.ownerMapId !== owner.id ||
            old.building.structureId !== spec.id)
        )
          throw new Error('A building floor ID conflicts with an existing map');
        const map =
          old?.building.signature === buildingSignature(spec)
            ? copy(old)
            : floorMap(owner, spec, floor, old);
        map.terrain.biome = owner.terrain.biome;
        floors.push(map);
        maps.push(map);
      }
      if (spec.kind !== 'cellar')
        connections.push(
          featureConnection(
            owner,
            spec,
            floors,
            'entry',
            'entry',
            'south',
            0.5,
            0,
            `${spec.id}-entry-door`
          )
        );
      for (const window of buildingWindows(spec))
        for (const section of buildingWindowSections(spec, window)) {
          const connection = featureConnection(
            owner,
            spec,
            floors,
            'window',
            `window-${window.id}`,
            window.side,
            window.u,
            section.floor,
            `${spec.id}-window-${window.id}`
          );
          if (section.floor !== window.floor) connection.id += `-floor-${section.floor}`;
          connections.push(connection);
        }
      for (const balcony of spec.building.balconies)
        connections.push(
          featureConnection(
            owner,
            spec,
            floors,
            'balcony',
            `balcony-${balcony.id}`,
            balcony.side,
            balcony.u,
            balcony.floor,
            `${spec.id}-balcony-${balcony.id}-door`,
            Math.min(2.5, balcony.depthFeet / 2)
          )
        );
      if (spec.building.stairs) {
        const { length, width } = buildingDimensions(spec);
        const physical = (point, floor) =>
          mapFeetToCampaign(
            owner,
            buildingLocalToFeet(spec, {
              x: point.x - length / 2,
              y: buildingLevelElevation(spec, floor) + point.y,
              z: point.z - width / 2,
            })
          );
        for (let floor = 0; floor < floors.length - 1; floor++) {
          const low = floors[floor],
            high = floors[floor + 1];
          const lowId = low.building.floor,
            highId = high.building.floor;
          const stairs = buildingStairs(
            spec,
            buildingLevelElevation(spec, highId) - buildingLevelElevation(spec, lowId)
          );
          connections.push({
            id: `${buildingIdentity(owner.id, spec.id)}-stairs-${lowId}`,
            name:
              highId === 100
                ? 'Stairs to battlement deck'
                : `Stairs to ${spec.kind === 'cellar' ? 'Cellar' : 'Floor'} ${highId + 1}`,
            kind: 'stairs',
            building: {
              ownerMapId: owner.id,
              structureId: spec.id,
              floor: lowId,
              kind: 'stairs',
              featureId: `stairs-${lowId}`,
            },
            feature: {
              mapId: low.id,
              volumeIds: stairs.steps.map((step) => `${low.id}:auto:${step.id}`),
            },
            ends: [
              {
                mapId: low.id,
                positionFeet: {
                  x: stairs.entry.x + low.building.offsetX,
                  y: 0,
                  z: stairs.entry.z + low.building.offsetZ,
                },
              },
              {
                mapId: high.id,
                positionFeet: {
                  x: stairs.exit.x + high.building.offsetX,
                  y: 0,
                  z: stairs.exit.z + high.building.offsetZ,
                },
              },
            ],
            pathFeet: stairs.path.map((point) => physical(point, lowId)),
          });
        }
      }
    }
  }
  for (const map of maps)
    if (map.terrain.geometry)
      map.terrain.geometry.volumes = map.terrain.geometry.volumes.filter(
        (volume) => !volume.id.includes(':cellar-access:')
      );
  for (const owner of owners)
    for (const spec of owner.terrain.geometry?.structures || [])
      if (spec.kind === 'cellar' && spec.building.access.kind !== 'none')
        installCellarAccess(owner, spec, maps, connections);
  const byId = new Map(maps.map((map) => [map.id, map]));
  for (const connection of connections.filter((entry) => !entry.building))
    for (const end of connection.ends) {
      const old = oldMaps.get(end.mapId),
        map = byId.get(end.mapId);
      if (!map)
        throw new Error('Unlink manually connected floor entrances before removing the building');
      if (translatedMaps.has(end.mapId))
        throw new Error('Unlink manual floor connections before moving the building');
      if (old?.building && map.building && Math.abs(old.originFeet.y - map.originFeet.y) > EPS)
        throw new Error('Unlink the manually connected level before changing its elevation');
      if (old?.building && map.building)
        end.positionFeet = campaignToMapFeet(map, mapFeetToCampaign(old, end.positionFeet));
    }
  for (const creature of next.creatures) {
    const old = oldMaps.get(creature.mapId),
      map = byId.get(creature.mapId);
    if (!map) throw new Error('A creature is on a floor being removed; move it before resizing');
    if (old?.building && map.building) {
      if (Math.abs(old.originFeet.y - map.originFeet.y) > EPS)
        throw new Error(
          'A creature occupies a level being raised or lowered; move it before changing room height'
        );
      if (
        ['wall', 'grip', 'ledge'].includes(creature.pose.kind) &&
        JSON.stringify(old.originFeet) !== JSON.stringify(map.originFeet)
      )
        throw new Error('Finish climbing on the interior before stretching this building');
      creature.pose.world = campaignToLocalWorld(
        map,
        localWorldToCampaign(old, creature.pose.world)
      );
      creature.gridX = Math.floor(creature.pose.world.x / map.grid.tileWorldSize);
      creature.gridY = Math.floor(creature.pose.world.z / map.grid.tileWorldSize);
      creature.facingAngle += ((map.quarterTurns - old.quarterTurns) * Math.PI) / 2;
    }

    const grip = creature.pose.grip;
    if (grip && oldMaps.get(grip.mapId)?.building) {
      const oldOwner = oldMaps.get(grip.mapId),
        owner = byId.get(grip.mapId);
      if (!owner)
        throw new Error('A creature is gripping a floor being removed; move it before resizing');
      const contact = mapFeetToCampaign(oldOwner, grip.pointFeet);
      const outward = mapFeetToCampaign(oldOwner, {
        x: grip.pointFeet.x + grip.normal.x,
        y: grip.pointFeet.y,
        z: grip.pointFeet.z + grip.normal.z,
      });
      grip.pointFeet = campaignToMapFeet(owner, contact);
      const normal = campaignToMapFeet(owner, outward);
      grip.normal = { x: normal.x - grip.pointFeet.x, y: 0, z: normal.z - grip.pointFeet.z };
    }
  }
  for (const entry of next.view.cameras || []) {
    const old = oldMaps.get(entry.mapId),
      map = byId.get(entry.mapId);
    if (
      old?.building &&
      map?.building &&
      !restoredCameras.has(entry.mapId) &&
      !translatedMaps.has(entry.mapId)
    )
      entry.camera.target = campaignToLocalWorld(
        map,
        localWorldToCampaign(old, entry.camera.target)
      );
  }
  if (!byId.has(next.view.mapId)) throw new Error('Leave this building floor before removing it');
  next.maps = maps;
  for (const connection of connections)
    if (connection.kind === 'door') {
      const previous = previousDoors.get(connection.id);
      connection.open = previous?.open === true;
      connection.locked = previous?.locked === true;
    }
  next.connections = connections;
  next.buildingAssemblies = 1;
  if (next.view.cameras)
    next.view.cameras = next.view.cameras.filter((camera) => byId.has(camera.mapId));
  return validateScene(next, context);
}
