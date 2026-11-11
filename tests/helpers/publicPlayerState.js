import { CharacterLibrary } from '../../src/entities/characters/CharacterLibrary.js';
import { sceneState } from './sceneState.js';

export function publicPlayerState() {
  localStorage.clear();
  const catalog = { version: 1, ruleset: '2014', entries: [], classes: [], enabledEntryIds: [] };
  const source = new CharacterLibrary({ ruleset: '2014', catalog: [], storage: localStorage });
  const scoutId = source.create('Scout');
  const wizardId = source.create('Wizard');
  const records = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
    .filter((key) => key?.startsWith('taverntable.character'))
    .map((key) => ({ key, value: localStorage.getItem(key) }));
  const terrain = sceneState().terrain;
  terrain.heights = Array.from({ length: 5 }, () => Array(5).fill(0));
  const state = {
    campaign: { id: 'campaign', name: 'Player table', ruleset: '2014' },
    profile: { role: 'player', name: 'Player', characterIds: [scoutId, wizardId] },
    records,
    revision: 1,
    sceneRevision: 1,
    scene: null,
    observerTokenId: 'canonical-scout',
    observers: [{ id: 'canonical-scout', name: 'Scout', characterId: scoutId, mapId: 'main' }],
    maps: [{ id: 'main', name: 'Courtyard' }],
    location: { id: 'site', name: 'Village' },
    publicScene: {
      version: 1,
      assetKey: 'assets',
      assets: {
        location: { id: 'site', name: 'Village' },
        maps: [
          {
            id: 'main',
            name: 'Courtyard',
            locationId: 'site',
            originFeet: { x: 0, y: 0, z: 0 },
            quarterTurns: 0,
            base: 'ground',
            grid: { cols: 5, rows: 5, tileWorldSize: 1 },
            terrain,
          },
        ],
        connections: [],
      },
      presentation: { mapId: 'main', focusTokenId: 'canonical-scout' },
      actors: [
        {
          id: 'canonical-scout',
          name: 'Scout',
          type: 'mannequin',
          mapId: 'main',
          gridX: 1,
          gridY: 1,
          owned: true,
          characterId: scoutId,
          portraitImage: null,
          facingAngle: 0,
          pose: { kind: 'ground', world: { x: 1.5, y: 0, z: 1.5 } },
          movement: { mode: 'walk', type: 'default' },
          flags: { prone: false, flightActive: false },
        },
      ],
      updates: [],
    },
    gameplay: {
      version: 1,
      commands: ['move'],
      ownedTokens: [
        {
          tokenId: 'canonical-scout',
          mapId: 'main',
          availability: { move: { allowed: true, code: 'allowed' } },
          movement: { spentFeet: 0, remainingFeet: 30, allowanceFeet: 30 },
          economy: {
            actions: 1,
            bonusActions: 1,
            reactions: 1,
            restrictedActions: [],
            attacksRemaining: 0,
            attacksAvailable: 1,
            bonusAttacksRemaining: 0,
          },
          availableActions: [],
          canUndo: false,
        },
      ],
      turn: { active: true, number: 1, tokenId: 'canonical-scout' },
    },
  };
  return { state, source, catalog, scoutId, wizardId };
}
