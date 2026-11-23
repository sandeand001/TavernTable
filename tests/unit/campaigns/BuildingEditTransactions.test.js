import CampaignWorld from '../../../src/campaigns/CampaignWorld.js';
import { restoreCampaignScene, captureCampaignScene } from '../../../src/campaigns/SceneWorld.js';
import { CharacterLibrary } from '../../../src/entities/characters/CharacterLibrary.js';
import { TerrainEngineSceneAdapter } from '../../../src/scene/terrain/TerrainEngineSceneAdapter.js';
import {
  generateCampaignBiome,
  replaceCampaignBiome,
} from '../../../src/campaigns/CampaignBiomeGeneration.js';
import { planCampaignBiomeReplacement } from '../../../src/campaigns/CampaignBiomePlan.js';
import { createCampaignBoard } from '../../helpers/campaignBoard.js';
import { sceneState } from '../../helpers/sceneState.js';
import GameManager from '../../../src/core/GameManager.js';
import { wallStairLayout } from '../../../src/terrain/WallStairs.js';
import {
  changeBuildingLevelHeight,
  removeBuildingLevel,
  explicitBuilding,
} from '../../../src/terrain/BuildingModel.js';
import { BoxGeometry, Mesh, MeshStandardMaterial } from 'three';
import { PlaceableMeshPool } from '../../../src/scene/terrain/PlaceableMeshPool.js';

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
  const constructionModel = new Mesh(
    new BoxGeometry(2, 2, 2),
    new MeshStandardMaterial({ name: 'MI_Plaster' })
  );
  const torchModel = new Mesh(
    new BoxGeometry(0.25, 0.9, 0.25),
    new MeshStandardMaterial({ name: 'Fire' })
  );
  torchModel.position.y = 0.45;
  gm.modelAssetCache = {
    getModel: jest.fn(async (key) =>
      key === 'source-dungeon-torch' ? torchModel.clone() : constructionModel.clone()
    ),
  };
  gm.ensureInstancing = () => {
    gm.placeableMeshPool ||= new PlaceableMeshPool({ gameManager: gm, publishMetrics: false });
    return gm.placeableMeshPool;
  };
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
    fixture.gm.placeableMeshPool?.dispose?.();
  }
  fixture = null;
});

test('generation on a fresh single board does not require connected-map state', async () => {
  localStorage.clear();
  const library = new CharacterLibrary({ ruleset: '2014', catalog: [], storage: localStorage });
  const gm = createCampaignBoard(library);
  gm.threeSceneManager.clearTerrainBrushPreview = jest.fn();
  const adapter = new TerrainEngineSceneAdapter({
    engine: gm.terrainEngine,
    gameManager: gm,
    threeSceneManager: gm.threeSceneManager,
  });
  adapter.attach();
  fixture = { gm, adapter, library };

  await expect(
    generateCampaignBiome(gm, { biomeKey: 'grassland', seed: 42, structures: false })
  ).resolves.toBe(true);
  expect(gm.terrainEngine.biomeKey).toBe('grassland');
  expect(gm.campaignWorld).toBeUndefined();
});

test('prepares a resized replacement without removing current tokens or changing the map', async () => {
  const { gm, library } = await board({ withCharacter: true });
  gm.terrainEngine.removeStructure('house');
  const terrain = gm.terrainEngine.save();
  const world = gm.campaignWorld.save();
  const token = gm.placedTokens[0];
  const character = library.get(token.characterSheetId);

  const prepared = await planCampaignBiomeReplacement(
    gm,
    { biomeKey: 'dungeon', seed: 42, densityMultiplier: 0 },
    { cols: 15, rows: 12 }
  );
  const target = prepared.scene.maps.find((map) => map.id === gm.campaignMapId);
  expect(target.grid).toEqual({ cols: 15, rows: 12, tileWorldSize: 1 });
  expect(target.terrain.biome).toBe('dungeon');
  expect(target.terrain.geometry.structures.length).toBeGreaterThan(0);
  expect(prepared.scene.creatures.some((creature) => creature.id === token.id)).toBe(false);
  expect(gm.terrainEngine.save()).toEqual(terrain);
  expect(gm.campaignWorld.save()).toEqual(world);
  expect(gm.placedTokens[0] === token).toBe(true);
  expect(library.get(token.characterSheetId)).toEqual(character);
});

test('a confirmed replacement applies the requested size and removes only active-map tokens', async () => {
  const { gm, library } = await board({ withCharacter: true });
  gm.terrainEngine.removeStructure('house');
  const token = gm.placedTokens[0];
  const characterId = token.characterSheetId;
  const character = library.get(characterId);
  library.saveScene = jest.fn(async (capture) => ({ captured: await capture(library) }));
  library.flush = jest.fn(async () => {});

  await expect(
    replaceCampaignBiome(
      gm,
      { biomeKey: 'dungeon', seed: 42, densityMultiplier: 0 },
      { cols: 15, rows: 12 }
    )
  ).resolves.toBe(true);
  expect([gm.cols, gm.rows]).toEqual([15, 12]);
  expect(gm.terrainEngine.biomeKey).toBe('dungeon');
  expect(gm.placedTokens).toHaveLength(0);
  expect(library.get(characterId)).toEqual(character);
  expect(library.saveScene).toHaveBeenCalledTimes(1);
});

test('a later generation expands the grid to the exact requested dimensions', async () => {
  const { gm, library } = await board();
  gm.terrainEngine.removeStructure('house');
  library.saveScene = jest.fn(async (capture) => ({ captured: await capture(library) }));
  library.flush = jest.fn(async () => {});
  await replaceCampaignBiome(
    gm,
    { biomeKey: 'dungeon', seed: 42, densityMultiplier: 0 },
    { cols: 15, rows: 12 }
  );
  await replaceCampaignBiome(
    gm,
    { biomeKey: 'grassland', seed: 7, densityMultiplier: 0, structures: false },
    { cols: 30, rows: 20 }
  );
  expect([gm.cols, gm.rows]).toEqual([30, 20]);
  expect(gm.terrainEngine.biomeKey).toBe('grassland');
  expect(gm.terrainEngine.geometry.getStructures()).toEqual([]);
  expect(gm.campaignWorld.getMap(gm.campaignMapId).grid).toMatchObject({ cols: 30, rows: 20 });
});

