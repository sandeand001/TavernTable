import { DICE_CONFIG } from '../../config/GameConstants.js';

const D20_MODEL_PATH = 'assets/Items/d20-gold.glb';
const DEFAULT_SCALE = 3.6;
const TRAVEL_DURATION_MS = 1800;
const TRAVEL_DISTANCE_MULTIPLIER = 4; // 300% more distance => 4x total travel
const SNAP_DURATION_MS = 320;
const D20_3D_SETTINGS = DICE_CONFIG?.D20_3D || {};
const DEFAULT_REST_HEIGHT =
  typeof D20_3D_SETTINGS.REST_HEIGHT === 'number' ? D20_3D_SETTINGS.REST_HEIGHT : 0;
const DEFAULT_RICOCHET_SETTINGS = {
  maxBounces: 4,
  pulseWidth: 0.085,
  clearanceTiles: 0.35,
  obstacleLimit: 256,
};
let threeNamespace;
let gltfLoaderCtor;
let blueprintPromise;
let diceBlueprint;
let blueprintGroundLift = 0;
let activeDieState;

const D20_NUMBER_TO_FACE_INDEX = Object.freeze({
  1: 712,
  2: 695,
  3: 188,
  4: 604,
  5: 615,
  6: 179,
  7: 709,
  8: 238,
  9: 2093,
  10: 270,
  11: 476,
  12: 697,
  13: 717,
  14: 699,
  15: 3623,
  16: 229,
  17: 280,
  18: 638,
  19: 254,
  20: 265,
});

const getFaceIndexForValue = (value) => {
  if (!Number.isInteger(value)) return null;
  return D20_NUMBER_TO_FACE_INDEX[value] ?? null;
};

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

function clampToRange(value, min, max) {
  if (!Number.isFinite(value)) return value;
  if (Number.isFinite(min) && value < min) return min;
  if (Number.isFinite(max) && value > max) return max;
  return value;
}

function normalize2D(vec) {
  if (!vec) return null;
  const mag = Math.hypot(vec.x || 0, vec.z || vec.y || 0);
  if (!Number.isFinite(mag) || mag === 0) return null;
  return { x: (vec.x || 0) / mag, z: (vec.z ?? vec.y ?? 0) / mag };
}

function reflectVector2D(vector, normal) {
  const norm = normalize2D(normal);
  if (!vector || !norm) return null;
  const dot = (vector.x || 0) * norm.x + (vector.z || 0) * norm.z;
  return {
    x: (vector.x || 0) - 2 * dot * norm.x,
    z: (vector.z || 0) - 2 * dot * norm.z,
  };
}

function deriveBounceIntensity(obstacle) {
  const type = obstacle?.type || obstacle?.placeableType;
  if (!type) return 0.6;
  if (type === 'structure' || type === 'rock' || type === 'wall') return 0.95;
  if (type === 'plant' || type === 'tree') return 0.55;
  if (type === 'token') return 0.7;
  return 0.65;
}

