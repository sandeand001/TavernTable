import {
  createConnectedTravelBoard,
  completeConnectionTravel,
  disposeConnectedTravelBoard,
} from '../../helpers/connectedTravelBoard.js';
import { installHumanoidAssetFiles } from '../../helpers/humanoid-fixture.js';
import { createTwoFloorTravelScene } from '../../../src/campaigns/examples/ConnectedTravelExample.js';
import { TerrainEngine } from '../../../src/terrain/TerrainEngine.js';
import { reconcileCavernScene } from '../../../src/campaigns/CavernAssembly.js';
import {
  captureCampaignScene,
  changeCampaignView,
  restoreCampaignScene,
} from '../../../src/campaigns/SceneWorld.js';
import {
  createCampaignCavernArea,
  createCampaignLogicalCavernArea,
} from '../../../src/campaigns/CampaignCavernEditing.js';
import { encodeScene, decodeScene } from '../../../src/campaigns/CampaignScene.js';
import { TerrainEngineSceneAdapter } from '../../../src/scene/terrain/TerrainEngineSceneAdapter.js';
import {
  generateCampaignBiome,
  replaceCampaignBiome,
} from '../../../src/campaigns/CampaignBiomeGeneration.js';
import { planCampaignBiomeReplacement } from '../../../src/campaigns/CampaignBiomePlan.js';
import CampaignWorld from '../../../src/campaigns/CampaignWorld.js';
import { CAVERN_SIDES } from '../../../src/terrain/generation/CavernInteriors.js';
import { createLogicalCavernNetwork } from '../../../src/campaigns/CampaignLogicalPassages.js';
import { getConnectionTravelOption } from '../../../src/campaigns/CampaignTravel.js';

let restoreFiles;
beforeAll(() => {
  restoreFiles = installHumanoidAssetFiles();
});
afterAll(() => restoreFiles());

async function fixture(key = 'cavern', { occupied = true } = {}) {
  const gm = await createConnectedTravelBoard({
    sceneFactory(options) {
      const engine = new TerrainEngine(25, 25);
      engine.configureGeometryScale(1.5);
      engine.generateBiomeElevation(key, { seed: 42 });
      const scene = createTwoFloorTravelScene(options);
      scene.maps = [scene.maps[0]];
      scene.connections = [];
      scene.creatures = scene.creatures.slice(0, 1);
      Object.assign(scene.maps[0].grid, { cols: 25, rows: 25 });
      Object.assign(scene.maps[0].terrain, {
        heights: engine.save().heights,
        geometry: engine.geometry.save(),
        cavern: engine.cavern,
        biome: key,
        seed: 42,
        worldElevationUnit: 0.3,
      });
      scene.creatures[0].gridX = 12;
      scene.creatures[0].gridY = 12;
      scene.creatures[0].pose = {
        kind: 'ground',
        world: {
          x: 12.5,
          y: engine.getHeightAt(12, 12) * scene.maps[0].terrain.worldElevationUnit,
          z: 12.5,
        },
      };
      const context = {
        ruleset: options.ruleset,
        library: {
          ruleset: options.ruleset,
          list: () => options.characters,
          get: (id) => options.characters.find((character) => character.id === id),
        },
      };
      const saved = reconcileCavernScene(scene, context, { regenerate: true });
      if (!occupied) {
        saved.creatures = [];
        saved.view.focusTokenId = null;
        return saved;
      }
      const end = saved.connections.find((connection) => connection.cavern).ends[0];
      saved.creatures[0].gridX = Math.floor(end.positionFeet.x / 5);
      saved.creatures[0].gridY = Math.floor(end.positionFeet.z / 5);
      saved.creatures[0].pose = {
        kind: 'ground',
        world: { x: end.positionFeet.x / 5, y: end.positionFeet.y / 5, z: end.positionFeet.z / 5 },
      };
      saved.view.focusTokenId = saved.creatures[0].id;
      saved.view.camera.target = { ...saved.creatures[0].pose.world };
      return saved;
    },
  });
  if (!occupied) return gm;
  const actor = gm.placedTokens[0];
  try {
    delete gm.__threeTestDouble;
    gm.token3DAdapter.releaseTokenVisual(actor);
    await gm.token3DAdapter.onTokenAdded(actor);
    await actor.__threeMeshPromise;
    await gm.token3DAdapter.setSelectedToken(actor);
    return gm;
  } catch (error) {
    disposeConnectedTravelBoard(gm);
    throw error;
  }
}

test('a fresh single-board campaign generates a cavern and its side chambers through the real geometry participant', async () => {
  const gm = await fixture();
  let editor;
  try {
    for (const token of [...gm.placedTokens]) gm.tokenManager.removeToken(token);
    gm.campaignWorld = null;
    gm.campaignMapId = null;
    gm.campaignView = null;
    gm.terrainEngine.configureGeometryBase(null);
    const empty = new TerrainEngine(25, 25);
    gm.terrainEngine.load(empty.save());
    gm.terrainEngine.setBiome('cavern', { seed: 42, generateIfFlat: false });
    gm.threeSceneManager.clearTerrainBrushPreview = jest.fn();
    gm.threeSceneManager.setTerrainBrushPreview = jest.fn();
    editor = new TerrainEngineSceneAdapter({
      engine: gm.terrainEngine,
      gameManager: gm,
      threeSceneManager: gm.threeSceneManager,
    });
    editor.attach();
    await generateCampaignBiome(gm, { seed: 42 });
    expect(gm.campaignWorld.listMaps()).toHaveLength(3);
    expect(gm.campaignWorld.getConnections()).toHaveLength(2);
    expect(gm.terrainEngine.cavern.kind).toBe('main');
    expect(gm.campaignMapId).toBe('map-main');
  } finally {
    editor?.detach();
    disposeConnectedTravelBoard(gm);
  }
}, 60000);

