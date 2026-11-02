import * as three from 'three';
import { installCameraMethods } from '../../../../src/scene/camera/CameraSystem.js';
import { Token3DAdapter } from '../../../../src/scene/Token3DAdapter.js';
import { linkTokenCharacter } from '../../../../src/entities/creatures/TokenMovement.js';
import { get3DTokenScreenPosition } from '../../../../src/managers/interaction-manager/internals/target-resolution.js';
import { GameErrors } from '../../../../src/utils/error/ErrorHandler.js';

class CameraHarness {
  constructor(gameManager, callbacks) {
    this.gameManager = gameManager;
    this.three = three;
    this.scene = new three.Scene();
    this.canvas = document.createElement('canvas');
    this.canvas.getBoundingClientRect = () => ({ left: 10, top: 20, width: 800, height: 600 });
    this.renderer = { domElement: this.canvas };
    this.camera = new three.PerspectiveCamera(35, 800 / 600, 0.1, 2000);
    this._isoMode = true;
    this._isoYaw = Math.PI / 4;
    this._isoPitch = Math.PI / 4;
    this._isoManualLock = true;
    this._zoom = 1;
    this._targetZoom = 1;
    this._minZoom = 0.35;
    this._maxZoom = 3;
    this._zoomEase = 0;
    this._updateSunCoverage = jest.fn();
    this.addAnimationCallback = (callback) => callbacks.push(callback);
  }
}

installCameraMethods(CameraHarness.prototype);

function fixture({ tile = 1 } = {}) {
  const callbacks = [];
  const token = {
    id: 'hero',
    type: 'mannequin',
    name: 'Aster Vale',
    gridX: 2,
    gridY: 2,
    world: { x: tile * 2.5, y: 0, z: tile * 2.5 },
    facingAngle: Math.PI / 3,
  };
  const model = new three.Group();
  model.userData.__tt3DToken = true;
  model.userData.__ttBillboard = false;
  model.position.copy(token.world);
  model.add(new three.Mesh(new three.BoxGeometry(0.3, 1, 0.3), new three.MeshBasicMaterial()));
  token.__threeMesh = model;
  const gm = {
    cols: 5,
    rows: 5,
    placedTokens: [token],
    spatial: { tileWorldSize: tile, gridToWorld: (x, z, y) => ({ x: x * tile, y, z: z * tile }) },
    getTerrainHeight: () => 0,
    is3DModeActive: () => true,
    tokenManager: { getTokenFacingRight: () => true },
    cameraRig: { attach: jest.fn() },
  };
  const manager = new CameraHarness(gm, callbacks);
  gm.threeSceneManager = manager;
  manager.scene.add(model);
  manager.reframe();
  const adapter = new Token3DAdapter(gm);
  gm.token3DAdapter = adapter;
  adapter.attach();
  return { gm, token, model, manager, adapter, frame: callbacks[0] };
}

beforeEach(() => {
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
    const context = {
      clearRect: jest.fn(),
      save: jest.fn(),
      restore: jest.fn(),
      beginPath: jest.fn(),
      arc: jest.fn(),
      clip: jest.fn(),
      fillRect: jest.fn(),
      drawImage: jest.fn(),
      fillText: jest.fn(),
      stroke: jest.fn(),
      measureText: jest.fn((text) => ({
        width: text.length * Number(context.font.match(/(\d+)px/)?.[1] || 16) * 0.55,
      })),
    };
    return context;
  });
});

afterEach(() => jest.restoreAllMocks());

test('the real top-down camera toggle swaps visuals and restores the same animated model', () => {
  const { manager, adapter, token, model, frame } = fixture();
  const mixer = { update: jest.fn() };
  adapter._animationMixers.set(token, mixer);
  frame();
  expect(adapter.getTokenVisual(token)).toBe(model);
  const world = { ...token.world };
  manager.setTopDownView(true);
  adapter._lastFrameTime = performance.now() - 20;
  frame();
  const tactical = adapter.getTokenVisual(token);
  expect(manager.camera.isOrthographicCamera).toBe(true);
  expect(tactical.geometry.type).toBe('CircleGeometry');
  expect(tactical.visible).toBe(true);
  expect(model.visible).toBe(false);
  expect(token.__threeMesh).toBe(model);
  expect(token.world).toEqual(world);
  expect(token.facingAngle).toBeCloseTo(Math.PI / 3);
  expect(mixer.update).toHaveBeenCalled();
  model.visible = true;
  frame();
  expect(model.visible).toBe(false);
  manager.setTopDownView(false);
  frame();
  expect(manager.camera.isPerspectiveCamera).toBe(true);
  expect(adapter.getTokenVisual(token)).toBe(model);
  expect(model.visible).toBe(true);
  expect(tactical.visible).toBe(false);
  expect(adapter._animationMixers.get(token)).toBe(mixer);
  adapter.disposeTacticalTokens();
});