function collectCollisionObstacles(
  manager,
  metrics,
  limit = DEFAULT_RICOCHET_SETTINGS.obstacleLimit
) {
  const gm = manager?.gameManager;
  const spatial = gm?.spatial;
  const tileSize = metrics?.tileSize || spatial?.tileWorldSize || 1;
  const toWorld = (gx, gy, height = 0) => {
    try {
      if (typeof spatial?.gridToWorld === 'function') {
        const res = spatial.gridToWorld(gx, gy, height) || {};
        return {
          x: Number.isFinite(res.x) ? res.x : (gx ?? 0) * tileSize,
          z: Number.isFinite(res.z) ? res.z : (gy ?? 0) * tileSize,
        };
      }
    } catch (_) {
      /* ignore */
    }
    return {
      x: (gx ?? 0) * tileSize,
      z: (gy ?? 0) * tileSize,
    };
  };

  const obstacles = [];
  const pushObstacle = (obs) => {
    if (!obs || obstacles.length >= limit) return;
    obstacles.push(obs);
  };

  try {
    const tokens = Array.isArray(gm?.placedTokens) ? gm.placedTokens : [];
    for (const token of tokens) {
      if (!token) continue;
      const gx = Number.isFinite(token.gridX) ? token.gridX : Number(token?.__originGridX) || 0;
      const gy = Number.isFinite(token.gridY) ? token.gridY : Number(token?.__originGridY) || 0;
      const world = toWorld(gx + 0.5, gy + 0.5, 0);
      pushObstacle({
        type: 'token',
        x: world.x,
        z: world.z,
        radius: tileSize * 0.45,
      });
    }
  } catch (_) {
    /* ignore token sampling errors */
  }

  try {
    const placeables = gm?.terrainCoordinator?.terrainManager?.placeables;
    if (placeables && typeof placeables.forEach === 'function') {
      placeables.forEach((list, key) => {
        if (!Array.isArray(list) || !list.length) return;
        const [gxRaw, gyRaw] = (key || '').split(',');
        const gx = Number(gxRaw);
        const gy = Number(gyRaw);
        const world = toWorld(gx + 0.5, gy + 0.5, 0);
        const primary = list[0] || {};
        const spanX = Number(primary.tileSpanX ?? primary.width ?? primary.tileWidth) || 1;
        const spanZ = Number(primary.tileSpanZ ?? primary.height ?? primary.tileHeight) || 1;
        const footprint = Math.max(spanX, spanZ, 1);
        const baseRadius = (footprint * tileSize) / 2;
        pushObstacle({
          type: primary.placeableType || primary.type || 'placeable',
          x: world.x,
          z: world.z,
          radius: baseRadius + tileSize * 0.15,
        });
      });
    }
  } catch (_) {
    /* ignore placeable sampling errors */
  }

  return obstacles.filter((obs) => Number.isFinite(obs.x) && Number.isFinite(obs.z));
}

function findPathCollision(start, target, obstacles, clearance = 0) {
  if (!Array.isArray(obstacles) || !obstacles.length) return null;
  const dir = { x: (target.x || 0) - (start.x || 0), z: (target.z || 0) - (start.z || 0) };
  const a = dir.x * dir.x + dir.z * dir.z;
  if (a <= 0.00001) return null;
  let best = null;
  for (const obstacle of obstacles) {
    const radius = (obstacle?.radius || 0) + clearance;
    if (!Number.isFinite(radius) || radius <= 0) continue;
    const oc = {
      x: (start.x || 0) - (obstacle.x || 0),
      z: (start.z || 0) - (obstacle.z || 0),
    };
    const b = 2 * (oc.x * dir.x + oc.z * dir.z);
    const c = oc.x * oc.x + oc.z * oc.z - radius * radius;
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) continue;
    const sqrtD = Math.sqrt(discriminant);
    const t1 = (-b - sqrtD) / (2 * a);
    const t2 = (-b + sqrtD) / (2 * a);
    const candidates = [t1, t2].filter((t) => t > 0 && t < 1);
    if (!candidates.length) continue;
    const t = Math.min(...candidates);
    if (!Number.isFinite(t)) continue;
    if (best && t >= best.t) continue;
    const point = {
      x: (start.x || 0) + dir.x * t,
      z: (start.z || 0) + dir.z * t,
    };
    const normal = normalize2D({ x: point.x - obstacle.x, z: point.z - obstacle.z });
    if (!normal) continue;
    best = { t, point, obstacle, normal };
  }
  return best;
}

