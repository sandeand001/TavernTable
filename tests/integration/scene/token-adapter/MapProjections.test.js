import CampaignWorld from '../../../../src/campaigns/CampaignWorld.js';
import { CharacterLibrary } from '../../../../src/entities/characters/CharacterLibrary.js';
import { TerrainEngine } from '../../../../src/terrain/TerrainEngine.js';
import { TOKEN_3D_MODELS } from '../../../../src/config/token-adapter/MannequinConfig.js';
import { TokenManager } from '../../../../src/managers/TokenManager.js';
import CombatSession from '../../../../src/entities/characters/CombatSession.js';
import { changeCampaignView } from '../../../../src/campaigns/SceneWorld.js';
import { linkTokenCharacter } from '../../../../src/entities/creatures/TokenMovement.js';
import { GameErrors } from '../../../../src/utils/error/ErrorHandler.js';
import { sceneState } from '../../../helpers/sceneState.js';
import {
  createHumanoidFixture,
  handPositions,
  installHumanoidAssetFiles,
  stepHumanoid,
} from '../../../helpers/humanoid-fixture.js';

let restoreFiles;
beforeAll(() => {
  restoreFiles = installHumanoidAssetFiles();
});
afterAll(() => restoreFiles());

async function projectedFixture({ activeCols = 12 } = {}) {
  const fixture = await createHumanoidFixture({
    height: 0,
    warmupFrames: 0,
    animationKeys: ['idle', 'walk'],
  });
  const { gm, token } = fixture;
  localStorage.clear();
  const library = new CharacterLibrary({ ruleset: '2014', catalog: [], storage: localStorage });
  const validation = { ruleset: '2014', library };
  const scene = sceneState();
  scene.grid = { cols: activeCols, rows: 8, tileWorldSize: 1 };
  scene.terrain.heights = Array.from({ length: 8 }, () => Array(activeCols).fill(0));
  scene.creatures[0].gridX = 2;
  scene.creatures[0].gridY = 2;
  scene.creatures[0].pose = { kind: 'flight', world: { x: 2.5, y: 2, z: 2.5 } };
  let world = CampaignWorld.fromScene(scene, validation);
  world.addMap({
    id: 'upper',
    name: 'Rotated upper floor',
    originFeet: { x: 60, y: 10, z: -5 },
    quarterTurns: 1,
    base: 'floor',
    grid: { cols: 12, rows: 8, tileWorldSize: 2 },
    terrain: {
      ...scene.terrain,
      heights: Array.from({ length: 8 }, () => Array(12).fill(0)),
    },
  });
  const saved = world.save();
  saved.view.focusTokenId = 'token-1';
  saved.creatures.push({
    ...saved.creatures[0],
    id: token.id,
    instanceNumber: 2,
    mapId: 'upper',
    gridX: 5,
    gridY: 4,
    pose: { kind: 'ground', world: { x: 11, y: 0, z: 9 } },
  });
  saved.tokenCounters.types[0][1] = 2;
  world = CampaignWorld.fromScene(saved, validation);
  const observer = {
    ...saved.creatures[0],
    world: { ...saved.creatures[0].pose.world },
    flightActive: true,
  };
  Object.assign(token, {
    mapId: 'upper',
    gridX: 5,
    gridY: 4,
    world: { x: 11, y: 0, z: 9 },
  });
  gm.placedTokens = [observer, token];
  gm.campaignWorld = world;
  gm.campaignMapId = 'map-main';
  gm.campaignView = world.createView({ focusTokenId: observer.id });
  gm.characterServices = { library };
  gm.cols = activeCols;
  gm.terrainEngine = new TerrainEngine(activeCols, 8);
  gm.getTerrainHeight = (x, z) => gm.terrainEngine.getHeightAt(x, z);
  if (activeCols < 12)
    gm.terrainEngine.addVolume({
      id: 'narrow-hall-floor',
      bounds: {
        min: { x: 0, y: -0.1, z: 0 },
        max: { x: activeCols * 5, y: 0, z: 40 },
      },
    });
  return fixture;
}

test('a B2-sized hall can load a real off-map rig without checking its coordinates against the hall', async () => {
  const { gm, adapter, token } = await projectedFixture({ activeCols: 5 });
  adapter.onTokenRemoved(token);
  const report = jest.spyOn(GameErrors, 'rendering').mockImplementation(() => {});
  try {
    await adapter.syncMapProjections();
    expect(report.mock.calls.map(([error]) => error.stack)).toEqual([]);
    const visual = adapter.getTokenVisual(token);
    expect(visual).not.toBeNull();
    expect(visual.position.toArray()).toEqual([7.5, 2, 4.5]);
    expect(token.world).toEqual({ x: 11, y: 0, z: 9 });
    expect(gm.cols).toBe(5);
  } finally {
    report.mockRestore();
    adapter.onTokenRemoved(token);
    adapter.disposeMapProjectionTerrain();
    adapter.disposeMovementRange();
  }
}, 30000);

