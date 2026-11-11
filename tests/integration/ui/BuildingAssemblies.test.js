import * as three from 'three';
import {
  addPhysicalTerrain,
  addPointerView,
  completeConnectionTravel,
  createConnectedTravelBoard,
  disposeConnectedTravelBoard,
} from '../../helpers/connectedTravelBoard.js';
import { installHumanoidAssetFiles, stepHumanoid } from '../../helpers/humanoid-fixture.js';
import { createTwoFloorTravelScene } from '../../../src/campaigns/examples/ConnectedTravelExample.js';
import { TerrainEngineSceneAdapter } from '../../../src/scene/terrain/TerrainEngineSceneAdapter.js';
import {
  captureCampaignScene,
  restoreCampaignScene,
  changeCampaignView,
} from '../../../src/campaigns/SceneWorld.js';
import { encodeScene, decodeScene } from '../../../src/campaigns/CampaignScene.js';
import * as dice from '../../../src/systems/dice/dice.js';
import {
  getConnectionTravelOption,
  prepareConnectionTravel,
} from '../../../src/campaigns/CampaignTravel.js';
import { explicitBuilding, changeBuildingLevelHeight } from '../../../src/terrain/BuildingModel.js';
import { GameErrors } from '../../../src/utils/error/ErrorHandler.js';
import { wallStairLayout } from '../../../src/terrain/WallStairs.js';
import { buildingLocalToFeet } from '../../../src/terrain/BuildingModel.js';
import { buildSurfaceRange } from '../../../src/terrain/SurfaceNavigation.js';
import { openTraversalDoors } from '../../helpers/openTraversalDoors.js';

let restoreFiles;
beforeAll(() => {
  restoreFiles = installHumanoidAssetFiles();
});
afterAll(() => restoreFiles());

async function fixture(
  start = null,
  { roofRiseFeet = 5, windows, balconies, prepare = null, startEnd = 1, gridSize = 25 } = {}
) {
  const gm = await createConnectedTravelBoard({
    sceneFactory: (options) => {
      const scene = createTwoFloorTravelScene(options);
      scene.maps = [scene.maps[0]];
      delete scene.maps[0].terrain.geometry;
      if (gridSize !== scene.maps[0].grid.cols) {
        Object.assign(scene.maps[0].grid, { cols: gridSize, rows: gridSize });
        scene.maps[0].terrain.heights = Array.from({ length: gridSize }, () =>
          Array(gridSize).fill(0)
        );
      }
      scene.connections = [];
      scene.creatures = scene.creatures.slice(0, 1);
      Object.assign(scene.creatures[0], {
        gridX: 12,
        gridY: 15,
        pose: { kind: 'ground', world: { x: 12.5, y: 0, z: 15.5 } },
      });
      scene.view.focusTokenId = null;
      return scene;
    },
  });
  let editor;
  try {
    gm.threeSceneManager.clearTerrainBrushPreview = jest.fn();
    gm.threeSceneManager.setTerrainBrushPreview = jest.fn();
    editor = new TerrainEngineSceneAdapter({
      engine: gm.terrainEngine,
      gameManager: gm,
      threeSceneManager: gm.threeSceneManager,
    });
    editor.attach();
    gm.terrainEngine.placeStructure({
      id: 'house',
      kind: 'building',
      xFeet: 62.5,
      zFeet: 62.5,
      heightFeet: 30,
      lengthFeet: 30,
      widthFeet: 25,
      building: {
        version: 2,
        roof: 'gable',
        roofRiseFeet,
        ...(windows === undefined ? {} : { autoWindows: false, windows }),
        balconies: balconies || [
          { id: 'lookout', floor: 1, side: 'south', u: 0.5, widthFeet: 10, depthFeet: 5 },
        ],
      },
    });
    if (prepare) {
      await gm.token3DAdapter.restoreStablePlacement(gm.placedTokens[0], {
        gridX: 1,
        gridY: 1,
        facingAngle: 0,
        pose: { kind: 'ground', world: { x: 1.5, y: 0, z: 1.5 } },
      });
      prepare(gm.terrainEngine);
    }
    if (start) {
      const saved = await captureCampaignScene(gm, gm.characterServices.library);
      const connection = saved.connections.find(start);
      const end = connection.ends[startEnd],
        map = saved.maps.find((entry) => entry.id === end.mapId);
      const unit = map.grid.tileWorldSize / 5;
      const point = {
        x: end.positionFeet.x * unit,
        y: 0,
        z: end.positionFeet.z * unit,
      };
      Object.assign(saved.creatures[0], {
        mapId: map.id,
        gridX: Math.floor(point.x / map.grid.tileWorldSize),
        gridY: Math.floor(point.z / map.grid.tileWorldSize),
        pose: { kind: 'ground', world: point },
      });
      saved.view.mapId = map.id;
      saved.view.camera.target = { ...point };
      await restoreCampaignScene(
        gm,
        saved,
        gm.characterServices.library,
        gm.characterServices.combat
      );
    }
    const actor = gm.placedTokens[0],
      adapter = gm.token3DAdapter;
    delete gm.__threeTestDouble;
    adapter.releaseTokenVisual(actor);
    await adapter.onTokenAdded(actor);
    await actor.__threeMeshPromise;
    await adapter.setSelectedToken(actor);
    const { library, combat: session } = gm.characterServices;
    await library.edit(actor.characterSheetId, { hp: { max: 40, current: 40 } });
    openTraversalDoors(gm.campaignWorld);
    return { gm, actor, adapter, editor, library, session };
  } catch (error) {
    editor?.detach();
    disposeConnectedTravelBoard(gm);
    throw error;
  }
}

