import { CameraRig } from '../../../../src/scene/camera/CameraRig.js';
import { PerspectiveCamera, Vector3 } from 'three';

describe('CameraRig', () => {
  function makeCamera() {
    return {
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      position: { x: 0, y: 40, z: 0 },
      updateProjectionMatrix: jest.fn(),
      lookAt: jest.fn(),
    };
  }

  test('attach & basic pan/zoom apply expected changes', () => {
    const cam = makeCamera();
    const rig = new CameraRig({ baseSpan: 10, startZoom: 1 });
    rig.attach(cam);
    const initialLeft = cam.left;
    rig.zoomOut();
    expect(rig.zoom).toBeGreaterThan(1);
    rig.pan(5, 3);
    expect(rig.target.x).toBe(25); // default 20 + 5
    expect(rig.target.z).toBe(23); // default 20 + 3
    expect(cam.lookAt).toHaveBeenCalled();
    expect(cam.left).not.toBe(initialLeft); // projection updated
  });

  test('zoom clamps within bounds', () => {
    const cam = makeCamera();
    const rig = new CameraRig({ minZoom: 0.5, maxZoom: 2, startZoom: 1 });
    rig.attach(cam);
    rig.setZoom(0.1);
    expect(rig.zoom).toBe(0.5);
    rig.setZoom(5);
    expect(rig.zoom).toBe(2);
  });

  test.each([1, 0.5])('perspective pan preserves direction and lens at rig zoom %s', (zoom) => {
    const camera = new PerspectiveCamera(35, 16 / 9, 0.1, 1000);
    camera.position.set(30, 20, 10);
    camera.lookAt(10, 0, 15);
    const rig = new CameraRig({ target: { x: 10, z: 15 } });
    rig.attach(camera, { zoom });
    const direction = camera.getWorldDirection(new Vector3());

    rig.pan(3, -4);
    expect(camera.position.toArray()).toEqual([33, 20, 6]);
    expect(camera.getWorldDirection(new Vector3()).distanceTo(direction)).toBeLessThan(1e-6);
    expect(camera.zoom).toBe(1);

    rig.zoomIn();
    expect(camera.zoom).toBeGreaterThan(1);
    expect(camera.aspect).toBe(16 / 9);
  });

  test('panning and changing focus height preserve the camera direction', () => {
    const camera = new PerspectiveCamera(35, 16 / 9, 0.1, 1000);
    camera.position.set(30, 25, 10);
    camera.lookAt(10, 5, 15);
    const rig = new CameraRig({ target: { x: 10, y: 5, z: 15 } });
    rig.attach(camera);
    const direction = camera.getWorldDirection(new Vector3());
    rig.pan(3, -4);
    expect(camera.position.toArray()).toEqual([33, 25, 6]);
    rig.setTarget(13, 11, 9);
    expect(camera.position.toArray()).toEqual([33, 29, 6]);
    expect(camera.getWorldDirection(new Vector3()).distanceTo(direction)).toBeLessThan(1e-6);
    expect(camera.zoom).toBe(1);
  });
});
