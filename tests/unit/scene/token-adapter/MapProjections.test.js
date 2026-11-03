import * as three from 'three';
import CampaignWorld from '../../../../src/campaigns/CampaignWorld.js';
import { CharacterLibrary } from '../../../../src/entities/characters/CharacterLibrary.js';
import { Token3DAdapter } from '../../../../src/scene/Token3DAdapter.js';
import { TerrainEngine } from '../../../../src/terrain/TerrainEngine.js';
import { TerrainGeometry } from '../../../../src/terrain/TerrainGeometry.js';
import { PickingService } from '../../../../src/scene/picking/PickingService.js';
import { sceneState } from '../../../helpers/sceneState.js';

function fixture() {
  localStorage.clear();
  const library = new CharacterLibrary({ ruleset: '2014', catalog: [], storage: localStorage });
  const scene = sceneState();
  scene.terrain.heights = scene.terrain.heights.map((row) => row.map(() => 0));
  const context = { ruleset: '2014', library };
  let world = CampaignWorld.fromScene(scene, context);
  const geometry = new TerrainGeometry({
    widthFeet: 25,
    depthFeet: 25,
    getTerrainHeightFeet: () => 0,
    terrainThicknessFeet: 0.5,
  });
  geometry.addSolid({
    id: 'front-wall',
    bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 10, z: 25 } },
  });
  geometry.carve({
    id: 'window',
    bounds: { min: { x: 0, y: 2, z: 5 }, max: { x: 1, y: 6, z: 10 } },
  });
  world.addMap({
    id: 'inside',
    name: 'Interior',
    originFeet: { x: 10, y: 0, z: 0 },
    quarterTurns: 0,
    base: 'floor',
    grid: { ...scene.grid, tileWorldSize: 2 },
    terrain: { ...scene.terrain, geometry: geometry.save() },
  });
  const saved = world.save();
  saved.view.focusTokenId = 'token-1';
  for (const [number, gridY] of [
    [2, 1],
    [3, 4],
  ]) {
    saved.creatures.push({
      ...saved.creatures[0],
      id: `token-${number}`,
      instanceNumber: number,
      name: number === 2 ? 'Window target' : 'Wall target',
      mapId: 'inside',
      gridY,
      pose: { kind: 'ground', world: { x: 3, y: 0, z: gridY * 2 + 1 } },
    });
  }
  saved.tokenCounters.nextId = 3;
  saved.tokenCounters.types[0][1] = 3;
  world = CampaignWorld.fromScene(saved, context);
  const tokens = saved.creatures.map((creature) => ({
    ...creature,
    world: { ...creature.pose.world },
  }));
  const frames = new Set();
  const gm = {
    cols: 5,
    rows: 5,
    placedTokens: tokens,
    campaignWorld: world,
    campaignMapId: 'map-main',
    campaignView: world.createView({ focusTokenId: 'token-1' }),
    characterServices: { library },
    terrainEngine: new TerrainEngine(5, 5),
    __threeTestDouble: three,
    is3DModeActive: () => true,
    threeSceneManager: {
      scene: new three.Scene(),
      three,
      addAnimationCallback: (callback) => frames.add(callback),
      removeAnimationCallback: (callback) => frames.delete(callback),
    },
    spatial: {
      tileWorldSize: 1,
      elevationUnit: 0.3,
      gridToWorld: (x, z, height = 0) => ({ x, y: height * 0.3, z }),
      worldToGrid: (x, z) => ({ gridX: Math.floor(x), gridY: Math.floor(z) }),
    },
  };
  gm.getTerrainHeight = (x, y) => gm.terrainEngine.getHeightAt(x, y);
  gm.token3DAdapter = new Token3DAdapter(gm);
  gm.advanceFrame = () => {
    for (const callback of frames) callback();
  };
  return {
    gm,
    adapter: gm.token3DAdapter,
    observer: tokens[0],
    window: tokens[1],
    wall: tokens[2],
  };
}

