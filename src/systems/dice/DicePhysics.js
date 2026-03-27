// DicePhysics.js — Collision detection, ricochet, vector math, path building.
// Extracted from dice3d.js (Phase 7). Pure functions, no shared state.

// ── Constants & Settings ────────────────────────────────────────
const DEFAULT_RICOCHET_SETTINGS = {
  maxBounces: 4,
  pulseWidth: 0.085,
  clearanceTiles: 0.35,
  obstacleLimit: 256,
};

// ── Vector Math ─────────────────────────────────────────────────
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

// ── Collision Detection ────────────────────────────────────────
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

// ── Ricochet Path Building ─────────────────────────────────────
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

// ── Linear Path ────────────────────────────────────────────────
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

// ── Path Merging & Extension ───────────────────────────────────
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

// ── Ground & Board Position Helpers ──────────────────────────────
function adjustDieHeightForGround(mesh, three, groundY) {
  if (!three?.Box3) return;
  const bounds = new three.Box3().setFromObject(mesh);
  if (!Number.isFinite(bounds.min?.y)) return;
  const delta = groundY - bounds.min.y;
  if (Math.abs(delta) < 0.0001) return;
  mesh.position.y += delta;
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

// ── Exports ────────────────────────────────────────────────────
export {
  clampToRange,
  collectCollisionObstacles,
  buildRicochetPath,
  buildAdditionalTravelTargets,
  extendPathDistance,
  adjustDieHeightForGround,
  pickEdgePosition,
  pickInteriorPosition,
};