test('shrinking a map reframes an out-of-bounds camera and persists that view', async () => {
  const { gm, library } = await board();
  gm.terrainEngine.removeStructure('house');
  const camera = {
    ...gm.threeSceneManager.snapshotView(),
    target: { x: 23.5, y: 0, z: 20.5 },
  };
  gm.threeSceneManager.restoreView(camera);
  gm.campaignView.setCamera(camera);
  let saved;
  library.saveScene = jest.fn(async (capture) => {
    saved = await capture(library);
  });
  library.flush = jest.fn(async () => {});

  await replaceCampaignBiome(
    gm,
    { biomeKey: 'grassland', seed: 42, densityMultiplier: 0, structures: false },
    { cols: 10, rows: 8 }
  );
  const target = gm.threeSceneManager.snapshotView().target;
  expect(target.x).toBeGreaterThanOrEqual(0);
  expect(target.x).toBeLessThan(10);
  expect(target.z).toBeGreaterThanOrEqual(0);
  expect(target.z).toBeLessThan(8);
  expect(saved.scene.view.camera.target).toEqual(target);
  expect(
    saved.scene.view.cameras.find((entry) => entry.mapId === gm.campaignMapId).camera.target
  ).toEqual(target);
});

test('generation lifts the unfocused camera target to the new terrain surface', async () => {
  const { gm } = await board();
  for (const token of [...gm.placedTokens]) gm.tokenManager.removeToken(token);
  gm.terrainEngine.removeStructure('house');
  const camera = {
    ...gm.threeSceneManager.snapshotView(),
    target: { x: 12.5, y: 0, z: 12.5 },
  };
  gm.threeSceneManager.restoreView(camera);
  gm.campaignView.setCamera(camera);
  const prepared = await planCampaignBiomeReplacement(
    gm,
    { biomeKey: 'mountain', seed: 42, densityMultiplier: 0, structures: false },
    { cols: 25, rows: 25 }
  );
  const map = prepared.scene.maps.find((entry) => entry.id === gm.campaignMapId);
  const height = map.terrain.heights[12][12] * map.terrain.worldElevationUnit;
  expect(height).not.toBe(0);
  expect(prepared.scene.view.camera.target).toEqual({ x: 12.5, y: height, z: 12.5 });
});

test('regenerating at the same size clears authored structures and placed scenery', async () => {
  const { gm, library } = await board();
  for (const token of [...gm.placedTokens]) gm.tokenManager.removeToken(token);
  gm.terrainEngine.removeStructure('house');
  library.saveScene = jest.fn(async (capture) => ({ captured: await capture(library) }));
  library.flush = jest.fn(async () => {});
  const model = new Mesh(new BoxGeometry(0.5, 1, 0.5), new MeshStandardMaterial());
  model.position.y = 0.5;
  const originalGetModel = gm.modelAssetCache.getModel;
  gm.modelAssetCache = {
    getModel: jest.fn(async (key) =>
      key === 'source-dungeon-torch' ? originalGetModel(key) : model
    ),
  };
  const pool = gm.ensureInstancing();
  try {
    await replaceCampaignBiome(
      gm,
      { biomeKey: 'dungeon', seed: 42, densityMultiplier: 0 },
      { cols: 15, rows: 12 }
    );
    gm.terrainEngine.placeStructure({
      id: 'authored-wall',
      kind: 'wall',
      xFeet: 15,
      zFeet: 15,
      lengthFeet: 10,
      widthFeet: 2,
      heightFeet: 10,
    });
    await pool.addPlaceable({
      type: 'plant',
      modelKey: 'test-model',
      placeableId: 'mushroom-common',
      variantKey: 'mushroom-common',
      gridX: 2,
      gridY: 2,
    });
    expect(
      (await pool.snapshotPlacements()).filter(({ modelKey }) => modelKey === 'test-model')
    ).toHaveLength(1);

    await replaceCampaignBiome(
      gm,
      { biomeKey: 'grassland', seed: 7, densityMultiplier: 0, structures: false },
      { cols: 15, rows: 12 }
    );
    expect([gm.cols, gm.rows]).toEqual([15, 12]);
    expect(gm.terrainEngine.geometry.getStructures()).toEqual([]);
    expect(pool.getStats().instances).toBe(0);
  } finally {
    pool.dispose();
  }
});

test('a failed replacement restores the prior grid, token, character and combat', async () => {
  const { gm, library } = await board({ withCharacter: true });
  gm.terrainEngine.removeStructure('house');
  const token = gm.placedTokens[0];
  const characterId = token.characterSheetId;
  const character = library.get(characterId);
  gm.characterServices.combat.startTurn(token);
  const before = await captureCampaignScene(gm, library);
  library.saveScene = jest.fn(async (capture) => ({ captured: await capture(library) }));
  library.flush = jest.fn(async () => {});
  const resize = gm.resizeGrid;
  let fail = true;
  gm.resizeGrid = (cols, rows) => {
    resize(cols, rows);
    if (fail && cols === 15 && rows === 12) {
      fail = false;
      throw new Error('Injected resize failure');
    }
  };

  await expect(
    replaceCampaignBiome(
      gm,
      { biomeKey: 'dungeon', seed: 42, densityMultiplier: 0 },
      { cols: 15, rows: 12 }
    )
  ).rejects.toThrow('Injected resize failure');
  expect(await captureCampaignScene(gm, library)).toEqual(before);
  expect([gm.cols, gm.rows]).toEqual([25, 25]);
  expect(gm.placedTokens).toHaveLength(1);
  expect(library.get(characterId)).toEqual(character);
  expect(library.saveScene).not.toHaveBeenCalled();
  expect(gm.campaignMapFailure).toBeUndefined();
});

