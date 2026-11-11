import CampaignWorld from '../../../src/campaigns/CampaignWorld.js';
import { restoreCampaignScene, captureCampaignScene } from '../../../src/campaigns/SceneWorld.js';
import { CharacterLibrary } from '../../../src/entities/characters/CharacterLibrary.js';
import { TerrainEngineSceneAdapter } from '../../../src/scene/terrain/TerrainEngineSceneAdapter.js';
import { createCampaignBoard } from '../../helpers/campaignBoard.js';
import { sceneState } from '../../helpers/sceneState.js';
import { wallStairLayout } from '../../../src/terrain/WallStairs.js';
import {
  changeBuildingLevelHeight,
  removeBuildingLevel,
  explicitBuilding,
} from '../../../src/terrain/BuildingModel.js';

let fixture;
async function board({ withCharacter = false } = {}) {
  localStorage.clear();
  const library = new CharacterLibrary({ ruleset: '2014', catalog: [], storage: localStorage });
  const characterId = withCharacter ? await library.create('Builder') : null;
  const scene = sceneState(characterId ? { characterId, name: 'Builder' } : {});
  scene.grid = { cols: 25, rows: 25, tileWorldSize: 1 };
  scene.terrain.heights = Array.from({ length: 25 }, () => Array(25).fill(0));
  const world = CampaignWorld.fromScene(scene, { ruleset: '2014', library });
  const gm = createCampaignBoard(library);
  gm.threeSceneManager.clearTerrainBrushPreview = jest.fn();
  gm.threeSceneManager.setTerrainBrushPreview = jest.fn();
  await restoreCampaignScene(gm, world.save(), library, gm.characterServices.combat);
  const adapter = new TerrainEngineSceneAdapter({
    engine: gm.terrainEngine,
    gameManager: gm,
    threeSceneManager: gm.threeSceneManager,
  });
  adapter.attach();
  fixture = { gm, adapter, library };
  gm.terrainEngine.placeStructure({
    id: 'house',
    kind: 'building',
    xFeet: 60,
    zFeet: 60,
    heightFeet: 20,
    lengthFeet: 30,
    widthFeet: 25,
  });
  return fixture;
}
afterEach(() => {
  fixture?.adapter.detach();
  if (fixture) {
    for (const token of [...fixture.gm.placedTokens]) fixture.gm.tokenManager.removeToken(token);
    fixture.gm.token3DAdapter.disposeMovementRange();
    fixture.gm.token3DAdapter.disposeMapProjectionTerrain();
  }
  fixture = null;
});

test('building edits update floor maps and connections live and compound Undo restores custom interior data', async () => {
  const { gm, library } = await board();
  expect(gm.campaignWorld.listMaps()).toHaveLength(3);
  const scene = gm.campaignWorld.save();
  const floor = scene.maps.find((map) => map.building?.floor === 1);
  floor.terrain.heights[4][4] = 1;
  gm.campaignWorld.acceptCheckpoint(scene);
  gm.terrainEngine.removeStructure('house');
  expect(gm.campaignWorld.listMaps()).toHaveLength(1);
  gm.terrainEngine.undo();
  expect(gm.campaignWorld.getMap(floor.id).terrain.heights[4][4]).toBe(1);
  expect(gm.campaignWorld.getConnections().some((connection) => connection.kind === 'stairs')).toBe(
    true
  );
  const captured = await captureCampaignScene(gm, library);
  expect(captured.maps.find((map) => map.id === floor.id).terrain.heights[4][4]).toBe(1);
  gm.terrainEngine.redo();
  expect(gm.campaignWorld.listMaps()).toHaveLength(1);
});

test('an occupied floor cannot be removed and a failed edit preserves world state and history', async () => {
  const { gm } = await board();
  const floor = gm.campaignWorld.save().maps.find((map) => map.building?.floor === 1);
  const token = gm.placedTokens[0];
  token.mapId = floor.id;
  await gm.token3DAdapter.restoreStablePlacement(token, {
    gridX: 5,
    gridY: 4,
    facingAngle: 0,
    pose: { kind: 'ground', world: { x: 5.5, y: 0, z: 4.5 } },
  });
  const before = gm.terrainEngine.save(),
    world = gm.campaignWorld.save();
  expect(() => gm.terrainEngine.resizeStructure('house', { heightFeet: 10 })).toThrow(
    /creature.*floor|floor.*removed/i
  );
  expect(gm.terrainEngine.save()).toEqual(before);
  expect(gm.campaignWorld.save()).toEqual(world);
});