test('generation refuses to remove unedited linked cavern areas', async () => {
  const gm = await fixture('cavern', { occupied: false });
  let editor;
  try {
    gm.threeSceneManager.clearTerrainBrushPreview = jest.fn();
    editor = new TerrainEngineSceneAdapter({
      engine: gm.terrainEngine,
      gameManager: gm,
      threeSceneManager: gm.threeSceneManager,
    });
    editor.attach();
    const terrain = gm.terrainEngine.save();
    const world = gm.campaignWorld.save();

    await expect(generateCampaignBiome(gm, { biomeKey: 'dungeon', seed: 42 })).rejects.toThrow(
      /linked cavern areas.*preserv/i
    );
    expect(gm.terrainEngine.save()).toEqual(terrain);
    expect(gm.campaignWorld.save()).toEqual(world);
  } finally {
    editor?.detach();
    disposeConnectedTravelBoard(gm);
  }
}, 60000);

test('regenerating the same cavern seed preserves linked maps and connections', async () => {
  const gm = await fixture('cavern', { occupied: false });
  let editor;
  try {
    gm.threeSceneManager.clearTerrainBrushPreview = jest.fn();
    editor = new TerrainEngineSceneAdapter({
      engine: gm.terrainEngine,
      gameManager: gm,
      threeSceneManager: gm.threeSceneManager,
    });
    editor.attach();
    const before = gm.campaignWorld.save();

    await expect(generateCampaignBiome(gm, { biomeKey: 'cavern', seed: 42 })).resolves.toBe(true);
    const after = gm.campaignWorld.save();
    expect(after.maps.filter((map) => map.id !== gm.campaignMapId)).toEqual(
      before.maps.filter((map) => map.id !== gm.campaignMapId)
    );
    expect(after.connections).toEqual(before.connections);
  } finally {
    editor?.detach();
    disposeConnectedTravelBoard(gm);
  }
}, 60000);

test('replacement planning keeps compatible cavern maps and passages', async () => {
  const gm = await fixture('cavern', { occupied: false });
  try {
    const before = gm.campaignWorld.save();
    const prepared = await planCampaignBiomeReplacement(
      gm,
      { biomeKey: 'cavern', seed: 42, densityMultiplier: 0 },
      { cols: 25, rows: 25 }
    );
    expect(prepared.scene.maps.filter((map) => map.id !== gm.campaignMapId)).toEqual(
      before.maps.filter((map) => map.id !== gm.campaignMapId)
    );
    expect(prepared.scene.connections).toEqual(before.connections);
    const world = CampaignWorld.fromScene(prepared.scene, {
      ruleset: gm.characterServices.library.ruleset,
      library: gm.characterServices.library,
    });
    for (const connection of world.getConnections())
      for (const end of connection.ends) {
        const unit = world.getMap(end.mapId).grid.tileWorldSize / 5;
        expect(() =>
          world.planConnection(connection.id, end.mapId, {
            x: end.positionFeet.x * unit,
            y: end.positionFeet.y * unit,
            z: end.positionFeet.z * unit,
          })
        ).not.toThrow();
      }
    expect(gm.campaignWorld.save()).toEqual(before);
  } finally {
    disposeConnectedTravelBoard(gm);
  }
}, 60000);

test('a new cavern seed keeps existing compatible chambers and their entrances', async () => {
  const gm = await fixture('cavern', { occupied: false });
  try {
    const before = gm.campaignWorld.save();
    const prepared = await planCampaignBiomeReplacement(
      gm,
      { biomeKey: 'cavern', seed: 77, densityMultiplier: 0 },
      { cols: 25, rows: 25 }
    );
    for (const map of before.maps.filter((entry) => entry.id !== gm.campaignMapId))
      expect(prepared.scene.maps.find((entry) => entry.id === map.id)).toEqual(map);
    for (const connection of before.connections)
      expect(prepared.scene.connections.find((entry) => entry.id === connection.id)).toEqual(
        connection
      );
    const world = CampaignWorld.fromScene(prepared.scene, {
      ruleset: gm.characterServices.library.ruleset,
      library: gm.characterServices.library,
    });
    for (const connection of before.connections)
      for (const end of connection.ends) {
        const unit = world.getMap(end.mapId).grid.tileWorldSize / 5;
        expect(() =>
          world.planConnection(connection.id, end.mapId, {
            x: end.positionFeet.x * unit,
            y: end.positionFeet.y * unit,
            z: end.positionFeet.z * unit,
          })
        ).not.toThrow();
      }
    expect(gm.campaignWorld.save()).toEqual(before);
  } finally {
    disposeConnectedTravelBoard(gm);
  }
}, 60000);