test('a failed cavern-network save restores the old scene without orphaned blank maps', async () => {
  const { gm, library } = await board({ withCharacter: true });
  gm.terrainEngine.removeStructure('house');
  const before = await captureCampaignScene(gm, library);
  library.saveScene = jest.fn(async () => {
    throw Object.assign(new Error('Storage unavailable'), { status: 400 });
  });
  library.flush = jest.fn(async () => {});
  library.campaign = { id: 'test-campaign' };
  library.sceneRevision = 1;
  library.savedScene = 'previous-scene';
  library.store = {
    readScene: jest.fn(async () => ({ revision: 1, scene: 'previous-scene' })),
  };
  await expect(
    replaceCampaignBiome(
      gm,
      {
        biomeKey: 'cavern',
        seed: 42,
        densityMultiplier: 0,
        cavernNetwork: { totalChambers: 3, outsideSides: [], outsideMode: 'separate' },
      },
      { cols: 25, rows: 25 }
    )
  ).rejects.toThrow('Storage unavailable');
  expect(await captureCampaignScene(gm, library)).toEqual(before);
  expect(gm.campaignWorld.listMaps()).toHaveLength(1);
  expect(gm.campaignWorld.getLogicalPassages()).toEqual([]);
  expect(gm.placedTokens).toHaveLength(1);
});

test('a failed replacement restores terrain undo and redo history', async () => {
  const { gm, library } = await board();
  gm.terrainEngine.removeStructure('house');
  gm.terrainEngine.setHeightAt(2, 2, 3);
  gm.terrainEngine.setHeightAt(3, 3, 4);
  expect(gm.terrainEngine.undo()).toBe(true);
  const before = gm.terrainEngine.save();
  library.saveScene = jest.fn(async () => {
    throw Object.assign(new Error('Storage unavailable'), { status: 400 });
  });
  library.flush = jest.fn(async () => {});
  library.campaign = { id: 'test-campaign' };
  library.sceneRevision = 1;
  library.savedScene = 'previous-scene';
  library.store = {
    readScene: jest.fn(async () => ({ revision: 1, scene: 'previous-scene' })),
  };

  await expect(
    replaceCampaignBiome(
      gm,
      { biomeKey: 'dungeon', seed: 42, densityMultiplier: 0 },
      { cols: 15, rows: 12 }
    )
  ).rejects.toThrow('Storage unavailable');
  expect(gm.terrainEngine.save()).toEqual(before);
  expect(gm.terrainEngine.canUndo).toBe(true);
  expect(gm.terrainEngine.canRedo).toBe(true);
  expect(gm.terrainEngine.redo()).toBe(true);
  expect(gm.terrainEngine.getHeightAt(3, 3)).toBe(4);
  expect(gm.terrainEngine.undo()).toBe(true);
  expect(gm.terrainEngine.undo()).toBe(true);
  expect(gm.terrainEngine.getHeightAt(2, 2)).toBe(0);
  expect(gm.terrainEngine.undo()).toBe(true);
  expect(gm.campaignWorld.listMaps()).toHaveLength(3);
  expect(gm.terrainEngine.redo()).toBe(true);
  expect(gm.campaignWorld.listMaps()).toHaveLength(1);
});

test('a failed replacement restores the focused and selected creature', async () => {
  const { gm, library } = await board({ withCharacter: true });
  gm.terrainEngine.removeStructure('house');
  const token = gm.placedTokens[0];
  await gm.token3DAdapter.setSelectedToken(token);
  gm.campaignView.focus(token.id);
  const before = await captureCampaignScene(gm, library);
  library.saveScene = jest.fn(async () => {
    throw Object.assign(new Error('Storage unavailable'), { status: 400 });
  });
  library.flush = jest.fn(async () => {});
  library.campaign = { id: 'test-campaign' };
  library.sceneRevision = 1;
  library.savedScene = 'previous-scene';
  library.store = {
    readScene: jest.fn(async () => ({ revision: 1, scene: 'previous-scene' })),
  };
  await expect(
    replaceCampaignBiome(
      gm,
      { biomeKey: 'dungeon', seed: 42, densityMultiplier: 0 },
      { cols: 15, rows: 12 }
    )
  ).rejects.toThrow('Storage unavailable');
  expect(gm.campaignView.focusTokenId).toBe(token.id);
  expect(gm.token3DAdapter.getSelectedToken()?.id).toBe(token.id);
  expect(await captureCampaignScene(gm, library)).toEqual(before);
});

test('a failed save restores the prior map and removed creature', async () => {
  const { gm, library } = await board({ withCharacter: true });
  gm.terrainEngine.removeStructure('house');
  const before = await captureCampaignScene(gm, library);
  library.saveScene = jest.fn(async () => {
    throw Object.assign(new Error('Storage unavailable'), { status: 400 });
  });
  library.flush = jest.fn(async () => {});
  library.campaign = { id: 'test-campaign' };
  library.sceneRevision = 1;
  library.savedScene = 'previous-scene';
  library.store = {
    readScene: jest.fn(async () => ({ revision: 1, scene: 'previous-scene' })),
  };

  await expect(
    replaceCampaignBiome(
      gm,
      { biomeKey: 'dungeon', seed: 42, densityMultiplier: 0 },
      { cols: 15, rows: 12 }
    )
  ).rejects.toThrow('Storage unavailable');
  expect(await captureCampaignScene(gm, library)).toEqual(before);
  expect(gm.placedTokens).toHaveLength(1);
});

test('an unverifiable save restores the local map and requires a reload', async () => {
  const { gm, library } = await board({ withCharacter: true });
  gm.terrainEngine.removeStructure('house');
  const before = gm.terrainEngine.save();
  library.saveScene = jest.fn(async () => {
    throw new Error('Save connection lost');
  });
  library.flush = jest.fn(async () => {});
  library.campaign = { id: 'test-campaign' };
  library.sceneRevision = 1;
  library.savedScene = 'previous-scene';
  library.store = {
    readScene: jest.fn(async () => {
      throw new Error('Cannot reach the host');
    }),
  };

  await expect(
    replaceCampaignBiome(
      gm,
      { biomeKey: 'dungeon', seed: 42, densityMultiplier: 0 },
      { cols: 15, rows: 12 }
    )
  ).rejects.toThrow(/could not be verified.*reload/i);
  expect(gm.terrainEngine.save()).toEqual(before);
  expect(gm.placedTokens).toHaveLength(1);
  expect(gm.campaignMapFailure).toBeInstanceOf(AggregateError);
});

