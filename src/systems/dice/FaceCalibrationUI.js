// Face calibration UI for the d20 dice system.
// Extracted from dice3d.js (Phase 7).

import logger from '../../utils/Logger.js';
import {
  diceState,
  hasWindow,
  getSceneManager,
  DICE_LOG_CATEGORY,
  DEFAULT_SCALE,
  DEFAULT_REST_HEIGHT,
  D20_FACE_CALIBRATION_SEQUENCE,
  getBoardMetrics,
  createGroundSampler,
  collectWorldFaceData,
  resolveUpFacingFace,
  orientMeshToFaceIndex,
} from './DiceState.js';
import { ensureThreeNamespace, ensureBlueprint, cloneDice } from './DiceModelManager.js';

function getCalibrationSequence() {
  return D20_FACE_CALIBRATION_SEQUENCE.map((entry) => ({ ...entry }));
}

function cycleCalibrationFace(direction = 0) {
  if (!diceState.faceCalibrationState?.mesh || !diceState.threeNamespace) return null;
  const sequence = diceState.faceCalibrationState.sequence || [];
  if (!sequence.length) return null;
  if (direction !== 0) {
    const nextIndex =
      (diceState.faceCalibrationState.sequenceIndex + direction + sequence.length) %
      sequence.length;
    diceState.faceCalibrationState.sequenceIndex = nextIndex;
  }
  const entry = sequence[diceState.faceCalibrationState.sequenceIndex];
  if (!entry) return null;
  orientMeshToFaceIndex(
    diceState.faceCalibrationState.mesh,
    entry.faceIndex,
    diceState.threeNamespace
  );
  diceState.faceCalibrationState.mesh.updateMatrixWorld(true);
  const faces = collectWorldFaceData(diceState.faceCalibrationState.mesh, diceState.threeNamespace);
  const fallbackInfo = {
    faceIndex: entry.faceIndex,
    value: entry.value,
  };
  const resolved = resolveUpFacingFace(
    diceState.faceCalibrationState.mesh,
    diceState.threeNamespace,
    faces
  );
  if (resolved) {
    diceState.faceCalibrationState.currentFaceInfo = {
      ...resolved,
      faceIndex: Number.isFinite(resolved.faceIndex) ? resolved.faceIndex : fallbackInfo.faceIndex,
      value: resolved.value ?? fallbackInfo.value ?? null,
    };
  } else {
    diceState.faceCalibrationState.currentFaceInfo = { ...fallbackInfo };
  }
  if (hasWindow() && logger.isInfoEnabled()) {
    const info = diceState.faceCalibrationState.currentFaceInfo || entry;
    logger.info(
      'D20 calibration face ready',
      {
        value: info?.value ?? 'unknown',
        faceIndex: info?.faceIndex ?? 'n/a',
      },
      DICE_LOG_CATEGORY
    );
  }
  return diceState.faceCalibrationState.currentFaceInfo;
}

function handleCalibrationPointer(event) {
  if (
    !diceState.faceCalibrationState?.mesh ||
    !diceState.threeNamespace?.Raycaster ||
    !diceState.threeNamespace?.Vector2
  )
    return;
  const { mesh, raycaster, pointer, camera, domElement } = diceState.faceCalibrationState;
  if (!raycaster || !pointer || !camera) return;
  const rect = domElement?.getBoundingClientRect?.();
  const clientX = event.clientX ?? 0;
  const clientY = event.clientY ?? 0;
  if (rect && rect.width && rect.height) {
    pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
  } else if (hasWindow()) {
    pointer.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
  } else {
    return;
  }
  raycaster.setFromCamera(pointer, camera);
  const intersections = raycaster.intersectObject(mesh, true);
  if (!intersections?.length) return;
  const hit = intersections[0];
  if (!hit?.point) return;
  const worldPoint = hit.point.clone();
  const localPoint = mesh.worldToLocal(worldPoint.clone());
  const faceInfo = diceState.faceCalibrationState.currentFaceInfo || {};
  const record = {
    faceValue: faceInfo.value ?? null,
    faceIndex: faceInfo.faceIndex ?? null,
    local: [
      Number(localPoint.x.toFixed(6)),
      Number(localPoint.y.toFixed(6)),
      Number(localPoint.z.toFixed(6)),
    ],
    world: [
      Number(worldPoint.x.toFixed(6)),
      Number(worldPoint.y.toFixed(6)),
      Number(worldPoint.z.toFixed(6)),
    ],
    timestamp: new Date().toISOString(),
  };
  diceState.faceCalibrationState.records.push(record);
  if (logger.isInfoEnabled()) {
    logger.info('[dice3d] Recorded face center', record, DICE_LOG_CATEGORY);
  }
  if (diceState.faceCalibrationState.autoAdvance) {
    cycleCalibrationFace(1);
  }
}

