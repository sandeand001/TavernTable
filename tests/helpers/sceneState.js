import { DEFAULT_CHARACTER_ID } from '../../src/config/CharacterCatalog.js';

export function sceneState({ ruleset = '2014', characterId = null, name = 'Rook' } = {}) {
  return {
    version: 1,
    ruleset,
    grid: { cols: 5, rows: 5, tileWorldSize: 1 },
    terrain: {
      heights: [
        [0, 0, 0, 0, 0],
        [0, 0, 8, 0, 0],
        [0, -2, 0, 0, 0],
        [0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0],
      ],
      biome: null,
      seed: 42,
      elevationScale: 8,
      worldElevationUnit: 0.3,
      treeDensity: 1,
      richShading: {},
      placeables: [],
    },
    creatures: [
      {
        id: 'token-1',
        type: DEFAULT_CHARACTER_ID,
        instanceNumber: 1,
        name,
        nameMode: characterId ? 'character' : 'custom',
        characterId,
        gridX: 1,
        gridY: 1,
        facingAngle: 0,
        movement: { mode: 'walk', type: 'default', ...(characterId ? {} : { speed: 30 }) },
        pose: { kind: 'ground', world: { x: 1.5, y: 0, z: 1.5 } },
      },
    ],
    tokenCounters: { nextId: 1, types: [[DEFAULT_CHARACTER_ID, 1]] },
    camera: {
      target: { x: 1.5, y: 0, z: 1.5 },
      yaw: Math.PI / 4,
      pitch: 0.8,
      zoom: 1,
      isometric: true,
      topDown: false,
      manualLock: false,
      orbit: null,
    },
    combat: { version: 1, active: false, turn: 0, activeTokenId: null, states: [], histories: [] },
    selection: null,
    rollLog: [],
  };
}