test('manual pitch switches at 80 degrees and uses a two-degree hysteresis buffer', () => {
  const { manager, adapter, token, model, frame } = fixture();
  manager.setCameraPitchDegrees(79);
  frame();
  expect(adapter.getTokenVisual(token)).toBe(model);
  manager.setCameraPitchDegrees(80);
  frame();
  const tactical = adapter.getTokenVisual(token);
  expect(tactical).not.toBe(model);
  expect(manager.camera.isPerspectiveCamera).toBe(true);
  manager.setCameraPitchDegrees(79);
  frame();
  expect(adapter.getTokenVisual(token)).toBe(tactical);
  manager.setCameraPitchDegrees(78);
  frame();
  expect(adapter.getTokenVisual(token)).toBe(tactical);
  manager.setCameraPitchDegrees(77.9);
  frame();
  expect(adapter.getTokenVisual(token)).toBe(model);
  adapter.disposeTacticalTokens();
});

test('actual camera orientation, not a toggle flag or saved pitch, determines tactical presentation', () => {
  const { manager, adapter, token, model, frame } = fixture();
  manager._isoPitch = 0.2;
  manager.camera.position.set(2.5, 10, 2.5);
  manager.camera.lookAt(2.5, 0, 2.5);
  frame();
  expect(adapter.getTokenVisual(token)).not.toBe(model);
  manager.camera.position.set(2.5, -10, 2.5);
  manager.camera.lookAt(2.5, 0, 2.5);
  frame();
  expect(adapter.getTokenVisual(token)).toBe(model);
  adapter.disposeTacticalTokens();
});

test('default names use readable text sizes, keep ordinary words whole, and retain long names', () => {
  const { manager, adapter, token, frame } = fixture();
  token.name = 'Knight';
  manager.setTopDownView(true);
  frame();
  const visual = adapter._tacticalTokens.get(token);
  expect(visual.context.font).toContain('96px');
  token.name = 'Mannequin';
  visual.context.fillText.mockClear();
  frame();
  expect(visual.context.fillText.mock.calls.map(([text]) => text)).toEqual(['Mannequin']);
  expect(Number(visual.context.font.match(/(\d+)px/)[1])).toBeGreaterThanOrEqual(64);
  token.name = 'A'.repeat(100);
  visual.context.fillText.mockClear();
  frame();
  expect(visual.context.fillText.mock.calls.map(([text]) => text).join('')).toBe(token.name);
  adapter.disposeTacticalTokens();
});

test('tokens track world height and tile size, remain readable across yaw, and highlight their rim', () => {
  const { manager, adapter, token, frame } = fixture({ tile: 2 });
  manager.setTopDownView(true);
  frame();
  const visual = adapter._tacticalTokens.get(token);
  expect(visual.context.fillText.mock.calls.map(([text]) => text).join(' ')).toContain(
    'Aster Vale'
  );
  token.flightActive = true;
  token.fallTraits = { flySpeed: 30 };
  token.world = { x: 4.4, y: 7, z: 6.6 };
  adapter._selectedToken = token;
  manager.setIsoAngles({ yaw: 2.3 });
  frame();
  expect(visual.mesh.position.toArray()).toEqual([4.4, 7.24, 6.6]);
  expect(visual.mesh.scale.x).toBe(2);
  expect(visual.mesh.quaternion.angleTo(manager.camera.quaternion)).toBeCloseTo(0);
  expect(visual.context.strokeStyle).toBe('#ffcc55');
  adapter._selectedToken = null;
  adapter._hoverToken = token;
  token.name = 'Renamed';
  frame();
  expect(visual.name).toBe('Renamed');
  expect(visual.context.strokeStyle).toBe('#79caff');
  const version = visual.texture.version;
  frame();
  expect(visual.texture.version).toBe(version);
  adapter.disposeTacticalTokens();
});

test('ray picking hits only the circular token, including precise picks, and menu anchors use that visual', () => {
  const { gm, manager, adapter, token, frame } = fixture();
  manager.setTopDownView(true);
  frame();
  const mesh = adapter.getTokenVisual(token);
  const normal = new three.Vector3(0, 0, 1).applyQuaternion(mesh.quaternion);
  const right = new three.Vector3(1, 0, 0).applyQuaternion(mesh.quaternion);
  const up = new three.Vector3(0, 1, 0).applyQuaternion(mesh.quaternion);
  const direction = normal.clone().negate();
  const ray = new three.Raycaster(mesh.position.clone().addScaledVector(normal, 10), direction);
  expect(adapter.pickTokenByRay(ray)?.token).toBe(token);
  expect(adapter.pickTokenByRay(ray, { precise: true })?.token).toBe(token);
  ray.ray.origin.addScaledVector(right, 0.4).addScaledVector(up, 0.4);
  expect(adapter.pickTokenByRay(ray)).toBeNull();
  const ndc = mesh.position.clone().project(manager.camera);
  expect(get3DTokenScreenPosition({ gameManager: gm }, token)).toEqual({
    x: 10 + ((ndc.x + 1) / 2) * 800,
    y: 20 + ((-ndc.y + 1) / 2) * 600,
  });
  adapter.disposeTacticalTokens();
});