export async function startD20FaceCalibration(options = {}) {
  if (!hasWindow()) return null;
  const manager = getSceneManager();
  if (!manager?.scene) {
    logger.warn(
      '[dice3d] Unable to start calibration: missing scene manager.',
      {},
      DICE_LOG_CATEGORY
    );
    return null;
  }
  await ensureThreeNamespace();
  await ensureBlueprint();
  stopD20FaceCalibration();
  // Clear any active die — import-safe because clearActiveDie is in dice3d.js
  // and we avoid circular deps by inlining the minimal cleanup here.
  if (diceState.activeDieState) {
    const state = diceState.activeDieState;
    diceState.activeDieState = null;
    try {
      state.interactionCleanup?.();
    } catch (_) {
      /* ignore */
    }
    try {
      state.dispose?.();
    } catch (_) {
      if (state.mesh?.parent) state.mesh.parent.remove(state.mesh);
    }
  }

  const mesh = cloneDice(diceState.diceBlueprint);
  const metrics = getBoardMetrics(manager);
  const tileSize = metrics.tileSize || 1;
  const scale = tileSize * (options.scale ?? DEFAULT_SCALE);
  mesh.scale.setScalar(scale);
  const restHeight =
    typeof options.restHeight === 'number' ? options.restHeight : DEFAULT_REST_HEIGHT;
  const sampleGround = createGroundSampler(manager, metrics, restHeight);
  const worldX = Number.isFinite(options.worldX) ? options.worldX : (metrics.centerX ?? 0);
  const worldZ = Number.isFinite(options.worldZ) ? options.worldZ : (metrics.centerZ ?? 0);
  const groundY = sampleGround(worldX, worldZ, restHeight);
  mesh.position.set(worldX, groundY + (mesh.userData?.groundLiftBase ?? 0) * scale, worldZ);
  mesh.rotation.set(0, 0, 0);
  mesh.updateMatrixWorld(true);
  manager.scene.add(mesh);

  const camera =
    options.camera ||
    manager.camera ||
    manager.activeCamera ||
    manager.mainCamera ||
    manager.scene?.camera ||
    manager.gameManager?.camera ||
    null;
  const domElement =
    options.domElement ||
    manager.renderer?.domElement ||
    manager.gameManager?.renderer?.domElement ||
    window;

  if (!camera || !diceState.threeNamespace?.Raycaster || !diceState.threeNamespace?.Vector2) {
    logger.warn(
      '[dice3d] Unable to start calibration: missing camera or raycasting support.',
      {},
      DICE_LOG_CATEGORY
    );
    if (mesh.parent) {
      mesh.parent.remove(mesh);
    }
    return null;
  }

  diceState.faceCalibrationState = {
    mesh,
    manager,
    camera,
    domElement,
    pointerTarget: domElement || window,
    raycaster: new diceState.threeNamespace.Raycaster(),
    pointer: new diceState.threeNamespace.Vector2(),
    records: [],
    sequence: getCalibrationSequence(),
    sequenceIndex: 0,
    autoAdvance: options.autoAdvance !== false,
    currentFaceInfo: null,
  };

  if (!diceState.faceCalibrationState.sequence.length) {
    logger.warn('[dice3d] Unable to start calibration: missing face order.', {}, DICE_LOG_CATEGORY);
    stopD20FaceCalibration();
    return null;
  }

  const pointerTargets = [];
  const registerTarget = (target) => {
    if (!target || typeof target.addEventListener !== 'function') return;
    if (pointerTargets.includes(target)) return;
    pointerTargets.push(target);
  };
  registerTarget(diceState.faceCalibrationState.pointerTarget);
  if (hasWindow()) {
    registerTarget(window);
    registerTarget(window.document);
  }
  if (!pointerTargets.length && hasWindow()) {
    registerTarget(window);
  }

  const pointerEvents = ['pointerdown'];
  if (!(hasWindow() && 'PointerEvent' in window)) {
    pointerEvents.push('mousedown', 'click');
  }

  const processedPointerEvents = new WeakSet();
  const pointerHandler = (event) => {
    if (!event) return;
    if (event.button != null && event.button !== 0) return;
    if (processedPointerEvents.has(event)) return;
    processedPointerEvents.add(event);
    handleCalibrationPointer(event);
  };

  pointerTargets.forEach((target) => {
    pointerEvents.forEach((type) => {
      target?.addEventListener(type, pointerHandler);
    });
  });

  diceState.faceCalibrationState.pointerListener = pointerHandler;
  diceState.faceCalibrationState.pointerTargets = pointerTargets;
  diceState.faceCalibrationState.pointerEvents = pointerEvents;

  cycleCalibrationFace(0);

  const controls = {
    next: () => cycleCalibrationFace(1),
    prev: () => cycleCalibrationFace(-1),
    jumpToValue: (value) => {
      if (!diceState.faceCalibrationState) return null;
      const idx = diceState.faceCalibrationState.sequence.findIndex(
        (entry) => entry.value === value
      );
      if (idx >= 0) {
        diceState.faceCalibrationState.sequenceIndex = idx;
        return cycleCalibrationFace(0);
      }
      return null;
    },
    jumpToFaceIndex: (faceIndex) => {
      if (!diceState.faceCalibrationState) return null;
      const idx = diceState.faceCalibrationState.sequence.findIndex(
        (entry) => entry.faceIndex === faceIndex
      );
      if (idx >= 0) {
        diceState.faceCalibrationState.sequenceIndex = idx;
        return cycleCalibrationFace(0);
      }
      return null;
    },
    current: () => ({ ...(diceState.faceCalibrationState?.currentFaceInfo || {}) }),
    records: () => [...(diceState.faceCalibrationState?.records || [])],
    export: () => JSON.stringify(diceState.faceCalibrationState?.records || [], null, 2),
    stop: () => stopD20FaceCalibration(),
  };

  diceState.faceCalibrationState.controls = controls;
  if (hasWindow()) {
    window.__TT_D20_CALIBRATION = controls;
    if (logger.isInfoEnabled()) {
      logger.info(
        'D20 calibration ready. Use window.__TT_D20_CALIBRATION.next() / prev() to cycle faces and click the die to log centers.',
        {},
        DICE_LOG_CATEGORY
      );
    }
  }

  return controls;
}