function dispose(context) {
  context.editor.detach();
  disposeConnectedTravelBoard(context.gm);
}

async function finishMotion({ gm, actor, adapter }) {
  for (
    let frame = 0;
    frame < 2400 && (adapter.isMovementInProgress(actor) || gm.campaignViewBusy);
    frame++
  ) {
    if (!gm.campaignViewBusy || gm.campaignTraversalAnimating)
      stepHumanoid({ adapter, token: actor, mesh: adapter.getTokenVisual(actor) }, 1 / 60);
    gm.advanceFrame();
    await Promise.resolve();
    if (frame % 30 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  gm.advanceFrame();
  expect(adapter.isMovementInProgress(actor)).toBe(false);
}

test.each([
  ['city', 25, 42],
  ['ruinedUrban', 25, 42],
  ['castle', 25, 42],
  ['ruinedCastle', 25, 42],
  ['castle', 20, 42],
  ['ruinedCastle', 20, 42],
  ['city', 45, 42],
  ['castle', 50, 42],
  ['ruinedCastle', 50, 42],
  ['castle', 50, 3],
  ['castle', 50, 13],
])(
  'a generated %s building on a %i-tile map (seed %i) supports real-rig entry, paid stairs and reopening without allowing occupied regeneration',
  async (biomeKey, gridSize, seed) => {
    const context = await fixture((connection) => connection.building?.kind === 'entry', {
      startEnd: 0,
      gridSize,
      prepare: (engine) => {
        engine.removeStructure('house');
        engine.generateBiomeElevation(biomeKey, { seed });
      },
    });
    const { gm, actor, adapter, library, session } = context;
    let reopened;
    try {
      session.startTurn(actor);
      session.adjustMovement(actor, 200);
      const turn = session.turn,
        character = library.get(actor.characterSheetId);
      const entry = gm.campaignWorld
        .getConnections()
        .find((connection) => connection.building?.kind === 'entry');
      await completeConnectionTravel(gm, actor, entry.id);
      expect(session.status(actor).movement.spent).toBe(5);
      const stairs = gm.campaignWorld
        .getConnections()
        .find(
          (connection) =>
            connection.building?.structureId === entry.building.structureId &&
            connection.building.kind === 'stairs' &&
            connection.building.floor === 0
        );
      const foot = stairs.ends.find((end) => end.mapId === actor.mapId);
      expect(
        adapter.requestMoveToGrid(
          actor,
          Math.floor(foot.positionFeet.x / 5),
          Math.floor(foot.positionFeet.z / 5)
        )?.cost
      ).toBeGreaterThan(0);
      await finishMotion(context);
      const before = session.status(actor).movement.spent;
      const quote = prepareConnectionTravel(gm, actor, stairs.id);
      expect(quote.costFeet).toBeGreaterThanOrEqual(35);
      await completeConnectionTravel(gm, actor, stairs.id);
      expect(session.status(actor).movement.spent - before).toBe(quote.costFeet);
      expect(gm.campaignWorld.getMap(actor.mapId).building.floor).toBe(1);
      expect(gm.campaignWorld.toCampaignPosition(actor.mapId, actor.world).y).toBe(10);
      const pose = adapter.getStablePlacement(actor),
        spent = session.status(actor).movement.spent;
      await changeCampaignView(gm, { mapId: 'map-main' });
      const terrain = gm.terrainEngine.save();
      expect(() => gm.terrainEngine.generateBiomeElevation('city', { seed: 17 })).toThrow(
        /creature occupies a floor/i
      );
      expect(gm.terrainEngine.save()).toEqual(terrain);
      expect(adapter.getStablePlacement(actor)).toEqual(pose);
      expect(library.get(actor.characterSheetId)).toEqual(character);
      expect(session.turn).toBe(turn);
      expect(session.status(actor).movement.spent).toBe(spent);
      const scene = await captureCampaignScene(gm, library, { combat: session });
      const decoded = decodeScene(encodeScene(scene, { ruleset: '2014', library }), {
        ruleset: '2014',
        library,
      });
      reopened = await createConnectedTravelBoard({ library, scene: decoded });
      expect(reopened.placedTokens).toHaveLength(1);
      expect(reopened.token3DAdapter.getStablePlacement(reopened.placedTokens[0])).toEqual(pose);
      expect(reopened.characterServices.combat.turn).toBe(turn);
      expect(
        reopened.characterServices.combat.status(reopened.placedTokens[0]).movement.spent
      ).toBe(spent);
    } finally {
      if (reopened) disposeConnectedTravelBoard(reopened);
      dispose(context);
    }
  },
  60000
);

test('a real animated creature enters a built house, uses both staircases, crosses its top window and reopens without refreshing its turn', async () => {
  const context = await fixture();
  const { gm, actor, adapter, library, session } = context;
  let reopened;
  try {
    const observer = gm.campaignWorld.createView({ mapId: 'map-main' });
    session.startTurn(actor);
    session.adjustMovement(actor, 200);
    const turn = session.turn,
      hp = library.get(actor.characterSheetId).hp;
    const entry = gm.campaignWorld.getConnections().find((c) => c.building?.kind === 'entry');
    await completeConnectionTravel(gm, actor, entry.id);
    expect(session.status(actor).movement.spent).toBe(5);
    for (let floor = 0; floor < 2; floor++) {
      const move = adapter.requestMoveToGrid(actor, 0, 1);
      expect(move?.cost).toBeGreaterThan(0);
      await finishMotion(context);
      const stairs = gm.campaignWorld
        .getConnections()
        .find((c) => c.building?.kind === 'stairs' && c.building.floor === floor);
      const before = session.status(actor).movement.spent;
      await completeConnectionTravel(gm, actor, stairs.id);
      expect(session.status(actor).movement.spent - before).toBe(35);
      expect(gm.campaignWorld.getMap(actor.mapId).building.floor).toBe(floor + 1);
      expect(gm.campaignWorld.toCampaignPosition(actor.mapId, actor.world).y).toBe(
        (floor + 1) * 10
      );
    }
    expect(adapter.requestMoveToGrid(actor, 3, 4)?.cost).toBeGreaterThan(0);
    await finishMotion(context);
    const window = gm.campaignWorld
      .getConnections()
      .find((c) => c.building?.floor === 2 && c.building.featureId === 'window-f2-south-1');
    const before = session.status(actor).movement.spent,
      floorId = actor.mapId;
    const clips = new Set();
    await completeConnectionTravel(gm, actor, window.id, {}, () => {
      if (adapter._movementStates.get(actor)?.openingCrossing) {
        expect(gm.campaignMapId).toBe('map-main');
        clips.add(adapter._tokenAnimationData.get(actor).current);
      }
    });
    expect(clips.has('climbShort')).toBe(true);
    expect(actor.mapId).toBe('map-main');
    expect(adapter.isWallAttached(actor)).toBe(true);
    expect(session.status(actor).movement.spent - before).toBe(10);
    await completeConnectionTravel(gm, actor, window.id);
    expect(actor.mapId).toBe(floorId);
    expect(gm.campaignMapId).toBe(floorId);
    expect(observer.mapId).toBe('map-main');
    expect(session.status(actor).movement.spent - before).toBe(15);
    expect(session.turn).toBe(turn);
    expect(library.get(actor.characterSheetId).hp).toEqual(hp);
    const saved = await captureCampaignScene(gm, library, { combat: session });
    const decoded = decodeScene(encodeScene(saved, { ruleset: '2014', library }), {
      ruleset: '2014',
      library,
    });
    const spent = session.status(actor).movement.spent;
    reopened = await createConnectedTravelBoard({ library, scene: decoded });
    const restored = reopened.placedTokens[0];
    expect(restored.mapId).toBe(floorId);
    expect(restored.world).toEqual(actor.world);
    expect(reopened.campaignWorld.listMaps()).toHaveLength(4);
    expect(reopened.characterServices.combat.status(restored).movement.spent).toBe(spent);
    expect(reopened.characterServices.combat.turn).toBe(turn);
  } finally {
    if (reopened) disposeConnectedTravelBoard(reopened);
    dispose(context);
  }
}, 60000);

test('a real creature exits a multi-storey window onto its upper slab grip, saves there and climbs back in', async () => {
  const context = await fixture(
    (c) => c.building?.featureId === 'window-giant' && c.building.floor === 2,
    {
      windows: [
        { id: 'giant', floor: 0, side: 'east', u: 0.5, widthFeet: 15, heightFeet: 25, sillFeet: 2 },
      ],
    }
  );
  const { gm, actor, adapter, session, library } = context;
  try {
    session.startTurn(actor);
    const floorId = actor.mapId,
      turn = session.turn;
    const connection = gm.campaignWorld
      .getConnections()
      .find((c) => c.building?.featureId === 'window-giant' && c.building.floor === 2);
    let frames = 0;
    await completeConnectionTravel(gm, actor, connection.id, {}, () => {
      if (adapter._movementStates.get(actor)?.openingCrossing) frames++;
    });
    expect(frames).toBeGreaterThan(20);
    expect(actor.mapId).toBe('map-main');
    expect(actor.world.y).toBe(3);
    const stable = adapter.getStablePlacement(actor);
    expect(stable.pose).toMatchObject({ kind: 'grip', grip: { mapId: floorId } });
    let skin;
    adapter.getTokenVisual(actor).traverse((child) => {
      if (child.isSkinnedMesh && !skin) skin = child;
    });
    const hands = skin.skeleton.bones.filter((bone) => /(LeftHand|RightHand)$/.test(bone.name));
    expect(hands).toHaveLength(2);
    const handY =
      hands.reduce((total, bone) => total + bone.getWorldPosition(new three.Vector3()).y, 0) /
      hands.length;
    expect(handY).toBeCloseTo(4, 1);
    const saved = await captureCampaignScene(gm, library);
    const decoded = decodeScene(encodeScene(saved, { ruleset: '2014', library }), {
      ruleset: '2014',
      library,
    });
    expect(decoded.creatures[0].pose.grip.mapId).toBe(floorId);
    await completeConnectionTravel(gm, actor, connection.id);
    expect(actor.mapId).toBe(floorId);
    expect(actor.world.y).toBe(0);
    expect(session.status(actor).movement.spent).toBe(10);
    expect(session.turn).toBe(turn);
    expect(library.get(actor.characterSheetId).hp.current).toBe(40);
  } finally {
    dispose(context);
  }
}, 60000);

test('small windows expose an explicit clearance denial without reserving or spending movement', async () => {
  const context = await fixture((c) => c.building?.featureId === 'window-small', {
    windows: [
      { id: 'small', floor: 2, side: 'east', u: 0.5, widthFeet: 0.5, heightFeet: 1, sillFeet: 2 },
    ],
  });
  const { gm, actor, session } = context;
  try {
    session.startTurn(actor);
    const connection = gm.campaignWorld
      .getConnections()
      .find((c) => c.building?.featureId === 'window-small');
    expect(getConnectionTravelOption(gm, actor, connection.id)).toMatchObject({
      allowed: false,
      reason: expect.stringMatching(/too small|clearance/i),
    });
    expect(session.moves.size).toBe(0);
    expect(session.status(actor).movement.spent).toBe(0);
  } finally {
    dispose(context);
  }
}, 60000);

test('the resized balcony extension is a real walkable support beyond the old deck edge', async () => {
  const context = await fixture((c) => c.building?.kind === 'balcony', {
    balconies: [{ id: 'lookout', floor: 1, side: 'south', u: 0.5, widthFeet: 15, depthFeet: 10 }],
  });
  const { gm, actor, adapter, session, library } = context;
  try {
    session.startTurn(actor);
    const connection = gm.campaignWorld
      .getConnections()
      .find((c) => c.building?.kind === 'balcony');
    await completeConnectionTravel(gm, actor, connection.id);
    expect(adapter.requestMoveToGrid(actor, 12, 16)?.cost).toBe(5);
    await finishMotion(context);
    expect(actor.world).toEqual({ x: 12.5, y: 2, z: 16.5 });
    expect(adapter.getStablePlacement(actor).pose.surfaceId).toBe('house-balcony-lookout-deck');
    expect(session.status(actor).movement.spent).toBe(10);
    expect(library.get(actor.characterSheetId).hp.current).toBe(40);
  } finally {
    dispose(context);
  }
}, 60000);

test('a real creature walks through a built balcony door onto its supported deck and back', async () => {
  const context = await fixture((c) => c.building?.kind === 'balcony');
  const { gm, actor, adapter, session } = context;
  try {
    session.startTurn(actor);
    const floorId = actor.mapId;
    const balcony = gm.campaignWorld.getConnections().find((c) => c.building?.kind === 'balcony');
    await completeConnectionTravel(gm, actor, balcony.id);
    expect(actor.mapId).toBe('map-main');
    expect(actor.world.y).toBe(2);
    expect(adapter.getStablePlacement(actor).pose).toMatchObject({
      kind: 'ground',
      surfaceId: 'house-balcony-lookout-deck',
    });
    expect(session.status(actor).movement.spent).toBe(5);
    await completeConnectionTravel(gm, actor, balcony.id);
    expect(actor.mapId).toBe(floorId);
    expect(session.status(actor).movement.spent).toBe(10);
  } finally {
    dispose(context);
  }
}, 60000);

test.each([
  ['south-1', 'balcony', 10, 0],
  ['east-0', 'ground', 0, 4],
])(
  'dropping from a built top-floor %s window lands on %s and damages only the actual fall',
  async (feature, _label, landingFeet, damage) => {
    const context = await fixture((c) => c.building?.featureId === `window-f2-${feature}`);
    const { gm, actor, adapter, library, session } = context;
    const roll = dice.rollDiceExpression;
    const spy = jest
      .spyOn(dice, 'rollDiceExpression')
      .mockImplementation((request) => roll(request, { random: () => 0.5 }));
    try {
      session.startTurn(actor);
      const window = gm.campaignWorld
        .getConnections()
        .find((c) => c.building?.featureId === `window-f2-${feature}`);
      await completeConnectionTravel(gm, actor, window.id);
      const heightFeet = actor.world.y * 5,
        spent = session.status(actor).movement.spent;
      await completeConnectionTravel(gm, actor, window.id, { action: 'drop' });
      await finishMotion(context);
      expect(adapter.isWallAttached(actor)).toBe(false);
      expect(actor.world.y).toBe(landingFeet / 5);
      expect(library.get(actor.characterSheetId)).toMatchObject({
        hp: { current: 40 - damage },
        conditions: damage ? ['prone'] : [],
        lastFall: { damage },
      });
      expect(library.get(actor.characterSheetId).lastFall.distanceFeet).toBeCloseTo(
        heightFeet - landingFeet
      );
      expect(session.status(actor).movement.spent).toBe(spent);
    } finally {
      spy.mockRestore();
      dispose(context);
    }
  },
  60000
);

test('a real flyer lands on a pitched built roof, walks its valid slope and takes off again', async () => {
  const context = await fixture(null, { roofRiseFeet: 3 });
  const { gm, actor, adapter, library, session } = context;
  let removeTerrain, canvas;
  try {
    await library.edit(actor.characterSheetId, { fallTraits: { flySpeed: 60 } });
    await adapter.restoreStablePlacement(actor, {
      gridX: 12,
      gridY: 13,
      facingAngle: 0,
      pose: { kind: 'flight', world: { x: 12.5, y: 8, z: 13.5 } },
    });
    session.startTurn(actor);
    await adapter.applyFlightCommand(actor, 'drop');
    await finishMotion(context);
    expect(actor.world.y).toBeCloseTo(6.36);
    removeTerrain = addPhysicalTerrain(gm);
    canvas = addPointerView(
      gm,
      new three.Vector3(12.5, 6.6, 12.5),
      new three.Vector3(12.5, 12, 17)
    );
    const picked = gm.pickingService.pickGroundSync(400, 300, canvas);
    expect(picked.surface.kind).toBe('floor');
    expect(picked.surface.normal.y).toBeGreaterThan(0.95);
    expect(picked.surface.normal.y).toBeLessThan(0.99);
    expect(adapter.requestMoveToSurface(actor, picked.surface)?.cost).toBe(5);
    await finishMotion(context);
    expect(actor.world.y).toBeCloseTo(6.6);
    await adapter.applyFlightCommand(actor, 'takeoff');
    await finishMotion(context);
    expect(actor.flightActive).toBe(true);
    expect(actor.world.y).toBeCloseTo(7.6);
    expect(session.status(actor).movement.spent).toBe(10);
    expect(library.get(actor.characterSheetId).hp.current).toBe(40);
  } finally {
    removeTerrain?.();
    canvas?.remove();
    dispose(context);
  }
}, 60000);

test.each(['ladder', 'stairs'])(
  'cellar %s travel spends real movement, preserves the turn and reopens underground',
  async (kind) => {
    const context = await fixture((c) => c.building?.kind === 'access', {
      prepare: (engine) => {
        const house = engine.geometry.getStructures()[0];
        engine.resizeStructure('house', { building: { ...house.building, stairs: false } });
        engine.placeStructure({
          id: 'cellar',
          kind: 'cellar',
          xFeet: 62.5,
          zFeet: 62.5,
          lengthFeet: 60,
          widthFeet: 50,
          heightFeet: 20,
          building: {
            access: {
              kind,
              structureId: 'house',
              xFeet: kind === 'stairs' ? -7.5 : 0,
              zFeet: kind === 'stairs' ? 2.5 : 0,
            },
          },
        });
      },
    });
    const { gm, actor, adapter, session, library } = context;
    let reopened;
    try {
      session.startTurn(actor);
      session.adjustMovement(actor, 100);
      const connection = gm.campaignWorld
        .getConnections()
        .find((c) => c.building?.kind === 'access');
      const turn = session.turn,
        clips = new Set(),
        positions = [];
      await completeConnectionTravel(gm, actor, connection.id, {}, () => {
        if (adapter._movementStates.get(actor)?.openingCrossing) {
          clips.add(adapter._tokenAnimationData.get(actor).current);
          positions.push(actor.world.y);
        }
      });
      expect(gm.campaignWorld.getMap(actor.mapId).originFeet.y).toBe(-10);
      expect(actor.world.y).toBe(0);
      expect(session.status(actor).movement.spent).toBe(kind === 'ladder' ? 25 : 35);
      if (kind === 'ladder') {
        expect(clips.has('climbWallDown')).toBe(true);
        expect(positions.length).toBeGreaterThan(30);
        expect(positions.some((y) => y > 0.1 && y < 1.9)).toBe(true);
      }
      const saved = await captureCampaignScene(gm, library);
      const decoded = decodeScene(encodeScene(saved, { ruleset: '2014', library }), {
        ruleset: '2014',
        library,
      });
      reopened = await createConnectedTravelBoard({ library, scene: decoded });
      expect(reopened.placedTokens[0].mapId).toBe(actor.mapId);
      expect(reopened.placedTokens[0].world).toEqual(actor.world);
      expect(reopened.characterServices.combat.turn).toBe(turn);
      const before = session.status(actor).movement.spent;
      await completeConnectionTravel(gm, actor, connection.id);
      expect(gm.campaignWorld.getMap(actor.mapId).building.structureId).toBe('house');
      expect(session.status(actor).movement.spent - before).toBe(kind === 'ladder' ? 25 : 35);
      expect(library.get(actor.characterSheetId).hp.current).toBe(40);
    } finally {
      if (reopened) disposeConnectedTravelBoard(reopened);
      dispose(context);
    }
  },
  60000
);

test('a real creature steps through a cut upper floor and falls to the actual lower floor', async () => {
  const context = await fixture((c) => c.building?.kind === 'balcony', {
    prepare: (engine) => {
      const house = engine.geometry.getStructures()[0],
        building = explicitBuilding(house);
      building.stairs = false;
      building.levels[1].openings.push({
        id: 'atrium',
        xFeet: 15,
        zFeet: 10,
        lengthFeet: 10,
        widthFeet: 10,
      });
      engine.resizeStructure('house', { building });
    },
  });
  const { gm, actor, adapter, session, library } = context,
    roll = dice.rollDiceExpression;
  const spy = jest
    .spyOn(dice, 'rollDiceExpression')
    .mockImplementation((request) => roll(request, { random: () => 0.5 }));
  const fallEntry = jest.spyOn(adapter, '_beginRuleFall');
  const errors = jest.spyOn(GameErrors, 'gameState');
  try {
    session.startTurn(actor);
    const request = adapter.requestMoveToGrid(actor, 3, 3);
    expect(request?.cost).toBe(5);
    expect(request.goal.world.y).toBe(-2);
    expect(adapter._movementStates.get(actor).surfaceMotion).toMatchObject({
      fall: true,
      start: { y: 0 },
      target: { y: -2 },
    });
    await finishMotion(context);
    expect(
      errors.mock.calls.map(([error, context]) => ({ message: error.message, context }))
    ).toEqual([]);
    expect(fallEntry).toHaveBeenCalledTimes(1);
    expect(gm.campaignWorld.getMap(actor.mapId).building.floor).toBe(0);
    expect(library.get(actor.characterSheetId)).toMatchObject({
      hp: { current: 36 },
      conditions: ['prone'],
      lastFall: { distanceFeet: 10, damage: 4 },
    });
    expect(session.status(actor).movement.spent).toBe(5);
    const saved = await captureCampaignScene(gm, library);
    expect(saved.creatures[0].mapId).toBe(actor.mapId);
  } finally {
    spy.mockRestore();
    errors.mockRestore();
    fallEntry.mockRestore();
    dispose(context);
  }
}, 60000);

test('a real creature walks the restored parallel flush stairs onto the castle-wall battlement', async () => {
  const context = await fixture(null, {
    prepare: (engine) =>
      engine.placeStructure({
        id: 'castle-wall',
        kind: 'wall',
        style: 'battlement',
        wallStairs: true,
        xFeet: 62.5,
        zFeet: 95,
        lengthFeet: 60,
        widthFeet: 10,
        heightFeet: 10,
      }),
  });
  const { gm, actor, adapter, session } = context;
  try {
    await adapter.restoreStablePlacement(actor, {
      gridX: 5,
      gridY: 17,
      facingAngle: 0,
      pose: { kind: 'ground', world: { x: 5.5, y: 0, z: 17.5 } },
    });
    session.startTurn(actor);
    session.adjustMovement(actor, 100);
    const result = adapter.requestMoveToSurface(actor, {
      kind: 'floor',
      surfaceId: 'castle-wall-wall',
      point: { x: 15.5, y: 2, z: 19.5 },
      normal: { x: 0, y: 1, z: 0 },
    });
    expect(result?.cost).toBeGreaterThan(40);
    await finishMotion(context);
    expect(actor.world).toEqual({ x: 15.5, y: 2, z: 19.5 });
    expect(session.status(actor).movement.spent).toBe(result.cost);
    await captureCampaignScene(gm, gm.characterServices.library);
  } finally {
    dispose(context);
  }
}, 60000);

test('a taller throne-room staircase reaches the retained upper level without granting free elevation', async () => {
  const context = await fixture((c) => c.kind === 'stairs' && c.building?.floor === 0, {
    startEnd: 0,
    prepare: (engine) => {
      const next = changeBuildingLevelHeight(engine.geometry.getStructures()[0], 0, 20);
      engine.resizeStructure('house', { heightFeet: next.heightFeet, building: next.building });
    },
  });
  const { gm, actor, session } = context;
  try {
    const connection = gm.campaignWorld
      .getConnections()
      .find((c) => c.kind === 'stairs' && c.building?.floor === 0);
    session.startTurn(actor);
    session.adjustMovement(actor, 100);
    await completeConnectionTravel(gm, actor, connection.id);
    expect(gm.campaignWorld.getMap(actor.mapId).originFeet.y).toBe(20);
    expect(session.status(actor).movement.spent).toBeGreaterThan(35);
  } finally {
    dispose(context);
  }
}, 60000);

test.each([
  ['near', 'forward', 0],
  ['far', 'reverse', Math.PI / 2],
])(
  'a real animated creature walks %s-side %s switchback battlement stairs and reopens at their actual height',
  async (side, direction, angle) => {
    const context = await fixture(null, {
      prepare: (engine) =>
        engine.placeStructure({
          id: 'switchback-wall',
          kind: 'wall',
          style: 'battlement',
          wallStairs: true,
          wallStairOffsetFeet: 5,
          wallStairSide: side,
          wallStairDirection: direction,
          xFeet: angle ? 100 : 62.5,
          zFeet: angle ? 62.5 : 100,
          lengthFeet: 60,
          widthFeet: 10,
          heightFeet: 20,
          angleRadians: angle,
        }),
    });
    const { gm, actor, adapter, session, library } = context;
    const errors = jest.spyOn(GameErrors, 'input');
    let reopened;
    try {
      const spec = gm.terrainEngine.geometry
          .getStructures()
          .find((s) => s.id === 'switchback-wall'),
        layout = wallStairLayout(spec);
      const entry = buildingLocalToFeet(spec, layout.entry),
        exit = buildingLocalToFeet(spec, layout.exit);
      await adapter.restoreStablePlacement(actor, {
        gridX: Math.floor(entry.x / 5),
        gridY: Math.floor(entry.z / 5),
        facingAngle: 0,
        pose: { kind: 'ground', world: { x: entry.x / 5, y: 0, z: entry.z / 5 } },
      });
      session.startTurn(actor);
      session.adjustMovement(actor, 300);
      const pureRange = buildSurfaceRange({
        geometry: gm.terrainEngine.geometry,
        start: {
          gridX: actor.gridX,
          gridY: actor.gridY,
          xFeet: entry.x,
          zFeet: entry.z,
          heightFeet: 0,
        },
        speedFeet: 300,
      });
      const liveRange = adapter.getTokenSurfaceRange(actor);
      expect({
        pureMax: Math.max(...[...pureRange.tiles.values()].map((p) => p.heightFeet)),
        liveMax: Math.max(...[...liveRange.tiles.values()].map((p) => p.heightFeet)),
        speed: liveRange.speed,
      }).toEqual({ pureMax: 20, liveMax: 20, speed: 300 });
      const support = gm.terrainEngine.geometry.findSupport(exit.x, exit.z, { belowFeet: 20.01 });
      const request = adapter.requestMoveToSurface(actor, {
        kind: 'floor',
        surfaceId: support.id,
        point: { x: exit.x / 5, y: 4, z: exit.z / 5 },
        normal: { x: 0, y: 1, z: 0 },
      });
      expect(errors.mock.calls.map(([error]) => error.message)).toEqual([]);
      expect(request?.cost).toBeGreaterThan(50);
      let walking = 0;
      for (let frame = 0; frame < 6000 && adapter.isMovementInProgress(actor); frame++) {
        stepHumanoid({ adapter, token: actor, mesh: adapter.getTokenVisual(actor) }, 1 / 60);
        if (adapter._movementStates.get(actor)?.phase === 'surface') walking++;
        gm.advanceFrame();
        await Promise.resolve();
        if (frame % 30 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      }
      expect(adapter.isMovementInProgress(actor)).toBe(false);
      expect(walking).toBeGreaterThan(30);
      expect(actor.world.y).toBe(4);
      expect(session.status(actor).movement.spent).toBe(request.cost);
      expect(library.get(actor.characterSheetId).hp.current).toBe(40);
      const scene = await captureCampaignScene(gm, library);
      const decoded = decodeScene(encodeScene(scene, { ruleset: '2014', library }), {
        ruleset: '2014',
        library,
      });
      reopened = await createConnectedTravelBoard({ library, scene: decoded });
      expect(reopened.placedTokens[0].world).toEqual(actor.world);
      expect(
        reopened.characterServices.combat.status(reopened.placedTokens[0]).movement.spent
      ).toBe(request.cost);
    } finally {
      errors.mockRestore();
      if (reopened) disposeConnectedTravelBoard(reopened);
      dispose(context);
    }
  },
  60000
);
