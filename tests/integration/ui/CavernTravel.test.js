import {
  createConnectedTravelBoard,
  completeConnectionTravel,
  disposeConnectedTravelBoard,
} from '../../helpers/connectedTravelBoard.js';
import { installHumanoidAssetFiles } from '../../helpers/humanoid-fixture.js';
import { createTwoFloorTravelScene } from '../../../src/campaigns/examples/ConnectedTravelExample.js';
import { TerrainEngine } from '../../../src/terrain/TerrainEngine.js';
import { reconcileCavernScene } from '../../../src/campaigns/CavernAssembly.js';
import { captureCampaignScene } from '../../../src/campaigns/SceneWorld.js';
import { createCampaignCavernArea } from '../../../src/campaigns/CampaignCavernEditing.js';
import { encodeScene, decodeScene } from '../../../src/campaigns/CampaignScene.js';
import { TerrainEngineSceneAdapter } from '../../../src/scene/terrain/TerrainEngineSceneAdapter.js';
import { generateCampaignBiome } from '../../../src/campaigns/CampaignBiomeGeneration.js';

let restoreFiles;
beforeAll(() => {
  restoreFiles = installHumanoidAssetFiles();
});
afterAll(() => restoreFiles());

async function fixture(key = 'cavern') {
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
      const end = saved.connections.find((connection) => connection.cavern.side === 'east').ends[0];
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
      const connection = gm.campaignWorld
        .getConnections()
        .find((entry) => entry.cavern.side === 'east');
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
        side: 'south',
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
    const before = gm.campaignWorld.save();
    const save = library.saveScene;
    library.saveScene = jest.fn(async () => {
      throw new Error('Host disk unavailable');
    });
    try {
      await expect(
        createCampaignCavernArea(gm, { side: 'south', kind: 'chamber' })
      ).rejects.toThrow('Host disk unavailable');
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
