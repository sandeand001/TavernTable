import { DICE_CONFIG } from '../../config/GameConstants.js';

const D20_MODEL_PATH = 'assets/Items/d20-gold.glb';
const DEFAULT_SCALE = 3.6;
const TRAVEL_DURATION_MS = 1800;
const SNAP_DURATION_MS = 320;
const D20_3D_SETTINGS = DICE_CONFIG?.D20_3D || {};
const DEFAULT_REST_HEIGHT =
  typeof D20_3D_SETTINGS.REST_HEIGHT === 'number' ? D20_3D_SETTINGS.REST_HEIGHT : 0;

let threeNamespace;
let gltfLoaderCtor;
let blueprintPromise;
let diceBlueprint;
let blueprintGroundLift = 0;
let activeDieState;

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const randomBetween = (min, max) => min + Math.random() * (max - min);

function clearActiveDie() {
  if (!activeDieState) return;
  try {
    activeDieState.dispose?.();
  } catch (_) {
    if (activeDieState.mesh?.parent) {
      activeDieState.mesh.parent.remove(activeDieState.mesh);
    }
  }
  activeDieState = null;
}

const hasWindow = () => typeof window !== 'undefined';

function getSceneManager() {
  if (!hasWindow()) return null;
  return window.gameManager?.threeSceneManager || null;
}

async function ensureThreeNamespace() {
  if (threeNamespace) return threeNamespace;
  const manager = getSceneManager();
  if (manager?.three) {
    threeNamespace = manager.three;
    return threeNamespace;
  }
  const mod = await import('three');
  threeNamespace = mod;
  return threeNamespace;
}

async function ensureLoaderCtor() {
  if (gltfLoaderCtor) return gltfLoaderCtor;
  const mod = await import('three/examples/jsm/loaders/GLTFLoader.js');
  gltfLoaderCtor = mod.GLTFLoader || mod.default;
  return gltfLoaderCtor;
}

async function ensureBlueprint() {
  if (diceBlueprint) return diceBlueprint;
  if (!blueprintPromise) {
    blueprintPromise = (async () => {
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
        const bounds = new threeNamespace.Box3().setFromObject(root);
        if (Number.isFinite(bounds.min?.y)) {
          blueprintGroundLift = -bounds.min.y;
        }
      } catch (_) {
        blueprintGroundLift = 0;
      }
      diceBlueprint = root;
      return root;
    })().catch((error) => {
      blueprintPromise = null;
      throw error;
    });
  }
  return blueprintPromise;
}

function cloneDice(base) {
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
  clone.userData.groundLiftBase = blueprintGroundLift;
  return clone;
}

