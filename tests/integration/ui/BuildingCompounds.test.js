import {
  createConnectedTravelBoard,
  disposeConnectedTravelBoard,
  completeConnectionTravel,
  addPhysicalTerrain,
  addPointerView,
} from '../../helpers/connectedTravelBoard.js';
import { createTwoFloorTravelScene } from '../../../src/campaigns/examples/ConnectedTravelExample.js';
import { TerrainEngineSceneAdapter } from '../../../src/scene/terrain/TerrainEngineSceneAdapter.js';
import { installHumanoidAssetFiles, stepHumanoid } from '../../helpers/humanoid-fixture.js';
import {
  captureCampaignScene,
  restoreCampaignScene,
  changeCampaignView,
} from '../../../src/campaigns/SceneWorld.js';
import { encodeScene, decodeScene } from '../../../src/campaigns/CampaignScene.js';
import { unlinkBuildingInteriors } from '../../../src/campaigns/CampaignConstruction.js';
import { TerrainConstructionPanel } from '../../../src/ui/TerrainConstructionPanel.js';
import * as three from 'three';
import {
  createInteriorCutaway,
  getBuildingFloorRenderContext,
} from '../../../src/scene/terrain/InteriorCutaway.js';
import { getBuildingFloorAppearance } from '../../../src/scene/terrain/TerrainMaterialFactory.js';
import { openTraversalDoors } from '../../helpers/openTraversalDoors.js';

let restoreFiles;
beforeAll(() => {
  restoreFiles = installHumanoidAssetFiles();
});
afterAll(() => restoreFiles());

