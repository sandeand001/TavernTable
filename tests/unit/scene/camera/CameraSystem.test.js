import * as three from 'three';
import { installCameraMethods } from '../../../../src/scene/camera/CameraSystem.js';
import { PickingService } from '../../../../src/scene/picking/PickingService.js';
import { StateCoordinator } from '../../../../src/coordinators/StateCoordinator.js';

class CameraHarness {
  constructor({ cols = 25, rows = 25, tileSize = 1, width = 1000, height = 700 } = {}) {
    this.three = three;
    this.viewport = { width, height };
    const container = document.createElement('div');
    Object.defineProperties(container, {
      clientWidth: { get: () => this.viewport.width },
      clientHeight: { get: () => this.viewport.height },
    });
    this.canvas = document.createElement('canvas');
    container.appendChild(this.canvas);
    this.canvas.width = width * 2;
    this.canvas.height = height * 2;
    this.canvas.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: this.viewport.width,
      height: this.viewport.height,
    });
    this.renderer = { domElement: this.canvas };
    this.camera = new three.OrthographicCamera(-20, 20, 20, -20, -100, 500);
    this.scene = new three.Scene();
    this.gameManager = {
      cols,
      rows,
      tileWidth: 64,
      tileHeight: 32,
      getViewMode: () => 'isometric',
      is3DModeActive: () => true,
      getTerrainHeight: () => 0,
      spatial: {
        tileWorldSize: tileSize,
        elevationUnit: 0.3,
        worldToGrid: (x, z) => ({
          gridX: Math.floor(x / tileSize),
          gridY: Math.floor(z / tileSize),
        }),
      },
      cameraRig: { attach: jest.fn() },
      threeSceneManager: this,
    };
    this._isoMode = true;
    this._isoYaw = 4.686209041604776;
    this._isoPitch = 0.17352511420554814;
    this._isoManualLock = true;
    this._isoPresetPitchDeg = 35.264389682754654;
    this._panCx = null;
    this._panCz = null;
    this._zoom = 1;
    this._targetZoom = 1;
    this._minZoom = 0.35;
    this._maxZoom = 3;
    this._zoomEase = 0;
    this._updateSunCoverage = jest.fn();
  }
}

installCameraMethods(CameraHarness.prototype);

function project(manager, point) {
  manager.camera.updateMatrixWorld(true);
  const ndc = point.clone().project(manager.camera);
  return {
    x: ((ndc.x + 1) * manager.viewport.width) / 2,
    y: ((1 - ndc.y) * manager.viewport.height) / 2,
    ndc,
  };
}

function oppositeEdges(manager) {
  const { cols, rows, spatial } = manager.gameManager;
  const width = cols * spatial.tileWorldSize;
  const depth = rows * spatial.tileWorldSize;
  const acrossX = Math.abs(Math.cos(manager._isoYaw)) < 0.5;
  const pairs = acrossX
    ? [
        [new three.Vector3(0, 0, 0), new three.Vector3(width, 0, 0)],
        [new three.Vector3(0, 0, depth), new three.Vector3(width, 0, depth)],
      ]
    : [
        [new three.Vector3(0, 0, 0), new three.Vector3(0, 0, depth)],
        [new three.Vector3(width, 0, 0), new three.Vector3(width, 0, depth)],
      ];
  return pairs
    .map(([a, b]) => {
      const p = project(manager, a);
      const q = project(manager, b);
      const middle = a.clone().add(b).multiplyScalar(0.5);
      return {
        width: Math.hypot(p.x - q.x, p.y - q.y),
        distance: -middle.applyMatrix4(manager.camera.matrixWorldInverse).z,
      };
    })
    .sort((a, b) => a.distance - b.distance);
}

function groundPoint(manager, x, y) {
  manager.camera.updateMatrixWorld(true);
  const raycaster = new three.Raycaster();
  raycaster.setFromCamera(
    new three.Vector2((x / manager.viewport.width) * 2 - 1, 1 - (y / manager.viewport.height) * 2),
    manager.camera
  );
  return raycaster.ray.intersectPlane(
    new three.Plane(new three.Vector3(0, 1, 0), 0),
    new three.Vector3()
  );
}