test('regenerating a cavern preserves a creature in a linked chamber', async () => {
  const gm = await fixture();
  try {
    const library = gm.characterServices.library;
    const scene = gm.campaignWorld.save();
    const rootId = gm.campaignMapId;
    const connection = scene.connections[0];
    const end = connection.ends.find((entry) => entry.mapId !== rootId);
    const remote = {
      ...scene.creatures[0],
      id: 'remote-token',
      name: 'Chamber sentinel',
      nameMode: 'custom',
      characterId: null,
      instanceNumber: 2,
      movement: { mode: 'walk', type: 'default', speed: 30 },
      mapId: end.mapId,
      gridX: Math.floor(end.positionFeet.x / 5),
      gridY: Math.floor(end.positionFeet.z / 5),
      pose: {
        kind: 'ground',
        world: {
          x: end.positionFeet.x / 5,
          y: end.positionFeet.y / 5,
          z: end.positionFeet.z / 5,
        },
      },
    };
    scene.creatures.push(remote);
    await restoreCampaignScene(gm, scene, library, gm.characterServices.combat);
    const before = await captureCampaignScene(gm, library);
    library.saveScene = jest.fn(async (capture) => ({ captured: await capture(library) }));
    library.flush = jest.fn(async () => {});
    await replaceCampaignBiome(
      gm,
      { biomeKey: 'cavern', seed: 42, densityMultiplier: 0 },
      { cols: 25, rows: 25 }
    );
    const after = await captureCampaignScene(gm, library);
    expect(after.creatures).toEqual(before.creatures.filter((entry) => entry.id === remote.id));
    expect(after.maps.find((map) => map.id === remote.mapId)).toEqual(
      before.maps.find((map) => map.id === remote.mapId)
    );
    expect(after.connections).toEqual(before.connections);
  } finally {
    disposeConnectedTravelBoard(gm);
  }
}, 60000);

test('a linked cavern chamber can be regenerated independently without changing its parent', async () => {
  const gm = await fixture('cavern', { occupied: false });
  try {
    const library = gm.characterServices.library;
    const initial = gm.campaignWorld.save();
    const chamber = initial.maps.find((map) => map.cavern?.parentMapId === gm.campaignMapId);
    initial.view.mapId = chamber.id;
    initial.view.focusTokenId = null;
    await restoreCampaignScene(gm, initial, library, gm.characterServices.combat);
    const before = gm.campaignWorld.save();
    const prepared = await planCampaignBiomeReplacement(
      gm,
      { biomeKey: 'cavern', seed: 77, densityMultiplier: 0 },
      { cols: chamber.grid.cols, rows: chamber.grid.rows }
    );
    const generated = prepared.scene.maps.find((map) => map.id === chamber.id);
    expect(generated.terrain.cavern.kind).toBe('chamber');
    expect(generated.terrain.cavern.seed).toBe(77);
    expect(prepared.scene.maps.filter((map) => map.id !== chamber.id)).toEqual(
      before.maps.filter((map) => map.id !== chamber.id)
    );
    expect(prepared.scene.connections).toEqual(before.connections);
    const world = CampaignWorld.fromScene(prepared.scene, { ruleset: library.ruleset, library });
    const connection = world.getConnections(chamber.id)[0];
    for (const end of connection.ends) {
      const unit = world.getMap(end.mapId).grid.tileWorldSize / 5;
      expect(() =>
        world.planConnection(connection.id, end.mapId, {
          x: end.positionFeet.x * unit,
          y: end.positionFeet.y * unit,
          z: end.positionFeet.z * unit,
        })
      ).not.toThrow();
    }
    expect(gm.campaignWorld.save()).toEqual(before);
    let saved;
    library.saveScene = jest.fn(async (capture) => {
      saved = await capture(library);
    });
    library.flush = jest.fn(async () => {});
    await replaceCampaignBiome(
      gm,
      { biomeKey: 'cavern', seed: 77, densityMultiplier: 0 },
      { cols: chamber.grid.cols, rows: chamber.grid.rows }
    );
    expect(gm.campaignMapId).toBe(chamber.id);
    expect(gm.terrainEngine.cavern.kind).toBe('chamber');
    expect(gm.terrainEngine.biomeSeed).toBe(77);
    await restoreCampaignScene(gm, saved.scene, library, gm.characterServices.combat);
    expect(gm.campaignWorld.getConnections()).toEqual(before.connections);
    expect(gm.campaignWorld.getMap(chamber.id).terrain.cavern.seed).toBe(77);
  } finally {
    disposeConnectedTravelBoard(gm);
  }
}, 60000);