test('a lost save response remains uncertain even if the old scene is still readable', async () => {
  const { gm, library } = await board({ withCharacter: true });
  gm.terrainEngine.removeStructure('house');
  const before = gm.terrainEngine.save();
  library.saveScene = jest.fn(async () => {
    throw new Error('Save connection lost');
  });
  library.flush = jest.fn(async () => {});
  library.campaign = { id: 'test-campaign' };
  library.sceneRevision = 1;
  library.savedScene = 'previous-scene';
  library.store = {
    readScene: jest.fn(async () => ({ revision: 1, scene: 'previous-scene' })),
  };
  await expect(
    replaceCampaignBiome(
      gm,
      { biomeKey: 'dungeon', seed: 42, densityMultiplier: 0 },
      { cols: 15, rows: 12 }
    )
  ).rejects.toThrow(/could not be verified.*reload/i);
  expect(gm.terrainEngine.save()).toEqual(before);
  expect(gm.campaignMapFailure).toBeInstanceOf(AggregateError);
});

test('a post-save refresh failure reports that the replacement was committed', async () => {
  const { gm, library } = await board();
  gm.terrainEngine.removeStructure('house');
  library.saveScene = jest.fn(async (capture) => ({ captured: await capture(library) }));
  library.flush = jest.fn(async () => {});
  let notifications = 0;
  gm.campaignRequests = {
    flush: () => {
      if (++notifications === 2) throw new Error('Refresh unavailable');
    },
  };
  await expect(
    replaceCampaignBiome(
      gm,
      { biomeKey: 'dungeon', seed: 42, densityMultiplier: 0 },
      { cols: 15, rows: 12 }
    )
  ).rejects.toThrow(/saved.*reload/i);
  expect(library.saveScene).toHaveBeenCalledTimes(1);
  expect(gm.campaignMapFailure).toBeInstanceOf(Error);
});

test('a replacement plan retains independent maps, remote creatures and active combat', async () => {
  const { gm, library } = await board({ withCharacter: true });
  gm.terrainEngine.removeStructure('house');
  const active = gm.placedTokens[0];
  const remoteMap = gm.campaignWorld.getMap(gm.campaignMapId);
  remoteMap.id = 'remote-map';
  remoteMap.name = 'Remote map';
  gm.campaignWorld.addLocation({ id: 'remote-location', name: 'Remote', map: remoteMap });
  const savedRemote = {
    ...sceneState().creatures[0],
    id: 'remote-token',
    mapId: 'remote-map',
  };
  const model = gm.tokenManager.createCreatureByType(savedRemote.type);
  gm.tokenManager.addTokenToCollection(
    model,
    savedRemote.gridX,
    savedRemote.gridY,
    savedRemote.type,
    null,
    savedRemote
  );
  const remote = gm.placedTokens.at(-1);
  await gm.token3DAdapter.restoreStablePlacement(remote, savedRemote);
  gm.characterServices.combat.startTurn(active);
  gm.characterServices.combat.effects = [
    {
      version: 1,
      id: 'effect-1',
      casterTokenId: active.id,
      characterId: active.characterSheetId,
      label: 'Shared effect',
      sourceId: 'effect-source',
      remainingTurns: 2,
      expiry: 'end',
      createdTurn: 0,
      lastTickTurn: 0,
      concentrationSpellId: null,
      kind: 'targets',
      targetTokenIds: [active.id, remote.id],
    },
  ];
  const before = await captureCampaignScene(gm, library);
  const character = library.get(active.characterSheetId);

  const prepared = await planCampaignBiomeReplacement(
    gm,
    { biomeKey: 'dungeon', seed: 42, densityMultiplier: 0 },
    { cols: 15, rows: 15 }
  );
  expect(prepared.scene.maps.find((map) => map.id === 'remote-map')).toEqual(
    before.maps.find((map) => map.id === 'remote-map')
  );
  expect(prepared.scene.creatures).toEqual(
    before.creatures.filter((entry) => entry.id === remote.id)
  );
  expect(prepared.scene.combat.active).toBe(true);
  expect(prepared.scene.combat.activeTokenId).toBeNull();
  expect(prepared.scene.combat.effects[0].targetTokenIds).toEqual([remote.id]);
  expect(gm.placedTokens).toHaveLength(2);
  expect(library.get(active.characterSheetId)).toEqual(character);
  library.saveScene = jest.fn(async (capture) => ({ captured: await capture(library) }));
  library.flush = jest.fn(async () => {});
  await expect(
    replaceCampaignBiome(
      gm,
      { biomeKey: 'dungeon', seed: 42, densityMultiplier: 0 },
      { cols: 15, rows: 15 }
    )
  ).resolves.toBe(true);
  expect(gm.placedTokens).toHaveLength(1);
  expect(gm.placedTokens[0] === remote).toBe(true);
  expect(remote.mapId).toBe('remote-map');
  expect(gm.campaignWorld.getMap('remote-map')).toEqual(
    before.maps.find((map) => map.id === 'remote-map')
  );
  expect(gm.characterServices.combat.effects[0].targetTokenIds).toEqual([remote.id]);
  expect(library.get(active.characterSheetId)).toEqual(character);
});

test('replacement planning rejects invalid grid sizes without changing the map', async () => {
  const { gm } = await board();
  const before = gm.terrainEngine.save();
  await expect(
    planCampaignBiomeReplacement(gm, { biomeKey: 'grassland', seed: 42 }, { cols: 4, rows: 25 })
  ).rejects.toThrow(/between 5 and 100/i);
  await expect(
    planCampaignBiomeReplacement(gm, { biomeKey: 'grassland', seed: 42 }, { cols: 25, rows: 101 })
  ).rejects.toThrow(/between 5 and 100/i);
  expect(gm.terrainEngine.save()).toEqual(before);
});