describe('Natural 3D perspective and tactical top-down', () => {
  afterEach(() => localStorage.removeItem('taverntable.viewMode'));

  test.each([0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2, 4.686209041604776])(
    'the near edge is wider at side-on yaw %s',
    (yaw) => {
      const manager = new CameraHarness();
      manager._isoYaw = yaw;
      manager.reframe();
      const [near, far] = oppositeEdges(manager);

      expect(manager.camera.isPerspectiveCamera).toBe(true);
      expect(manager.camera.near).toBeGreaterThan(0);
      expect(near.width / far.width).toBeGreaterThan(1.1);
    }
  );

  test.each([
    [25, 25, 1, 1400, 800],
    [25, 25, 1, 600, 900],
    [50, 12, 2, 900, 700],
  ])(
    'frames a %sx%s board at tile size %s in a %sx%s viewport',
    (cols, rows, tileSize, width, height) => {
      const manager = new CameraHarness({ cols, rows, tileSize, width, height });
      manager.reframe();

      expect(manager.camera.aspect).toBeCloseTo(width / height);
      for (const x of [0, cols * tileSize]) {
        for (const z of [0, rows * tileSize]) {
          const { ndc } = project(manager, new three.Vector3(x, 0, z));
          expect(Math.abs(ndc.x)).toBeLessThanOrEqual(1);
          expect(Math.abs(ndc.y)).toBeLessThanOrEqual(1);
          expect(ndc.z).toBeGreaterThan(-1);
          expect(ndc.z).toBeLessThan(1);
        }
      }
    }
  );

  test('top-down is orthographic and returning restores the orbit pose and focus', () => {
    const manager = new CameraHarness();
    manager.reframe();
    manager.setCameraTarget(8, 11);
    manager.setZoom(1.2);
    manager._updateZoom(16);
    const orbit = { yaw: manager._isoYaw, pitch: manager._isoPitch };

    manager.setTopDownView(true);
    expect(manager.camera.isOrthographicCamera).toBe(true);
    const [near, far] = oppositeEdges(manager);
    expect(near.width / far.width).toBeCloseTo(1, 8);

    manager.setTopDownView(false);
    expect(manager.camera.isPerspectiveCamera).toBe(true);
    expect(manager._isoYaw).toBe(orbit.yaw);
    expect(manager._isoPitch).toBe(orbit.pitch);
    expect(manager._panCx).toBe(8);
    expect(manager._panCz).toBe(11);
    expect(manager.getZoom()).toBe(1.2);
    expect(manager.gameManager.cameraRig.attach.mock.lastCall[0]).toBe(manager.camera);
  });

  test('perspective zoom keeps the cursor ground point fixed using CSS pixels', () => {
    const manager = new CameraHarness();
    manager._isoPitch = 0.65;
    manager.reframe();
    const before = groundPoint(manager, 650, 420);

    manager.zoomAtScreenPoint(1.5, 650, 420);

    expect(groundPoint(manager, 650, 420).distanceTo(before)).toBeLessThan(1e-6);
  });

  test('perspective panning grabs the ground without changing the orbit angle', () => {
    const manager = new CameraHarness();
    manager._isoPitch = 0.65;
    manager.reframe();
    const point = new three.Vector3(12.5, 0, 12.5);
    const before = project(manager, point);
    const yaw = manager._isoYaw;

    manager.panBy(35, -20);

    const after = project(manager, point);
    expect(after.x - before.x).toBeCloseTo(35);
    expect(after.y - before.y).toBeCloseTo(-20);
    expect(manager._isoYaw).toBe(yaw);
  });

  test('orbiting after panning preserves the chosen focus', () => {
    const manager = new CameraHarness();
    manager.reframe();
    manager.setCameraTarget(7, 9);

    manager.setIsoAngles({ yaw: 0.7, pitch: 0.5 });

    const focus = project(manager, new three.Vector3(7, 0, 9));
    expect(focus.x).toBeCloseTo(manager.viewport.width / 2);
    expect(focus.y).toBeCloseTo(manager.viewport.height / 2);
  });

  test('picking follows the active lens when switching views', () => {
    const manager = new CameraHarness();
    manager._isoPitch = 0.65;
    manager.reframe();
    const picker = new PickingService({ gameManager: manager.gameManager });
    const point = new three.Vector3(7.5, 0, 10.5);
    for (const topDown of [false, true, false]) {
      manager.setTopDownView(topDown);
      const pixel = project(manager, point);
      const hit = picker._executeGroundPick(three, pixel.x, pixel.y, manager.canvas);
      expect(hit.grid).toEqual({ gx: 7, gy: 10 });
      expect(
        new three.Vector3(hit.world.x, hit.world.y, hit.world.z).distanceTo(point)
      ).toBeLessThan(1e-6);
    }
  });

  test('view-mode changes update the lens without relying on settings-panel listeners', () => {
    const manager = new CameraHarness();
    const coordinator = new StateCoordinator(manager.gameManager);
    manager.gameManager.getViewMode = () => coordinator.getViewMode();
    manager.reframe();

    coordinator.setViewMode('topdown');
    expect(manager.camera.isOrthographicCamera).toBe(true);
    coordinator.setViewMode('isometric');
    expect(manager.camera.isPerspectiveCamera).toBe(true);
  });

  test('startup restores the stored top-down lens before settings controls exist', () => {
    const key = 'taverntable.viewMode';
    const previous = localStorage.getItem(key);
    try {
      localStorage.setItem(key, 'topdown');
      const manager = new CameraHarness();
      const coordinator = new StateCoordinator(manager.gameManager);
      manager.gameManager.getViewMode = () => coordinator.getViewMode();

      coordinator.initializeViewMode();

      expect(coordinator.getViewMode()).toBe('topdown');
      expect(manager.camera.isOrthographicCamera).toBe(true);
      expect(manager._isoPitch).toBeCloseTo((89.9 * Math.PI) / 180);
      coordinator.setViewMode('isometric');
      expect(manager.camera.isPerspectiveCamera).toBe(true);
    } finally {
      if (previous === null) localStorage.removeItem(key);
      else localStorage.setItem(key, previous);
    }
  });
});
