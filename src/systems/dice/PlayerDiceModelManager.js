import {
  PLAYER_DICE_MODEL_PATH,
  PLAYER_DICE_TEXTURE_BASE,
  getPlayerDiceColor,
  getPlayerDiceDefinition,
} from '../../config/PlayerDiceCatalog.js';
import { ensureThreeNamespace, recordDiceBaseMaterialState } from './DiceModelManager.js';

let loaderConstructor = null;
let blueprint = null;
let blueprintPromise = null;
let authoritativeBlueprint = null;
let authoritativeBlueprintPromise = null;
const textureSets = new Map();

async function getLoaderConstructor() {
  if (loaderConstructor) return loaderConstructor;
  const module = await import('three/examples/jsm/loaders/GLTFLoader.js');
  loaderConstructor = module.GLTFLoader || module.default;
  return loaderConstructor;
}

function parseBlueprint(gltf) {
  const scene = gltf.scene || gltf.scenes?.[0];
  if (!scene) throw new Error('Player dice GLB is missing its scene');
  for (const sides of [4, 6, 8, 10, 12, 20]) {
    const definition = getPlayerDiceDefinition(sides);
    const mesh = scene.getObjectByName(definition.meshName);
    if (!mesh?.isMesh) throw new Error(`Player dice GLB is missing ${definition.meshName}`);
  }
  return scene;
}

export async function ensurePlayerDiceBlueprint() {
  if (blueprint) return blueprint;
  if (!blueprintPromise) {
    blueprintPromise = (async () => {
      const Loader = await getLoaderConstructor();
      const gltf = await new Loader().loadAsync(PLAYER_DICE_MODEL_PATH);
      blueprint = parseBlueprint(gltf);
      return blueprint;
    })().catch((error) => {
      blueprintPromise = null;
      throw error;
    });
  }
  return blueprintPromise;
}

export async function ensureAuthoritativePlayerDiceBlueprint(geometryKey) {
  if (typeof geometryKey !== 'string' || !/^[a-f0-9]{64}$/.test(geometryKey))
    throw new Error('The host supplied an invalid player dice asset key');
  if (!authoritativeBlueprint) {
    if (!authoritativeBlueprintPromise) {
      authoritativeBlueprintPromise = (async () => {
        if (!globalThis.crypto?.subtle)
          throw new Error('Verified player dice replay requires a secure browser origin');
        const response = await fetch(PLAYER_DICE_MODEL_PATH);
        if (!response.ok) throw new Error('The player dice model could not be loaded');
        const bytes = await response.arrayBuffer();
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        const key = Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, '0')
        ).join('');
        if (key !== geometryKey)
          throw new Error('The player dice model does not match the host simulation');
        const Loader = await getLoaderConstructor();
        const gltf = await new Loader().parseAsync(bytes, '');
        authoritativeBlueprint = { key, root: parseBlueprint(gltf) };
        return authoritativeBlueprint;
      })().catch((error) => {
        authoritativeBlueprintPromise = null;
        throw error;
      });
    }
    return authoritativeBlueprintPromise;
  }
  if (authoritativeBlueprint.key !== geometryKey)
    throw new Error('The player dice model does not match the host simulation');
  return authoritativeBlueprint;
}

async function loadTextureSet(color) {
  const selected = getPlayerDiceColor(color);
  if (!selected) throw new Error('Choose a supported dice color');
  if (textureSets.has(selected.id)) return textureSets.get(selected.id);
  const promise = (async () => {
    const three = await ensureThreeNamespace();
    const loader = new three.TextureLoader();
    const base = `${PLAYER_DICE_TEXTURE_BASE}/${selected.variant}`;
    const [baseColor, normal, roughness] = await Promise.all([
      loader.loadAsync(`${base}/basecolor.png`),
      loader.loadAsync(`${base}/normal.png`),
      loader.loadAsync(`${base}/roughness.png`),
    ]);
    baseColor.colorSpace = three.SRGBColorSpace;
    baseColor.name = `${selected.id}-base-color`;
    normal.name = `${selected.id}-normal`;
    roughness.name = `${selected.id}-roughness`;
    return { baseColor, normal, roughness };
  })().catch((error) => {
    textureSets.delete(selected.id);
    throw error;
  });
  textureSets.set(selected.id, promise);
  return promise;
}

export async function clonePlayerDie(root, sides, color) {
  const three = await ensureThreeNamespace();
  const definition = getPlayerDiceDefinition(sides);
  const source = root.getObjectByName(definition.meshName);
  if (!source?.isMesh) throw new Error(`Player dice mesh is unavailable: ${definition.meshName}`);
  const textures = await loadTextureSet(color);
  const material = new three.MeshStandardMaterial({
    name: `player-dice-${color}`,
    map: textures.baseColor,
    normalMap: textures.normal,
    roughnessMap: textures.roughness,
    roughness: 0.55,
    metalness: 0.04,
  });
  material.normalScale?.set(0.75, 0.75);
  const mesh = new three.Mesh(source.geometry.clone(), material);
  mesh.name = definition.meshName;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.diceSides = definition.sides;
  mesh.userData.diceColor = color;
  mesh.userData.faceValues = definition.faceValues;
  mesh.userData.resultFaceDirection = definition.resultFaceDirection;
  recordDiceBaseMaterialState(mesh);
  return mesh;
}

export async function ensurePlayerDie(sides, color) {
  const root = await ensurePlayerDiceBlueprint();
  return clonePlayerDie(root, sides, color);
}

export function preloadPlayerDiceAssets() {
  return ensurePlayerDiceBlueprint()
    .then(() => true)
    .catch(() => false);
}