test('regenerating a logically linked cavern preserves blank chambers without adding physical areas', async () => {
  const gm = await fixture('cavern', { occupied: false });
  try {
    const library = gm.characterServices.library;
    const scene = gm.campaignWorld.save();
    scene.maps = [scene.maps[0]];
    scene.connections = [];
    const linked = createLogicalCavernNetwork(scene, {
      mapId: 'map-main',
      totalChambers: 3,
    });
    await restoreCampaignScene(gm, linked, library, gm.characterServices.combat);
    const before = gm.campaignWorld.save();
    const prepared = await planCampaignBiomeReplacement(
      gm,
      { biomeKey: 'cavern', seed: 77, densityMultiplier: 0 },
      { cols: 25, rows: 25 }
    );
    expect(prepared.scene.maps).toHaveLength(before.maps.length);
    expect(prepared.scene.maps.filter((map) => map.id !== gm.campaignMapId)).toEqual(
      before.maps.filter((map) => map.id !== gm.campaignMapId)
    );
    expect(prepared.scene.logicalPassages).toEqual(before.logicalPassages);
    expect(prepared.scene.connections).toEqual([]);
    const exits = prepared.scene.maps[0].terrain.cavern.exits;
    for (const passage of before.logicalPassages) {
      const end = passage.ends.find((entry) => entry.mapId === gm.campaignMapId);
      if (end) expect(exits).toContain(end.side);
    }
    expect(gm.campaignWorld.save()).toEqual(before);
  } finally {
    disposeConnectedTravelBoard(gm);
  }
}, 60000);

test('confirmed cavern planning stages a requested network of blank independent chambers', async () => {
  const gm = await fixture('cavern', { occupied: false });
  try {
    const library = gm.characterServices.library;
    const scene = gm.campaignWorld.save();
    scene.maps = [scene.maps[0]];
    scene.connections = [];
    await restoreCampaignScene(gm, scene, library, gm.characterServices.combat);
    const before = gm.campaignWorld.save();
    const prepared = await planCampaignBiomeReplacement(
      gm,
      {
        biomeKey: 'cavern',
        seed: 42,
        densityMultiplier: 0,
        cavernNetwork: { totalChambers: 3, outsideSides: [], outsideMode: 'separate' },
      },
      { cols: 25, rows: 25 }
    );
    expect(prepared.scene.maps).toHaveLength(3);
    expect(prepared.scene.connections).toEqual([]);
    expect(prepared.scene.logicalPassages).toHaveLength(2);
    expect(
      prepared.scene.maps
        .filter((map) => map.id !== gm.campaignMapId)
        .every(
          (map) =>
            map.terrain.biome === null && map.terrain.heights.flat().every((height) => height === 0)
        )
    ).toBe(true);
    expect(gm.campaignWorld.save()).toEqual(before);
  } finally {
    disposeConnectedTravelBoard(gm);
  }
}, 60000);

test('cavern network entrance counts preserve chosen exits without silently adding extra sides', async () => {
  const gm = await fixture('cavern', { occupied: false });
  try {
    const library = gm.characterServices.library;
    const scene = gm.campaignWorld.save();
    scene.maps = [scene.maps[0]];
    scene.connections = [];
    await restoreCampaignScene(gm, scene, library, gm.characterServices.combat);
    const prepared = await planCampaignBiomeReplacement(
      gm,
      {
        biomeKey: 'cavern',
        seed: 42,
        densityMultiplier: 0,
        cavernExitCount: 2,
        cavernNetwork: {
          totalChambers: 2,
          outsideSides: ['north'],
          outsideMode: 'separate',
        },
      },
      { cols: 25, rows: 25 }
    );
    const root = prepared.scene.maps.find((map) => map.id === gm.campaignMapId);
    expect(root.terrain.cavern.exits).toHaveLength(2);
    expect(root.terrain.cavern.exits).toContain('north');
    expect(prepared.scene.logicalPassages.map((passage) => passage.kind).sort()).toEqual([
      'chamber',
      'outside',
    ]);
  } finally {
    disposeConnectedTravelBoard(gm);
  }
}, 60000);

test('regeneration refuses to reduce entrances below the number of preserved links', async () => {
  const gm = await fixture('cavern', { occupied: false });
  try {
    const library = gm.characterServices.library;
    const scene = gm.campaignWorld.save();
    scene.maps = [scene.maps[0]];
    scene.connections = [];
    const linked = createLogicalCavernNetwork(scene, { mapId: 'map-main', totalChambers: 3 });
    await restoreCampaignScene(gm, linked, library, gm.characterServices.combat);
    const before = gm.campaignWorld.save();
    await expect(
      planCampaignBiomeReplacement(
        gm,
        {
          biomeKey: 'cavern',
          seed: 42,
          densityMultiplier: 0,
          cavernExitCount: 1,
          cavernNetwork: { totalChambers: 3, outsideSides: [], outsideMode: 'separate' },
        },
        { cols: 25, rows: 25 }
      )
    ).rejects.toThrow(/at least 2 main entrances/i);
    expect(gm.campaignWorld.save()).toEqual(before);
  } finally {
    disposeConnectedTravelBoard(gm);
  }
}, 60000);