function outsideFixture(mapChanges = {}) {
  const board = fixture();
  const saved = board.gm.campaignWorld.save();
  Object.assign(
    saved.maps.find((map) => map.id === 'inside'),
    {
      originFeet: { x: 20, y: 0, z: 0 },
      ...mapChanges,
    }
  );
  board.gm.campaignWorld.acceptCheckpoint(saved);
  return board;
}

test('a visible interior creature gets one translated visual and a wall-hidden creature stays hidden', async () => {
  const { gm, adapter, window, wall } = fixture();
  try {
    const position = { ...window.world };
    await adapter.syncMapProjections();
    const visual = adapter.getTokenVisual(window);
    expect(visual).not.toBeNull();
    expect(visual.position.toArray()).toEqual([3.5, 0, 1.5]);
    expect(adapter.getTokenVisual(wall)).toBeNull();
    expect(gm.placedTokens).toHaveLength(3);
    expect(window.world).toEqual(position);
    expect(window.mapId).toBe('inside');
    expect(gm.campaignView.focusTokenId).toBe('token-1');
  } finally {
    for (const token of [...gm.placedTokens]) adapter.onTokenRemoved(token);
    adapter.disposeMovementRange();
  }
});

test('a visible off-board projection renders its real supporting terrain without adding gameplay terrain', async () => {
  const { gm, adapter, window } = outsideFixture();
  const heightMap = () =>
    Array.from({ length: gm.rows }, (_, z) =>
      Array.from({ length: gm.cols }, (_, x) => gm.terrainEngine.getHeightAt(x, z))
    );
  const heights = heightMap();
  try {
    await adapter.syncMapProjections();
    const visual = adapter.getTokenVisual(window);
    const context = gm.threeSceneManager.scene.getObjectByName('MapProjectionTerrain');
    expect(context).toBeDefined();
    gm.threeSceneManager.scene.updateMatrixWorld(true);
    const ray = new three.Raycaster(
      new three.Vector3(visual.position.x, 2, visual.position.z),
      new three.Vector3(0, -1, 0)
    );
    const hits = ray.intersectObject(context, true);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].point.y).toBeCloseTo(0);
    expect(window.world).toEqual({ x: 3, y: 0, z: 3 });
    expect(heightMap()).toEqual(heights);
    expect(gm.cols).toBe(5);
    expect(gm.placedTokens).toHaveLength(3);
  } finally {
    for (const token of [...gm.placedTokens]) adapter.onTokenRemoved(token);
    adapter.disposeMovementRange();
  }
});

test('support context follows map rotation, scale and real floor elevation', async () => {
  const { gm, adapter, window } = outsideFixture({
    originFeet: { x: 40.7, y: 2, z: 0.6 },
    quarterTurns: 1,
  });
  try {
    await adapter.syncMapProjections();
    const visual = adapter.getTokenVisual(window);
    expect(visual.position.x).toBeCloseTo(6.64);
    expect(visual.position.y).toBeCloseTo(0.4);
    expect(visual.position.z).toBeCloseTo(1.62);
    gm.threeSceneManager.scene.updateMatrixWorld(true);
    const context = gm.threeSceneManager.scene.getObjectByName('MapProjectionTerrain');
    const ray = new three.Raycaster(
      new three.Vector3(visual.position.x, 3, visual.position.z),
      new three.Vector3(0, -1, 0)
    );
    expect(ray.intersectObject(context, true)[0].point.y).toBeCloseTo(0.4);
  } finally {
    for (const token of [...gm.placedTokens]) adapter.onTokenRemoved(token);
    adapter.disposeMovementRange();
  }
});

test('context joins a fractional map boundary without duplicating the active ground', async () => {
  const { gm, adapter, window } = outsideFixture({
    originFeet: { x: 21.2, y: 0, z: 0 },
  });
  try {
    await adapter.syncMapProjections();
    gm.threeSceneManager.scene.updateMatrixWorld(true);
    const context = gm.threeSceneManager.scene.getObjectByName('MapProjectionTerrain');
    const visual = adapter.getTokenVisual(window);
    const ray = new three.Raycaster(
      new three.Vector3(visual.position.x, 2, visual.position.z),
      new three.Vector3(0, -1, 0)
    );
    expect(ray.intersectObject(context, true)[0].point.y).toBeCloseTo(0);
    ray.ray.origin.x = 4.9;
    expect(ray.intersectObject(context, true)).toEqual([]);
  } finally {
    for (const token of [...gm.placedTokens]) adapter.onTokenRemoved(token);
    adapter.disposeMovementRange();
  }
});

