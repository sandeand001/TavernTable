// Model loading and material management for the d20 dice system.
// Extracted from dice3d.js (Phase 7).

import { diceState, hasWindow, getSceneManager } from './DiceState.js';

const D20_MODEL_PATH = 'assets/Items/d20-gold.glb';
const CRIT_FAILURE_COLOR_HEX = 0xb3261e;
const CRIT_SUCCESS_COLOR_HEX = 0x1f8f3a;

export async function ensureThreeNamespace() {
  if (diceState.threeNamespace) return diceState.threeNamespace;
  const manager = getSceneManager();
  if (manager?.three) {
    diceState.threeNamespace = manager.three;
    return diceState.threeNamespace;
  }
  const mod = await import('three');
  diceState.threeNamespace = mod;
  return diceState.threeNamespace;
}

export async function ensureLoaderCtor() {
  if (diceState.gltfLoaderCtor) return diceState.gltfLoaderCtor;
  const mod = await import('three/examples/jsm/loaders/GLTFLoader.js');
  diceState.gltfLoaderCtor = mod.GLTFLoader || mod.default;
  return diceState.gltfLoaderCtor;
}

export async function ensureBlueprint() {
  if (diceState.diceBlueprint) return diceState.diceBlueprint;
  if (!diceState.blueprintPromise) {
    diceState.blueprintPromise = (async () => {
      await ensureThreeNamespace();
      const Loader = await ensureLoaderCtor();
      const loader = new Loader();
      const gltf = await loader.loadAsync(D20_MODEL_PATH);
      const root = gltf.scene || gltf.scenes?.[0];
      if (!root) throw new Error('d20 GLB missing scene');
      root.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          if (child.material?.clone) {
            child.material = child.material.clone();
          }
        }
      });
      try {
        const bounds = new diceState.threeNamespace.Box3().setFromObject(root);
        if (Number.isFinite(bounds.min?.y)) {
          diceState.blueprintGroundLift = -bounds.min.y;
        }
      } catch (_) {
        diceState.blueprintGroundLift = 0;
      }
      diceState.diceBlueprint = root;
      return root;
    })().catch((error) => {
      diceState.blueprintPromise = null;
      throw error;
    });
  }
  return diceState.blueprintPromise;
}

export function cloneDice(base) {
  const clone = base.clone(true);
  clone.traverse((child) => {
    if (child.isMesh) {
      if (child.material?.clone) {
        child.material = child.material.clone();
      }
      applyDiceMaterialTuning(child.material);
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  if (!clone.userData) clone.userData = {};
  clone.userData.groundLiftBase = diceState.blueprintGroundLift;
  recordDiceBaseMaterialState(clone);
  return clone;
}

export function applyDiceMaterialTuning(material) {
  if (!material) return;
  if (material.color?.offsetHSL) {
    material.color.offsetHSL(0, -0.08, 0.25);
  } else if (material.color?.multiplyScalar) {
    material.color.multiplyScalar(1.2);
  }
  if (material.emissive?.setHex) {
    material.emissive.setHex(0x2d1500);
    material.emissiveIntensity = Math.max(material.emissiveIntensity ?? 0.2, 0.8);
  }
  if (typeof material.metalness === 'number') {
    material.metalness = Math.min(material.metalness, 0.45);
  }
  if (typeof material.roughness === 'number') {
    material.roughness = Math.max(material.roughness, 0.25);
  }
  if ('toneMapped' in material) {
    material.toneMapped = false;
  }
  if ('envMapIntensity' in material && typeof material.envMapIntensity === 'number') {
    material.envMapIntensity = Math.max(material.envMapIntensity, 1.1);
  }
}

export function recordDiceBaseMaterialState(mesh) {
  if (!mesh) return;
  const materialState = [];
  mesh.traverse((child) => {
    if (!child?.isMesh || !child.material) return;
    const material = child.material;
    materialState.push({
      material,
      colorHex: material.color?.getHex ? material.color.getHex() : null,
      emissiveHex: material.emissive?.getHex ? material.emissive.getHex() : null,
      emissiveIntensity:
        typeof material.emissiveIntensity === 'number' ? material.emissiveIntensity : null,
    });
  });
  if (!mesh.userData) mesh.userData = {};
  mesh.userData.d20BaseMaterialState = materialState;
}

export function resetDiceMaterialColors(mesh) {
  const state = mesh?.userData?.d20BaseMaterialState;
  if (!Array.isArray(state)) return;
  state.forEach((entry) => {
    const material = entry.material;
    if (!material) return;
    if (entry.colorHex != null && material.color?.setHex) {
      material.color.setHex(entry.colorHex);
    }
    if (entry.emissiveHex != null && material.emissive?.setHex) {
      material.emissive.setHex(entry.emissiveHex);
    }
    if (entry.emissiveIntensity != null && typeof material.emissiveIntensity === 'number') {
      material.emissiveIntensity = entry.emissiveIntensity;
    }
  });
}

export function tintDiceMaterial(mesh, colorHex) {
  if (!mesh || !Number.isFinite(colorHex)) return;
  mesh.traverse((child) => {
    if (!child?.isMesh || !child.material) return;
    if (child.material.color?.setHex) {
      child.material.color.setHex(colorHex);
    }
    if (child.material.emissive?.setHex) {
      child.material.emissive.setHex(colorHex);
      if (typeof child.material.emissiveIntensity === 'number') {
        child.material.emissiveIntensity = Math.max(child.material.emissiveIntensity, 1.05);
      } else {
        child.material.emissiveIntensity = 1.05;
      }
    }
  });
}

export function applyCriticalRollTint(mesh, rollValue) {
  if (!mesh) return;
  const normalized = Number(rollValue);
  const resolvedValue = Number.isFinite(normalized) ? Math.trunc(normalized) : null;
  if (resolvedValue === 1) {
    resetDiceMaterialColors(mesh);
    tintDiceMaterial(mesh, CRIT_FAILURE_COLOR_HEX);
    return;
  }
  if (resolvedValue === 20) {
    resetDiceMaterialColors(mesh);
    tintDiceMaterial(mesh, CRIT_SUCCESS_COLOR_HEX);
    return;
  }
  resetDiceMaterialColors(mesh);
}

export function preloadD20Asset() {
  if (!hasWindow()) return Promise.resolve(false);
  return ensureBlueprint()
    .then(() => true)
    .catch(() => false);
}