function applyDiceMaterialTuning(material) {
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

function attachDiceAccentLights(mesh, three, tileSize) {
  if (!three?.PointLight) return;
  const primary = new three.PointLight(0xfff1c0, 1.65, tileSize * 9, 2);
  primary.position.set(0, tileSize * 0.9, 0);
  primary.castShadow = false;
  mesh.add(primary);

  const rim = new three.PointLight(0xffb46a, 0.85, tileSize * 6, 2.5);
  rim.position.set(tileSize * 0.45, tileSize * 0.6, tileSize * 0.45);
  rim.castShadow = false;
  mesh.add(rim);
}

function pickEdgePosition(metrics) {
  const boardWidth = metrics.cols * metrics.tileSize;
  const boardDepth = metrics.rows * metrics.tileSize;
  const margin = metrics.tileSize * 0.4;
  const spanX = Math.max(boardWidth - margin * 2, metrics.tileSize);
  const spanZ = Math.max(boardDepth - margin * 2, metrics.tileSize);
  const alongWidth = margin + Math.random() * spanX;
  const alongDepth = margin + Math.random() * spanZ;
  if (Math.random() < 0.5) {
    return { x: alongWidth, z: Math.random() < 0.5 ? margin : boardDepth - margin };
  }
  return { x: Math.random() < 0.5 ? margin : boardWidth - margin, z: alongDepth };
}

function pickInteriorPosition(metrics) {
  const boardWidth = metrics.cols * metrics.tileSize;
  const boardDepth = metrics.rows * metrics.tileSize;
  const margin = metrics.tileSize * 1.2;
  const spanX = Math.max(boardWidth - margin * 2, metrics.tileSize * 0.5);
  const spanZ = Math.max(boardDepth - margin * 2, metrics.tileSize * 0.5);
  return {
    x: margin + Math.random() * spanX,
    z: margin + Math.random() * spanZ,
  };
}

function getBoardMetrics(manager) {
  try {
    const metrics = manager?._getBoardMetrics?.();
    if (metrics) return metrics;
  } catch (_) {
    /* ignore */
  }
  const gm = manager?.gameManager;
  const tileSize = gm?.spatial?.tileWorldSize || 1;
  const cols = Number.isFinite(gm?.cols) ? gm.cols : 25;
  const rows = Number.isFinite(gm?.rows) ? gm.rows : 25;
  return {
    cols,
    rows,
    tileSize,
    centerX: (cols * tileSize) / 2,
    centerZ: (rows * tileSize) / 2,
  };
}

function clampGridCoordinate(value, maxExclusive) {
  if (!Number.isFinite(value) || !Number.isFinite(maxExclusive)) return value;
  if (value < 0) return 0;
  if (value >= maxExclusive) return maxExclusive - 1;
  return value;
}

function createGroundSampler(manager, metrics, fallbackHeight = DEFAULT_REST_HEIGHT) {
  const gm = manager?.gameManager;
  const spatial = gm?.spatial;
  let cols = Number.isFinite(metrics?.cols) ? metrics.cols : null;
  if (cols == null && Number.isFinite(gm?.cols)) {
    cols = gm.cols;
  }

  let rows = Number.isFinite(metrics?.rows) ? metrics.rows : null;
  if (rows == null && Number.isFinite(gm?.rows)) {
    rows = gm.rows;
  }
  const tileSize = metrics?.tileSize || spatial?.tileWorldSize || 1;

  const worldToGrid =
    typeof spatial?.worldToGrid === 'function'
      ? (x, z) => spatial.worldToGrid(x, z)
      : (x, z) => ({
          gridX: Math.round(x / tileSize),
          gridY: Math.round(z / tileSize),
        });

  const elevationUnit = Number.isFinite(spatial?.elevationUnit) ? spatial.elevationUnit : 1;
  const elevationToWorld =
    typeof spatial?.elevationToWorldY === 'function'
      ? (level) => spatial.elevationToWorldY(level)
      : (level) => level * elevationUnit;

  const terrainSample =
    typeof gm?.getTerrainHeight === 'function'
      ? (x, y) => gm.getTerrainHeight(x, y)
      : typeof gm?.terrainCoordinator?.getTerrainHeight === 'function'
        ? (x, y) => gm.terrainCoordinator.getTerrainHeight(x, y)
        : null;

  return (worldX, worldZ, fallback = fallbackHeight) => {
    try {
      if (!worldToGrid || !elevationToWorld || !terrainSample) return fallback;
      const grid = worldToGrid(worldX, worldZ);
      if (!grid) return fallback;
      let gx = grid.gridX;
      let gy = grid.gridY;
      if (Number.isFinite(cols)) gx = clampGridCoordinate(gx, cols);
      if (Number.isFinite(rows)) gy = clampGridCoordinate(gy, rows);
      const level = terrainSample(gx, gy);
      if (Number.isFinite(level)) {
        return elevationToWorld(level);
      }
      return fallback;
    } catch (_) {
      return fallback;
    }
  };
}

function adjustDieHeightForGround(mesh, three, groundY) {
  if (!three?.Box3) return;
  const bounds = new three.Box3().setFromObject(mesh);
  if (!Number.isFinite(bounds.min?.y)) return;
  const delta = groundY - bounds.min.y;
  if (Math.abs(delta) < 0.0001) return;
  mesh.position.y += delta;
}

function collectWorldFaceData(mesh, three) {
  if (!mesh || !three?.Vector3) return [];
  const faces = [];
  const vA = new three.Vector3();
  const vB = new three.Vector3();
  const vC = new three.Vector3();
  const centroid = new three.Vector3();
  const ab = new three.Vector3();
  const ac = new three.Vector3();
  const normal = new three.Vector3();

  mesh.updateMatrixWorld(true);
  mesh.traverse((child) => {
    if (!child.isMesh) return;
    const geometry = child.geometry;
    const position = geometry?.attributes?.position;
    if (!position) return;
    const indexArray = geometry.index ? geometry.index.array : null;
    const matrixWorld = child.matrixWorld;

    const pushFaceData = (iA, iB, iC) => {
      vA.fromBufferAttribute(position, iA).applyMatrix4(matrixWorld);
      vB.fromBufferAttribute(position, iB).applyMatrix4(matrixWorld);
      vC.fromBufferAttribute(position, iC).applyMatrix4(matrixWorld);
      centroid
        .copy(vA)
        .add(vB)
        .add(vC)
        .multiplyScalar(1 / 3);
      ab.subVectors(vB, vA);
      ac.subVectors(vC, vA);
      normal.crossVectors(ab, ac).normalize();
      if (Number.isFinite(normal.x) && Number.isFinite(normal.y) && Number.isFinite(normal.z)) {
        faces.push({ normal: normal.clone(), centroidY: centroid.y });
      }
    };

    if (indexArray?.length) {
      for (let i = 0; i < indexArray.length; i += 3) {
        pushFaceData(indexArray[i], indexArray[i + 1], indexArray[i + 2]);
      }
    } else {
      const triCount = position.count;
      for (let i = 0; i < triCount; i += 3) {
        pushFaceData(i, i + 1, i + 2);
      }
    }
  });

  return faces;
}

function computeSnapSolution(mesh, three, groundY) {
  if (!mesh || !three?.Vector3 || !three?.Quaternion) return null;
  const faces = collectWorldFaceData(mesh, three);
  if (!faces.length) return null;
  const down = new three.Vector3(0, -1, 0);
  const centroidTolerance = Math.max(Math.abs(groundY) * 0.02, 0.01);
  let bestFace = null;

  for (const face of faces) {
    if (!bestFace) {
      bestFace = face;
      continue;
    }
    if (face.centroidY < bestFace.centroidY - centroidTolerance) {
      bestFace = face;
      continue;
    }
    const centroidDelta = Math.abs(face.centroidY - bestFace.centroidY);
    if (centroidDelta <= centroidTolerance) {
      if (face.normal.dot(down) > bestFace.normal.dot(down)) {
        bestFace = face;
      }
    }
  }

  if (!bestFace) return null;
  const correction = new three.Quaternion().setFromUnitVectors(bestFace.normal, down);
  const targetQuat = mesh.quaternion.clone().premultiply(correction);
  return {
    targetQuat,
    applyFinal: () => {
      mesh.quaternion.copy(targetQuat);
      mesh.rotation.setFromQuaternion(mesh.quaternion);
      mesh.updateMatrixWorld(true);
      adjustDieHeightForGround(mesh, three, groundY);
    },
  };
}

function snapDieToBoard(mesh, three, groundY) {
  const solution = computeSnapSolution(mesh, three, groundY);
  solution?.applyFinal();
}

function scheduleRollAnimation(manager, mesh, metrics, options = {}) {
  const travelMs = options.travelMs ?? TRAVEL_DURATION_MS;
  const settleDurationMs = options.settleDurationMs ?? 650;
  const snapDurationMs = options.snapDurationMs ?? SNAP_DURATION_MS;
  const start = pickEdgePosition(metrics);
  const target = pickInteriorPosition(metrics);
  const arcHeight = options.arcHeight ?? metrics.tileSize * 0.05;
  const restHeight =
    typeof options.restHeight === 'number' ? options.restHeight : DEFAULT_REST_HEIGHT;
  const hopHeight = metrics.tileSize * 1.15;
  const groundLift = (mesh.userData?.groundLiftBase ?? 0) * mesh.scale.x;
  const sampleGroundHeight = createGroundSampler(manager, metrics, restHeight);
  let resolvedGroundY = sampleGroundHeight(start.x, start.z, restHeight);
  const targetGroundY = sampleGroundHeight(target.x, target.z, restHeight);

  mesh.position.set(start.x, resolvedGroundY + groundLift + arcHeight, start.z);
  mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
  const startAngles = { x: mesh.rotation.x, y: mesh.rotation.y, z: mesh.rotation.z };
  const endAngles = {
    x: startAngles.x + randomBetween(Math.PI * 3, Math.PI * 5),
    y: startAngles.y + randomBetween(Math.PI * 2, Math.PI * 4),
    z: startAngles.z + randomBetween(Math.PI * 2, Math.PI * 4),
  };

  let startTs = null;
  let settleTs = null;
  let stopped = false;
  let removeCallback = null;
  let rafHandle = null;
  let hasSnappedFlat = false;
  let snapState = null;

  const stopAnimation = () => {
    if (stopped) return;
    stopped = true;
    if (typeof removeCallback === 'function') {
      try {
        removeCallback();
      } catch (_) {
        /* ignore */
      }
    }
    if (rafHandle && hasWindow()) {
      try {
        window.cancelAnimationFrame(rafHandle);
      } catch (_) {
        /* ignore */
      }
    }
  };

  const ensureGroundContact = () => {
    try {
      resolvedGroundY = sampleGroundHeight(mesh.position.x, mesh.position.z, resolvedGroundY);
      adjustDieHeightForGround(mesh, threeNamespace, resolvedGroundY);
    } catch (_) {
      /* ignore grounding errors */
    }
  };

  const step = (ts) => {
    if (stopped) return;
    if (startTs == null) startTs = ts;
    const elapsed = ts - startTs;
    const travelT = Math.min(Math.max(elapsed / travelMs, 0), 1);
    const eased = easeOutCubic(travelT);

    mesh.position.x = start.x + (target.x - start.x) * eased;
    mesh.position.z = start.z + (target.z - start.z) * eased;

    if (settleTs == null) {
      const bounce = Math.sin(travelT * Math.PI) * hopHeight;
      const groundY = sampleGroundHeight(mesh.position.x, mesh.position.z, resolvedGroundY);
      resolvedGroundY = groundY;
      mesh.position.y = groundY + groundLift + arcHeight + Math.max(bounce, 0);
      const spinT = easeOutCubic(travelT);
      mesh.rotation.set(
        startAngles.x + (endAngles.x - startAngles.x) * spinT,
        startAngles.y + (endAngles.y - startAngles.y) * spinT,
        startAngles.z + (endAngles.z - startAngles.z) * spinT
      );
      if (travelT >= 1) {
        settleTs = ts;
        resolvedGroundY = sampleGroundHeight(target.x, target.z, targetGroundY);
        mesh.position.set(target.x, resolvedGroundY + groundLift, target.z);
        ensureGroundContact();
      }
      return;
    }

    const wobbleT = Math.min((ts - settleTs) / settleDurationMs, 1);
    const wobbleStrength = (1 - wobbleT) * 0.015 * metrics.tileSize;
    mesh.rotation.x += Math.sin(wobbleT * Math.PI * 2) * wobbleStrength;
    mesh.rotation.z -= Math.sin(wobbleT * Math.PI * 2) * wobbleStrength;
    ensureGroundContact();
    if (wobbleT >= 1) {
      if (!hasSnappedFlat) {
        if (!snapState) {
          const snapGround = sampleGroundHeight(mesh.position.x, mesh.position.z, resolvedGroundY);
          const solution = computeSnapSolution(mesh, threeNamespace, snapGround);
          if (solution) {
            snapState = {
              startQuat: mesh.quaternion.clone(),
              targetQuat: solution.targetQuat,
              groundY: snapGround,
              startTs: ts,
            };
          } else {
            hasSnappedFlat = true;
            stopAnimation();
            return;
          }
        }

        if (snapState?.targetQuat) {
          const snapElapsed = ts - snapState.startTs;
          const snapT = Math.min(Math.max(snapElapsed / snapDurationMs, 0), 1);
          mesh.quaternion.copy(snapState.startQuat).slerp(snapState.targetQuat, snapT);
          mesh.rotation.setFromQuaternion(mesh.quaternion);
          mesh.updateMatrixWorld(true);
          ensureGroundContact();
          if (snapT >= 1) {
            const finalGround = snapState?.groundY ?? resolvedGroundY;
            snapDieToBoard(mesh, threeNamespace, finalGround);
            snapState = null;
            hasSnappedFlat = true;
            stopAnimation();
          }
          return;
        }
      }

      stopAnimation();
    }
  };

  const managerCallback = manager?.addAnimationCallback;
  if (typeof managerCallback === 'function') {
    removeCallback = managerCallback.call(manager, step);
  } else if (hasWindow()) {
    const loop = (ts) => {
      if (stopped) return;
      step(ts || performance.now());
      rafHandle = window.requestAnimationFrame(loop);
    };
    rafHandle = window.requestAnimationFrame(loop);
    removeCallback = () => {
      stopped = true;
    };
  } else {
    removeCallback = () => {};
  }

  return {
    stopAnimation,
    dispose: () => {
      stopAnimation();
      if (mesh.parent) mesh.parent.remove(mesh);
    },
  };
}

export async function playD20RollOnGrid(options = {}) {
  if (!hasWindow()) return false;
  const manager = getSceneManager();
  if (!manager || manager.degraded || !manager.scene) return false;

  try {
    clearActiveDie();
    const three = await ensureThreeNamespace();
    const blueprint = await ensureBlueprint();
    const clone = cloneDice(blueprint);
    const metrics = getBoardMetrics(manager);
    const tileSize = metrics.tileSize || 1;
    const scale = tileSize * (options.scale ?? DEFAULT_SCALE);
    clone.scale.setScalar(scale);
    attachDiceAccentLights(clone, three, tileSize);
    manager.scene.add(clone);
    const animationOptions = { ...options };
    if (typeof animationOptions.restHeight !== 'number') {
      animationOptions.restHeight = DEFAULT_REST_HEIGHT;
    }
    const animationState = scheduleRollAnimation(manager, clone, metrics, animationOptions);
    activeDieState = {
      mesh: clone,
      dispose: animationState.dispose,
    };
    return true;
  } catch (error) {
    console.warn('[dice3d] Unable to play d20 animation', error);
    return false;
  }
}

export function preloadD20Asset() {
  if (!hasWindow()) return Promise.resolve(false);
  return ensureBlueprint()
    .then(() => true)
    .catch(() => false);
}

if (hasWindow()) {
  window.addEventListener('beforeunload', () => {
    clearActiveDie();
  });
}
