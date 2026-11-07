import {
  createConnectedTravelBoard,
  completeConnectionTravel,
  disposeConnectedTravelBoard,
} from '../../helpers/connectedTravelBoard.js';
import { createTwoFloorTravelScene } from '../../../src/campaigns/examples/ConnectedTravelExample.js';
import { installHumanoidAssetFiles, stepHumanoid } from '../../helpers/humanoid-fixture.js';
import { TerrainEngine } from '../../../src/terrain/TerrainEngine.js';
import { reconcileBuildingScene } from '../../../src/campaigns/BuildingAssembly.js';
import { captureCampaignScene } from '../../../src/campaigns/SceneWorld.js';
import { encodeScene, decodeScene } from '../../../src/campaigns/CampaignScene.js';
import { TerrainEngineSceneAdapter } from '../../../src/scene/terrain/TerrainEngineSceneAdapter.js';
import { getTokenConditions } from '../../../src/entities/creatures/TokenMovement.js';
import * as dice from '../../../src/systems/dice/dice.js';

let restoreFiles;
beforeAll(() => {
  restoreFiles = installHumanoidAssetFiles();
});
afterAll(() => restoreFiles());

async function fixture(key, seed = 42, cliffStart = false, size = 60) {
  let actor;
  const gm = await createConnectedTravelBoard({
    sceneFactory: (options) => {
      const base = createTwoFloorTravelScene(options),
        engine = new TerrainEngine(size, size);
      engine.generateBiomeElevation(key, { seed });
      base.maps = [base.maps[0]];
      base.connections = [];
      base.creatures = base.creatures.slice(0, 1);
      Object.assign(base.maps[0].grid, { cols: size, rows: size });
      Object.assign(base.maps[0].terrain, {
        heights: engine.save().heights,
        geometry: engine.geometry.save(),
        biome: key,
        worldElevationUnit: 0.5,
        seed,
      });
      base.creatures[0].gridX = 0;
      base.creatures[0].gridY = 0;
      base.creatures[0].pose = {
        kind: 'ground',
        world: {
          x: 0.5,
          y: engine.getHeightAt(0, 0) * 0.5,
          z: 0.5,
        },
      };
      base.view.focusTokenId = null;
      const context = {
        ruleset: '2014',
        library: {
          ruleset: '2014',
          list: () => options.characters,
          get: (id) => options.characters.find((c) => c.id === id),
        },
      };
      const scene = reconcileBuildingScene(base, context);
      let point;
      if (cliffStart) {
        const heights = engine.save().heights;
        const plateau = Math.max(...heights.flat());
        outer: for (let z = 2; z < size - 2; z++)
          for (let x = 2; x < size - 2; x++) {
            if (heights[z][x] !== plateau) continue;
            for (const [dx, dz] of [
              [1, 0],
              [-1, 0],
              [0, 1],
              [0, -1],
            ])
              if (heights[z + dz][x + dx] <= -4) {
                point = {
                  x: x + 0.5,
                  y: plateau * 0.5,
                  z: z + 0.5,
                  targetX: x + dx,
                  targetZ: z + dz,
                };
                break outer;
              }
          }
        if (!point) throw new Error('The generated cliff has no physical drop edge');
      } else {
        const wanted = key === 'mountainCastle' ? 'Stoneheart Great Hall' : null;
        const spec = engine.geometry
          .getStructures()
          .find((s) => s.building && (!wanted || s.name === wanted));
        const entry = scene.connections.find(
          (c) => c.building?.kind === 'entry' && c.building.structureId === spec.id
        );
        const end = entry.ends[0];
        point = { x: end.positionFeet.x / 5, y: end.positionFeet.y / 5, z: end.positionFeet.z / 5 };
      }
      const saved = scene.creatures[0];
      saved.gridX = Math.floor(point.x);
      saved.gridY = Math.floor(point.z);
      saved.pose = { kind: 'ground', world: { x: point.x, y: point.y, z: point.z } };
      scene.view.camera.target = { ...saved.pose.world };
      actor = point;
      return scene;
    },
  });
  try {
    const token = gm.placedTokens[0],
      adapter = gm.token3DAdapter;
    delete gm.__threeTestDouble;
    adapter.releaseTokenVisual(token);
    await adapter.onTokenAdded(token);
    await token.__threeMeshPromise;
    await adapter.setSelectedToken(token);
    await gm.characterServices.library.edit(token.characterSheetId, {
      hp: { max: 40, current: 40 },
    });
    return { gm, token, adapter, start: actor };
  } catch (error) {
    disposeConnectedTravelBoard(gm);
    throw error;
  }
}