export function stopD20FaceCalibration() {
  if (!diceState.faceCalibrationState) return [];
  const records = [...diceState.faceCalibrationState.records];
  if (
    diceState.faceCalibrationState.pointerTargets?.length &&
    diceState.faceCalibrationState.pointerListener
  ) {
    const events = diceState.faceCalibrationState.pointerEvents?.length
      ? diceState.faceCalibrationState.pointerEvents
      : ['pointerdown'];
    diceState.faceCalibrationState.pointerTargets.forEach((target) => {
      events.forEach((type) => {
        target?.removeEventListener(type, diceState.faceCalibrationState.pointerListener);
      });
    });
  } else if (
    diceState.faceCalibrationState.pointerTarget &&
    diceState.faceCalibrationState.pointerListener
  ) {
    diceState.faceCalibrationState.pointerTarget.removeEventListener(
      'pointerdown',
      diceState.faceCalibrationState.pointerListener
    );
  }
  if (diceState.faceCalibrationState.mesh?.parent) {
    diceState.faceCalibrationState.mesh.parent.remove(diceState.faceCalibrationState.mesh);
  }
  if (hasWindow() && window.__TT_D20_CALIBRATION) {
    delete window.__TT_D20_CALIBRATION;
  }
  diceState.faceCalibrationState = null;
  return records;
}

// Register window globals for console access
if (hasWindow()) {
  window.__TT_START_D20_CALIBRATION = (options) => startD20FaceCalibration(options);
  window.__TT_STOP_D20_CALIBRATION = () => stopD20FaceCalibration();
  window.addEventListener('beforeunload', () => {
    stopD20FaceCalibration();
  });
}