test('fine footprint stretching is rejected for an occupied building and preserves the creature position and grid lattice', async () => {
  const { gm } = await board();
  const floor = gm.campaignWorld.save().maps.find((map) => map.building?.floor === 1);
  const token = gm.placedTokens[0];
  token.mapId = floor.id;
  await gm.token3DAdapter.restoreStablePlacement(token, {
    gridX: 5,
    gridY: 4,
    facingAngle: 0,
    pose: { kind: 'ground', world: { x: 5.5, y: 0, z: 4.5 } },
  });
  const physical = gm.campaignWorld.toCampaignPosition(token.mapId, token.world);
  expect(() =>
    gm.terrainEngine.resizeStructure('house', { lengthFeet: 35.5, xFeet: 57.25 })
  ).toThrow(/creature|occupied/i);
  expect(gm.campaignWorld.toCampaignPosition(token.mapId, token.world)).toEqual(physical);
  expect(gm.campaignWorld.getMap(floor.id).grid.cols).toBe(floor.grid.cols);
});

test('compound building Undo and Redo preserve later HP changes and spent movement', async () => {
  const { gm, library } = await board({ withCharacter: true });
  const actor = gm.placedTokens[0],
    session = gm.characterServices.combat;
  gm.terrainEngine.resizeStructure('house', { heightFeet: 30 });
  await library.edit(actor.characterSheetId, { hp: { max: 40, current: 17 } });
  session.startTurn(actor);
  const ticket = session.beginMovement(actor, 5);
  session.finishMovement(ticket, 5);
  const combat = session.snapshot();
  gm.terrainEngine.undo();
  expect(gm.campaignWorld.listMaps()).toHaveLength(3);
  expect(library.get(actor.characterSheetId).hp.current).toBe(17);
  expect(session.snapshot()).toEqual(combat);
  gm.terrainEngine.redo();
  expect(gm.campaignWorld.listMaps()).toHaveLength(4);
  expect(library.get(actor.characterSheetId).hp.current).toBe(17);
  expect(session.snapshot()).toEqual(combat);
});

test('live biome generation installs linked floors once and repeated generation keeps their identities', async () => {
  const { gm, library } = await board();
  gm.terrainEngine.generateBiomeElevation('city', { seed: 42 });
  const structures = gm.terrainEngine.geometry.getStructures().filter((spec) => spec.building);
  const ids = gm.campaignWorld.listMaps().map((map) => map.id);
  expect(ids).toHaveLength(1 + structures.reduce((count, spec) => count + spec.heightFeet / 10, 0));
  expect(ids.length).toBeGreaterThan(3);
  gm.terrainEngine.generateBiomeElevation('city', { seed: 42 });
  expect(gm.campaignWorld.listMaps().map((map) => map.id)).toEqual(ids);
  expect((await captureCampaignScene(gm, library)).maps.map((map) => map.id)).toEqual(ids);
});

test('base conversion preserves floor identities and manual interior edits through undo and redo', async () => {
  const { gm, library } = await board();
  const scene = gm.campaignWorld.save(),
    floor = scene.maps.find((map) => map.building?.floor === 1);
  floor.terrain.heights[4][4] = 1;
  gm.campaignWorld.acceptCheckpoint(scene);
  const building = gm.terrainEngine.geometry.getStructures()[0].building;
  gm.terrainEngine.resizeStructure('house', {
    kind: 'turret',
    diameterFeet: 30,
    building: { ...building, version: 2, roof: 'conical' },
  });
  expect(gm.campaignWorld.getMap(floor.id).terrain.heights.flat()).toContain(1);
  expect(gm.campaignWorld.listMaps()).toHaveLength(3);
  const saved = await captureCampaignScene(gm, library);
  expect(saved.maps[0].terrain.geometry.structures[0].kind).toBe('turret');
  gm.terrainEngine.undo();
  expect(gm.campaignWorld.getMap(floor.id).terrain.heights[4][4]).toBe(1);
  gm.terrainEngine.redo();
  expect(gm.campaignWorld.getMap(floor.id).terrain.heights.flat()).toContain(1);
});