test('replacement planning refuses to remove linked building floors', async () => {
  const { gm } = await board();
  const before = gm.campaignWorld.save();
  const terrain = gm.terrainEngine.save();
  await expect(
    planCampaignBiomeReplacement(
      gm,
      { biomeKey: 'dungeon', seed: 42, densityMultiplier: 0 },
      { cols: 25, rows: 25 }
    )
  ).rejects.toThrow(/map|floor|preserv/i);
  expect(gm.campaignWorld.save()).toEqual(before);
  expect(gm.terrainEngine.save()).toEqual(terrain);
});

test('replacement planning preserves compatible linked floors and their connections', async () => {
  const { gm } = await board();
  for (const token of [...gm.placedTokens]) gm.tokenManager.removeToken(token);
  gm.terrainEngine.removeStructure('house');
  await generateCampaignBiome(gm, { biomeKey: 'town', seed: 42, structures: true });
  const before = gm.campaignWorld.save();
  before.maps.find((map) => map.building).name = 'Saved workshop';
  gm.campaignWorld.acceptCheckpoint(before);
  const prepared = await planCampaignBiomeReplacement(
    gm,
    { biomeKey: 'town', seed: 42, densityMultiplier: 0 },
    { cols: 25, rows: 25 }
  );
  expect(prepared.scene.maps.filter((map) => map.id !== gm.campaignMapId)).toEqual(
    before.maps.filter((map) => map.id !== gm.campaignMapId)
  );
  expect(prepared.scene.connections).toEqual(before.connections);
  expect(gm.campaignWorld.save()).toEqual(before);
});

test('a linked building floor can be regenerated without losing its stairs or other maps', async () => {
  const { gm, library } = await board();
  for (const token of [...gm.placedTokens]) gm.tokenManager.removeToken(token);
  const scene = gm.campaignWorld.save();
  const floor = scene.maps.find((map) => map.building?.floor === 0);
  scene.view.mapId = floor.id;
  scene.view.focusTokenId = null;
  await restoreCampaignScene(gm, scene, library, gm.characterServices.combat);
  const before = gm.campaignWorld.save();
  const prepared = await planCampaignBiomeReplacement(
    gm,
    { biomeKey: 'dungeon', seed: 42, densityMultiplier: 0, structures: false },
    { cols: floor.grid.cols, rows: floor.grid.rows }
  );
  const generated = prepared.scene.maps.find((map) => map.id === floor.id);
  expect(generated.terrain.biome).toBe('dungeon');
  expect(
    generated.terrain.geometry.volumes.filter((volume) => volume.id.includes(':auto:'))
  ).toEqual(
    before.maps
      .find((map) => map.id === floor.id)
      .terrain.geometry.volumes.filter((volume) => volume.id.includes(':auto:'))
  );
  expect(prepared.scene.maps.filter((map) => map.id !== floor.id)).toEqual(
    before.maps.filter((map) => map.id !== floor.id)
  );
  expect(prepared.scene.connections).toEqual(before.connections);
  expect(gm.campaignWorld.save()).toEqual(before);
  let saved;
  library.saveScene = jest.fn(async (capture) => {
    saved = await capture(library);
  });
  library.flush = jest.fn(async () => {});
  await replaceCampaignBiome(
    gm,
    { biomeKey: 'dungeon', seed: 42, densityMultiplier: 0, structures: false },
    { cols: floor.grid.cols, rows: floor.grid.rows }
  );
  expect(gm.terrainEngine.biomeKey).toBe('dungeon');
  await restoreCampaignScene(gm, saved.scene, library, gm.characterServices.combat);
  expect(gm.campaignWorld.getConnections()).toEqual(before.connections);
  const outside = gm.campaignWorld.save();
  outside.view.mapId = floor.building.ownerMapId;
  await restoreCampaignScene(gm, outside, library, gm.characterServices.combat);
  gm.terrainEngine.resizeStructure('house', { heightFeet: 30 });
  expect(gm.campaignWorld.getMap(floor.id).terrain.biome).toBe('dungeon');
});

test('a linked building floor can expand without extending its physical footprint', async () => {
  const { gm, library } = await board();
  for (const token of [...gm.placedTokens]) gm.tokenManager.removeToken(token);
  const scene = gm.campaignWorld.save();
  const floor = scene.maps.find((map) => map.building?.floor === 0);
  scene.view.mapId = floor.id;
  scene.view.focusTokenId = null;
  await restoreCampaignScene(gm, scene, library, gm.characterServices.combat);
  const before = gm.campaignWorld.save();
  const cols = floor.grid.cols + 3;
  const rows = floor.grid.rows + 3;
  const prepared = await planCampaignBiomeReplacement(
    gm,
    { biomeKey: 'dungeon', seed: 42, densityMultiplier: 0, structures: false },
    { cols, rows }
  );
  const expanded = prepared.scene.maps.find((map) => map.id === floor.id);
  expect(expanded.grid).toMatchObject({ cols, rows });
  expect(expanded.originFeet).toEqual(floor.originFeet);
  expect(prepared.scene.connections).toEqual(before.connections);
  expect(prepared.scene.maps.filter((map) => map.id !== floor.id)).toEqual(
    before.maps.filter((map) => map.id !== floor.id)
  );
  const world = CampaignWorld.fromScene(prepared.scene, { ruleset: library.ruleset, library });
  expect(world.getMapGeometry(floor.id).findSupport((cols - 0.5) * 5, (rows - 0.5) * 5)).toBeNull();
  expect(gm.campaignWorld.save()).toEqual(before);
  let saved;
  library.saveScene = jest.fn(async (capture) => {
    saved = await capture(library);
  });
  library.flush = jest.fn(async () => {});
  await replaceCampaignBiome(
    gm,
    { biomeKey: 'dungeon', seed: 42, densityMultiplier: 0, structures: false },
    { cols, rows }
  );
  await restoreCampaignScene(gm, saved.scene, library, gm.characterServices.combat);
  expect([gm.cols, gm.rows]).toEqual([cols, rows]);
  expect(gm.campaignWorld.getConnections()).toEqual(before.connections);
  await replaceCampaignBiome(
    gm,
    { biomeKey: 'dungeon', seed: 43, densityMultiplier: 0, structures: false },
    { cols: floor.grid.cols, rows: floor.grid.rows }
  );
  expect([gm.cols, gm.rows]).toEqual([floor.grid.cols, floor.grid.rows]);
  expect(gm.campaignWorld.getConnections()).toEqual(before.connections);
});