test.each([
  ['cliffsideCastle', 1, 60],
  ['cliffsideCastle', 42, 60],
  ['mountainCastle', 1, 60],
  ['mountainCastle', 42, 60],
  ['cliffsideCastle', 42, 50],
  ['mountainCastle', 42, 50],
])(
  '%s seed %i on %i tiles supports real animated entry and reopening without changing character resources or turn',
  async (key, seed, size) => {
    const { gm, token, adapter } = await fixture(key, seed, false, size);
    let reopened, editor;
    try {
      gm.threeSceneManager.clearTerrainBrushPreview = jest.fn();
      gm.threeSceneManager.setTerrainBrushPreview = jest.fn();
      editor = new TerrainEngineSceneAdapter({
        engine: gm.terrainEngine,
        gameManager: gm,
        threeSceneManager: gm.threeSceneManager,
      });
      editor.attach();
      const { library, combat } = gm.characterServices;
      combat.startTurn(token);
      const turn = combat.turn,
        before = library.get(token.characterSheetId);
      const entry = gm.campaignWorld
        .getConnections()
        .find(
          (c) =>
            c.building?.kind === 'entry' &&
            Math.abs(c.ends[0].positionFeet.x / 5 - token.world.x) < 0.01 &&
            Math.abs(c.ends[0].positionFeet.z / 5 - token.world.z) < 0.01
        );
      await completeConnectionTravel(gm, token, entry.id);
      expect(token.mapId).toBe(entry.ends[1].mapId);
      expect(combat.status(token).movement.spent).toBe(5);
      expect(library.get(token.characterSheetId)).toEqual(before);
      expect(combat.turn).toBe(turn);
      const saved = await captureCampaignScene(gm, library, { combat });
      const decoded = decodeScene(encodeScene(saved, { ruleset: '2014', library }), {
        ruleset: '2014',
        library,
      });
      reopened = await createConnectedTravelBoard({ library, scene: decoded });
      expect(reopened.placedTokens).toHaveLength(1);
      expect(reopened.placedTokens[0].mapId).toBe(token.mapId);
      expect(reopened.token3DAdapter.getStablePlacement(reopened.placedTokens[0])).toEqual(
        adapter.getStablePlacement(token)
      );
      expect(reopened.characterServices.combat.turn).toBe(turn);
      expect(
        reopened.characterServices.combat.status(reopened.placedTokens[0]).movement.spent
      ).toBe(5);
    } finally {
      if (reopened) disposeConnectedTravelBoard(reopened);
      editor?.detach();
      disposeConnectedTravelBoard(gm);
    }
  },
  60000
);

test('walking off a generated cliff resolves the real lower terrain and paid fall without teleporting the creature', async () => {
  const context = await fixture('cliffsideCastle', 42, true),
    { gm, token, adapter, start } = context;
  const roll = jest.spyOn(dice, 'rollDiceExpression').mockResolvedValue({
    expression: '5d6',
    total: 15,
    text: '5d6 = 15',
  });
  try {
    const combat = gm.characterServices.combat;
    combat.startTurn(token);
    const request = adapter.requestMoveToGrid(token, start.targetX, start.targetZ);
    expect(request?.cost).toBe(5);
    for (let i = 0; i < 2400 && (adapter.isMovementInProgress(token) || gm.campaignViewBusy); i++) {
      stepHumanoid({ adapter, token, mesh: token.__threeMesh }, 1 / 60);
      gm.advanceFrame();
      await Promise.resolve();
      if (i % 30 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(adapter.isMovementInProgress(token)).toBe(false);
    expect(token.world.y).toBeLessThanOrEqual(-2);
    expect(roll.mock.calls[0][0]).toMatchObject({ expression: '5d6' });
    expect(gm.characterServices.library.get(token.characterSheetId).hp.current).toBe(25);
    expect(getTokenConditions(token)).toContain('prone');
    expect(combat.status(token).movement.spent).toBe(5);
    await captureCampaignScene(gm, gm.characterServices.library);
  } finally {
    roll.mockRestore();
    disposeConnectedTravelBoard(gm);
  }
}, 60000);