test.each(['height', 'whole-floor', 'opening'])(
  'an occupied floor rejects %s edits atomically instead of teleporting or dropping the creature',
  async (change) => {
    const { gm } = await board(),
      spec = gm.terrainEngine.geometry.getStructures()[0];
    const floor = gm.campaignWorld.save().maps.find((map) => map.building?.floor === 1),
      actor = gm.placedTokens[0];
    actor.mapId = floor.id;
    await gm.token3DAdapter.restoreStablePlacement(actor, {
      gridX: 5,
      gridY: 4,
      facingAngle: 0,
      pose: { kind: 'ground', world: { x: 5.5, y: 0, z: 4.5 } },
    });
    const before = gm.terrainEngine.save(),
      world = gm.campaignWorld.save(),
      position = { ...actor.world };
    let next;
    if (change === 'height') next = changeBuildingLevelHeight(spec, 0, 20);
    else if (change === 'whole-floor') next = removeBuildingLevel(spec, 1);
    else {
      const building = explicitBuilding(spec);
      building.levels[1].openings.push({
        id: 'cut',
        xFeet: 25,
        zFeet: 20,
        lengthFeet: 5,
        widthFeet: 5,
      });
      next = { ...spec, building };
    }
    expect(() =>
      gm.terrainEngine.resizeStructure('house', {
        heightFeet: next.heightFeet,
        building: next.building,
      })
    ).toThrow(/creature|floor|support|placement/i);
    expect(gm.terrainEngine.save()).toEqual(before);
    expect(gm.campaignWorld.save()).toEqual(world);
    expect(actor.world).toEqual(position);
  }
);

test('raising a room moves manual interior geometry with its floor and Undo restores its original local data', async () => {
  const { gm } = await board(),
    scene = gm.campaignWorld.save(),
    floor = scene.maps.find((map) => map.building?.floor === 1);
  floor.terrain.heights[4][4] = 1;
  floor.terrain.geometry.volumes.push({
    id: 'manual-box',
    operation: 'add',
    layerId: 'ground',
    bounds: { min: { x: 25, y: 0, z: 15 }, max: { x: 27, y: 2, z: 17 } },
  });
  gm.campaignWorld.acceptCheckpoint(scene);
  const spec = gm.terrainEngine.geometry.getStructures()[0],
    next = changeBuildingLevelHeight(spec, 0, 20);
  gm.terrainEngine.resizeStructure('house', {
    heightFeet: next.heightFeet,
    building: next.building,
  });
  const moved = gm.campaignWorld.getMap(floor.id);
  expect(moved.originFeet.y).toBe(20);
  expect(
    moved.terrain.geometry.volumes.find((volume) => volume.id === 'manual-box').bounds
  ).toEqual(floor.terrain.geometry.volumes.find((volume) => volume.id === 'manual-box').bounds);
  expect(moved.terrain.heights[4][4]).toBe(1);
  gm.terrainEngine.undo();
  expect(gm.campaignWorld.getMap(floor.id).originFeet.y).toBe(10);
  expect(gm.campaignWorld.getMap(floor.id).terrain.heights[4][4]).toBe(1);
});

test('cellar removal and Undo restore access holes, links and rooms without leaving an open surface hatch', async () => {
  const { gm, library } = await board();
  const spec = gm.terrainEngine.geometry.getStructures()[0];
  gm.terrainEngine.resizeStructure('house', { building: { ...spec.building, stairs: false } });
  gm.terrainEngine.placeStructure({
    id: 'cellar',
    kind: 'cellar',
    xFeet: 60,
    zFeet: 60,
    lengthFeet: 50,
    widthFeet: 40,
    heightFeet: 20,
    building: { access: { kind: 'ladder', structureId: 'house', xFeet: 0, zFeet: 0 } },
  });
  const floorId = gm.campaignWorld
    .save()
    .maps.find((map) => map.building?.structureId === 'house' && map.building.floor === 0).id;
  expect(
    gm.campaignWorld
      .getMap(floorId)
      .terrain.geometry.volumes.some((v) => v.id.includes(':cellar-access:'))
  ).toBe(true);
  gm.terrainEngine.removeStructure('cellar');
  expect(
    gm.campaignWorld
      .getMap(floorId)
      .terrain.geometry.volumes.some((v) => v.id.includes(':cellar-access:'))
  ).toBe(false);
  expect(gm.campaignWorld.listMaps()).toHaveLength(3);
  gm.terrainEngine.undo();
  expect(gm.campaignWorld.getConnections().some((c) => c.kind === 'ladder')).toBe(true);
  expect(gm.campaignWorld.listMaps()).toHaveLength(5);
  expect((await captureCampaignScene(gm, library)).maps).toHaveLength(5);
});