test('an off-map checkpoint retains its source support and scale when the displayed terrain has no volumes', async () => {
  const { gm, adapter, token } = await projectedFixture();
  const saved = gm.campaignWorld.save();
  const geometry = gm.campaignWorld.getMapGeometry(token.mapId);
  geometry.addSolid({
    id: 'source-platform',
    bounds: { min: { x: 20, y: 0, z: 15 }, max: { x: 40, y: 2, z: 30 } },
  });
  saved.maps.find((map) => map.id === token.mapId).terrain.geometry = geometry.save();
  token.world.y = 0.8;
  saved.creatures.find((creature) => creature.id === token.id).pose.world.y = 0.8;
  gm.campaignWorld.acceptCheckpoint(saved);
  try {
    expect(gm.terrainEngine.geometry.hasVolumes).toBe(false);
    expect(adapter.recordStablePlacement(token)).toBe(true);
    const checkpoint = adapter.getStablePlacement(token);
    expect(checkpoint.pose.surfaceId).toBe('source-platform');
    expect(checkpoint.pose.world).toEqual({ x: 11, y: 0.8, z: 9 });
  } finally {
    adapter.onTokenRemoved(token);
    adapter.disposeMapProjectionTerrain();
    adapter.disposeMovementRange();
  }
}, 30000);

test('a real animated rig projects its floor height and facing without moving the canonical creature', async () => {
  const fixture = await projectedFixture();
  const { gm, adapter, token, mesh } = fixture;
  try {
    const position = { ...token.world };
    await adapter.syncMapProjections();
    expect(adapter.getTokenVisual(token)).toBe(mesh);
    expect(mesh.position.toArray()).toEqual([7.5, 2, 4.5]);
    expect(mesh.rotation.y).toBeCloseTo(
      (TOKEN_3D_MODELS[token.type].baseRotation?.y || 0) - Math.PI / 2
    );
    const hands = handPositions(fixture);
    fixture.data.actions.walk.play();
    stepHumanoid(fixture, 0.25);
    await adapter.syncMapProjections();
    expect(
      handPositions(fixture).some((hand, index) => hand.distanceTo(hands[index]) > 0.001)
    ).toBe(true);
    expect(token.world).toEqual(position);
    expect(token.mapId).toBe('upper');
    expect(adapter.getTokenMovementRange(token)).toBeNull();
    expect(gm.placedTokens).toHaveLength(2);
  } finally {
    adapter.onTokenRemoved(token);
    adapter.disposeMovementRange();
  }
}, 30000);

test('concurrent projection refreshes load only one actual character model', async () => {
  const { gm, adapter, token } = await projectedFixture();
  adapter.onTokenRemoved(token);
  try {
    await Promise.all([adapter.syncMapProjections(), adapter.syncMapProjections()]);
    expect(adapter.getTokenVisual(token)).not.toBeNull();
    expect(
      gm.threeSceneManager.scene.children.filter((child) => child.name === `Token3D:${token.id}`)
    ).toHaveLength(1);
    expect(token.world).toEqual({ x: 11, y: 0, z: 9 });
    expect(gm.placedTokens).toHaveLength(2);
  } finally {
    adapter.onTokenRemoved(token);
    adapter.disposeMovementRange();
  }
}, 30000);

test('a projection that becomes hidden while its actual model loads never appears after completion', async () => {
  const { gm, adapter, token } = await projectedFixture();
  adapter.onTokenRemoved(token);
  try {
    const loading = adapter.syncMapProjections();
    token.conditions = ['invisible'];
    await adapter.syncMapProjections();
    await loading;
    expect(adapter.getTokenVisual(token)).toBeNull();
    expect(gm.threeSceneManager.scene.getObjectByName(`Token3D:${token.id}`)?.visible).toBe(false);
    expect(token.world).toEqual({ x: 11, y: 0, z: 9 });
  } finally {
    adapter.onTokenRemoved(token);
    adapter.disposeMovementRange();
  }
}, 30000);

test('removing a creature during projection loading cannot leave an orphaned visible model', async () => {
  const { gm, adapter, token } = await projectedFixture();
  adapter.onTokenRemoved(token);
  const manager = new TokenManager(gm);
  manager.placedTokens = gm.placedTokens;
  gm.tokenManager = manager;
  Object.defineProperty(gm, 'placedTokens', { get: () => manager.placedTokens });
  try {
    const loading = adapter.syncMapProjections();
    manager.removeToken(token);
    await loading;
    expect(gm.placedTokens).toHaveLength(1);
    expect(gm.threeSceneManager.scene.getObjectByName(`Token3D:${token.id}`)).toBeUndefined();
  } finally {
    adapter.onTokenRemoved(token);
    adapter.disposeMovementRange();
  }
}, 30000);

