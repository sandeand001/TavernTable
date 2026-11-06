import CampaignWorld from '../../../src/campaigns/CampaignWorld.js';
import { playerCreatureVisibility } from '../../../src/campaigns/CreatureVisibility.js';
import { CharacterLibrary } from '../../../src/entities/characters/CharacterLibrary.js';
import { TerrainGeometry } from '../../../src/terrain/TerrainGeometry.js';
import { sceneState } from '../../helpers/sceneState.js';

function fixture() {
  localStorage.clear();
  const library = new CharacterLibrary({ ruleset: '2014', catalog: [], storage: localStorage });
  const hero = library.create('Hero');
  const second = library.create('Second hero');
  const base = sceneState({ characterId: hero, name: 'Hero' });
  base.terrain.heights = Array.from({ length: 5 }, () => Array(5).fill(0));
  const world = CampaignWorld.fromScene(base, { ruleset: '2014', library });
  const map = world.getMap('map-main');
  const creature = (id, x, characterId = null, mapId = 'map-main') => ({
    ...base.creatures[0],
    id,
    mapId,
    characterId,
    nameMode: characterId ? 'character' : 'custom',
    movement: { mode: 'walk', type: 'default', ...(characterId ? {} : { speed: 30 }) },
    gridX: x,
    pose: { kind: 'ground', world: { x: x + 0.5, y: 0, z: 1.5 } },
  });
  const creatures = [creature('hero', 0, hero), creature('near', 1), creature('hidden', 4)];
  const options = {
    world,
    creatures,
    ownedIds: [hero, second],
    publishedIds: ['map-main'],
  };
  return { ...options, options, map, library, second, creature };
}

test('only the active assigned creature supplies sight, not the combined party or camera', () => {
  const { options, world, map, second, creature } = fixture();
  const geometry = new TerrainGeometry({
    widthFeet: 25,
    depthFeet: 25,
    getTerrainHeightFeet: () => 0,
  });
  geometry.addSolid({
    id: 'opaque-wall',
    bounds: { min: { x: 12, y: 0, z: 0 }, max: { x: 13, y: 15, z: 25 } },
  });
  const saved = world.save();
  saved.maps[0].terrain.geometry = geometry.save();
  world.acceptCheckpoint(saved);
  options.creatures.push(creature('second', 3, second));
  expect(playerCreatureVisibility(options).visible.map(({ id }) => id)).toEqual(['hero', 'near']);
  expect(
    playerCreatureVisibility({ ...options, observerTokenId: 'second' }).visible.map(({ id }) => id)
  ).toEqual(['hidden', 'second']);
  expect(world.getMap(map.id).terrain.geometry).toEqual(geometry.save());
});

test('no assigned creature means no creature locations are disclosed', () => {
  const { options } = fixture();
  expect(playerCreatureVisibility({ ...options, ownedIds: [] })).toEqual({
    observer: null,
    observers: [],
    visible: [],
  });
});

test('an arbitrary enemy or unpublished-map observer cannot be selected', () => {
  const { options } = fixture();
  expect(() => playerCreatureVisibility({ ...options, observerTokenId: 'hidden' })).toThrow(
    'assigned creature'
  );
  expect(() =>
    playerCreatureVisibility({ ...options, publishedIds: [], observerTokenId: 'hero' })
  ).toThrow('assigned');
});

test('published-map browsing never changes the observer or reveals unpublished creatures', () => {
  const { options, world, map, creature } = fixture();
  world.addMap({
    ...map,
    id: 'private-map',
    name: 'Private map',
    originFeet: { x: 100, y: 0, z: 0 },
  });
  options.creatures.push(creature('private-token', 1, null, 'private-map'));
  const result = playerCreatureVisibility(options);
  expect(result.observer.id).toBe('hero');
  expect(result.visible.map(({ id }) => id)).not.toContain('private-token');
});

test('a solid upper floor blocks sight to its creature while an open sight line stays visible', () => {
  const { options, world, map, creature } = fixture();
  world.addMap({
    ...map,
    id: 'upper',
    name: 'Upper floor',
    base: 'floor',
    originFeet: { x: 0, y: 10, z: 0 },
  });
  options.publishedIds.push('upper');
  options.creatures.push(creature('upstairs', 0, null, 'upper'));
  expect(playerCreatureVisibility(options).visible.map(({ id }) => id)).toEqual([
    'hero',
    'near',
    'hidden',
  ]);
});

test('persisted opaque tree bounds obstruct physical vision at their real height', () => {
  const { options, world } = fixture();
  const saved = world.save();
  saved.maps[0].terrain.sightBounds = [
    {
      min: { x: 2.4, y: 0, z: 1.2 },
      max: { x: 2.6, y: 4, z: 1.8 },
    },
  ];
  world.acceptCheckpoint(saved);
  expect(playerCreatureVisibility(options).visible.map(({ id }) => id)).toEqual(['hero', 'near']);
  saved.maps[0].terrain.sightBounds[0].min.y = 2;
  world.acceptCheckpoint(saved);
  expect(playerCreatureVisibility(options).visible.map(({ id }) => id)).toContain('hidden');
});

test('a physical opening reveals its sight line without revealing creatures behind the wall beside it', () => {
  const { options, world } = fixture();
  const geometry = new TerrainGeometry({
    widthFeet: 25,
    depthFeet: 25,
    getTerrainHeightFeet: () => 0,
  });
  geometry.addSolid({
    id: 'wall',
    bounds: { min: { x: 12, y: 0, z: 0 }, max: { x: 13, y: 15, z: 25 } },
  });
  geometry.carve({
    id: 'window',
    bounds: { min: { x: 12, y: 2, z: 7 }, max: { x: 13, y: 6, z: 8 } },
  });
  const saved = world.save();
  saved.maps[0].terrain.geometry = geometry.save();
  world.acceptCheckpoint(saved);
  expect(playerCreatureVisibility(options).visible.map(({ id }) => id)).toContain('hidden');
  options.creatures.find(({ id }) => id === 'hidden').pose.world.z = 3.5;
  expect(playerCreatureVisibility(options).visible.map(({ id }) => id)).not.toContain('hidden');
});

test('legacy trees without saved physical bounds require an explicit DM recapture, not clear sight', () => {
  const { options, world } = fixture();
  const saved = world.save();
  saved.maps[0].terrain.placeables.push({
    type: 'plant',
    placeableId: 'tree-oak',
    gridX: 2,
    gridY: 1,
    persistedScale: { x: 1, y: 1, z: 1 },
  });
  world.acceptCheckpoint(saved);
  expect(() => playerCreatureVisibility(options)).toThrow('DM must reopen and save');
});

test('malformed physical sight bounds cannot be accepted as a campaign checkpoint', () => {
  const { world } = fixture();
  const saved = world.save();
  saved.maps[0].terrain.sightBounds = [
    {
      min: { x: 2, y: 0, z: 1 },
      max: { x: 1, y: 5, z: 2 },
    },
  ];
  expect(() => world.acceptCheckpoint(saved)).toThrow('physical sight bounds');
});