test('a blank logical chamber can be generated and resized without changing linked maps', async () => {
  const gm = await fixture('cavern', { occupied: false });
  try {
    const library = gm.characterServices.library;
    const scene = gm.campaignWorld.save();
    scene.maps = [scene.maps[0]];
    scene.connections = [];
    const linked = createLogicalCavernNetwork(scene, {
      mapId: 'map-main',
      totalChambers: 2,
    });
    const chamber = linked.maps.find((map) => map.id !== 'map-main');
    linked.view.mapId = chamber.id;
    linked.view.focusTokenId = null;
    await restoreCampaignScene(gm, linked, library, gm.characterServices.combat);
    const before = gm.campaignWorld.save();
    const prepared = await planCampaignBiomeReplacement(
      gm,
      { biomeKey: 'fungalGrove', seed: 77, densityMultiplier: 0 },
      { cols: 20, rows: 18 }
    );
    const generated = prepared.scene.maps.find((map) => map.id === chamber.id);
    expect(generated.grid).toMatchObject({ cols: 20, rows: 18 });
    expect(generated.terrain.biome).toBe('fungalGrove');
    const side = before.logicalPassages[0].ends.find((end) => end.mapId === chamber.id).side;
    expect(generated.terrain.cavern.exits).toContain(side);
    expect(prepared.scene.maps.filter((map) => map.id !== chamber.id)).toEqual(
      before.maps.filter((map) => map.id !== chamber.id)
    );
    expect(prepared.scene.logicalPassages).toEqual(before.logicalPassages);
    expect(prepared.scene.connections).toEqual([]);
    expect(gm.campaignWorld.save()).toEqual(before);
  } finally {
    disposeConnectedTravelBoard(gm);
  }
}, 60000);

test('generation rejects a new obstruction in an existing logical cavern entrance', async () => {
  const gm = await fixture('cavern', { occupied: false });
  try {
    const library = gm.characterServices.library;
    const scene = gm.campaignWorld.save();
    scene.maps = [scene.maps[0]];
    scene.connections = [];
    const linked = createLogicalCavernNetwork(scene, { mapId: 'map-main', totalChambers: 2 });
    await restoreCampaignScene(gm, linked, library, gm.characterServices.combat);
    const before = gm.campaignWorld.save();
    const options = { biomeKey: 'cavern', seed: 42, densityMultiplier: 0 };
    const plan = gm.terrainEngine.planBiomeGeneration(options.biomeKey, options, {
      cols: 25,
      rows: 25,
      clear: true,
    });
    const source = before.logicalPassages[0].ends.find((end) => end.mapId === 'map-main');
    const { logicalPassageEndpoint } =
      await import('../../../src/campaigns/CampaignLogicalPassageTravel.js');
    const entry = logicalPassageEndpoint(before.maps[0], source.side);
    const floorFeet = plan.heights[entry.gridY][entry.gridX] * 1.5;
    plan.geometry = {
      version: 1,
      volumes: [
        {
          id: 'blocked-logical-entrance',
          layerId: 'ground',
          operation: 'add',
          bounds: {
            min: { x: entry.gridX * 5, y: floorFeet, z: entry.gridY * 5 },
            max: { x: (entry.gridX + 1) * 5, y: floorFeet + 10, z: (entry.gridY + 1) * 5 },
          },
        },
      ],
    };
    jest.spyOn(gm.terrainEngine, 'planBiomeGeneration').mockReturnValue(plan);
    await expect(planCampaignBiomeReplacement(gm, options, { cols: 25, rows: 25 })).rejects.toThrow(
      /passage|entrance/i
    );
    expect(gm.campaignWorld.save()).toEqual(before);
  } finally {
    disposeConnectedTravelBoard(gm);
  }
}, 60000);

test('a creature traverses a logical chamber passage and returns without changing identity', async () => {
  const gm = await fixture();
  try {
    const library = gm.characterServices.library;
    const scene = gm.campaignWorld.save();
    scene.maps = [scene.maps[0]];
    scene.connections = [];
    const linked = createLogicalCavernNetwork(scene, { mapId: 'map-main', totalChambers: 2 });
    const passage = linked.logicalPassages[0];
    const source = passage.ends.find((end) => end.mapId === 'map-main');
    const { logicalPassageEndpoint } =
      await import('../../../src/campaigns/CampaignLogicalPassageTravel.js');
    const placement = logicalPassageEndpoint(linked.maps[0], source.side);
    Object.assign(linked.creatures[0], {
      gridX: placement.gridX,
      gridY: placement.gridY,
      pose: { kind: 'ground', world: placement.world },
    });
    linked.view.camera.target = { ...placement.world };
    await restoreCampaignScene(gm, linked, library, gm.characterServices.combat);
    const actor = gm.placedTokens[0];
    const character = library.get(actor.characterSheetId);
    const destination = passage.ends.find((end) => end.mapId !== 'map-main').mapId;
    expect(getConnectionTravelOption(gm, actor, passage.id)).toMatchObject({
      allowed: true,
      costFeet: 5,
      actionLabel: 'Go through',
    });
    await expect(completeConnectionTravel(gm, actor, passage.id)).resolves.toMatchObject({
      mapId: destination,
      costFeet: 5,
    });
    expect(actor.id).toBe(linked.creatures[0].id);
    expect(library.get(actor.characterSheetId)).toEqual(character);
    await expect(completeConnectionTravel(gm, actor, passage.id)).resolves.toMatchObject({
      mapId: 'map-main',
      costFeet: 5,
    });
    expect(actor.id).toBe(linked.creatures[0].id);
    expect(gm.campaignWorld.getLogicalPassages()).toEqual(linked.logicalPassages);
  } finally {
    disposeConnectedTravelBoard(gm);
  }
}, 60000);

