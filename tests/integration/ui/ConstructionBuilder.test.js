import {
  createConnectedTravelBoard,
  disposeConnectedTravelBoard,
} from '../../helpers/connectedTravelBoard.js';
import { installHumanoidAssetFiles, stepHumanoid } from '../../helpers/humanoid-fixture.js';
import { createCurvedStructuresScene } from '../../../src/campaigns/examples/CurvedStructuresExample.js';
import { TerrainEngine } from '../../../src/terrain/TerrainEngine.js';
import { validateConstructionEdit } from '../../../src/campaigns/CampaignConstruction.js';
import { captureCampaignScene } from '../../../src/campaigns/SceneWorld.js';
import { encodeScene, decodeScene } from '../../../src/campaigns/CampaignScene.js';

let restoreFiles;
beforeAll(() => {
  restoreFiles = installHumanoidAssetFiles();
});
afterAll(() => restoreFiles());

test('a real animated creature climbs an angled built wall, persists its unit-normal grip and prevents destructive resizing', async () => {
  const sceneFactory = (options) => {
    const scene = createCurvedStructuresScene(options);
    const engine = new TerrainEngine(25, 25);
    engine.placeStructure({
      id: 'diagonal-wall',
      kind: 'wall',
      xFeet: 60,
      zFeet: 60,
      lengthFeet: 40,
      heightFeet: 20,
      angleRadians: Math.PI / 4,
    });
    scene.maps[0].terrain.geometry = engine.geometry.save();
    return scene;
  };
  let gm;
  try {
    gm = await createConnectedTravelBoard({ sceneFactory });
    const actor = gm.placedTokens[0];
    for (const npc of [...gm.placedTokens].slice(1)) gm.tokenManager.removeToken(npc);
    const adapter = gm.token3DAdapter;
    delete gm.__threeTestDouble;
    adapter.releaseTokenVisual(actor);
    await adapter.onTokenAdded(actor);
    await actor.__threeMeshPromise;
    const half = Math.SQRT1_2;
    const normal = { x: -half, y: 0, z: half };
    const offset = Math.SQRT1_2;
    const contact = { x: 60 + normal.x, y: 5, z: 60 + normal.z };
    const grip = { mapId: 'map-main', pointFeet: contact, normal, offsetFeet: offset };
    const world = {
      x: (contact.x + normal.x * offset) / 5,
      y: 0,
      z: (contact.z + normal.z * offset) / 5,
    };
    await adapter.restoreStablePlacement(actor, {
      gridX: Math.floor(world.x),
      gridY: Math.floor(world.z),
      facingAngle: 0,
      pose: { kind: 'grip', world, grip },
    });
    const combat = gm.characterServices.combat;
    combat.startTurn(actor);
    const result = adapter.requestClimbToSurface(actor, {
      kind: 'wall',
      point: { x: contact.x / 5, y: 3, z: contact.z / 5 },
      normal,
    });
    expect(result.cost).toBe(20);
    let frames = 0;
    for (; frames < 1800 && adapter.isMovementInProgress(actor); frames++) {
      stepHumanoid({ adapter, token: actor, mesh: actor.__threeMesh }, 1 / 60);
      gm.advanceFrame();
      await Promise.resolve();
    }
    expect(adapter.isMovementInProgress(actor)).toBe(false);
    expect(actor.world.y).toBeCloseTo(2);
    expect(frames).toBeGreaterThan(30);
    expect(combat.status(actor).movement.spent).toBe(20);
    const saved = await captureCampaignScene(gm, gm.characterServices.library);
    const decoded = decodeScene(
      encodeScene(saved, {
        ruleset: '2014',
        library: gm.characterServices.library,
      }),
      { ruleset: '2014', library: gm.characterServices.library }
    );
    expect(decoded.creatures[0].pose.kind).toBe('grip');
    expect(decoded.creatures[0].pose.grip.normal.x).toBeCloseTo(normal.x, 8);
    expect(decoded.creatures[0].pose.grip.normal.z).toBeCloseTo(normal.z, 8);
    expect(decoded.creatures[0].pose).toEqual(saved.creatures[0].pose);
    const before = gm.terrainEngine.save();
    const remove = gm.terrainEngine.validateGeometryEdits((geometry) =>
      validateConstructionEdit(gm, geometry)
    );
    try {
      expect(() => gm.terrainEngine.resizeStructure('diagonal-wall', { heightFeet: 5 })).toThrow(
        /gripping|inside|floor/
      );
      expect(gm.terrainEngine.save()).toEqual(before);
    } finally {
      remove();
    }
  } finally {
    if (gm) disposeConnectedTravelBoard(gm);
  }
}, 60000);