test('portrait loads are cached, refresh explicitly, and stale image callbacks cannot replace a newer portrait', () => {
  const images = [];
  jest.spyOn(globalThis, 'Image').mockImplementation(() => {
    const image = { naturalWidth: 400, naturalHeight: 600 };
    images.push(image);
    return image;
  });
  const { manager, adapter, token, frame } = fixture();
  const character = { id: 'saved', name: 'Portrait hero', speed: 30, portraitImage: 'first-image' };
  const library = { get: jest.fn(() => character) };
  linkTokenCharacter(token, library, character.id);
  manager.setTopDownView(true);
  frame();
  const visual = adapter._tacticalTokens.get(token);
  const firstLoad = images[0].onload;
  const reads = library.get.mock.calls.length;
  frame();
  expect(library.get).toHaveBeenCalledTimes(reads);
  expect(images).toHaveLength(1);
  character.portraitImage = 'second-image';
  adapter.refreshTokenAppearance(token, character);
  firstLoad();
  expect(visual.image).toBeNull();
  images[1].onload();
  expect(visual.image).toBe(images[1]);
  expect(visual.context.drawImage).toHaveBeenCalled();
  character.portraitImage = null;
  adapter.refreshTokenAppearance(token, character);
  expect(visual.image).toBeNull();
  expect(visual.name).toBe('Portrait hero');
  adapter.disposeTacticalTokens();
});

test('tokens render while their model is loading and removal disposes every tactical resource', () => {
  const { manager, adapter, token, model, frame } = fixture();
  manager.scene.remove(model);
  delete token.__threeMesh;
  manager.setTopDownView(true);
  frame();
  const visual = adapter._tacticalTokens.get(token);
  expect(visual.mesh.visible).toBe(true);
  const geometry = jest.spyOn(visual.mesh.geometry, 'dispose');
  const material = jest.spyOn(visual.mesh.material, 'dispose');
  const texture = jest.spyOn(visual.texture, 'dispose');
  adapter.onTokenRemoved(token);
  expect(visual.mesh.parent).toBeNull();
  expect(geometry).toHaveBeenCalledTimes(1);
  expect(material).toHaveBeenCalledTimes(1);
  expect(texture).toHaveBeenCalledTimes(1);
  expect(adapter._tacticalTokens.size).toBe(0);
});

test('portrait decode errors are reported and image callbacks cannot outlive a removed token', () => {
  const images = [];
  jest.spyOn(globalThis, 'Image').mockImplementation(() => {
    const image = { naturalWidth: 64, naturalHeight: 64 };
    images.push(image);
    return image;
  });
  const rendering = jest.spyOn(GameErrors, 'rendering').mockImplementation(() => {});
  const { manager, adapter, token, frame } = fixture();
  const character = {
    id: 'saved',
    name: 'Portrait hero',
    speed: 30,
    portraitImage: 'broken-image',
  };
  linkTokenCharacter(token, { get: () => character }, character.id);
  manager.setTopDownView(true);
  frame();
  images[0].onerror();
  expect(rendering).toHaveBeenCalledWith(
    expect.any(Error),
    expect.objectContaining({ operation: 'loadPortrait' })
  );
  const visual = adapter._tacticalTokens.get(token);
  expect(visual.image).toBeNull();
  character.portraitImage = 'pending-image';
  adapter.refreshTokenAppearance(token, character);
  const lateLoad = images[1].onload;
  adapter.onTokenRemoved(token);
  expect(images[1].onload).toBeNull();
  expect(images[1].onerror).toBeNull();
  lateLoad();
  expect(visual.context.drawImage).not.toHaveBeenCalled();
});

test('a model arriving after the token is shown is hidden without losing its original visibility', () => {
  const { manager, adapter, token, model, frame } = fixture();
  delete token.__threeMesh;
  model.visible = false;
  manager.setTopDownView(true);
  frame();
  token.__threeMesh = model;
  frame();
  manager.setTopDownView(false);
  frame();
  expect(model.visible).toBe(false);
  adapter.disposeTacticalTokens();
});

test('unavailable canvas rendering surfaces an error once and leaves the original model available', () => {
  HTMLCanvasElement.prototype.getContext.mockReturnValue(null);
  const rendering = jest.spyOn(GameErrors, 'rendering').mockImplementation(() => {});
  const { manager, adapter, token, model, frame } = fixture();
  manager.setTopDownView(true);
  frame();
  frame();
  expect(rendering).toHaveBeenCalledTimes(1);
  expect(model.visible).toBe(true);
  expect(adapter.getTokenVisual(token)).toBe(model);
});
