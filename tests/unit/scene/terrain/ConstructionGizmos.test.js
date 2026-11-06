import * as three from 'three';
import { ConstructionGizmos } from '../../../../src/scene/terrain/ConstructionGizmos.js';
import { createStructure } from '../../../../src/terrain/ConstructionBlueprints.js';

function fixture(tileWorldSize = 1) {
  const scene = new three.Scene(),
    camera = new three.PerspectiveCamera(45, 4 / 3, 0.1, 1000);
  const gm = {
    spatial: { tileWorldSize },
    threeSceneManager: { three, scene, camera },
    pickingService: {},
  };
  const spec = createStructure({
    id: 'house',
    kind: 'building',
    xFeet: 60,
    zFeet: 60,
    heightFeet: 30,
    lengthFeet: 40,
    widthFeet: 30,
    building: {
      balconies: [{ id: 'deck', floor: 1, side: 'south', u: 0.5, widthFeet: 15, depthFeet: 10 }],
    },
  });
  return { gm, spec, gizmos: new ConstructionGizmos(gm) };
}

test('window handle placement respects quarter-turn buildings and rendering scale while sharing handle geometry', () => {
  const { gm, spec, gizmos } = fixture(2);
  const window = {
    id: 'window',
    floor: 1,
    side: 'south',
    u: 0.5,
    widthFeet: 5,
    heightFeet: 5,
    sillFeet: 2,
  };
  try {
    const rotated = { ...spec, angleRadians: Math.PI / 2 };
    gizmos.showFeature(rotated, window, 'window');
    const handle = gizmos.handles.get('feature-top'),
      geometry = handle.geometry;
    expect(handle.position.x).toBeCloseTo((60 - 15.15) * 0.4);
    expect(handle.position.y).toBeCloseTo(17 * 0.4);
    expect(handle.position.z).toBeCloseTo(60 * 0.4);
    gizmos.showFeature(rotated, { ...window, heightFeet: 15 }, 'window');
    expect(gizmos.handles.get('feature-top').geometry).toBe(geometry);
    gizmos.show(rotated);
    expect(handle.visible).toBe(false);
    expect(gizmos.handles.get('height').visible).toBe(true);
  } finally {
    gizmos.dispose();
  }
  expect(gm.threeSceneManager.scene.getObjectByName('ConstructionHandles')).toBeUndefined();
});

test('a balcony can be selected by its outer railing rather than only its doorway, with real surface occlusion', () => {
  const { gm, spec, gizmos } = fixture();
  const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) };
  const target = new three.Vector3(12, 2.4, 16.96);
  gm.threeSceneManager.camera.position.set(12, 4, 22);
  gm.threeSceneManager.camera.lookAt(target);
  gm.threeSceneManager.camera.updateMatrixWorld(true);
  gm.pickingService.pickGroundSync = () => ({ surface: { point: target } });
  try {
    expect(gizmos.pickFeature({ clientX: 400, clientY: 300 }, canvas, spec, 'balcony').id).toBe(
      'deck'
    );
    const closer = gm.threeSceneManager.camera.position.clone().lerp(target, 0.1);
    gm.pickingService.pickGroundSync = () => ({ surface: { point: closer } });
    expect(gizmos.pickFeature({ clientX: 400, clientY: 300 }, canvas, spec, 'balcony')).toBeNull();
  } finally {
    gizmos.dispose();
  }
});