test('visible supporting terrain continues from the viewed grid toward a distant projection', async () => {
  const { gm, adapter, window } = outsideFixture();
  window.world.x = 9;
  window.gridX = 4;
  try {
    await adapter.syncMapProjections();
    expect(adapter.getTokenVisual(window)).not.toBeNull();
    gm.threeSceneManager.scene.updateMatrixWorld(true);
    const context = gm.threeSceneManager.scene.getObjectByName('MapProjectionTerrain');
    const ray = new three.Raycaster(new three.Vector3(5.5, 2, 1.5), new three.Vector3(0, -1, 0));
    expect(ray.intersectObject(context, true).some((hit) => Math.abs(hit.point.y) < 1e-6)).toBe(
      true
    );
  } finally {
    for (const token of [...gm.placedTokens]) adapter.onTokenRemoved(token);
    adapter.disposeMovementRange();
  }
});

test('a creature visible at a window edge retains its actual support even when the tile center is hidden', async () => {
  const { gm, adapter, window } = outsideFixture({
    originFeet: { x: 40, y: 0, z: 0 },
  });
  window.world.x = 0.44;
  window.world.z = 4.002;
  window.gridX = 0;
  window.gridY = 2;
  try {
    await adapter.syncMapProjections();
    const visual = adapter.getTokenVisual(window);
    expect(visual).not.toBeNull();
    gm.threeSceneManager.scene.updateMatrixWorld(true);
    const context = gm.threeSceneManager.scene.getObjectByName('MapProjectionTerrain');
    const ray = new three.Raycaster(
      new three.Vector3(visual.position.x, 2, visual.position.z),
      new three.Vector3(0, -1, 0)
    );
    expect(ray.intersectObject(context, true).some((hit) => Math.abs(hit.point.y) < 1e-6)).toBe(
      true
    );
  } finally {
    for (const token of [...gm.placedTokens]) adapter.onTokenRemoved(token);
    adapter.disposeMovementRange();
  }
});

test('supporting context disappears with lost character sight, invisibility or no focus and is disposed with its creature', async () => {
  const { gm, adapter, observer, window } = outsideFixture();
  try {
    await adapter.syncMapProjections();
    const context = gm.threeSceneManager.scene.getObjectByName('MapProjectionTerrain');
    expect(context.visible).toBe(true);
    observer.conditions = ['blinded'];
    await adapter.syncMapProjections();
    expect(context.visible).toBe(false);
    observer.conditions = [];
    window.conditions = ['invisible'];
    await adapter.syncMapProjections();
    expect(context.visible).toBe(false);
    window.conditions = [];
    await adapter.syncMapProjections();
    expect(context.visible).toBe(true);
    window.world.z = 9;
    await adapter.syncMapProjections();
    expect(context.visible).toBe(false);
    window.world.z = 3;
    await adapter.syncMapProjections();
    expect(context.visible).toBe(true);
    gm.campaignView.focus(null);
    await adapter.syncMapProjections();
    expect(context.visible).toBe(false);
    adapter.onTokenRemoved(window);
    expect(context.parent).toBeNull();
    expect(gm.threeSceneManager.scene.getObjectByName('MapProjectionTerrain')).toBeUndefined();
  } finally {
    for (const token of [...gm.placedTokens]) adapter.onTokenRemoved(token);
    adapter.disposeMovementRange();
  }
});