test('shrinking a linked floor below its building footprint is rejected without edits', async () => {
  const { gm, library } = await board();
  for (const token of [...gm.placedTokens]) gm.tokenManager.removeToken(token);
  const scene = gm.campaignWorld.save();
  const floor = scene.maps.find((map) => map.building?.floor === 0);
  scene.view.mapId = floor.id;
  scene.view.focusTokenId = null;
  await restoreCampaignScene(gm, scene, library, gm.characterServices.combat);
  const before = gm.campaignWorld.save();
  await expect(
    planCampaignBiomeReplacement(
      gm,
      { biomeKey: 'dungeon', seed: 42, densityMultiplier: 0, structures: false },
      { cols: floor.grid.cols - 1, rows: floor.grid.rows }
    )
  ).rejects.toThrow(/building.*footprint/i);
  expect(gm.campaignWorld.save()).toEqual(before);
});

test('a later building edit retains an independently sized floor grid', async () => {
  const { gm, library } = await board();
  for (const token of [...gm.placedTokens]) gm.tokenManager.removeToken(token);
  const scene = gm.campaignWorld.save();
  const floor = scene.maps.find((map) => map.building?.floor === 0);
  scene.view.mapId = floor.id;
  scene.view.focusTokenId = null;
  await restoreCampaignScene(gm, scene, library, gm.characterServices.combat);
  library.saveScene = jest.fn(async (capture) => ({ captured: await capture(library) }));
  library.flush = jest.fn(async () => {});
  const cols = floor.grid.cols + 3;
  const rows = floor.grid.rows + 3;
  await replaceCampaignBiome(
    gm,
    { biomeKey: 'dungeon', seed: 42, densityMultiplier: 0, structures: false },
    { cols, rows }
  );
  const outside = gm.campaignWorld.save();
  outside.view.mapId = floor.building.ownerMapId;
  await restoreCampaignScene(gm, outside, library, gm.characterServices.combat);
  gm.terrainEngine.resizeStructure('house', { heightFeet: 30 });
  expect(gm.campaignWorld.getMap(floor.id).grid).toMatchObject({ cols, rows });
  expect(gm.campaignWorld.getMap(floor.id).terrain.biome).toBe('dungeon');
});

test('generated scenery on an expanded building floor stays on supported interior cells', async () => {
  const { gm, library } = await board();
  for (const token of [...gm.placedTokens]) gm.tokenManager.removeToken(token);
  gm.terrainEngine.resizeStructure('house', { heightFeet: 10 });
  const scene = gm.campaignWorld.save();
  const floor = scene.maps.find((map) => map.building?.floor === 0);
  scene.view.mapId = floor.id;
  scene.view.focusTokenId = null;
  await restoreCampaignScene(gm, scene, library, gm.characterServices.combat);
  const raw = gm.terrainEngine.planBiomeGeneration(
    'forestTemperate',
    { seed: 42, relief: 0.1, densityMultiplier: 1, structures: false },
    { cols: 25, rows: 25, clear: true }
  );
  raw.heights = Array.from({ length: 25 }, () => Array(25).fill(0));
  const tree = raw.placements.find((placement) => placement.placeableId.startsWith('tree-'));
  raw.placements = [
    { ...tree, gridX: 2, gridY: 2 },
    { ...tree, gridX: 20, gridY: 20 },
  ];
  jest.spyOn(gm.terrainEngine, 'planBiomeGeneration').mockReturnValue(raw);
  const model = new Mesh(new BoxGeometry(0.5, 2, 0.5), new MeshStandardMaterial());
  model.position.y = 1;
  gm.modelAssetCache.getModel.mockResolvedValue(model);
  const prepared = await planCampaignBiomeReplacement(
    gm,
    {
      biomeKey: 'forestTemperate',
      seed: 42,
      relief: 0.1,
      densityMultiplier: 1,
      structures: false,
    },
    { cols: 25, rows: 25 }
  );
  const map = prepared.scene.maps.find((entry) => entry.id === floor.id);
  expect(map.terrain.placeables).toHaveLength(1);
  const world = CampaignWorld.fromScene(prepared.scene, { ruleset: library.ruleset, library });
  const geometry = world.getMapGeometry(floor.id);
  for (const placement of map.terrain.placeables) {
    const height =
      (map.terrain.heights[placement.gridY][placement.gridX] * map.terrain.worldElevationUnit * 5) /
      map.grid.tileWorldSize;
    const support = geometry.findSupport(placement.gridX * 5 + 2.5, placement.gridY * 5 + 2.5, {
      belowFeet: height + 1e-5,
    });
    expect(support?.heightFeet).toBeCloseTo(height);
  }
});

test('replacement planning does not duplicate existing castle interior passages', async () => {
  const { gm } = await board();
  for (const token of [...gm.placedTokens]) gm.tokenManager.removeToken(token);
  gm.terrainEngine.removeStructure('house');
  await generateCampaignBiome(gm, {
    biomeKey: 'castle',
    seed: 42,
    structures: true,
    densityMultiplier: 0,
  });
  const before = gm.campaignWorld.save();
  expect(
    before.connections.some((connection) => connection.name === 'Joined interior passage')
  ).toBe(true);
  const prepared = await planCampaignBiomeReplacement(
    gm,
    { biomeKey: 'castle', seed: 42, densityMultiplier: 0 },
    { cols: 25, rows: 25 }
  );
  expect(prepared.scene.connections).toEqual(before.connections);
  expect(gm.campaignWorld.save()).toEqual(before);
});

