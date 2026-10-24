// Shared mutable state, constants, and utility functions for the dice system.
// Extracted from dice3d.js (Phase 7). All dice modules import from here to
// avoid circular dependencies.

import { DICE_CONFIG } from '../../config/GameConstants.js';

import { LOG_CATEGORY } from '../../utils/logger/Logger.js';

// ── Shared mutable state ────────────────────────────────────────────────────
export const diceState = {
  threeNamespace: null,
  gltfLoaderCtor: null,
  blueprintPromise: null,
  diceBlueprint: null,
  blueprintGroundLift: 0,
  activeDieState: null,
  faceCalibrationState: null,
};

// ── Constants ───────────────────────────────────────────────────────────────
export const D20_3D_SETTINGS = DICE_CONFIG?.D20_3D || {};
export const DEFAULT_SCALE = 3.6;
export const DEFAULT_REST_HEIGHT =
  typeof D20_3D_SETTINGS.REST_HEIGHT === 'number' ? D20_3D_SETTINGS.REST_HEIGHT : 0;
export const DICE_LOG_CATEGORY = LOG_CATEGORY.INTERACTION;

export const D20_NUMBER_TO_FACE_INDEX = Object.freeze({
  1: 35,
  2: 30,
  3: 0,
  4: 31,
  5: 20,
  6: 11,
  7: 23,
  8: 10,
  9: 6,
  10: 14,
  11: 26,
  12: 34,
  13: 21,
  14: 25,
  15: 29,
  16: 7,
  17: 9,
  18: 27,
  19: 1,
  20: 2,
});

export const FACE_INDEX_TO_NUMBER = Object.freeze(
  Object.entries(D20_NUMBER_TO_FACE_INDEX).reduce((acc, [value, faceIndex]) => {
    acc[faceIndex] = Number(value);
    return acc;
  }, {})
);

export const D20_FACE_CALIBRATION_SEQUENCE = Object.freeze(
  Object.entries(D20_NUMBER_TO_FACE_INDEX)
    .map(([value, faceIndex]) => ({
      value: Number(value),
      faceIndex,
    }))
    .filter((entry) => Number.isFinite(entry.faceIndex))
    .sort((a, b) => a.value - b.value)
);

// ── Small helpers ───────────────────────────────────────────────────────────
export const hasWindow = () => typeof window !== 'undefined';

export function getSceneManager() {
  if (!hasWindow()) return null;
  return window.gameManager?.threeSceneManager || null;
}

export const toErrorPayload = (error) =>
  error
    ? {
        message: error.message,
        stack: error.stack,
        name: error.name,
      }
    : undefined;