async function fixture(
  position = { x: 0.5, y: 0, z: 0.5 },
  {
    gridSize = 40,
    rooms = true,
    roomBuilding = { version: 2, roof: 'flat', stairs: false, autoWindows: false },
  } = {}
) {
  const gm = await createConnectedTravelBoard({
    sceneFactory: (options) => {
      const scene = createTwoFloorTravelScene(options),
        owner = scene.maps[0];
      scene.maps = [owner];
      scene.connections = [];
      scene.creatures = scene.creatures.slice(0, 1);
      owner.grid = { cols: gridSize, rows: gridSize, tileWorldSize: 1 };
      owner.terrain.heights = Array.from({ length: gridSize }, () => Array(gridSize).fill(0));
      owner.terrain.worldElevationUnit = 0.5;
      owner.terrain.treeDensity = 0;
      delete owner.terrain.geometry;
      Object.assign(scene.creatures[0], {
        mapId: owner.id,
        gridX: Math.floor(position.x),
        gridY: Math.floor(position.z),
        pose: { kind: 'ground', world: { ...position } },
      });
      scene.view.mapId = owner.id;
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
    if (rooms)
      for (const spec of [
        { id: 'keep', xFeet: 40, lengthFeet: 40 },
        { id: 'wing', xFeet: 90, lengthFeet: 30 },
      ])
        gm.terrainEngine.placeStructure({
          ...spec,
          kind: 'building',
          zFeet: 40,
          widthFeet: 30,
          heightFeet: 10,
          building: roomBuilding,
        });
    return { gm, editor };
  } catch (error) {
    editor?.detach();
    disposeConnectedTravelBoard(gm);
    throw error;
  }
}

test('a committed snap creates a canonical traversable opening without moving or replacing the character', async () => {
  const { gm, editor } = await fixture();
  try {
    const token = gm.placedTokens[0],
      placement = gm.token3DAdapter.getStablePlacement(token),
      character = gm.characterServices.library.get(token.characterSheetId),
      floorIds = gm.campaignWorld
        .save()
        .maps.filter((map) => map.building)
        .map((map) => map.id);
    expect(floorIds.length).toBeGreaterThanOrEqual(2);
    const preview = gm.terrainEngine.previewStructureSnap(
      'wing',
      { xFeet: 82.5, zFeet: 40 },
      { targetId: 'keep' }
    );
    expect(gm.terrainEngine.commitStructureSnap(preview)).toBe(true);
    const opening = gm.campaignWorld.getConnections().find((entry) => entry.kind === 'opening');
    expect(opening).toBeDefined();
    const end = opening.ends[0],
      map = gm.campaignWorld.getMap(end.mapId),
      unit = map.grid.tileWorldSize / 5;
    const plan = gm.campaignWorld.planConnection(opening.id, end.mapId, {
      x: end.positionFeet.x * unit,
      y: end.positionFeet.y * unit,
      z: end.positionFeet.z * unit,
    });
    expect(plan.costFeet).toBe(5);
    expect(
      gm.campaignWorld
        .save()
        .maps.filter((entry) => entry.building)
        .map((entry) => entry.id)
    ).toEqual(floorIds);
    expect(gm.token3DAdapter.getStablePlacement(token)).toEqual(placement);
    expect(gm.characterServices.library.get(token.characterSheetId)).toEqual(character);
  } finally {
    editor.detach();
    disposeConnectedTravelBoard(gm);
  }
});

test.each([
  [50, 7],
  [60, 42],
])(
  'a normal %i-square castle entrance opens its real interior with visible exterior context',
  async (gridSize, seed) => {
    const { gm, editor } = await fixture({ x: 0.5, y: 0, z: 0.5 }, { gridSize, rooms: false });
    try {
      gm.terrainEngine.generateBiomeElevation('castle', { seed });
      openTraversalDoors(gm.campaignWorld);
      const library = gm.characterServices.library,
        ownerId = gm.campaignMapId,
        keep = gm.terrainEngine.geometry
          .getStructures()
          .find((spec) => spec.name.endsWith('High Keep')),
        entrance = gm.campaignWorld
          .getConnections()
          .find(
            (connection) =>
              connection.building?.structureId === keep.id && connection.building.kind === 'entry'
          ),
        outside = entrance.ends.find((end) => end.mapId === ownerId),
        scale = gm.campaignWorld.getMap(ownerId).grid.tileWorldSize / 5,
        start = {
          x: outside.positionFeet.x * scale,
          y: outside.positionFeet.y * scale,
          z: outside.positionFeet.z * scale,
        },
        plan = gm.campaignWorld.planConnection(entrance.id, ownerId, start),
        scene = await captureCampaignScene(gm, library),
        witness = library.get(await library.create('Exterior witness')),
        original = { ...scene.creatures[0] };
      Object.assign(scene.creatures[0], {
        mapId: plan.targetMapId,
        gridX: Math.floor(plan.targetWorld.x),
        gridY: Math.floor(plan.targetWorld.z),
        pose: { kind: 'ground', world: plan.targetWorld },
      });
      scene.creatures.push({
        ...original,
        id: 'token-2',
        instanceNumber: 2,
        characterId: witness.id,
        name: witness.name,
        mapId: ownerId,
        gridX: Math.floor(start.x),
        gridY: Math.floor(start.z),
        pose: { kind: 'ground', world: start },
      });
      scene.tokenCounters.nextId = 2;
      scene.tokenCounters.types[0][1] = 2;
      scene.view.mapId = plan.targetMapId;
      scene.view.focusTokenId = 'token-1';
      scene.view.camera.target = plan.targetWorld;
      const before = scene.maps.find((map) => map.id === ownerId).terrain.geometry;
      await restoreCampaignScene(gm, scene, library, gm.characterServices.combat);
      const [inside, exterior] = gm.placedTokens;
      expect(gm.campaignMapId).toBe(plan.targetMapId);
      expect(gm.token3DAdapter.isTokenProjectionVisible(exterior)).toBe(true);
      expect(gm.campaignWorld.getMap(ownerId).terrain.geometry).toEqual(before);
      expect(gm.placedTokens).toEqual([inside, exterior]);
    } finally {
      editor.detach();
      disposeConnectedTravelBoard(gm);
    }
  }
);

test('a snap preview compiles immutable member-floor topology and connections without applying saved world changes', async () => {
  const { gm, editor } = await fixture();
  try {
    const beforeGeometry = gm.terrainEngine.save(),
      beforeWorld = gm.campaignWorld.save(),
      token = gm.placedTokens[0],
      placement = gm.token3DAdapter.getStablePlacement(token),
      character = gm.characterServices.library.get(token.characterSheetId),
      preview = gm.terrainEngine.previewStructureSnap(
        'wing',
        { xFeet: 82.5, zFeet: 40 },
        { targetId: 'keep' }
      );
    expect(preview.buildingContext.ownerMapId).toBe(gm.campaignMapId);
    for (const structureId of ['keep', 'wing']) {
      const existing = beforeWorld.maps.find(
        (map) => map.building?.structureId === structureId && map.building.floor === 0
      );
      expect(preview.buildingContext.maps.some((map) => map.id === existing.id)).toBe(true);
    }
    expect(
      preview.buildingContext.connections.some((connection) => connection.kind === 'opening')
    ).toBe(true);
    expect(Object.isFrozen(preview.buildingContext.maps[0].terrain.geometry)).toBe(true);
    expect(gm.terrainEngine.cancelStructureSnap(preview)).toBe(true);
    expect(gm.terrainEngine.save()).toEqual(beforeGeometry);
    expect(gm.campaignWorld.save()).toEqual(beforeWorld);
    expect(gm.token3DAdapter.getStablePlacement(token)).toEqual(placement);
    expect(gm.characterServices.library.get(token.characterSheetId)).toEqual(character);
  } finally {
    editor.detach();
    disposeConnectedTravelBoard(gm);
  }
});

test('one construction Undo and Redo restore the joined poses, interiors and connections without rewinding HP', async () => {
  const { gm, editor } = await fixture();
  try {
    const engine = gm.terrainEngine,
      token = gm.placedTokens[0],
      beforeGeometry = engine.save(),
      before = gm.campaignWorld.save(),
      placement = gm.token3DAdapter.getStablePlacement(token);
    const preview = engine.previewStructureSnap(
      'wing',
      { xFeet: 82.5, zFeet: 40 },
      { targetId: 'keep' }
    );
    await gm.characterServices.library.edit(token.characterSheetId, {
      hp: { max: 30, current: 23 },
    });
    engine.commitStructureSnap(preview);
    expect(gm.characterServices.library.get(token.characterSheetId).hp.current).toBe(23);
    const joinedGeometry = engine.save(),
      joined = gm.campaignWorld.save();
    await gm.characterServices.library.edit(token.characterSheetId, {
      hp: { max: 30, current: 17 },
    });

    expect(engine.undo()).toBe(true);
    expect(engine.save()).toEqual(beforeGeometry);
    expect(gm.campaignWorld.save().maps).toEqual(before.maps);
    expect(gm.campaignWorld.save().connections).toEqual(before.connections);
    expect(gm.token3DAdapter.getStablePlacement(token)).toEqual(placement);
    expect(gm.characterServices.library.get(token.characterSheetId).hp.current).toBe(17);

    expect(engine.redo()).toBe(true);
    expect(engine.save()).toEqual(joinedGeometry);
    expect(gm.campaignWorld.save().maps).toEqual(joined.maps);
    expect(gm.campaignWorld.save().connections).toEqual(joined.connections);
    expect(gm.token3DAdapter.getStablePlacement(token)).toEqual(placement);
    expect(gm.characterServices.library.get(token.characterSheetId).hp.current).toBe(17);
  } finally {
    editor.detach();
    disposeConnectedTravelBoard(gm);
  }
});

test('a joined building reopens with the same existing-format physical connection and floor identities', async () => {
  const { gm, editor } = await fixture();
  let reopened;
  try {
    const library = gm.characterServices.library;
    gm.terrainEngine.commitStructureSnap(
      gm.terrainEngine.previewStructureSnap(
        'wing',
        { xFeet: 82.5, zFeet: 40 },
        { targetId: 'keep' }
      )
    );
    const original = gm.campaignWorld
      .getConnections()
      .find((connection) => connection.kind === 'opening');
    const scene = await captureCampaignScene(gm, library);
    expect(scene.version).toBe(3);
    expect(scene.buildingAssemblies).toBe(1);
    const decoded = decodeScene(encodeScene(scene, { ruleset: '2014', library }), {
      ruleset: '2014',
      library,
    });
    reopened = await createConnectedTravelBoard({ library, scene: decoded });
    const opening = reopened.campaignWorld
      .getConnections()
      .find((connection) => connection.kind === 'opening');
    expect(opening).toEqual(original);
    expect(reopened.campaignWorld.save().maps.map((map) => map.id)).toEqual(
      scene.maps.map((map) => map.id)
    );
    const end = opening.ends[0],
      unit = reopened.campaignWorld.getMap(end.mapId).grid.tileWorldSize / 5;
    expect(
      reopened.campaignWorld.planConnection(opening.id, end.mapId, {
        x: end.positionFeet.x * unit,
        y: end.positionFeet.y * unit,
        z: end.positionFeet.z * unit,
      }).costFeet
    ).toBe(5);
  } finally {
    if (reopened) disposeConnectedTravelBoard(reopened);
    editor.detach();
    disposeConnectedTravelBoard(gm);
  }
});

test('a real animated character walks normally through the shared opening and pays the actual distance', async () => {
  const { gm, editor } = await fixture({ x: 7.5, y: 0, z: 8.5 });
  try {
    const token = gm.placedTokens[0],
      adapter = gm.token3DAdapter,
      before = gm.characterServices.library.get(token.characterSheetId);
    gm.terrainEngine.commitStructureSnap(
      gm.terrainEngine.previewStructureSnap(
        'wing',
        { xFeet: 82.5, zFeet: 40 },
        { targetId: 'keep' }
      )
    );
    delete gm.__threeTestDouble;
    adapter.releaseTokenVisual(token);
    await adapter.onTokenAdded(token);
    await token.__threeMeshPromise;
    await adapter.setSelectedToken(token);
    let skins = 0;
    token.__threeMesh.traverse((node) => {
      if (node.isSkinnedMesh) skins++;
    });
    expect(skins).toBeGreaterThan(0);
    gm.characterServices.combat.startTurn(token);
    const request = adapter.requestMoveToGrid(token, 13, 8);
    expect(request?.cost).toBe(30);
    let intermediate = false;
    for (let frame = 0; frame < 6000 && adapter.isMovementInProgress(token); frame++) {
      stepHumanoid({ adapter, token, mesh: token.__threeMesh }, 1 / 30);
      gm.advanceFrame();
      if (token.world.x > 7.6 && token.world.x < 13.4) intermediate = true;
      await Promise.resolve();
      if (frame % 30 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(intermediate).toBe(true);
    expect(adapter.isMovementInProgress(token)).toBe(false);
    expect(token.world.x).toBeCloseTo(13.5);
    expect(token.world.z).toBeCloseTo(8.5);
    expect(token.world.y).toBeCloseTo(0);
    expect(gm.characterServices.combat.status(token).movement.spent).toBe(30);
    expect(gm.characterServices.library.get(token.characterSheetId)).toEqual(before);
    const occupiedGeometry = gm.terrainEngine.save(),
      placement = adapter.getStablePlacement(token);
    expect(() => gm.terrainEngine.undo()).toThrow(/creature occupies/i);
    expect(gm.terrainEngine.save()).toEqual(occupiedGeometry);
    expect(adapter.getStablePlacement(token)).toEqual(placement);
    expect(gm.characterServices.combat.status(token).movement.spent).toBe(30);
    expect(gm.characterServices.library.get(token.characterSheetId)).toEqual(before);
  } finally {
    editor.detach();
    disposeConnectedTravelBoard(gm);
  }
});

test('a snap commit revalidates a floor occupied after preview without moving or changing its character', async () => {
  const { gm, editor } = await fixture();
  try {
    const library = gm.characterServices.library,
      saved = await captureCampaignScene(gm, library),
      wing = saved.maps.find(
        (map) => map.building?.structureId === 'wing' && map.building.floor === 0
      ),
      preview = gm.terrainEngine.previewStructureSnap(
        'wing',
        { xFeet: 82.5, zFeet: 40 },
        { targetId: 'keep' }
      );
    Object.assign(saved.creatures[0], {
      mapId: wing.id,
      gridX: 3,
      gridY: 3,
      pose: { kind: 'ground', world: { x: 3.5, y: 0, z: 3.5 } },
    });
    await restoreCampaignScene(gm, saved, library, gm.characterServices.combat);
    const engine = gm.terrainEngine,
      token = gm.placedTokens[0],
      geometry = engine.save(),
      scene = gm.campaignWorld.save(),
      placement = gm.token3DAdapter.getStablePlacement(token),
      character = gm.characterServices.library.get(token.characterSheetId);
    expect(() => engine.commitStructureSnap(preview)).toThrow(/creature occupies/i);
    expect(engine.save()).toEqual(geometry);
    expect(gm.campaignWorld.save()).toEqual(scene);
    expect(gm.token3DAdapter.getStablePlacement(token)).toEqual(placement);
    expect(gm.characterServices.library.get(token.characterSheetId)).toEqual(character);
  } finally {
    editor.detach();
    disposeConnectedTravelBoard(gm);
  }
});

test('a normal Castle main building has joined wings reachable through real shared-floor openings', async () => {
  const { gm, editor } = await fixture(undefined, { gridSize: 50, rooms: false });
  try {
    gm.terrainEngine.generateBiomeElevation('castle', { seed: 42 });
    const world = gm.campaignWorld,
      scene = world.save(),
      keep = gm.terrainEngine.geometry
        .getStructures()
        .find((spec) => spec.name.endsWith('High Keep')),
      main = scene.maps.find(
        (map) => map.building?.structureId === keep.id && map.building.floor === 0
      ),
      openings = world.getConnections().filter((connection) => connection.kind === 'opening');
    expect(
      openings.some((connection) => connection.ends.some((end) => end.mapId === main.id))
    ).toBe(true);
    const reached = new Set([main.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const connection of openings)
        if (connection.ends.some((end) => reached.has(end.mapId)))
          for (const end of connection.ends)
            if (!reached.has(end.mapId)) {
              reached.add(end.mapId);
              changed = true;
            }
    }
    expect(reached.size).toBeGreaterThanOrEqual(3);
    for (const connection of openings) {
      const end = connection.ends[0],
        unit = world.getMap(end.mapId).grid.tileWorldSize / 5;
      expect(
        world.planConnection(connection.id, end.mapId, {
          x: end.positionFeet.x * unit,
          y: end.positionFeet.y * unit,
          z: end.positionFeet.z * unit,
        }).costFeet
      ).toBeGreaterThan(0);
    }
  } finally {
    editor.detach();
    disposeConnectedTravelBoard(gm);
  }
});

test('a grand normal Castle has a connected hall and gatehouse around a supported open-sky courtyard', async () => {
  const { gm, editor } = await fixture(undefined, { gridSize: 50, rooms: false });
  try {
    gm.terrainEngine.generateBiomeElevation('castle', { seed: 42 });
    const world = gm.campaignWorld,
      scene = world.save(),
      specs = gm.terrainEngine.geometry.getStructures(),
      keep = specs.find((spec) => spec.name.endsWith('High Keep')),
      main = scene.maps.find(
        (map) => map.building?.structureId === keep.id && map.building.floor === 0
      ),
      edges = world
        .getConnections()
        .filter(
          (connection) =>
            connection.enabled !== false && ['opening', 'stairs'].includes(connection.kind)
        ),
      reached = new Set([main.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const edge of edges)
        if (edge.ends.some((end) => reached.has(end.mapId)))
          for (const end of edge.ends)
            if (!reached.has(end.mapId)) {
              reached.add(end.mapId);
              changed = true;
            }
    }
    const members = new Set(
      [...reached].map((id) => world.getMap(id).building?.structureId).filter(Boolean)
    );
    expect(members.size).toBeGreaterThanOrEqual(6);
    const gatehouse = specs.find((spec) => members.has(spec.id) && /gatehouse/i.test(spec.name));
    expect(gatehouse).toBeDefined();
    const z = (keep.zFeet + keep.widthFeet / 2 + gatehouse.zFeet - gatehouse.widthFeet / 2) / 2;
    const support = gm.terrainEngine.geometry.findSupport(keep.xFeet, z, {
      belowFeet: 1e-5,
      clearanceFeet: 6,
    });
    expect(support).toMatchObject({ heightFeet: 0, ceilingFeet: null });
  } finally {
    editor.detach();
    disposeConnectedTravelBoard(gm);
  }
});

test.each([
  [50, 1],
  [50, 7],
  [60, 42],
  [40, 123],
  [25, 42],
])(
  'normal Castle %i-square seed %i keeps its entrances, stairs and interior joins physically traversable',
  async (size, seed) => {
    const { gm, editor } = await fixture(undefined, { gridSize: size, rooms: false });
    try {
      gm.terrainEngine.generateBiomeElevation('castle', { seed });
      openTraversalDoors(gm.campaignWorld);
      const world = gm.campaignWorld;
      for (const connection of world
        .getConnections()
        .filter(
          (entry) => entry.kind === 'opening' || ['entry', 'stairs'].includes(entry.building?.kind)
        )) {
        const end = connection.ends[0],
          unit = world.getMap(end.mapId).grid.tileWorldSize / 5;
        let plan;
        try {
          plan = world.planConnection(connection.id, end.mapId, {
            x: end.positionFeet.x * unit,
            y: end.positionFeet.y * unit,
            z: end.positionFeet.z * unit,
          });
        } catch (error) {
          error.message = `${connection.name} ${connection.id}: ${error.message}`;
          throw error;
        }
        expect(plan.costFeet).toBeGreaterThan(0);
      }
    } finally {
      editor.detach();
      disposeConnectedTravelBoard(gm);
    }
  },
  60000
);

test('a locked normal Castle seed reproduces the same joined geometry, maps and connection identities', async () => {
  const { gm, editor } = await fixture(undefined, { gridSize: 50, rooms: false });
  try {
    gm.terrainEngine.generateBiomeElevation('castle', { seed: 7 });
    const geometry = gm.terrainEngine.save(),
      scene = gm.campaignWorld.save();
    gm.terrainEngine.generateBiomeElevation('castle', { seed: 7 });
    expect(gm.terrainEngine.save()).toEqual(geometry);
    const physicalMaps = (snapshot) =>
      snapshot.maps.map((map) => ({
        id: map.id,
        originFeet: map.originFeet,
        quarterTurns: map.quarterTurns,
        base: map.base,
        grid: map.grid,
        building: map.building,
        heights: map.terrain.heights,
        geometry: map.terrain.geometry,
        placeables: map.terrain.placeables,
      }));
    expect(physicalMaps(gm.campaignWorld.save())).toEqual(physicalMaps(scene));
    expect(gm.campaignWorld.save().connections).toEqual(scene.connections);
  } finally {
    editor.detach();
    disposeConnectedTravelBoard(gm);
  }
});

test('replacing an unoccupied generated Castle rebuilds only its generated joins and preserves the character', async () => {
  const { gm, editor } = await fixture(undefined, { gridSize: 50, rooms: false });
  try {
    gm.terrainEngine.generateBiomeElevation('castle', { seed: 7 });
    const token = gm.placedTokens[0],
      placement = gm.token3DAdapter.getStablePlacement(token),
      character = gm.characterServices.library.get(token.characterSheetId),
      oldIds = new Set(
        gm.campaignWorld
          .getConnections()
          .filter((entry) => entry.kind === 'opening')
          .map((entry) => entry.id)
      );
    gm.terrainEngine.generateBiomeElevation('castle', { seed: 42 });
    const scene = gm.campaignWorld.save(),
      openings = scene.connections.filter((entry) => entry.kind === 'opening');
    expect(openings.length).toBeGreaterThan(0);
    expect(openings.some((entry) => oldIds.has(entry.id))).toBe(false);
    for (const entry of openings) {
      const owner = scene.maps.find((map) => map.id === entry.feature.mapId);
      expect(
        entry.feature.volumeIds.every((id) =>
          owner.terrain.geometry.volumes.some((volume) => volume.id === id)
        )
      ).toBe(true);
    }
    expect(gm.token3DAdapter.getStablePlacement(token)).toEqual(placement);
    expect(gm.characterServices.library.get(token.characterSheetId)).toEqual(character);
  } finally {
    editor.detach();
    disposeConnectedTravelBoard(gm);
  }
});

test('disconnecting a member restores its shared walls without moving it and Undo restores the join', async () => {
  const { gm, editor } = await fixture();
  try {
    const engine = gm.terrainEngine,
      token = gm.placedTokens[0],
      placement = gm.token3DAdapter.getStablePlacement(token);
    engine.commitStructureSnap(
      engine.previewStructureSnap('wing', { xFeet: 82.5, zFeet: 40 }, { targetId: 'keep' })
    );
    const joined = gm.campaignWorld.save(),
      geometry = engine.save(),
      body = {
        min: { x: 57.5, y: 1e-5, z: 37.5 },
        max: { x: 62.5, y: 6, z: 42.5 },
      };
    expect(unlinkBuildingInteriors(gm, 'wing')).toBe(true);
    expect(engine.geometry.getStructures().find((spec) => spec.id === 'wing').xFeet).toBe(75);
    expect(engine.geometry.isSpaceClear(body)).toBe(false);
    expect(gm.campaignWorld.getConnections().some((entry) => entry.kind === 'opening')).toBe(false);
    expect(gm.token3DAdapter.getStablePlacement(token)).toEqual(placement);
    expect(engine.undo()).toBe(true);
    expect(engine.save()).toEqual(geometry);
    expect(gm.campaignWorld.save().connections).toEqual(joined.connections);
    expect(engine.geometry.isSpaceClear(body)).toBe(true);
  } finally {
    editor.detach();
    disposeConnectedTravelBoard(gm);
  }
});

test('a real character crosses a joined floor opening with one canonical identity and five feet of movement', async () => {
  const { gm, editor } = await fixture();
  try {
    gm.terrainEngine.commitStructureSnap(
      gm.terrainEngine.previewStructureSnap(
        'wing',
        { xFeet: 82.5, zFeet: 40 },
        { targetId: 'keep' }
      )
    );
    const library = gm.characterServices.library,
      scene = await captureCampaignScene(gm, library),
      opening = scene.connections.find((entry) => entry.kind === 'opening'),
      source = scene.maps.find((map) => map.id === opening.ends[0].mapId),
      unit = source.grid.tileWorldSize / 5,
      point = opening.ends[0].positionFeet,
      world = { x: point.x * unit, y: point.y * unit, z: point.z * unit };
    Object.assign(scene.creatures[0], {
      mapId: source.id,
      gridX: Math.floor(world.x),
      gridY: Math.floor(world.z),
      pose: { kind: 'ground', world },
    });
    scene.view.mapId = source.id;
    scene.view.camera.target = { ...world };
    await restoreCampaignScene(gm, scene, library, gm.characterServices.combat);
    const token = gm.placedTokens[0],
      adapter = gm.token3DAdapter,
      before = library.get(token.characterSheetId);
    delete gm.__threeTestDouble;
    adapter.releaseTokenVisual(token);
    await adapter.onTokenAdded(token);
    await token.__threeMeshPromise;
    await adapter.setSelectedToken(token);
    gm.characterServices.combat.startTurn(token);
    const turn = gm.characterServices.combat.turn;
    await completeConnectionTravel(gm, token, opening.id);
    expect(token.mapId).toBe(opening.ends[1].mapId);
    expect(gm.placedTokens).toHaveLength(1);
    expect(gm.characterServices.combat.status(token).movement.spent).toBe(5);
    expect(gm.characterServices.combat.turn).toBe(turn);
    expect(library.get(token.characterSheetId)).toEqual(before);
  } finally {
    editor.detach();
    disposeConnectedTravelBoard(gm);
  }
});

test('a default windowed building joins without retaining a false exterior entrance on its shared face', async () => {
  const { gm, editor } = await fixture(undefined, {
    roomBuilding: { version: 2, roof: 'battlement' },
  });
  try {
    gm.terrainEngine.resizeStructure('wing', { angleRadians: Math.PI / 2 });
    expect(
      gm.terrainEngine.commitStructureSnap(
        gm.terrainEngine.previewStructureSnap(
          'wing',
          { xFeet: 82.5, zFeet: 40 },
          { targetId: 'keep' }
        )
      )
    ).toBe(true);
    const world = gm.campaignWorld,
      wingFloor = world
        .save()
        .maps.find((map) => map.building?.structureId === 'wing' && map.building.floor === 0);
    expect(
      world
        .getConnections()
        .filter(
          (connection) =>
            connection.kind === 'door' &&
            connection.ends.some((end) => end.mapId === gm.campaignMapId) &&
            connection.ends.some((end) => end.mapId === wingFloor.id)
        )
    ).toHaveLength(0);
    expect(world.getConnections().some((connection) => connection.kind === 'opening')).toBe(true);
  } finally {
    editor.detach();
    disposeConnectedTravelBoard(gm);
  }
});

test('the public construction controls disconnect a selected member and allow editing without losing Undo', async () => {
  const { gm, editor } = await fixture();
  const root = document.createElement('section');
  document.body.append(root);
  let panel;
  let canvas;
  let disposeTerrain;
  try {
    gm.terrainEngine.commitStructureSnap(
      gm.terrainEngine.previewStructureSnap(
        'wing',
        { xFeet: 82.5, zFeet: 40 },
        { targetId: 'keep' }
      )
    );
    const joined = gm.terrainEngine.save(),
      connections = gm.campaignWorld.getConnections();
    gm.threeSceneManager.three = three;
    gm.threeSceneManager.scene = new three.Scene();
    canvas = addPointerView(gm, new three.Vector3(15, 0, 8), new three.Vector3(15, 35, 8));
    disposeTerrain = addPhysicalTerrain(gm);
    gm.terrainEngine.activate();
    panel = new TerrainConstructionPanel({ root, gameManager: gm });
    root.querySelector('[data-build-select]').click();
    for (const type of ['pointerdown', 'pointerup'])
      gm.getEventCanvas().dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: 400,
          clientY: 300,
        })
      );
    const disconnect = root.querySelector('[data-building-join-remove]');
    expect(disconnect.hidden).toBe(false);
    disconnect.click();
    expect(root.querySelector('[role="status"]').textContent).toMatch(/interiors disconnected/i);
    expect(gm.campaignWorld.getConnections().some((entry) => entry.kind === 'opening')).toBe(false);
    const height = root.querySelector('[name="heightFeet"]');
    expect(root.querySelector('[data-height-label]').textContent).toMatch(/storeys/i);
    height.value = '2';
    height.dispatchEvent(new Event('input', { bubbles: true }));
    root
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(
      gm.terrainEngine.geometry.getStructures().find((spec) => spec.id === 'wing').heightFeet
    ).toBe(20);
    expect(gm.terrainEngine.undo()).toBe(true);
    expect(gm.terrainEngine.undo()).toBe(true);
    expect(gm.terrainEngine.save()).toEqual(joined);
    expect(gm.campaignWorld.getConnections()).toEqual(connections);
  } finally {
    panel?.dispose();
    disposeTerrain?.();
    canvas?.remove();
    root.remove();
    editor.detach();
    disposeConnectedTravelBoard(gm);
  }
});

test('a joined floor cutaway displays both connected rooms without changing canonical roofs or walls', async () => {
  const { gm, editor } = await fixture();
  try {
    gm.terrainEngine.commitStructureSnap(
      gm.terrainEngine.previewStructureSnap(
        'wing',
        { xFeet: 82.5, zFeet: 40 },
        { targetId: 'keep' }
      )
    );
    const world = gm.campaignWorld,
      ownerId = gm.campaignMapId,
      floor = world
        .save()
        .maps.find((map) => map.building?.structureId === 'wing' && map.building.floor === 0);
    await changeCampaignView(gm, { mapId: floor.id });
    const owner = world.getMap(ownerId),
      geometry = world.getMapGeometry(ownerId),
      before = geometry.save(),
      cutaway = createInteriorCutaway(gm),
      cells = cutaway.query(geometry, owner, geometry.getPartition()).getSolidCells();
    expect(Math.min(...cells.map((cell) => cell.bounds.min.x))).toBeLessThan(25);
    expect(Math.max(...cells.map((cell) => cell.bounds.max.x))).toBeGreaterThan(85);
    expect(Math.max(...cells.map((cell) => cell.bounds.max.y))).toBeLessThanOrEqual(9.5);
    expect(geometry.save()).toEqual(before);
  } finally {
    editor.detach();
    disposeConnectedTravelBoard(gm);
  }
});

test('a transitive L-shaped interior cutaway excludes the empty corner of its enclosing box', async () => {
  const { gm, editor } = await fixture();
  try {
    const engine = gm.terrainEngine;
    engine.commitStructureSnap(
      engine.previewStructureSnap('wing', { xFeet: 82.5, zFeet: 40 }, { targetId: 'keep' })
    );
    engine.placeStructure({
      id: 'rear-wing',
      kind: 'building',
      xFeet: 75,
      zFeet: 90,
      lengthFeet: 30,
      widthFeet: 30,
      heightFeet: 10,
      building: { version: 2, roof: 'flat', stairs: false, autoWindows: false },
    });
    engine.addVolumes([
      {
        id: 'empty-corner-proof',
        layerId: 'castle',
        operation: 'add',
        source: 'manual',
        bounds: { min: { x: 38, y: 0, z: 68 }, max: { x: 42, y: 5, z: 72 } },
      },
    ]);
    engine.commitStructureSnap(
      engine.previewStructureSnap('rear-wing', { zFeet: 77.5 }, { targetId: 'wing' })
    );
    const world = gm.campaignWorld,
      ownerId = gm.campaignMapId,
      floor = world
        .save()
        .maps.find((map) => map.building?.structureId === 'rear-wing' && map.building.floor === 0);
    await changeCampaignView(gm, { mapId: floor.id });
    const owner = world.getMap(ownerId),
      geometry = world.getMapGeometry(ownerId),
      cells = createInteriorCutaway(gm)
        .query(geometry, owner, geometry.getPartition())
        .getSolidCells();
    expect(Math.min(...cells.map((cell) => cell.bounds.min.x))).toBeLessThan(25);
    expect(
      cells.some(
        ({ bounds }) =>
          bounds.min.x <= 40 &&
          bounds.max.x >= 40 &&
          bounds.min.z <= 70 &&
          bounds.max.z >= 70 &&
          bounds.max.y > 0
      )
    ).toBe(false);
    expect(geometry.findSupport(40, 70, { belowFeet: 6 }).heightFeet).toBe(5);
  } finally {
    editor.detach();
    disposeConnectedTravelBoard(gm);
  }
});

test('public floor materials consume the exact floorContext wire without a private building record', () => {
  const floorAppearance = { floorColor: 0x756957, floorMaterial: 'stone' };
  const publicWorld = {
    getMap: () => ({
      floorContext: {
        ownerMapId: 'public-owner',
        structureId: 'public-keep',
        offsetX: 0,
        offsetZ: 0,
        lengthFeet: 30,
        widthFeet: 20,
        levelId: 0,
        roomHeightFeet: 10,
      },
    }),
    getBuildingFloorRenderContext: () => ({
      ceilingFeet: 9.5,
      terrainThicknessFeet: 0.5,
      floorAppearance,
    }),
  };
  expect(getBuildingFloorAppearance(publicWorld, 'public-floor')).toEqual(floorAppearance);
  expect(getBuildingFloorRenderContext(publicWorld, 'public-floor')).toEqual({
    ceilingFeet: 9.5,
    terrainThicknessFeet: 0.5,
    floorAppearance,
  });
});

test('public floor readers reject a private building alias instead of accepting two wire formats', () => {
  const publicWorld = {
    getMap: () => ({
      building: { ownerMapId: 'private-owner', structureId: 'private-keep', floor: 0 },
    }),
    getBuildingFloorRenderContext: () => ({
      ceilingFeet: 9.5,
      terrainThicknessFeet: 0.5,
      floorAppearance: null,
    }),
  };
  expect(() => getBuildingFloorAppearance(publicWorld, 'public-floor')).toThrow(
    /floorContext, not private building/i
  );
});

test('the canonical floor-context export returns only resolved geometry/material data for public projection', async () => {
  const { gm, editor } = await fixture();
  try {
    const world = gm.campaignWorld,
      floor = world
        .save()
        .maps.find((map) => map.building?.structureId === 'keep' && map.building.floor === 0);
    expect(getBuildingFloorRenderContext(world, floor.id)).toEqual({
      ceilingFeet: 9.5,
      terrainThicknessFeet: 0.5,
      floorAppearance: null,
    });
    expect(getBuildingFloorRenderContext(world, gm.campaignMapId)).toBeNull();
  } finally {
    editor.detach();
    disposeConnectedTravelBoard(gm);
  }
});

test('joined public cutaways consume exact floorContext references and per-room ceilings without private records', async () => {
  const { gm, editor } = await fixture();
  let canonical = gm.campaignWorld;
  try {
    gm.terrainEngine.resizeStructure('wing', {
      heightFeet: 20,
      building: {
        ...gm.terrainEngine.geometry.getStructures().find((spec) => spec.id === 'wing').building,
        version: 3,
        roof: 'flat',
        levels: [{ id: 0, elevationFeet: 0, openings: [] }],
        nextLevelId: 1,
        stairs: false,
        autoWindows: false,
      },
    });
    gm.terrainEngine.commitStructureSnap(
      gm.terrainEngine.previewStructureSnap(
        'wing',
        { xFeet: 82.5, zFeet: 40 },
        { targetId: 'keep' }
      )
    );
    canonical = gm.campaignWorld;
    const ownerId = gm.campaignMapId,
      floor = canonical
        .save()
        .maps.find((map) => map.building?.structureId === 'wing' && map.building.floor === 0);
    await changeCampaignView(gm, { mapId: floor.id });
    canonical = gm.campaignWorld;
    gm.campaignWorld = {
      listLocationMaps: canonical.listLocationMaps.bind(canonical),
      getConnections: canonical.getConnections.bind(canonical),
      toMapPosition: canonical.toMapPosition.bind(canonical),
      toCampaignPosition: canonical.toCampaignPosition.bind(canonical),
      getMapGeometry: canonical.getMapGeometry.bind(canonical),
      getMap: (id) => {
        const map = canonical.getMap(id),
          { building, ...publicMap } = map,
          publicGeometry = {
            version: 2,
            volumes: map.terrain.geometry.volumes.map((volume) => {
              const publicVolume = { ...volume };
              delete publicVolume.structureId;
              delete publicVolume.source;
              return publicVolume;
            }),
          },
          render = building && getBuildingFloorRenderContext(canonical, id);
        return {
          ...publicMap,
          ...(building
            ? {
                floorContext: {
                  ownerMapId: building.ownerMapId,
                  structureId: building.structureId,
                  offsetX: building.offsetX,
                  offsetZ: building.offsetZ,
                  lengthFeet: building.lengthFeet,
                  widthFeet: building.widthFeet,
                  levelId: building.floor,
                  roomHeightFeet:
                    render.ceilingFeet === null
                      ? null
                      : render.ceilingFeet - map.originFeet.y + 0.5,
                },
              }
            : {}),
          terrain: { ...map.terrain, geometry: publicGeometry },
        };
      },
      getBuildingFloorRenderContext: (id) => getBuildingFloorRenderContext(canonical, id),
    };
    const geometry = canonical.getMapGeometry(ownerId),
      cells = createInteriorCutaway(gm)
        .query(geometry, canonical.getMap(ownerId), geometry.getPartition())
        .getSolidCells();
    const wingCells = cells.filter((cell) => cell.bounds.min.x >= 65),
      keepCells = cells.filter((cell) => cell.bounds.max.x <= 55);
    expect(wingCells.length).toBeGreaterThan(0);
    expect(keepCells.length).toBeGreaterThan(0);
    expect(Math.max(...wingCells.map((cell) => cell.bounds.max.y))).toBeCloseTo(19.5);
    expect(Math.max(...keepCells.map((cell) => cell.bounds.max.y))).toBeCloseTo(9.5);
    gm.campaignWorld.getBuildingFloorRenderContext = () => undefined;
    expect(() => createInteriorCutaway(gm)).toThrow(/render context is missing/i);
    expect(() => getBuildingFloorAppearance(gm.campaignWorld, floor.id)).toThrow(
      /floor appearance is missing/i
    );
  } finally {
    gm.campaignWorld = canonical;
    editor.detach();
    disposeConnectedTravelBoard(gm);
  }
});