test('adding a later logical chamber saves a blank map without regenerating the cavern', async () => {
  const gm = await fixture('cavern', { occupied: false });
  try {
    const library = gm.characterServices.library;
    const scene = gm.campaignWorld.save();
    scene.maps = [scene.maps[0]];
    scene.connections = [];
    await restoreCampaignScene(gm, scene, library, gm.characterServices.combat);
    const terrain = gm.terrainEngine.save();
    const side = gm.terrainEngine.cavern.exits[0];
    let saved;
    library.saveScene = jest.fn(async (capture) => {
      saved = await capture(library);
    });
    library.flush = jest.fn(async () => {});
    const created = await createCampaignLogicalCavernArea(gm, {
      side,
      kind: 'chamber',
      name: 'Lower cavern',
    });
    expect(gm.terrainEngine.save()).toEqual(terrain);
    expect(gm.campaignWorld.getMap(created.mapId).name).toBe('Lower cavern');
    expect(gm.campaignWorld.getMap(created.mapId).terrain.biome).toBeNull();
    expect(saved.scene.logicalPassages).toHaveLength(1);
    expect(gm.campaignWorld.getLogicalPassages()).toEqual(saved.scene.logicalPassages);
    expect(gm.campaignMapId).toBe('map-main');
  } finally {
    disposeConnectedTravelBoard(gm);
  }
}, 60000);

test('a rejected later chamber save leaves the old maps and links intact', async () => {
  const gm = await fixture('cavern', { occupied: false });
  try {
    const library = gm.characterServices.library;
    const scene = gm.campaignWorld.save();
    scene.maps = [scene.maps[0]];
    scene.connections = [];
    await restoreCampaignScene(gm, scene, library, gm.characterServices.combat);
    const before = gm.campaignWorld.save();
    library.saveScene = jest.fn(async () => {
      throw Object.assign(new Error('Storage unavailable'), { status: 400 });
    });
    library.flush = jest.fn(async () => {});
    library.campaign = { id: 'test-campaign' };
    library.sceneRevision = 1;
    library.savedScene = 'previous-scene';
    library.store = { readScene: jest.fn(async () => ({ revision: 1, scene: 'previous-scene' })) };
    await expect(
      createCampaignLogicalCavernArea(gm, {
        side: gm.terrainEngine.cavern.exits[0],
        kind: 'chamber',
      })
    ).rejects.toThrow('Storage unavailable');
    expect(gm.campaignWorld.save()).toEqual(before);
    expect(gm.campaignMapFailure).toBeUndefined();
  } finally {
    disposeConnectedTravelBoard(gm);
  }
}, 60000);

test('replacement planning retains a manually connected cavern entrance', async () => {
  const gm = await fixture('cavern', { occupied: false });
  const library = gm.characterServices.library;
  const save = library.saveScene;
  try {
    library.saveScene = jest.fn(async (capture) => ({ captured: await capture() }));
    const occupied = new Set(
      gm.campaignWorld
        .getConnections(gm.campaignMapId)
        .filter((connection) => connection.cavern)
        .map((connection) => connection.cavern.side)
    );
    const side = CAVERN_SIDES.find((candidate) => !occupied.has(candidate));
    await createCampaignCavernArea(gm, { side, kind: 'chamber', name: 'Manual cavern' });
    const before = gm.campaignWorld.save();
    const prepared = await planCampaignBiomeReplacement(
      gm,
      { biomeKey: 'cavern', seed: 42, densityMultiplier: 0 },
      { cols: 25, rows: 25 }
    );
    expect(
      prepared.scene.maps.find((map) => map.id === gm.campaignMapId).terrain.cavern.exits
    ).toContain(side);
    expect(prepared.scene.connections).toEqual(before.connections);
    const world = CampaignWorld.fromScene(prepared.scene, { ruleset: library.ruleset, library });
    const connection = world.getConnections().find((entry) => entry.cavern?.side === side);
    for (const end of connection.ends) {
      const unit = world.getMap(end.mapId).grid.tileWorldSize / 5;
      expect(() =>
        world.planConnection(connection.id, end.mapId, {
          x: end.positionFeet.x * unit,
          y: end.positionFeet.y * unit,
          z: end.positionFeet.z * unit,
        })
      ).not.toThrow();
    }
  } finally {
    library.saveScene = save;
    disposeConnectedTravelBoard(gm);
  }
}, 60000);

test('replacement refuses a resize that overlaps an existing cavern area', async () => {
  const gm = await fixture('cavern', { occupied: false });
  try {
    const before = gm.campaignWorld.save();
    const terrain = gm.terrainEngine.save();
    await expect(
      planCampaignBiomeReplacement(
        gm,
        { biomeKey: 'cavern', seed: 42, densityMultiplier: 0 },
        { cols: 30, rows: 30 }
      )
    ).rejects.toThrow(/overlap|connection|preserv/i);
    expect(gm.campaignWorld.save()).toEqual(before);
    expect(gm.terrainEngine.save()).toEqual(terrain);
  } finally {
    disposeConnectedTravelBoard(gm);
  }
}, 60000);