test('a model-loading failure rejects replacement planning without clearing the board', async () => {
  const { gm } = await board();
  gm.terrainEngine.removeStructure('house');
  gm.modelAssetCache = { getModel: jest.fn(async () => null) };
  const terrain = gm.terrainEngine.save();
  const world = gm.campaignWorld.save();
  const token = gm.placedTokens[0];
  await expect(
    planCampaignBiomeReplacement(
      gm,
      { biomeKey: 'forestTemperate', seed: 42 },
      { cols: 25, rows: 25 }
    )
  ).rejects.toThrow(/asset preparation failed/i);
  expect(gm.terrainEngine.save()).toEqual(terrain);
  expect(gm.campaignWorld.save()).toEqual(world);
  expect(gm.placedTokens[0] === token).toBe(true);
});

test('a missing construction model rejects replacement before clearing the board', async () => {
  const { gm } = await board();
  gm.terrainEngine.removeStructure('house');
  const originalGetModel = gm.modelAssetCache.getModel;
  gm.modelAssetCache = {
    getModel: jest.fn(async (key) =>
      key === 'source-dungeon-wall' ? null : originalGetModel(key)
    ),
  };
  const terrain = gm.terrainEngine.save();
  const world = gm.campaignWorld.save();
  const token = gm.placedTokens[0];
  await expect(
    planCampaignBiomeReplacement(
      gm,
      { biomeKey: 'dungeon', seed: 42, densityMultiplier: 0 },
      { cols: 25, rows: 25 }
    )
  ).rejects.toThrow(/construction.*source-dungeon-wall/i);
  expect(gm.terrainEngine.save()).toEqual(terrain);
  expect(gm.campaignWorld.save()).toEqual(world);
  expect(gm.placedTokens[0] === token).toBe(true);
});

test('a failed required model texture rejects replacement before clearing the board', async () => {
  const { gm } = await board();
  gm.terrainEngine.removeStructure('house');
  gm.modelAssetCache.whenModelReady = jest.fn(async (key) => {
    if (key === 'source-dungeon-wall') throw new Error('Required texture failed to load');
  });
  const before = gm.terrainEngine.save();
  await expect(
    planCampaignBiomeReplacement(
      gm,
      { biomeKey: 'dungeon', seed: 42, densityMultiplier: 0 },
      { cols: 25, rows: 25 }
    )
  ).rejects.toThrow(/texture failed/i);
  expect(gm.terrainEngine.save()).toEqual(before);
  expect(gm.placedTokens).toHaveLength(1);
});

test('a map edited while its assets are loading is not replaced by a stale plan', async () => {
  const { gm } = await board();
  gm.terrainEngine.removeStructure('house');
  let release;
  let loadingStarted;
  const loading = new Promise((resolve) => {
    release = resolve;
  });
  const started = new Promise((resolve) => {
    loadingStarted = resolve;
  });
  gm.modelAssetCache = {
    getModel: jest.fn(() => {
      loadingStarted();
      return loading;
    }),
  };
  const pending = planCampaignBiomeReplacement(
    gm,
    { biomeKey: 'forestTemperate', seed: 42 },
    { cols: 25, rows: 25 }
  );
  await started;
  gm.terrainEngine.setHeightAt(0, 0, 2);
  const edited = gm.terrainEngine.save();
  const model = new Mesh(new BoxGeometry(0.5, 2, 0.5), new MeshStandardMaterial());
  model.position.y = 1;
  release(model);
  await expect(pending).rejects.toThrow(/changed while generation was being prepared/i);
  expect(gm.terrainEngine.save()).toEqual(edited);
});

test('a terrain editing session started during asset loading cancels preparation', async () => {
  const { gm } = await board();
  gm.terrainEngine.removeStructure('house');
  let release;
  let loadingStarted;
  const loading = new Promise((resolve) => {
    release = resolve;
  });
  const started = new Promise((resolve) => {
    loadingStarted = resolve;
  });
  gm.modelAssetCache = {
    getModel: jest.fn(() => {
      loadingStarted();
      return loading;
    }),
  };
  const before = gm.terrainEngine.save();
  const pending = planCampaignBiomeReplacement(
    gm,
    { biomeKey: 'forestTemperate', seed: 42 },
    { cols: 25, rows: 25 }
  );
  await started;
  gm.terrainEngine.activate();
  const model = new Mesh(new BoxGeometry(0.5, 2, 0.5), new MeshStandardMaterial());
  model.position.y = 1;
  release(model);
  await expect(pending).rejects.toThrow(/finish.*action|finish.*editing/i);
  expect(gm.terrainEngine.isActive).toBe(true);
  expect(gm.terrainEngine.save()).toEqual(before);
});

test('a character save started during asset loading cancels preparation', async () => {
  const { gm, library } = await board();
  gm.terrainEngine.removeStructure('house');
  let release;
  let loadingStarted;
  const loading = new Promise((resolve) => {
    release = resolve;
  });
  const started = new Promise((resolve) => {
    loadingStarted = resolve;
  });
  gm.modelAssetCache = {
    getModel: jest.fn(() => {
      loadingStarted();
      return loading;
    }),
  };
  const before = gm.terrainEngine.save();
  const pending = planCampaignBiomeReplacement(
    gm,
    { biomeKey: 'forestTemperate', seed: 42 },
    { cols: 25, rows: 25 }
  );
  await started;
  library.isSaving = true;
  const model = new Mesh(new BoxGeometry(0.5, 2, 0.5), new MeshStandardMaterial());
  model.position.y = 1;
  release(model);
  await expect(pending).rejects.toThrow(/finish.*action|finish.*save/i);
  expect(gm.terrainEngine.save()).toEqual(before);
});

test('generation on a lone map retains the existing world when no topology changes', async () => {
  const { gm } = await board();
  for (const token of [...gm.placedTokens]) gm.tokenManager.removeToken(token);
  gm.terrainEngine.removeStructure('house');
  const world = gm.campaignWorld;
  expect(world.listMaps()).toHaveLength(1);

  await expect(
    generateCampaignBiome(gm, { biomeKey: 'grassland', seed: 42, structures: false })
  ).resolves.toBe(true);
  expect(gm.campaignWorld === world).toBe(true);
});