test('moving wall stairs cannot remove an occupied tread and a rejected edit leaves all state untouched', async () => {
  const { gm } = await board();
  gm.terrainEngine.placeStructure({
    id: 'wall',
    kind: 'wall',
    style: 'battlement',
    wallStairs: true,
    xFeet: 60,
    zFeet: 95,
    heightFeet: 20,
    lengthFeet: 60,
    widthFeet: 10,
  });
  const spec = gm.terrainEngine.geometry.getStructures().find((s) => s.id === 'wall');
  const p = wallStairLayout(spec).path[0],
    actor = gm.placedTokens[0];
  await gm.token3DAdapter.restoreStablePlacement(actor, {
    gridX: Math.floor((spec.xFeet + p.x) / 5),
    gridY: Math.floor((spec.zFeet + p.z) / 5),
    facingAngle: 0,
    pose: {
      kind: 'ground',
      world: { x: (spec.xFeet + p.x) / 5, y: p.y / 5, z: (spec.zFeet + p.z) / 5 },
    },
  });
  const before = gm.terrainEngine.save(),
    world = gm.campaignWorld.save();
  expect(() => gm.terrainEngine.resizeStructure('wall', { wallStairSide: 'far' })).toThrow(
    /creature|floor|support/i
  );
  expect(gm.terrainEngine.save()).toEqual(before);
  expect(gm.campaignWorld.save()).toEqual(world);
});

test('moving an empty building carries its floor contents and grid lattice, while all creatures stay at their world positions', async () => {
  const { gm, library } = await board(),
    scene = gm.campaignWorld.save();
  const floor = scene.maps.find((map) => map.building?.floor === 1);
  floor.terrain.heights[4][4] = 1;
  floor.terrain.geometry.volumes.push({
    id: 'furniture',
    operation: 'add',
    layerId: 'ground',
    bounds: { min: { x: 25, y: 0, z: 15 }, max: { x: 27, y: 2, z: 17 } },
  });
  gm.campaignWorld.acceptCheckpoint(scene);
  const actor = gm.placedTokens[0],
    position = gm.campaignWorld.toCampaignPosition(actor.mapId, actor.world);
  gm.terrainEngine.resizeStructure('house', { xFeet: 65.5, zFeet: 65 });
  const moved = gm.campaignWorld.getMap(floor.id);
  expect(moved.originFeet.x - floor.originFeet.x).toBe(5.5);
  expect(moved.originFeet.z - floor.originFeet.z).toBe(5);
  expect(moved.terrain.heights[4][4]).toBe(1);
  expect(moved.terrain.geometry.volumes.find((v) => v.id === 'furniture').bounds).toEqual(
    floor.terrain.geometry.volumes.find((v) => v.id === 'furniture').bounds
  );
  expect(gm.campaignWorld.toCampaignPosition(actor.mapId, actor.world)).toEqual(position);
  expect(
    (await captureCampaignScene(gm, library)).maps.find((map) => map.id === floor.id).originFeet
  ).toEqual(moved.originFeet);
  gm.terrainEngine.undo();
  expect(gm.campaignWorld.getMap(floor.id).terrain.heights[4][4]).toBe(1);
  expect(gm.campaignWorld.getMap(floor.id).originFeet).toEqual(floor.originFeet);
});

test('any building edit while a creature is inside is rejected, preserving its canonical position and resources', async () => {
  const { gm } = await board(),
    floor = gm.campaignWorld.save().maps.find((map) => map.building?.floor === 1);
  const actor = gm.placedTokens[0];
  actor.mapId = floor.id;
  await gm.token3DAdapter.restoreStablePlacement(actor, {
    gridX: 5,
    gridY: 4,
    facingAngle: 0,
    pose: { kind: 'ground', world: { x: 5.5, y: 0, z: 4.5 } },
  });
  const before = gm.terrainEngine.save(),
    world = gm.campaignWorld.save(),
    point = { ...actor.world };
  expect(() => gm.terrainEngine.resizeStructure('house', { xFeet: 61 })).toThrow(
    /creature|occupied/i
  );
  expect(() =>
    gm.terrainEngine.resizeStructure('house', {
      building: {
        ...gm.terrainEngine.geometry.getStructures()[0].building,
        roof: 'hipped',
      },
    })
  ).toThrow(/creature|occupied/i);
  expect(gm.terrainEngine.save()).toEqual(before);
  expect(gm.campaignWorld.save()).toEqual(world);
  expect(actor.world).toEqual(point);
});