test('the normal frame loop mirrors live movement and hides an occluded projection without replacing its model', async () => {
  const { gm, adapter, window } = fixture();
  try {
    adapter.attach();
    gm.advanceFrame();
    await Promise.resolve();
    const visual = adapter.getTokenVisual(window);
    expect(visual).not.toBeNull();
    window.world.x = 4;
    gm.advanceFrame();
    await Promise.resolve();
    expect(visual.position.toArray()).toEqual([4, 0, 1.5]);
    window.world.z = 9;
    gm.advanceFrame();
    await Promise.resolve();
    expect(adapter.getTokenVisual(window)).toBeNull();
    expect(visual.visible).toBe(false);
    window.world.z = 3;
    gm.advanceFrame();
    await Promise.resolve();
    expect(adapter.getTokenVisual(window)).toBe(visual);
    expect(visual.visible).toBe(true);
    expect(gm.placedTokens).toHaveLength(3);
    expect(gm.campaignView.focusTokenId).toBe('token-1');
  } finally {
    for (const token of [...gm.placedTokens]) adapter.onTokenRemoved(token);
    adapter.disposeMovementRange();
  }
});

test('projection visibility follows the observing character rather than the camera or an unfocused DM view', async () => {
  const { gm, adapter, observer, window } = fixture();
  try {
    await adapter.syncMapProjections();
    expect(adapter.getTokenVisual(window)).not.toBeNull();
    observer.conditions = ['blinded'];
    await adapter.syncMapProjections();
    expect(adapter.getTokenVisual(window)).toBeNull();
    observer.conditions = [];
    window.conditions = ['invisible'];
    await adapter.syncMapProjections();
    expect(adapter.getTokenVisual(window)).toBeNull();
    window.conditions = [];
    gm.campaignView.focus(null);
    await adapter.syncMapProjections();
    expect(adapter.getTokenVisual(window)).toBeNull();
    gm.campaignView.focus(observer.id);
    await adapter.syncMapProjections();
    expect(adapter.getTokenVisual(window)).not.toBeNull();
  } finally {
    for (const token of [...gm.placedTokens]) adapter.onTokenRemoved(token);
    adapter.disposeMovementRange();
  }
});

test('picking a projection resolves to the original creature without changing viewing focus', async () => {
  const { gm, adapter, window } = fixture();
  try {
    await adapter.syncMapProjections();
    gm.threeSceneManager.scene.updateMatrixWorld(true);
    const ray = new three.Raycaster(new three.Vector3(3.5, 0, 10), new three.Vector3(0, 0, -1));
    expect(adapter.pickTokenByRay(ray, { precise: true })?.token).toBe(window);
    expect(gm.campaignMapId).toBe('map-main');
    expect(gm.campaignView.focusTokenId).toBe('token-1');
    window.conditions = ['invisible'];
    await adapter.syncMapProjections();
    expect(adapter.pickTokenByRay(ray, { precise: true })).toBeNull();
    expect(gm.placedTokens).toHaveLength(3);
  } finally {
    for (const token of [...gm.placedTokens]) adapter.onTokenRemoved(token);
    adapter.disposeMovementRange();
  }
});

test('a projected creature outside the viewed board never reports its foreign local cell as an exterior cell', async () => {
  const { gm, adapter, window } = fixture();
  const saved = gm.campaignWorld.save();
  saved.maps.find((map) => map.id === 'inside').originFeet.x = 20;
  gm.campaignWorld.acceptCheckpoint(saved);
  const camera = new three.OrthographicCamera(0, 10, 5, -5, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 800;
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 800 });
  gm.threeSceneManager.camera = camera;
  gm.threeSceneManager.canvas = canvas;
  try {
    await adapter.syncMapProjections();
    gm.threeSceneManager.scene.updateMatrixWorld(true);
    const pick = new PickingService({ gameManager: gm }).pickGroundSync(440, 400);
    expect(pick.token).toBe(window);
    expect(pick.grid).toBeNull();
    expect(window.gridX).toBe(1);
    expect(window.mapId).toBe('inside');
  } finally {
    for (const token of [...gm.placedTokens]) adapter.onTokenRemoved(token);
    adapter.disposeMovementRange();
  }
});