test('generation leaves another independent map and its creature unchanged', async () => {
  const { gm, library } = await board({ withCharacter: true });
  gm.terrainEngine.removeStructure('house');
  const remote = gm.campaignWorld.getMap(gm.campaignMapId);
  remote.id = 'remote-map';
  remote.name = 'Remote map';
  gm.campaignWorld.addLocation({ id: 'remote-location', name: 'Remote', map: remote });
  const token = gm.placedTokens[0];
  token.mapId = 'remote-map';
  await gm.token3DAdapter.restoreStablePlacement(token, {
    gridX: 1,
    gridY: 1,
    facingAngle: 0,
    pose: { kind: 'ground', world: { x: 1.5, y: 0, z: 1.5 } },
  });
  const beforeMap = gm.campaignWorld.getMap('remote-map');
  const beforePlacement = gm.token3DAdapter.getStablePlacement(token);
  const character = library.get(token.characterSheetId);

  await expect(
    generateCampaignBiome(gm, { biomeKey: 'grassland', seed: 42, structures: false })
  ).resolves.toBe(true);
  expect(gm.campaignWorld.getMap('remote-map')).toEqual(beforeMap);
  expect(gm.placedTokens[0] === token).toBe(true);
  expect(token.mapId).toBe('remote-map');
  expect(gm.token3DAdapter.getStablePlacement(token)).toEqual(beforePlacement);
  expect(library.get(token.characterSheetId)).toEqual(character);
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

test('regeneration refuses to remove existing generated building floors', async () => {
  const { gm } = await board();
  for (const token of [...gm.placedTokens]) gm.tokenManager.removeToken(token);
  gm.terrainEngine.removeStructure('house');
  await generateCampaignBiome(gm, { biomeKey: 'town', seed: 42, structures: true });
  const before = gm.campaignWorld.save();
  expect(before.maps.some((map) => map.building)).toBe(true);
  const terrain = gm.terrainEngine.save();

  await expect(
    generateCampaignBiome(gm, { biomeKey: 'grassland', seed: 7, structures: false })
  ).rejects.toThrow(/another map.*preserv/i);
  expect(gm.campaignWorld.save()).toEqual(before);
  expect(gm.terrainEngine.save()).toEqual(terrain);
});

test('regenerating an unchanged settlement preserves its customized floors and links', async () => {
  const { gm } = await board();
  for (const token of [...gm.placedTokens]) gm.tokenManager.removeToken(token);
  gm.terrainEngine.removeStructure('house');
  await generateCampaignBiome(gm, { biomeKey: 'town', seed: 42, structures: true });
  const before = gm.campaignWorld.save();
  const floor = before.maps.find((map) => map.building);
  floor.name = 'Saved workshop';
  gm.campaignWorld.acceptCheckpoint(before);

  await expect(generateCampaignBiome(gm, { biomeKey: 'town', seed: 42 })).resolves.toBe(true);
  const after = gm.campaignWorld.save();
  expect(after.maps.filter((map) => map.id !== gm.campaignMapId)).toEqual(
    before.maps.filter((map) => map.id !== gm.campaignMapId)
  );
  expect(after.connections).toEqual(before.connections);
});

test('clearing the grid removes generated geometry and floor maps so the map can shrink afterward', async () => {
  const { gm, library } = await board();
  gm.terrainEngine.setHeightAt(2, 2, 4);
  gm.terrainEngine._generationRecipe = {
    version: 1,
    biomeKey: 'castle',
    values: { canvasScale: 1.4 },
  };
  const purgeAll = jest.fn();
  gm.placeableMeshPool = {
    _metadata: new Map(),
    purgeAll,
    sightBlockingBounds: () => [],
    targetingCoverBounds: () => [],
    getStats: () => ({ instances: 0 }),
  };

  expect(gm.campaignWorld.listMaps().length).toBeGreaterThan(1);
  expect(GameManager.prototype.resetTerrain.call(gm)).toBe(true);
  expect(
    gm.terrainEngine
      .save()
      .heights.flat()
      .every((height) => height === 0)
  ).toBe(true);
  expect(gm.terrainEngine.geometry.getStructures()).toEqual([]);
  expect(gm.terrainEngine.geometry.save().volumes).toEqual([]);
  expect(gm.campaignWorld.listMaps()).toHaveLength(1);
  expect(gm.campaignWorld.getConnections()).toHaveLength(0);
  expect(gm.campaignWorld.getMap(gm.campaignMapId).terrain.generationRecipe).toBeUndefined();
  expect(purgeAll).toHaveBeenCalledTimes(1);
  expect(gm.terrainEngine.undo()).toBe(true);
  expect(gm.terrainEngine.geometry.getStructures().map(({ id }) => id)).toEqual(['house']);
  expect(gm.terrainEngine.getHeightAt(2, 2)).toBe(4);
  expect(gm.campaignWorld.listMaps().length).toBeGreaterThan(1);
  expect(gm.terrainEngine.redo()).toBe(true);
  expect(gm.terrainEngine.geometry.getStructures()).toEqual([]);
  expect(gm.campaignWorld.listMaps()).toHaveLength(1);

  gm.resizeGrid(15, 15);
  expect([gm.cols, gm.rows]).toEqual([15, 15]);
  const captured = await captureCampaignScene(gm, library);
  expect(captured.maps).toHaveLength(1);
  expect(captured.maps[0].grid).toEqual({ cols: 15, rows: 15, tileWorldSize: 1 });
  expect(captured.maps[0].terrain.placeables).toEqual([]);
  expect(captured.maps[0].terrain.generationRecipe).toBeUndefined();
});

test('clearing the grid rejects an occupied linked floor atomically', async () => {
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
  const before = gm.terrainEngine.save();
  const world = gm.campaignWorld.save();
  const purgeAll = jest.fn();
  gm.placeableMeshPool = {
    _metadata: new Map(),
    purgeAll,
    sightBlockingBounds: () => [],
    targetingCoverBounds: () => [],
  };

  expect(() => GameManager.prototype.resetTerrain.call(gm)).toThrow(
    /creature.*floor|floor.*removed/i
  );
  expect(gm.terrainEngine.save()).toEqual(before);
  expect(gm.campaignWorld.save()).toEqual(world);
  expect(purgeAll).not.toHaveBeenCalled();
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
