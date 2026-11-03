import { DEFAULT_CHARACTER_ID } from '../../config/CharacterCatalog.js';
import { TerrainGeometry } from '../../terrain/TerrainGeometry.js';

function terrain(cols, rows, geometry = null) {
  return {
    heights: Array.from({ length: rows }, () => Array(cols).fill(0)),
    biome: null,
    seed: 42,
    elevationScale: 8,
    worldElevationUnit: 0.3,
    treeDensity: 1,
    richShading: {},
    placeables: [],
    ...(geometry ? { geometry: geometry.save() } : {}),
  };
}

export function createTwoFloorTravelScene({ ruleset, characters }) {
  if (
    !['2014', '2024'].includes(ruleset) ||
    !Array.isArray(characters) ||
    characters.length !== 3 ||
    characters.some((character) => !character?.id || !character.name)
  )
    throw new Error('The travel example requires an edition and three saved characters');
  const shell = new TerrainGeometry({
    widthFeet: 125,
    depthFeet: 125,
    getTerrainHeightFeet: () => 0,
  });
  for (const [id, min, max] of [
    ['west-wall', [55, 0, 20], [56, 20, 70]],
    ['east-wall', [94, 0, 20], [95, 20, 70]],
    ['north-wall', [55, 0, 20], [95, 20, 21]],
    ['south-wall', [55, 0, 69], [95, 20, 70]],
    ['roof', [55, 19.5, 20], [95, 20, 70]],
  ])
    shell.addSolid({
      id,
      layerId: id === 'roof' ? 'roof' : 'ground',
      bounds: {
        min: { x: min[0], y: min[1], z: min[2] },
        max: { x: max[0], y: max[1], z: max[2] },
      },
    });
  for (const [id, bottom, top, z0, z1] of [
    ['ground-window', 2, 7, 27.5, 37.5],
    ['upper-window', 12, 17, 27.5, 37.5],
    ['entry-door', 0, 7, 50, 55],
  ])
    shell.carve({
      id,
      bounds: { min: { x: 54.5, y: bottom, z: z0 }, max: { x: 56.5, y: top, z: z1 } },
    });
  const ground = new TerrainGeometry({
    widthFeet: 40,
    depthFeet: 50,
    getTerrainHeightFeet: () => 0,
    terrainThicknessFeet: 0.5,
  });
  for (let i = 0; i < 8; i++)
    ground.addSolid({
      id: `stairs-${i + 1}`,
      layerId: 'stairs',
      bounds: {
        min: { x: 30, y: 0, z: 38.75 - i * 2.5 },
        max: { x: 35, y: (i + 1) * 1.25, z: 41.25 - i * 2.5 },
      },
    });
  const upper = new TerrainGeometry({
    widthFeet: 40,
    depthFeet: 50,
    getTerrainHeightFeet: () => 0,
    terrainThicknessFeet: 0.5,
  });
  upper.carve({
    id: 'stairwell',
    bounds: { min: { x: 30, y: -1, z: 23.75 }, max: { x: 35, y: 1, z: 43.75 } },
  });
  const creature = (index, mapId, x, z) => ({
    id: `token-${index + 1}`,
    type: DEFAULT_CHARACTER_ID,
    instanceNumber: index + 1,
    name: characters[index].name,
    nameMode: 'character',
    characterId: characters[index].id,
    mapId,
    gridX: Math.floor(x),
    gridY: Math.floor(z),
    facingAngle: 0,
    movement: { mode: 'walk', type: 'default' },
    pose: { kind: 'ground', world: { x, y: 0, z } },
  });
  return {
    version: 3,
    ruleset,
    maps: [
      {
        id: 'map-main',
        name: 'Outside the inn',
        originFeet: { x: 0, y: 0, z: 0 },
        quarterTurns: 0,
        base: 'ground',
        grid: { cols: 25, rows: 25, tileWorldSize: 1 },
        terrain: terrain(25, 25, shell),
      },
      ...[
        ['ground-floor', 'Inn ground floor', 0, ground],
        ['upper-floor', 'Inn upper floor', 10, upper],
      ].map(([id, name, height, geometry]) => ({
        id,
        name,
        originFeet: { x: 55, y: height, z: 20 },
        quarterTurns: 0,
        base: 'floor',
        grid: { cols: 8, rows: 10, tileWorldSize: 1 },
        terrain: terrain(8, 10, geometry),
      })),
    ],
    connections: [
      {
        id: 'building-door',
        name: 'Inn doorway',
        kind: 'door',
        feature: { mapId: 'map-main', volumeIds: ['entry-door'] },
        ends: [
          { mapId: 'map-main', positionFeet: { x: 52.5, y: 0, z: 52.5 } },
          { mapId: 'ground-floor', positionFeet: { x: 2.5, y: 0, z: 32.5 } },
        ],
        pathFeet: [],
      },
      {
        id: 'main-stairs',
        name: 'Main staircase',
        kind: 'stairs',
        feature: {
          mapId: 'ground-floor',
          volumeIds: Array.from({ length: 8 }, (_, i) => `stairs-${i + 1}`),
        },
        ends: [
          { mapId: 'ground-floor', positionFeet: { x: 32.5, y: 0, z: 42.5 } },
          { mapId: 'upper-floor', positionFeet: { x: 32.5, y: 0, z: 22.5 } },
        ],
        pathFeet: Array.from({ length: 7 }, (_, i) => ({
          x: 87.5,
          y: (i + 1) * 1.25,
          z: 60 - i * 2.5,
        })),
      },
    ],
    creatures: [
      creature(0, 'map-main', 10.5, 10.5),
      creature(1, 'ground-floor', 1.5, 2.5),
      creature(2, 'upper-floor', 1.5, 2.5),
    ],
    tokenCounters: { nextId: 3, types: [[DEFAULT_CHARACTER_ID, 3]] },
    combat: { version: 1, active: false, turn: 0, activeTokenId: null, states: [], histories: [] },
    rollLog: [],
    view: {
      mapId: 'map-main',
      focusTokenId: 'token-1',
      camera: {
        target: { x: 10.5, y: 0, z: 10.5 },
        yaw: 3.8,
        pitch: 0.8,
        zoom: 1.3,
        isometric: false,
        topDown: false,
        manualLock: false,
        orbit: null,
      },
    },
  };
}