test('replacement retains the scale needed by existing cavern passages', async () => {
  const gm = await fixture('cavern', { occupied: false });
  try {
    gm.sync3DElevationScaling = () => {};
    gm._defaultElevationPixelsPerLevel = 8;
    gm._baselineWorldElevationUnit = 0.3;
    gm._worldElevationAttenuation = 1;
    const before = gm.campaignWorld.save();
    const prepared = await planCampaignBiomeReplacement(
      gm,
      { biomeKey: 'cavern', seed: 42, densityMultiplier: 0 },
      { cols: 25, rows: 25 }
    );
    const map = prepared.scene.maps.find((entry) => entry.id === gm.campaignMapId);
    expect(map.terrain.worldElevationUnit).toBe(0.3);
    expect(map.terrain.elevationScale).toBe(8);
    const world = CampaignWorld.fromScene(prepared.scene, {
      ruleset: gm.characterServices.library.ruleset,
      library: gm.characterServices.library,
    });
    for (const connection of world.getConnections())
      for (const end of connection.ends) {
        const unit = world.getMap(end.mapId).grid.tileWorldSize / 5;
        expect(() =>
          world.planConnection(connection.id, end.mapId, {
            x: end.positionFeet.x * unit,
            y: end.positionFeet.y * unit,
            z: end.positionFeet.z * unit,
          })
        ).not.toThrow();
      }
    expect(gm.campaignWorld.save()).toEqual(before);
  } finally {
    disposeConnectedTravelBoard(gm);
  }
}, 60000);

test('replacement rejects terrain that makes a preserved passage unusable', async () => {
  const gm = await createConnectedTravelBoard({
    sceneFactory(options) {
      const scene = createTwoFloorTravelScene(options);
      const parent = scene.maps[0];
      delete parent.terrain.geometry;
      const neighbor = JSON.parse(JSON.stringify(parent));
      neighbor.id = 'neighbor';
      neighbor.name = 'Neighbor';
      neighbor.originFeet = { x: 125, y: 0, z: 0 };
      scene.maps = [parent, neighbor];
      scene.creatures = [];
      scene.view.focusTokenId = null;
      scene.connections = [
        {
          id: 'plain-passage',
          name: 'Plain passage',
          kind: 'opening',
          feature: { mapId: parent.id, terrainCells: [{ x: 24, z: 12 }] },
          ends: [
            { mapId: parent.id, positionFeet: { x: 122.5, y: 0, z: 62.5 } },
            { mapId: neighbor.id, positionFeet: { x: 2.5, y: 0, z: 62.5 } },
          ],
          pathFeet: [],
        },
      ];
      return scene;
    },
  });
  try {
    const before = gm.campaignWorld.save();
    expect(() =>
      gm.campaignWorld.planConnection('plain-passage', gm.campaignMapId, {
        x: 24.5,
        y: 0,
        z: 12.5,
      })
    ).not.toThrow();
    await expect(
      planCampaignBiomeReplacement(
        gm,
        { biomeKey: 'mountain', seed: 42, densityMultiplier: 0, structures: false },
        { cols: 25, rows: 25 }
      )
    ).rejects.toThrow(/plain passage.*no longer be usable/i);
    expect(gm.campaignWorld.save()).toEqual(before);
  } finally {
    disposeConnectedTravelBoard(gm);
  }
}, 60000);

test.each([
  ['castle', 'an untouched generated chamber', false],
  ['castle', 'an edited generated chamber', true],
  ['dungeon', 'an untouched generated chamber', false],
  ['dungeon', 'an edited generated chamber', true],
])(
  '%s generation from a saved cavern handles %s safely',
  async (biome, _label, edited) => {
    const gm = await fixture('cavern', { occupied: false });
    let editor;
    try {
      const engine = gm.terrainEngine;
      const before = gm.campaignWorld.save();
      const chamber = before.maps.find(({ cavern }) => cavern?.parentMapId === gm.campaignMapId);
      expect(chamber).toBeDefined();
      if (edited) {
        chamber.name = 'Edited cavern chamber';
        gm.campaignWorld.acceptCheckpoint(before);
      }
      gm.threeSceneManager.clearTerrainBrushPreview = jest.fn();
      editor = new TerrainEngineSceneAdapter({
        engine,
        gameManager: gm,
        threeSceneManager: gm.threeSceneManager,
      });
      editor.attach();
      engine.setBiome(biome, { seed: 42, generateIfFlat: false });
      const beforeAttempt = engine.save();
      await expect(generateCampaignBiome(gm, { seed: edited ? 43 : 42 })).rejects.toThrow(
        'Generation would remove linked cavern areas'
      );
      expect(engine.save()).toEqual(beforeAttempt);
      expect(gm.campaignWorld.save()).toEqual(before);
    } finally {
      editor?.detach();
      disposeConnectedTravelBoard(gm);
    }
  },
  60000
);

test('Dungeon generation cannot remove an occupied cavern chamber', async () => {
  const gm = await fixture('cavern');
  let editor;
  try {
    const actor = gm.placedTokens[0];
    gm.characterServices.combat.startTurn(actor);
    const connection = gm.campaignWorld.getConnections().find((entry) => entry.cavern);
    await completeConnectionTravel(gm, actor, connection.id);
    expect(actor.mapId).toBe(connection.ends[1].mapId);
    await changeCampaignView(gm, { mapId: 'map-main' });

    const engine = gm.terrainEngine;
    gm.threeSceneManager.clearTerrainBrushPreview = jest.fn();
    editor = new TerrainEngineSceneAdapter({
      engine,
      gameManager: gm,
      threeSceneManager: gm.threeSceneManager,
    });
    editor.attach();
    engine.setBiome('dungeon', { seed: 42, generateIfFlat: false });
    const beforeAttempt = engine.save();
    const beforeWorld = gm.campaignWorld.save();
    await expect(generateCampaignBiome(gm, { seed: 42 })).rejects.toThrow(
      'Generation would remove linked cavern areas'
    );
    expect(engine.save()).toEqual(beforeAttempt);
    expect(gm.campaignWorld.save()).toEqual(beforeWorld);
    expect(actor.mapId).toBe(connection.ends[1].mapId);
  } finally {
    editor?.detach();
    disposeConnectedTravelBoard(gm);
  }
}, 60000);

