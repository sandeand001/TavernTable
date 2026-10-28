import fs from 'fs';
import path from 'path';
import { TextDecoder } from 'util';
import * as three from 'three';
import { Token3DAdapter } from '../../src/scene/Token3DAdapter.js';
import { TOKEN_3D_MODELS } from '../../src/config/token-adapter/MannequinConfig.js';

const projectRoot = path.resolve(__dirname, '..', '..');
const models = new Map();
const clips = new Map();
const sources = new Map();

export function installHumanoidAssetFiles() {
  const decoder = globalThis.TextDecoder;
  const createObjectURL = window.URL.createObjectURL;
  globalThis.TextDecoder = TextDecoder;
  let imageId = 0;
  window.URL.createObjectURL = () => `blob:humanoid-fixture-${imageId++}`;
  const textures = jest
    .spyOn(three.TextureLoader.prototype, 'load')
    .mockImplementation(() => new three.Texture());
  const files = jest
    .spyOn(three.FileLoader.prototype, 'load')
    .mockImplementation(function (url, onLoad, onProgress, onError) {
      let bytes;
      try {
        bytes = fs.readFileSync(
          path.resolve(projectRoot, ...decodeURIComponent(url).split(/[\\/]/))
        );
      } catch (error) {
        queueMicrotask(() => onError(error));
        return;
      }
      const data =
        this.responseType === 'arraybuffer'
          ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
          : bytes.toString('utf8');
      queueMicrotask(() => onLoad(data));
    });
  return () => {
    files.mockRestore();
    textures.mockRestore();
    if (decoder === undefined) delete globalThis.TextDecoder;
    else globalThis.TextDecoder = decoder;
    if (createObjectURL === undefined) delete window.URL.createObjectURL;
    else window.URL.createObjectURL = createObjectURL;
    models.clear();
    clips.clear();
    sources.clear();
  };
}

export async function createHumanoidFixture({
  type = 'mannequin',
  height = 24,
  high = false,
  elevationUnit = 0.3,
  animationKeys = null,
  warmupFrames = 40,
} = {}) {
  const scene = new three.Scene();
  const token = {
    id: `humanoid-${type}`,
    type,
    gridX: high ? 6 : 5,
    gridY: 4,
    facingAngle: 0,
    world: { x: high ? 6.5 : 5.5, y: high ? height * elevationUnit : 0, z: 4.5 },
    movementSettings: { speed: 200, mode: 'walk', type: 'default' },
  };
  const gm = {
    cols: 12,
    rows: 8,
    placedTokens: [token],
    is3DModeActive: () => true,
    getTerrainHeight: (x) => (x >= 6 ? height : 0),
    threeSceneManager: { scene, three },
    spatial: {
      tileWorldSize: 1,
      elevationUnit,
      gridToWorld: (x, y, level) => ({ x, y: level * elevationUnit, z: y }),
      worldToGrid: (x, z) => ({ gridX: Math.floor(x), gridY: Math.floor(z) }),
    },
  };
  const adapter = new Token3DAdapter(gm);
  adapter._modelCache = models;
  adapter._animationClipCache = clips;
  adapter._animationSourceCache = sources;
  gm.token3DAdapter = adapter;
  const config = TOKEN_3D_MODELS[type];
  const animations = animationKeys
    ? Object.fromEntries(animationKeys.map((key) => [key, config.animations[key]]))
    : config.animations;
  const mesh = await adapter._create3DToken(token, scene, { ...config, animations });
  expect(mesh).toBeTruthy();
  const skins = [];
  mesh.traverse((node) => {
    if (node.isSkinnedMesh) skins.push(node);
  });
  const bones = skins[0].skeleton.bones.filter((node) => /(LeftHand|RightHand)$/.test(node.name));
  expect(bones).toHaveLength(2);
  const fixture = { adapter, token, gm, mesh, skins, bones };
  fixture.data = adapter._tokenAnimationData.get(token);
  for (let frame = 0; frame < warmupFrames; frame++) stepHumanoid(fixture);
  return fixture;
}

export function stepHumanoid({ adapter, token, mesh }, delta = 1 / 120) {
  for (const mixer of adapter._animationMixers.values()) mixer.update(delta);
  adapter._updateForwardMovements(delta);
  adapter._updatePlannedMovements();
  adapter._neutralizeRootMotion(token);
  mesh.updateMatrixWorld(true);
}

export function finishHumanoid(fixture, observe = () => {}) {
  for (
    let frame = 0;
    frame < 12000 && fixture.adapter.isMovementInProgress(fixture.token);
    frame++
  ) {
    stepHumanoid(fixture);
    observe();
  }
  expect(fixture.adapter.isMovementInProgress(fixture.token)).toBe(false);
  for (let frame = 0; frame < 40; frame++) stepHumanoid(fixture);
}

export function handPositions(fixture) {
  return fixture.bones.map((bone) => bone.getWorldPosition(new three.Vector3()));
}

export function humanoidBounds(fixture) {
  const bounds = new three.Box3();
  for (const skin of fixture.skins) {
    bounds.union(new three.Box3().setFromObject(skin, true));
  }
  return bounds;
}

export const wallSurface = (y) => ({
  point: { x: 6, y, z: 4.5 },
  normal: { x: -1, y: 0, z: 0 },
});