function buildRicochetPath(start, target, metrics, options = {}) {
  const tileSize = metrics?.tileSize || 1;
  const boardWidth = (metrics?.cols || 1) * tileSize;
  const boardDepth = (metrics?.rows || 1) * tileSize;
  const clearanceTiles = Number.isFinite(options.clearanceTiles)
    ? options.clearanceTiles
    : DEFAULT_RICOCHET_SETTINGS.clearanceTiles;
  const clearanceWorld = clearanceTiles * tileSize;
  const maxBounces = Math.max(0, options.maxBounces ?? DEFAULT_RICOCHET_SETTINGS.maxBounces);
  const clampPoint = (point) => ({
    x: clampToRange(point.x, tileSize * 0.35, boardWidth - tileSize * 0.35),
    z: clampToRange(point.z, tileSize * 0.35, boardDepth - tileSize * 0.35),
  });

  const waypoints = [clampPoint(start)];
  const bounceEntries = [];
  let currentStart = waypoints[0];
  let currentTarget = clampPoint(target);
  const obstacles = Array.isArray(options.obstacles) ? options.obstacles.slice(0) : [];

  for (let i = 0; i < maxBounces; i += 1) {
    const collision = findPathCollision(currentStart, currentTarget, obstacles, clearanceWorld);
    if (!collision) break;
    const bouncePoint = clampPoint({ ...collision.point });
    waypoints.push(bouncePoint);
    bounceEntries.push({ waypointIndex: waypoints.length - 1, obstacle: collision.obstacle });
    const dir = {
      x: currentTarget.x - currentStart.x,
      z: currentTarget.z - currentStart.z,
    };
    const remainingDistance = Math.hypot(dir.x, dir.z) * (1 - collision.t);
    const reflected = reflectVector2D(dir, collision.normal);
    const normalized = normalize2D(reflected);
    if (!normalized) break;
    currentStart = clampPoint({
      x: bouncePoint.x + normalized.x * clearanceWorld,
      z: bouncePoint.z + normalized.z * clearanceWorld,
    });
    const projectedDistance = Math.max(remainingDistance, tileSize * 1.5);
    currentTarget = clampPoint({
      x: currentStart.x + normalized.x * projectedDistance,
      z: currentStart.z + normalized.z * projectedDistance,
    });
  }

  waypoints.push(currentTarget);
  const segments = [];
  let totalLength = 0;
  for (let i = 0; i < waypoints.length - 1; i += 1) {
    const from = waypoints[i];
    const to = waypoints[i + 1];
    const length = Math.hypot((to.x || 0) - (from.x || 0), (to.z || 0) - (from.z || 0));
    segments.push({ start: from, end: to, length });
    totalLength += length;
  }
  if (!Number.isFinite(totalLength) || totalLength <= 0) {
    totalLength = tileSize || 1;
  }

  const bounces = bounceEntries.map((entry) => {
    let accumulated = 0;
    for (let i = 0; i < segments.length; i += 1) {
      if (segments[i].end === waypoints[entry.waypointIndex]) {
        break;
      }
      accumulated += segments[i].length || 0;
    }
    return {
      progress: totalLength ? accumulated / totalLength : 0,
      intensity: deriveBounceIntensity(entry.obstacle),
      obstacleType: entry.obstacle?.type || entry.obstacle?.placeableType || 'generic',
    };
  });

  const resolvePointAt = (progress) => {
    if (!segments.length) return { ...waypoints[waypoints.length - 1] };
    const clamped = clampToRange(progress, 0, 1);
    const targetDistance = totalLength * clamped;
    let traversed = 0;
    for (const segment of segments) {
      const available = segment.length || 0;
      if (available <= 0) {
        continue;
      }
      if (traversed + available >= targetDistance) {
        const localT = available ? (targetDistance - traversed) / available : 0;
        return {
          x: segment.start.x + (segment.end.x - segment.start.x) * localT,
          z: segment.start.z + (segment.end.z - segment.start.z) * localT,
        };
      }
      traversed += available;
    }
    const last = waypoints[waypoints.length - 1];
    return { x: last.x, z: last.z };
  };

  return {
    waypoints,
    segments,
    totalLength,
    bounces,
    finalWaypoint: waypoints[waypoints.length - 1],
    getPointAt: resolvePointAt,
  };
}

const clonePoint = (point) => ({
  x: Number.isFinite(point?.x) ? point.x : 0,
  z: Number.isFinite(point?.z) ? point.z : 0,
});