test.each(['cavern', 'fungalGrove'])(
  '%s passage changes to a separate cavern view with real paid animated travel and stable saved resources',
  async (key) => {
    const gm = await fixture(key);
    let reopened;
    try {
      const actor = gm.placedTokens[0],
        { library, combat } = gm.characterServices;
      const before = library.get(actor.characterSheetId);
      combat.startTurn(actor);
      const turn = combat.turn;
      const connection = gm.campaignWorld.getConnections().find((entry) => entry.cavern);
      await completeConnectionTravel(gm, actor, connection.id);
      expect(actor.mapId).toBe(connection.ends[1].mapId);
      expect(gm.campaignMapId).toBe(actor.mapId);
      expect(gm.terrainEngine.cavern.kind).toBe('chamber');
      expect(combat.status(actor).movement.spent).toBe(5);
      expect(combat.turn).toBe(turn);
      expect(library.get(actor.characterSheetId)).toEqual(before);
      const scene = await captureCampaignScene(gm, library, { combat });
      const context = { ruleset: library.ruleset, library };
      const saved = decodeScene(encodeScene(scene, context), context);
      reopened = await createConnectedTravelBoard({ scene: saved, library });
      expect(reopened.campaignMapId).toBe(actor.mapId);
      expect(reopened.terrainEngine.cavern).toEqual(gm.terrainEngine.cavern);
      expect(
        reopened.characterServices.combat.status(reopened.placedTokens[0]).movement.spent
      ).toBe(5);
    } finally {
      if (reopened) disposeConnectedTravelBoard(reopened);
      disposeConnectedTravelBoard(gm);
    }
  },
  60000
);

test('adding a cavern area saves atomically without recreating or moving the current actor', async () => {
  const gm = await fixture();
  try {
    const actor = gm.placedTokens[0],
      { library, combat } = gm.characterServices;
    const occupiedSides = new Set(
      gm.campaignWorld
        .getConnections()
        .filter((connection) => connection.cavern?.parentMapId === gm.campaignMapId)
        .map((connection) => connection.cavern.side)
    );
    const side = CAVERN_SIDES.find((candidate) => !occupiedSides.has(candidate));
    combat.startTurn(actor);
    const turn = combat.turn;
    const placement = gm.token3DAdapter.getStablePlacement(actor);
    let checkpoint;
    const originalSave = library.saveScene;
    library.saveScene = jest.fn(async (capture) => {
      checkpoint = capture();
      return { captured: checkpoint, receipt: { revision: 1 } };
    });
    try {
      const result = await createCampaignCavernArea(gm, {
        side,
        kind: 'tunnel',
        name: 'Lower tunnel',
      });
      expect(checkpoint.scene.maps).toHaveLength(4);
      expect(gm.campaignWorld.getMap(result.mapId).terrain.cavern.kind).toBe('tunnel');
      expect(gm.campaignMapId).toBe('map-main');
      expect(gm.placedTokens[0]).toBe(actor);
      const current = gm.token3DAdapter.getStablePlacement(actor);
      expect(current.gridX).toBe(placement.gridX);
      expect(current.gridY).toBe(placement.gridY);
      expect(current.pose.kind).toBe(placement.pose.kind);
      expect(current.pose.world.x).toBe(placement.pose.world.x);
      expect(current.pose.world.z).toBe(placement.pose.world.z);
      expect(current.pose.world.y).toBeCloseTo(placement.pose.world.y, 12);
      expect(combat.turn).toBe(turn);
      expect(combat.status(actor).movement.spent).toBe(0);
    } finally {
      library.saveScene = originalSave;
    }
  } finally {
    disposeConnectedTravelBoard(gm);
  }
}, 60000);

test('a failed cavern-area save leaves the scene, actor and connection list unchanged', async () => {
  const gm = await fixture();
  try {
    const actor = gm.placedTokens[0],
      library = gm.characterServices.library;
    const occupiedSides = new Set(
      gm.campaignWorld
        .getConnections()
        .filter((connection) => connection.cavern?.parentMapId === gm.campaignMapId)
        .map((connection) => connection.cavern.side)
    );
    const side = CAVERN_SIDES.find((candidate) => !occupiedSides.has(candidate));
    const before = gm.campaignWorld.save();
    const save = library.saveScene;
    library.saveScene = jest.fn(async () => {
      throw new Error('Host disk unavailable');
    });
    try {
      await expect(createCampaignCavernArea(gm, { side, kind: 'chamber' })).rejects.toThrow(
        'Host disk unavailable'
      );
      expect(gm.campaignWorld.save()).toEqual(before);
      expect(gm.placedTokens[0]).toBe(actor);
      expect(gm.campaignViewBusy).toBe(false);
    } finally {
      library.saveScene = save;
    }
  } finally {
    disposeConnectedTravelBoard(gm);
  }
}, 60000);