test('focusing a map with another render scale preserves physical rig size and creature state', async () => {
  const { gm, adapter, token } = await projectedFixture();
  const three = gm.threeSceneManager.three;
  const height = (root) => {
    root.updateMatrixWorld(true);
    const bounds = new three.Box3();
    root.traverse((child) => {
      if (child.isSkinnedMesh) bounds.union(new three.Box3().setFromObject(child, true));
    });
    return bounds.max.y - bounds.min.y;
  };
  let camera = sceneState().camera;
  gm.threeSceneManager.snapshotView = () => camera;
  gm.threeSceneManager.restoreView = (view) => {
    camera = JSON.parse(JSON.stringify(view));
  };
  gm.stateCoordinator = { setViewMode: () => {} };
  gm.ensureInstancing = () => null;
  gm.notifyTerrainHeightsChanged = () => adapter.resyncHeights();
  gm.resizeGrid = (cols, rows) => {
    gm.cols = cols;
    gm.rows = rows;
    gm.terrainEngine.resize(cols, rows);
  };
  gm.spatial.gridToWorld = function (x, z, level = 0) {
    return { x: x * this.tileWorldSize, y: level * this.elevationUnit, z: z * this.tileWorldSize };
  };
  gm.spatial.worldToGrid = function (x, z) {
    return { gridX: Math.floor(x / this.tileWorldSize), gridY: Math.floor(z / this.tileWorldSize) };
  };
  gm.getTerrainHeight = (x, y) => gm.terrainEngine.getHeightAt(x, y);
  gm.characterServices.combat = new CombatSession({ library: gm.characterServices.library });
  Object.assign(token, { instanceNumber: 2, name: 'Upper Scout', nameMode: 'custom' });
  const manager = new TokenManager(gm);
  manager.placedTokens = gm.placedTokens;
  manager._nextTokenId = 1;
  manager._tokenTypeCounts.set(token.type, 2);
  gm.tokenManager = manager;
  Object.defineProperty(gm, 'placedTokens', { get: () => manager.placedTokens });
  await adapter.restoreStablePlacement(token, {
    gridX: 5,
    gridY: 4,
    facingAngle: 0,
    pose: { kind: 'ground', world: { ...token.world } },
  });
  try {
    await adapter.syncMapProjections();
    const originalHeight = height(adapter.getTokenVisual(token));
    const position = { ...token.world };
    await changeCampaignView(gm, { focusTokenId: token.id });
    expect(gm.spatial.tileWorldSize).toBe(2);
    expect(height(adapter.getTokenVisual(token))).toBeCloseTo(originalHeight * 2, 1);
    expect(token.world).toEqual(position);
    expect(gm.placedTokens[1]).toBe(token);
    await changeCampaignView(gm, { focusTokenId: 'token-1' });
    expect(gm.spatial.tileWorldSize).toBe(1);
    expect(height(adapter.getTokenVisual(token))).toBeCloseTo(originalHeight, 1);
    expect(token.world).toEqual(position);
  } finally {
    for (const entry of [...gm.placedTokens]) adapter.onTokenRemoved(entry);
    adapter.disposeMovementRange();
  }
}, 30000);

test('keyboard movement cannot start while a map view change is preparing', async () => {
  const { gm, adapter, token } = await createHumanoidFixture({
    height: 0,
    warmupFrames: 0,
    animationKeys: ['idle', 'walk'],
  });
  gm.campaignViewBusy = true;
  try {
    adapter.beginForwardMovement(token);
    expect(adapter.isMovementInProgress(token)).toBe(false);
    const position = { ...token.world };
    adapter.beginRotation(token);
    for (let frame = 0; frame < 5; frame++) adapter._updateForwardMovements(1 / 60);
    expect(token.world).toEqual(position);
    expect(token.facingAngle).toBe(0);
  } finally {
    gm.campaignViewBusy = false;
    adapter.onTokenRemoved(token);
    adapter.disposeMovementRange();
  }
}, 30000);

test('a visual rebuild failure cannot remove a canonical creature turn or movement budget', async () => {
  const { gm, adapter, token } = await projectedFixture();
  const library = gm.characterServices.library;
  const characterId = library.create('Upper Scout');
  linkTokenCharacter(token, library, characterId);
  const combat = new CombatSession({ library });
  gm.characterServices.combat = combat;
  combat.startTurn(token);
  combat.adjustMovement(token, 20);
  const budget = combat.snapshot();
  const reported = jest.spyOn(GameErrors, 'rendering').mockImplementation(() => {});
  const clips = jest
    .spyOn(gm.threeSceneManager.three.AnimationMixer.prototype, 'clipAction')
    .mockImplementationOnce(() => {
      throw new Error('Animation backend unavailable');
    });
  adapter.releaseTokenVisual(token);
  try {
    await adapter.syncMapProjections();
    expect(reported).toHaveBeenCalled();
    expect(combat.activeToken).toBe(token);
    expect(combat.snapshot()).toEqual(budget);
    expect(gm.placedTokens).toContain(token);
    expect(token.characterSheetId).toBe(characterId);
  } finally {
    clips.mockRestore();
    reported.mockRestore();
    adapter.onTokenRemoved(token);
    adapter.disposeMovementRange();
  }
}, 30000);