// ── Board / scene utilities ─────────────────────────────────────────────────
export function getBoardMetrics(manager) {
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

export function clampGridCoordinate(value, maxExclusive) {
  if (!Number.isFinite(value) || !Number.isFinite(maxExclusive)) return value;
  if (value < 0) return 0;
  if (value >= maxExclusive) return maxExclusive - 1;
  return value;
}

export function createGroundSampler(manager, metrics, fallbackHeight = DEFAULT_REST_HEIGHT) {
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

// ── Geometry: face data, orientation ────────────────────────────────────────
const d20ColliderCache = new WeakMap();

export function collectWorldFaceData(mesh, three) {
  if (!mesh || !three?.Vector3) return [];
  const faces = [];
  const vA = new three.Vector3();
  const vB = new three.Vector3();
  const vC = new three.Vector3();
  const centroid = new three.Vector3();
  const ab = new three.Vector3();
  const ac = new three.Vector3();
  const normal = new three.Vector3();
  let faceIndex = 0;

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
      normal.crossVectors(ab, ac);
      const faceArea = normal.length() * 0.5;
      normal.normalize();
      if (Number.isFinite(normal.x) && Number.isFinite(normal.y) && Number.isFinite(normal.z)) {
        faces.push({
          normal: normal.clone(),
          centroidY: centroid.y,
          centroid: centroid.clone(),
          faceIndex,
          area: faceArea,
        });
      }
      faceIndex += 1;
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

export function getD20ColliderData(mesh, three) {
  if (d20ColliderCache.has(mesh)) return d20ColliderCache.get(mesh);
  const worldFaces = new Map(
    collectWorldFaceData(mesh, three).map((face) => [face.faceIndex, face])
  );
  const inverseRoot = mesh.matrixWorld.clone().invert();
  const localNormalMatrix = new three.Matrix3().setFromMatrix4(mesh.matrixWorld).transpose();
  const numberedFaces = Object.entries(D20_NUMBER_TO_FACE_INDEX).map(([value, faceIndex]) => {
    const face = worldFaces.get(faceIndex);
    if (!face) throw new Error(`Gold d20 is missing numbered face ${value}`);
    const normal = face.normal.clone().applyMatrix3(localNormalMatrix).normalize();
    const centroid = face.centroid.clone().applyMatrix4(inverseRoot);
    return { value: Number(value), faceIndex, normal, centroid, plane: normal.dot(centroid) };
  });
  mesh.traverse((child) => {
    const positions = child.isMesh ? child.geometry?.attributes?.position : null;
    if (!positions) return;
    const toRoot = inverseRoot.clone().multiply(child.matrixWorld);
    const vertex = new three.Vector3();
    for (let i = 0; i < positions.count; i += 1) {
      vertex.fromBufferAttribute(positions, i).applyMatrix4(toRoot);
      // The calibrated triangles are recessed; include the bevels and raised numerals.
      for (const face of numberedFaces) face.plane = Math.max(face.plane, face.normal.dot(vertex));
    }
  });

  const vertices = [];
  for (let i = 0; i < numberedFaces.length - 2; i += 1) {
    for (let j = i + 1; j < numberedFaces.length - 1; j += 1) {
      for (let k = j + 1; k < numberedFaces.length; k += 1) {
        const a = numberedFaces[i];
        const b = numberedFaces[j];
        const c = numberedFaces[k];
        const bc = b.normal.clone().cross(c.normal);
        const determinant = a.normal.dot(bc);
        if (Math.abs(determinant) < 1e-8) continue;
        const vertex = bc
          .multiplyScalar(a.plane)
          .addScaledVector(c.normal.clone().cross(a.normal), b.plane)
          .addScaledVector(a.normal.clone().cross(b.normal), c.plane)
          .divideScalar(determinant);
        if (numberedFaces.some((face) => face.normal.dot(vertex) > face.plane + 1e-6)) continue;
        if (vertices.some((existing) => existing.distanceToSquared(vertex) < 1e-10)) continue;
        vertices.push(vertex);
      }
    }
  }
  const faces = numberedFaces.map((face) => {
    const indices = vertices
      .map((vertex, index) => ({ vertex, index }))
      .filter(({ vertex }) => Math.abs(face.normal.dot(vertex) - face.plane) < 1e-6)
      .map(({ index }) => index);
    if (indices.length < 3) throw new Error(`Invalid collider for d20 face ${face.value}`);
    const center = new three.Vector3();
    for (const index of indices) center.add(vertices[index]);
    center.divideScalar(indices.length);
    const u = new three.Vector3(Math.abs(face.normal.y) < 0.9 ? 0 : 1, 1, 0)
      .cross(face.normal)
      .normalize();
    const v = face.normal.clone().cross(u);
    const angle = (index) => {
      const offset = vertices[index].clone().sub(center);
      return Math.atan2(offset.dot(v), offset.dot(u));
    };
    return indices.sort((a, b) => angle(a) - angle(b));
  });
  const data = {
    numberedFaces,
    vertices,
    faces,
    radius: Math.max(...vertices.map((vertex) => vertex.length())),
  };
  d20ColliderCache.set(mesh, data);
  return data;
}

export function resolveUpFacingFace(mesh, three, facesOverride = null) {
  if (!mesh || !three?.Vector3) return null;
  let faces;
  if (Array.isArray(facesOverride)) {
    faces = facesOverride.filter((face) => Number.isInteger(FACE_INDEX_TO_NUMBER[face.faceIndex]));
  } else {
    const data = getD20ColliderData(mesh, three);
    mesh.updateMatrixWorld(true);
    const normalMatrix = new three.Matrix3().getNormalMatrix(mesh.matrixWorld);
    faces = data.numberedFaces.map((face) => {
      const centroid = face.centroid.clone().applyMatrix4(mesh.matrixWorld);
      return {
        ...face,
        normal: face.normal.clone().applyMatrix3(normalMatrix).normalize(),
        centroid,
        centroidY: centroid.y,
      };
    });
  }
  if (!faces.length) return null;
  const up = new three.Vector3(0, 1, 0);
  let best = null;
  for (const face of faces) {
    const alignment = face.normal.dot(up);
    if (!(alignment > 0)) continue;
    if (!best || alignment > best.score) {
      best = {
        ...face,
        score: alignment,
      };
    }
  }
  if (!best) return null;
  return {
    ...best,
    value: FACE_INDEX_TO_NUMBER[best.faceIndex] ?? null,
  };
}

export function orientMeshToFaceIndex(mesh, faceIndex, three) {
  if (!mesh || !three?.Vector3 || !three?.Quaternion) return false;
  if (!Number.isFinite(faceIndex)) return false;
  const faces = collectWorldFaceData(mesh, three);
  if (!faces.length) return false;
  const target = faces.find((face) => face.faceIndex === faceIndex);
  if (!target) return false;
  const up = new three.Vector3(0, 1, 0);
  const alignQuat = new three.Quaternion().setFromUnitVectors(target.normal, up);
  mesh.quaternion.premultiply(alignQuat);
  mesh.rotation.setFromQuaternion(mesh.quaternion);
  mesh.updateMatrixWorld(true);
  return true;
}
