import { readFileSync } from 'node:fs';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import * as three from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  PLAYER_DICE_DEFINITIONS,
  PLAYER_DICE_MODEL_PATH,
  getPlayerDiceDefinition,
} from '../../../../src/config/PlayerDiceCatalog.js';
import {
  getPlayerDiceColliderData,
  resolvePlayerDiceFace,
} from '../../../../src/systems/dice/DiceState.js';

let scene;

beforeAll(async () => {
  globalThis.TextDecoder = TextDecoder;
  const bytes = readFileSync(path.resolve(PLAYER_DICE_MODEL_PATH));
  const buffer = new Uint8Array(bytes).buffer;
  const gltf = await new GLTFLoader().parseAsync(buffer, '');
  scene = gltf.scene;
});

describe('player dice runtime geometry', () => {
  test('d4 face clusters preserve the visible 1/2/3/4 atlas mapping', () => {
    expect(getPlayerDiceDefinition(4).faceValues).toEqual([2, 4, 3, 1]);
  });

  test.each(Object.keys(PLAYER_DICE_DEFINITIONS).map(Number))(
    'the d%s collider has one readable value for every numbered face',
    (sides) => {
      const definition = getPlayerDiceDefinition(sides);
      const mesh = scene.getObjectByName(definition.meshName);
      const geometry = getPlayerDiceColliderData(mesh, definition, three);

      expect(geometry.numberedFaces.map((face) => face.value).sort((a, b) => a - b)).toEqual(
        Array.from({ length: sides }, (_, index) => index + 1)
      );
      expect(geometry.faces).toHaveLength(sides);
      expect(geometry.radius).toBeGreaterThan(0.4);
      expect(geometry.radius).toBeLessThan(1);

      for (const face of geometry.numberedFaces) {
        const oriented = mesh.clone();
        const direction = new three.Vector3(
          0,
          definition.resultFaceDirection === 'down' ? -1 : 1,
          0
        );
        oriented.quaternion.setFromUnitVectors(face.normal, direction);
        oriented.updateMatrixWorld(true);
        expect(resolvePlayerDiceFace(oriented, definition, three)?.value).toBe(face.value);
      }
    }
  );
});
