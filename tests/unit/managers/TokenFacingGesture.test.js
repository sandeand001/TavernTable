import * as three from 'three';
import { InteractionManager } from '../../../src/managers/InteractionManager.js';
import {
  normalizeAngle,
  rotateToken,
} from '../../../src/managers/token-manager/internals/orientation.js';

function fixture(orthographic = false, yaw = 0.6) {
  const view = document.createElement('canvas');
  document.body.appendChild(view);
  view.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 });
  const camera = orthographic
    ? new three.OrthographicCamera(-4, 4, 3, -3, 0.1, 100)
    : new three.PerspectiveCamera(45, 4 / 3, 0.1, 100);
  camera.position.set(Math.sin(yaw) * 8, 7, Math.cos(yaw) * 8);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const token = {
    id: 'facing',
    world: { x: 0, y: 0, z: 0 },
    facingAngle: 0,
    creature: { facingAngle: 0 },
  };
  const gm = {
    placedTokens: [token],
    selectedTokenType: 'mannequin',
    is3DModeActive: () => true,
    isTerrainModeActive: () => false,
    getEventCanvas: () => view,
    pickingService: { pickGroundSync: () => ({ token }) },
    threeSceneManager: { camera, three },
    token3DAdapter: {
      isMovementInProgress: () => false,
      isWallAttached: () => false,
      setSelectedToken: jest.fn(),
      updateTokenOrientation: jest.fn(),
    },
  };
  gm.tokenManager = {
    rotateToken: (target, delta) => rotateToken({ gameManager: gm }, target, delta),
  };
  const manager = new InteractionManager(gm);
  manager.handleLeftClick = jest.fn();
  manager.setupMouseInteractions();
  const screen = (x, z) => {
    const p = new three.Vector3(x, 0, z).project(camera);
    return { clientX: (p.x + 1) * 400, clientY: (1 - p.y) * 300 };
  };
  return { view, token, gm, manager, screen };
}

function mouse(target, type, coordinates, extra = {}) {
  target.dispatchEvent(
    new MouseEvent(type, { bubbles: true, button: 0, ...coordinates, ...extra })
  );
}

describe.each([false, true])('eight-direction facing; orthographic=%s', (orthographic) => {
  test.each(Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4))(
    'snaps to world heading %s under an orbited camera without moving or clicking',
    (heading) => {
      const f = fixture(orthographic);
      const origin = { x: 0.2, z: -0.3 };
      mouse(f.view, 'mousedown', f.screen(origin.x, origin.z));
      const end = f.screen(origin.x + Math.cos(heading) * 2, origin.z + Math.sin(heading) * 2);
      mouse(document, 'mousemove', end, { buttons: 1 });
      mouse(document, 'mouseup', end);
      expect(Math.abs(normalizeAngle(f.token.facingAngle + heading))).toBeLessThan(1e-8);
      expect(f.token.creature.facingAngle).toBe(f.token.facingAngle);
      expect(f.token.world).toEqual({ x: 0, y: 0, z: 0 });
      expect(f.manager.handleLeftClick).not.toHaveBeenCalled();
      f.manager._facingGesture.detach();
      f.view.remove();
    }
  );
});

test('ordinary creature clicks retain the normal click path', () => {
  const f = fixture();
  const point = f.screen(0, 0);
  mouse(f.view, 'mousedown', point);
  mouse(document, 'mouseup', point);
  expect(f.manager.handleLeftClick).toHaveBeenCalledTimes(1);
  expect(f.token.facingAngle).toBe(0);
  f.manager._facingGesture.detach();
  f.view.remove();
});

test.each(['movement', 'wall', 'terrain', 'remove'])('%s prevents a facing drag', (reason) => {
  const f = fixture();
  if (reason === 'movement') f.gm.token3DAdapter.isMovementInProgress = () => true;
  if (reason === 'wall') f.gm.token3DAdapter.isWallAttached = () => true;
  if (reason === 'terrain') f.gm.isTerrainModeActive = () => true;
  if (reason === 'remove') f.gm.selectedTokenType = 'remove';
  mouse(f.view, 'mousedown', f.screen(0, 0));
  mouse(document, 'mousemove', f.screen(-2, 0), { buttons: 1 });
  mouse(document, 'mouseup', f.screen(-2, 0));
  expect(f.manager._facingGesture.active).toBeNull();
  expect(f.token.facingAngle).toBe(0);
  expect(f.manager.handleLeftClick).toHaveBeenCalledTimes(1);
  f.manager._facingGesture.detach();
  f.view.remove();
});

test('Escape restores the original heading and removes drag listeners', () => {
  const f = fixture();
  mouse(f.view, 'mousedown', f.screen(0, 0));
  mouse(document, 'mousemove', f.screen(0, 2), { buttons: 1 });
  expect(f.token.facingAngle).toBeCloseTo(-Math.PI / 2);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  mouse(document, 'mousemove', f.screen(-2, 0), { buttons: 1 });
  expect(f.token.facingAngle).toBe(0);
  expect(f.manager._facingGesture.active).toBeNull();
  f.manager._facingGesture.detach();
  f.view.remove();
});