function createLinearPath(startPoint, endPoint, metrics) {
  const from = clonePoint(startPoint);
  const to = clonePoint(endPoint);
  const deltaX = to.x - from.x;
  const deltaZ = to.z - from.z;
  const rawLength = Math.hypot(deltaX, deltaZ);
  const effectiveLength = rawLength > 0 ? rawLength : metrics?.tileSize || 1;
  const segments = [
    {
      start: from,
      end: to,
      length: effectiveLength,
    },
  ];
  const resolvePointAt = (progress) => {
    const clamped = clampToRange(progress, 0, 1);
    return {
      x: from.x + deltaX * clamped,
      z: from.z + deltaZ * clamped,
    };
  };
  return {
    waypoints: [from, to],
    segments,
    totalLength: effectiveLength,
    bounces: [],
    finalWaypoint: to,
    getPointAt: (progress) => resolvePointAt(progress),
  };
}

function mergePathInfos(paths) {
  if (!Array.isArray(paths) || !paths.length) return null;
  const waypoints = [];
  const segments = [];
  const bounceDistances = [];
  let totalLength = 0;

  const appendWaypoints = (wps, skipFirst) => {
    if (!Array.isArray(wps)) return;
    wps.forEach((wp, index) => {
      if (skipFirst && index === 0) return;
      waypoints.push(clonePoint(wp));
    });
  };

  for (const path of paths) {
    if (!path) continue;
    const pathWaypoints = Array.isArray(path.waypoints) ? path.waypoints : [];
    const pathSegments = Array.isArray(path.segments) ? path.segments : [];
    const offset = totalLength;

    appendWaypoints(pathWaypoints, waypoints.length > 0);

    for (const seg of pathSegments) {
      const start = clonePoint(seg.start);
      const end = clonePoint(seg.end);
      const length = Number.isFinite(seg?.length)
        ? seg.length
        : Math.hypot(end.x - start.x, end.z - start.z);
      segments.push({ start, end, length });
    }

    const pathLength = Number.isFinite(path?.totalLength)
      ? path.totalLength
      : pathSegments.reduce((sum, seg) => sum + (Number.isFinite(seg?.length) ? seg.length : 0), 0);

    if (Array.isArray(path.bounces)) {
      for (const bounce of path.bounces) {
        const distance = offset + (pathLength > 0 ? (bounce.progress ?? 0) * pathLength : 0);
        bounceDistances.push({
          distance,
          intensity: bounce.intensity,
          obstacleType: bounce.obstacleType,
        });
      }
    }

    totalLength += pathLength;
  }

  if (!segments.length || !Number.isFinite(totalLength) || totalLength <= 0) {
    return paths[0] || null;
  }

  const resolvePointAt = (progress) => {
    const clamped = clampToRange(progress, 0, 1);
    const targetDistance = totalLength * clamped;
    let traversed = 0;
    for (const segment of segments) {
      const available = segment.length || 0;
      if (available <= 0) continue;
      if (traversed + available >= targetDistance) {
        const localT = available ? (targetDistance - traversed) / available : 0;
        return {
          x: segment.start.x + (segment.end.x - segment.start.x) * localT,
          z: segment.start.z + (segment.end.z - segment.start.z) * localT,
        };
      }
      traversed += available;
    }
    const last = segments[segments.length - 1].end;
    return { x: last.x, z: last.z };
  };

  const bounces = bounceDistances.map((entry) => ({
    progress: totalLength ? entry.distance / totalLength : 0,
    intensity: entry.intensity,
    obstacleType: entry.obstacleType || 'generic',
  }));

  return {
    waypoints,
    segments,
    totalLength,
    bounces,
    finalWaypoint: waypoints[waypoints.length - 1],
    getPointAt: resolvePointAt,
  };
}

function buildAdditionalTravelTargets(metrics, additionalSegments) {
  if (!Number.isFinite(additionalSegments) || additionalSegments <= 0) return [];
  const targets = [];
  for (let i = 0; i < additionalSegments; i += 1) {
    const isLast = i === additionalSegments - 1;
    if (isLast) {
      targets.push(pickInteriorPosition(metrics));
    } else {
      targets.push(i % 2 === 0 ? pickEdgePosition(metrics) : pickInteriorPosition(metrics));
    }
  }
  return targets;
}

