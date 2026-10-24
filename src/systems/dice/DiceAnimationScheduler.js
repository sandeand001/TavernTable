import logger from '../../utils/logger/Logger.js';
import { adjustDieHeightForGround, collectCollisionObstacles } from './DicePhysics.js';
import {
  diceState,
  DICE_LOG_CATEGORY,
  FACE_INDEX_TO_NUMBER,
  toErrorPayload,
  createGroundSampler,
  collectWorldFaceData,
  getD20ColliderData,
  resolveUpFacingFace,
} from './DiceState.js';

export function computeSnapSolution(mesh, three, groundY) {
  if (!mesh || !three?.Vector3 || !three?.Quaternion) return null;
  const faces = collectWorldFaceData(mesh, three).filter((face) =>
    Number.isInteger(FACE_INDEX_TO_NUMBER[face.faceIndex])
  );
  const down = new three.Vector3(0, -1, 0);
  const best = faces.reduce(
    (current, face) =>
      !current || face.normal.dot(down) > current.normal.dot(down) ? face : current,
    null
  );
  if (!best) return null;
  const correction = new three.Quaternion().setFromUnitVectors(best.normal, down);
  const targetQuat = mesh.quaternion.clone().premultiply(correction);
  return {
    targetQuat,
    applyFinal: () => {
      mesh.quaternion.copy(targetQuat);
      mesh.updateMatrixWorld(true);
      adjustDieHeightForGround(mesh, three, groundY);
    },
  };
}

export function snapDieToBoard(mesh, three, groundY) {
  computeSnapSolution(mesh, three, groundY)?.applyFinal();
}

function notify(callback, payload, stage) {
  if (typeof callback !== 'function') return;
  try {
    callback(payload);
  } catch (error) {
    logger.warn(
      'D20 animation callback failed',
      { stage, error: toErrorPayload(error) },
      DICE_LOG_CATEGORY
    );
  }
}

export async function scheduleRollAnimation(manager, mesh, metrics, options = {}) {
  if (options.forceFaceIndex != null) {
    throw new Error('Physical d20 rolls cannot force a result; use face calibration instead');
  }
  const three = diceState.threeNamespace;
  const { createD20Simulation } = await import('./D20Dynamics.js');
  const sampleGround = createGroundSampler(manager, metrics, options.restHeight ?? 0);
  const groundHeights = Array.from({ length: metrics.rows }, (_, y) =>
    Array.from({ length: metrics.cols }, (_, x) =>
      sampleGround((x + 0.5) * metrics.tileSize, (y + 0.5) * metrics.tileSize)
    )
  );
  const geometry = getD20ColliderData(mesh, three);
  const fitScale =
    (Math.min(metrics.cols, metrics.rows) * metrics.tileSize * 0.4) / geometry.radius;
  mesh.scale.setScalar(Math.min(mesh.scale.x, fitScale));
  const simulation = createD20Simulation({
    geometry,
    scale: mesh.scale.x,
    metrics,
    groundHeights,
    obstacles: collectCollisionObstacles(manager, metrics),
    random: options.random,
  });
  mesh.position.copy(simulation.body.position);
  mesh.quaternion.copy(simulation.body.quaternion);
  const renderQuaternion = new three.Quaternion();

  let finished = false;
  let lastTimestamp = null;
  let removeCallback = null;
  let rafHandle = null;

  const stopScheduling = () => {
    if (removeCallback) {
      removeCallback();
      removeCallback = null;
    }
    if (rafHandle != null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(rafHandle);
      rafHandle = null;
    }
  };

  const step = (timestamp) => {
    if (finished) return;
    try {
      if (!Number.isFinite(timestamp)) throw new Error('Invalid d20 animation timestamp');
      const delta = lastTimestamp == null ? 0 : Math.max((timestamp - lastTimestamp) / 1000, 0);
      lastTimestamp = timestamp;
      const done = simulation.advance(delta);
      const body = simulation.body;
      if (done) {
        mesh.position.copy(body.position);
        mesh.quaternion.copy(body.quaternion);
        mesh.updateMatrixWorld(true);
        if (simulation.cocked) {
          finished = true;
          stopScheduling();
          notify(options.onCocked, { mesh }, 'cocked');
          return;
        }
        const faceInfo = resolveUpFacingFace(mesh, three);
        if (!Number.isInteger(faceInfo?.value) || faceInfo.value < 1 || faceInfo.value > 20) {
          throw new Error('Unable to read the settled d20 face');
        }
        finished = true;
        stopScheduling();
        notify(options.onSettle, { mesh, faceInfo }, 'settle');
      } else {
        mesh.position.copy(body.previousPosition).lerp(body.position, simulation.alpha);
        mesh.quaternion
          .copy(body.previousQuaternion)
          .slerp(renderQuaternion.copy(body.quaternion), simulation.alpha);
      }
    } catch (error) {
      finished = true;
      stopScheduling();
      logger.error('D20 physics roll failed', { error: toErrorPayload(error) }, DICE_LOG_CATEGORY);
      notify(options.onError, error, 'error');
    }
  };

  if (typeof manager?.addAnimationCallback === 'function') {
    removeCallback = manager.addAnimationCallback(step);
    if (
      typeof removeCallback !== 'function' &&
      typeof manager.removeAnimationCallback === 'function'
    ) {
      removeCallback = () => manager.removeAnimationCallback(step);
    }
  } else if (typeof window !== 'undefined') {
    const loop = (timestamp) => {
      step(timestamp);
      if (!finished) rafHandle = window.requestAnimationFrame(loop);
    };
    rafHandle = window.requestAnimationFrame(loop);
  } else {
    throw new Error('No animation scheduler is available for the d20');
  }

  const stopAnimation = () => {
    if (finished) return;
    finished = true;
    stopScheduling();
    notify(options.onCancel, { mesh }, 'cancel');
  };
  return {
    stopAnimation,
    dispose: () => {
      stopAnimation();
      mesh.parent?.remove(mesh);
      const materials = new Set();
      mesh.traverse((child) => {
        if (!child.isMesh) return;
        for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
          if (material) materials.add(material);
        }
      });
      for (const material of materials) material.dispose();
    },
  };
}
