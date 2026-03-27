// Animation scheduling, snap-to-board, and roll animation for the d20 system.
// Extracted from dice3d.js (Phase 7).

import logger from '../../utils/Logger.js';
import {
  clampToRange,
  buildRicochetPath,
  buildAdditionalTravelTargets,
  extendPathDistance,
  adjustDieHeightForGround,
  pickEdgePosition,
  pickInteriorPosition,
  collectCollisionObstacles,
} from './DicePhysics.js';
import {
  diceState,
  DICE_LOG_CATEGORY,
  FACE_INDEX_TO_NUMBER,
  toErrorPayload,
  createGroundSampler,
  collectWorldFaceData,
  resolveUpFacingFace,
  orientMeshToFaceIndex,
} from './DiceState.js';

const TRAVEL_DURATION_MS = 850;
const TRAVEL_DISTANCE_MULTIPLIER = 3;
const SNAP_DURATION_MS = 220;
const DEFAULT_RICOCHET_SETTINGS = {
  maxBounces: 4,
  pulseWidth: 0.085,
  clearanceTiles: 0.35,
  obstacleLimit: 256,
};

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const randomBetween = (min, max) => min + Math.random() * (max - min);
const hasWindow = () => typeof window !== 'undefined';

export function computeSnapSolution(mesh, three, groundY) {
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

export function snapDieToBoard(mesh, three, groundY) {
  const solution = computeSnapSolution(mesh, three, groundY);
  solution?.applyFinal();
}

export function scheduleRollAnimation(manager, mesh, metrics, options = {}) {
  const baseTravelMs = TRAVEL_DURATION_MS;
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

  const DEFAULT_REST_HEIGHT_FALLBACK = 0;
  const start = pathInfo.waypoints?.[0] || initialStart;
  const target = pathInfo.finalWaypoint || initialTarget;
  const arcHeight = options.arcHeight ?? metrics.tileSize * 0.05;
  const restHeight =
    typeof options.restHeight === 'number' ? options.restHeight : DEFAULT_REST_HEIGHT_FALLBACK;
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
  let settleCallbackFired = false;

  const fireSettleCallback = () => {
    if (settleCallbackFired || typeof options.onSettle !== 'function') return;
    let faceInfo = null;
    try {
      faceInfo = resolveUpFacingFace(mesh, diceState.threeNamespace);
    } catch (_) {
      faceInfo = null;
    }
    if (!faceInfo && Number.isFinite(forcedFaceIndex)) {
      faceInfo = {
        faceIndex: forcedFaceIndex,
        value: FACE_INDEX_TO_NUMBER[forcedFaceIndex] ?? null,
      };
    }
    try {
      options.onSettle({ mesh, faceInfo: faceInfo || null });
    } catch (callbackError) {
      logger.warn(
        'Dice settle callback failed',
        { error: toErrorPayload(callbackError) },
        DICE_LOG_CATEGORY
      );
    }
    settleCallbackFired = true;
  };

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
      adjustDieHeightForGround(mesh, diceState.threeNamespace, resolvedGroundY);
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
          forcedFaceAligned = orientMeshToFaceIndex(
            mesh,
            forcedFaceIndex,
            diceState.threeNamespace
          );
          if (!forcedFaceAligned && options.debugFaceIndex !== false) {
            logger.warn(
              'Unable to align die to requested faceIndex',
              { faceIndex: forcedFaceIndex },
              DICE_LOG_CATEGORY
            );
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
          const solution = computeSnapSolution(mesh, diceState.threeNamespace, snapGround);
          if (solution) {
            snapState = {
              startQuat: mesh.quaternion.clone(),
              targetQuat: solution.targetQuat,
              groundY: snapGround,
              startTs: ts,
            };
          } else {
            hasSnappedFlat = true;
            fireSettleCallback();
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
            snapDieToBoard(mesh, diceState.threeNamespace, finalGround);
            snapState = null;
            hasSnappedFlat = true;
            if (forcedFaceIndex != null && !forcedFaceAligned) {
              forcedFaceAligned = orientMeshToFaceIndex(
                mesh,
                forcedFaceIndex,
                diceState.threeNamespace
              );
              ensureGroundContact();
            }
            fireSettleCallback();
            stopAnimation();
          }
          return;
        }
      }

      fireSettleCallback();
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