function extendPathDistance(basePath, additionalTargets, metrics, options = {}) {
  if (!basePath || !Array.isArray(additionalTargets) || !additionalTargets.length) return basePath;
  const lastWaypoint =
    basePath.finalWaypoint || basePath.waypoints?.[basePath.waypoints.length - 1];
  if (!lastWaypoint) return basePath;

  const ricochetOptions = {
    maxBounces: options.maxBounces ?? DEFAULT_RICOCHET_SETTINGS.maxBounces,
    clearanceTiles: options.clearanceTiles ?? DEFAULT_RICOCHET_SETTINGS.clearanceTiles,
    obstacles: Array.isArray(options.obstacles) ? options.obstacles : undefined,
  };

  const paths = [basePath];
  let currentPoint = clonePoint(lastWaypoint);
  for (const target of additionalTargets) {
    const nextTarget = clonePoint(target);
    let subPath = buildRicochetPath(currentPoint, nextTarget, metrics, ricochetOptions);
    if (!subPath?.segments?.length) {
      subPath = createLinearPath(currentPoint, nextTarget, metrics);
    }
    paths.push(subPath);
    currentPoint = clonePoint(subPath.finalWaypoint || nextTarget);
  }

  const combined = mergePathInfos(paths);
  return combined || basePath;
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

function orientMeshToFaceIndex(mesh, faceIndex, three) {
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
  const baseTravelMs = options.travelMs ?? TRAVEL_DURATION_MS;
  const settleDurationMs = options.settleDurationMs ?? 650;
  const snapDurationMs = options.snapDurationMs ?? SNAP_DURATION_MS;
  const forcedFaceIndex = Number.isFinite(options.forceFaceIndex) ? options.forceFaceIndex : null;
  const initialStart = pickEdgePosition(metrics);
  const initialTarget = pickInteriorPosition(metrics);
  const defaultPathLength = Math.hypot(
    (initialTarget.x || 0) - (initialStart.x || 0),
    (initialTarget.z || 0) - (initialStart.z || 0)
  );
  const fallbackPath = {
    waypoints: [initialStart, initialTarget],
    segments: [
      {
        start: initialStart,
        end: initialTarget,
        length: defaultPathLength,
      },
    ],
    totalLength: defaultPathLength || metrics.tileSize || 1,
    bounces: [],
    finalWaypoint: initialTarget,
    getPointAt: (progress) => {
      const clamped = clampToRange(progress, 0, 1);
      return {
        x: initialStart.x + (initialTarget.x - initialStart.x) * clamped,
        z: initialStart.z + (initialTarget.z - initialStart.z) * clamped,
      };
    },
  };

  let pathInfo = fallbackPath;
  let obstacles = null;
  if (options.enableRicochet !== false) {
    try {
      obstacles = collectCollisionObstacles(manager, metrics);
      const ricochetPath = buildRicochetPath(initialStart, initialTarget, metrics, {
        obstacles,
        maxBounces: options.maxRicochetBounces,
        clearanceTiles: options.ricochetClearanceTiles,
      });
      if (ricochetPath?.segments?.length) {
        pathInfo = ricochetPath;
      }
    } catch (_) {
      pathInfo = fallbackPath;
    }
  }

  const basePathLength = pathInfo.totalLength || metrics.tileSize || 1;
  const distanceMultiplier = Number.isFinite(options.travelDistanceMultiplier)
    ? Math.max(1, options.travelDistanceMultiplier)
    : TRAVEL_DISTANCE_MULTIPLIER;
  const desiredSegments = Math.max(2, Math.round(distanceMultiplier));
  const additionalSegmentsNeeded = Math.max(0, desiredSegments - 1);
  const additionalTargets = buildAdditionalTravelTargets(metrics, additionalSegmentsNeeded);
  const extendedTravelEnabled = options.enableExtendedTravel !== false;
  if (extendedTravelEnabled && additionalTargets.length) {
    pathInfo = extendPathDistance(pathInfo, additionalTargets, metrics, {
      obstacles,
      maxBounces: options.maxRicochetBounces,
      clearanceTiles: options.ricochetClearanceTiles,
    });
  }
  const adjustedPathLength = pathInfo.totalLength || basePathLength;
  const travelDistanceScale = Math.max(
    1,
    basePathLength > 0 ? adjustedPathLength / basePathLength : distanceMultiplier
  );
  const travelDurationMs = baseTravelMs * travelDistanceScale;

  const start = pathInfo.waypoints?.[0] || initialStart;
  const target = pathInfo.finalWaypoint || initialTarget;
  const arcHeight = options.arcHeight ?? metrics.tileSize * 0.05;
  const restHeight =
    typeof options.restHeight === 'number' ? options.restHeight : DEFAULT_REST_HEIGHT;
  const hopHeight = metrics.tileSize * 1.15;
  const groundLift = (mesh.userData?.groundLiftBase ?? 0) * mesh.scale.x;
  const sampleGroundHeight = createGroundSampler(manager, metrics, restHeight);
  const pathResolver =
    typeof pathInfo.getPointAt === 'function' ? pathInfo.getPointAt : fallbackPath.getPointAt;
  const pathBounces = Array.isArray(pathInfo.bounces) ? pathInfo.bounces : [];
  const bouncePulseWidth = Number.isFinite(options.ricochetPulseWidth)
    ? Math.max(0.02, options.ricochetPulseWidth)
    : DEFAULT_RICOCHET_SETTINGS.pulseWidth;
  const ricochetHopScale = hopHeight * 0.75;
  let forcedFaceAligned = false;
  const getBounceBoost = (progress) => {
    if (!pathBounces.length) return 0;
    let boost = 0;
    for (const bounce of pathBounces) {
      const delta = Math.abs(progress - (bounce.progress ?? 0));
      if (delta <= bouncePulseWidth) {
        const strength = 1 - delta / bouncePulseWidth;
        boost += ricochetHopScale * (bounce.intensity ?? 0.6) * strength;
      }
    }
    return boost;
  };

  let resolvedGroundY = sampleGroundHeight(start.x, start.z, restHeight);
  const targetGroundY = sampleGroundHeight(target.x, target.z, restHeight);

  mesh.position.set(start.x, resolvedGroundY + groundLift + arcHeight, start.z);
  mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
  const startAngles = { x: mesh.rotation.x, y: mesh.rotation.y, z: mesh.rotation.z };
  const spinScale = Math.max(1, travelDistanceScale);
  const endAngles = {
    x: startAngles.x + randomBetween(Math.PI * 3 * spinScale, Math.PI * 5 * spinScale),
    y: startAngles.y + randomBetween(Math.PI * 2 * spinScale, Math.PI * 4 * spinScale),
    z: startAngles.z + randomBetween(Math.PI * 2 * spinScale, Math.PI * 4 * spinScale),
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
    const travelT = Math.min(Math.max(elapsed / travelDurationMs, 0), 1);
    const eased = easeOutCubic(travelT);
    const pathPoint = pathResolver(eased) || target;
    mesh.position.x = pathPoint.x;
    mesh.position.z = pathPoint.z;

    if (settleTs == null) {
      const bounce = Math.sin(travelT * Math.PI) * hopHeight + getBounceBoost(eased);
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
        if (forcedFaceIndex != null && !forcedFaceAligned) {
          forcedFaceAligned = orientMeshToFaceIndex(mesh, forcedFaceIndex, threeNamespace);
          if (!forcedFaceAligned && options.debugFaceIndex !== false) {
            console.warn('[dice3d] unable to align die to requested faceIndex', forcedFaceIndex);
          }
          ensureGroundContact();
        }
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
            if (forcedFaceIndex != null && !forcedFaceAligned) {
              forcedFaceAligned = orientMeshToFaceIndex(mesh, forcedFaceIndex, threeNamespace);
              ensureGroundContact();
            }
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
    const valueNumber = Number(animationOptions.value);
    const resolvedRollValue =
      Number.isInteger(valueNumber) && valueNumber >= 1 && valueNumber <= 20 ? valueNumber : null;
    if (
      resolvedRollValue != null &&
      !Number.isFinite(animationOptions.forceFaceIndex) &&
      getFaceIndexForValue(resolvedRollValue) != null
    ) {
      animationOptions.forceFaceIndex = getFaceIndexForValue(resolvedRollValue);
    }
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
