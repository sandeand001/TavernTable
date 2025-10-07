import { CameraRig } from '../../src/scene/CameraRig.js';

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
});
