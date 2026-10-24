import * as three from 'three';
import {
  D20_NUMBER_TO_FACE_INDEX,
  getD20ColliderData,
  orientMeshToFaceIndex,
  resolveUpFacingFace,
} from '../../../../src/systems/dice/DiceState.js';
import { loadD20Model } from '../../../helpers/d20-model.js';

const model = loadD20Model();

describe('The numbered facets of the real gold d20', () => {
  test.each(Object.entries(D20_NUMBER_TO_FACE_INDEX))(
    'reads face %s independently of triangulation, yaw, position, and scale',
    (value, faceIndex) => {
      for (const yaw of [0, 0.4, 1.2]) {
        const mesh = model.clone(true);
        mesh.scale.setScalar(3.6);
        mesh.position.set(4, 13, -7);
        orientMeshToFaceIndex(mesh, faceIndex, three);
        mesh.quaternion.premultiply(
          new three.Quaternion().setFromAxisAngle(new three.Vector3(0, 1, 0), yaw)
        );

        expect(resolveUpFacingFace(mesh, three)?.value).toBe(Number(value));
      }
    }
  );

  test('builds a compact closed convex collider from the twenty numbered planes', () => {
    const data = getD20ColliderData(model, three);

    expect(data.numberedFaces.map((face) => face.value)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1)
    );
    expect(data.faces).toHaveLength(20);
    expect(data.vertices.length).toBeGreaterThanOrEqual(12);
    expect(data.vertices.length).toBeLessThanOrEqual(40);
    expect(data.radius).toBeGreaterThan(0.5);
    expect(data.radius).toBeLessThan(1);
    for (const vertex of data.vertices) {
      for (const face of data.numberedFaces) {
        expect(face.normal.dot(vertex)).toBeLessThanOrEqual(face.plane + 1e-4);
      }
    }
    const edgeUse = new Map();
    for (const face of data.faces) {
      expect(face.length).toBeGreaterThanOrEqual(3);
      for (let i = 0; i < face.length; i += 1) {
        const key = [face[i], face[(i + 1) % face.length]].sort((a, b) => a - b).join(',');
        edgeUse.set(key, (edgeUse.get(key) || 0) + 1);
      }
    }
    expect([...edgeUse.values()].every((count) => count === 2)).toBe(true);
  });
});
