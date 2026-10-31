import * as three from 'three';
import { CHARACTER_DEFINITIONS } from '../../../src/config/CharacterCatalog.js';
import { InteractionManager } from '../../../src/managers/InteractionManager.js';
import { rotateToken } from '../../../src/managers/token-manager/internals/orientation.js';
import {
  createHumanoidFixture,
  installHumanoidAssetFiles,
} from '../../helpers/humanoid-fixture.js';

let restoreFiles;
beforeAll(() => {
  restoreFiles = installHumanoidAssetFiles();
});
afterAll(() => restoreFiles());

test.each(
  CHARACTER_DEFINITIONS.map(({ id }) => id).flatMap((type) =>
    [false, true].flatMap((topDown) => [0.6, 2.2].map((yaw) => ({ type, topDown, yaw })))
  )
)(
  'the rendered $type faces the dragged grid direction; topDown=$topDown yaw=$yaw',
  async ({ type, topDown, yaw }) => {
    const fixture = await createHumanoidFixture({ type, height: 0, animationKeys: ['idle'] });
    const { gm, token, adapter, mesh } = fixture;
    const view = document.createElement('canvas');
    document.body.append(view);
    view.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 });
    const camera = topDown
      ? new three.OrthographicCamera(-4, 4, 3, -3, 0.1, 100)
      : new three.PerspectiveCamera(45, 4 / 3, 0.1, 100);
    const radius = topDown ? 8 * Math.cos((89.9 * Math.PI) / 180) : 8;
    camera.position.set(
      token.world.x + Math.sin(yaw) * radius,
      topDown ? 8 * Math.sin((89.9 * Math.PI) / 180) : 7,
      token.world.z + Math.cos(yaw) * radius
    );
    camera.lookAt(token.world.x, 0, token.world.z);
    camera.updateMatrixWorld(true);
    gm.getEventCanvas = () => view;
    Object.assign(gm.threeSceneManager, { camera, three });
    gm.pickingService = { pickGroundSync: () => ({ token }) };
    gm.tokenManager = {
      rotateToken: (target, delta) => rotateToken({ gameManager: gm }, target, delta),
    };
    gm.tokenFacingRight = true;
    const manager = new InteractionManager(gm);
    manager._selectTokenEntry = jest.fn();
    manager.handleLeftClick = jest.fn();
    manager.setupMouseInteractions();
    const world = { ...token.world };
    const screen = (x, z) => {
      const p = new three.Vector3(x, 0, z).project(camera);
      return { clientX: (p.x + 1) * 400, clientY: (1 - p.y) * 300 };
    };
    const mouse = (target, event, point) =>
      target.dispatchEvent(
        new MouseEvent(event, {
          bubbles: true,
          button: 0,
          buttons: event === 'mouseup' ? 0 : 1,
          ...point,
        })
      );
    try {
      for (let index = 0; index < 8; index++) {
        const direction = new three.Vector3(
          Math.cos((index * Math.PI) / 4),
          0,
          Math.sin((index * Math.PI) / 4)
        );
        adapter._orientTokenTowardsWorld(token, {
          x: world.x + direction.x * 2,
          y: world.y,
          z: world.z + direction.z * 2,
        });
        mesh.updateMatrixWorld(true);
        expect(
          new three.Vector3(0, 0, 1).transformDirection(mesh.matrixWorld).dot(direction)
        ).toBeCloseTo(1, 8);
        token.facingAngle = 0;
        adapter.updateTokenOrientation(token);
        const start = screen(world.x, world.z);
        const end = screen(world.x + direction.x * 2, world.z + direction.z * 2);
        mouse(view, 'mousedown', start);
        mouse(document, 'mousemove', end);
        mouse(document, 'mouseup', end);
        mesh.updateMatrixWorld(true);
        const visibleForward = new three.Vector3(0, 0, 1).transformDirection(mesh.matrixWorld);
        expect(visibleForward.dot(direction)).toBeCloseTo(1, 8);
        const movementForward = adapter._getDirectionalVectorFromYaw(
          adapter._getMovementYaw(token)
        );
        expect(movementForward.x).toBeCloseTo(direction.x, 8);
        expect(movementForward.z).toBeCloseTo(direction.z, 8);
        expect(token.world).toEqual(world);
      }
      expect(manager.handleLeftClick).not.toHaveBeenCalled();
    } finally {
      manager._facingGesture.detach();
      adapter.disposeMovementRange();
      view.remove();
    }
  },
  30000
);
