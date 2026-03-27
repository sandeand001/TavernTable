// dice3d.js — d20 roll orchestration (slim core).
// Model management, animation, and calibration extracted to sibling modules.

import logger from '../../utils/Logger.js';
import {
  diceState,
  hasWindow,
  getSceneManager,
  toErrorPayload,
  DICE_LOG_CATEGORY,
  DEFAULT_SCALE,
  DEFAULT_REST_HEIGHT,
  getBoardMetrics,
} from './DiceState.js';
import {
  ensureThreeNamespace,
  ensureBlueprint,
  cloneDice,
  resetDiceMaterialColors,
  applyCriticalRollTint,
} from './DiceModelManager.js';
import { scheduleRollAnimation } from './DiceAnimationScheduler.js';
// Side-effect import: registers window calibration globals
import './FaceCalibrationUI.js';

// ── Core lifecycle ───────────────────────────────────────────────────────────
function clearActiveDie() {
  if (!diceState.activeDieState) return;
  const state = diceState.activeDieState;
  diceState.activeDieState = null;
  const mesh = state.mesh;
  try {
    state.interactionCleanup?.();
  } catch (_) {
    /* ignore */
  }
  try {
    resetDiceMaterialColors(mesh);
  } catch (_) {
    /* ignore */
  }
  try {
    state.dispose?.();
  } catch (_) {
    if (mesh?.parent) {
      mesh.parent.remove(mesh);
    }
  }
}

// ── Scene helpers (only used within this file) ──────────────────────────────
function resolvePrimaryCamera(manager) {
  return (
    manager?.camera ||
    manager?.activeCamera ||
    manager?.mainCamera ||
    manager?.renderCoordinator?.camera ||
    manager?.gameManager?.camera ||
    manager?.scene?.camera ||
    null
  );
}

function resolvePrimaryDomElement(manager) {
  return (
    manager?.renderer?.domElement ||
    manager?.gameManager?.renderer?.domElement ||
    manager?.renderCoordinator?.renderer?.domElement ||
    (hasWindow() ? window.document?.body : null) ||
    null
  );
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

function attachDieDismissOnClick(manager, mesh) {
  if (!hasWindow() || !mesh || !manager) return null;
  if (!diceState.threeNamespace?.Raycaster || !diceState.threeNamespace?.Vector2) return null;
  const camera = resolvePrimaryCamera(manager);
  if (!camera) return null;
  const pointer = new diceState.threeNamespace.Vector2();
  const raycaster = new diceState.threeNamespace.Raycaster();
  const pointerTargets = [];
  const registerTarget = (target) => {
    if (!target || typeof target.addEventListener !== 'function') return;
    if (pointerTargets.includes(target)) return;
    pointerTargets.push(target);
  };
  const primaryTarget = resolvePrimaryDomElement(manager) || window;
  registerTarget(primaryTarget);
  if (hasWindow()) {
    registerTarget(window);
    registerTarget(window.document);
  }
  if (!pointerTargets.length) return null;

  const pointerEvents = ['pointerdown'];
  if (!(hasWindow() && 'PointerEvent' in window)) {
    pointerEvents.push('mousedown', 'click');
  }

  const updatePointerFromEvent = (event) => {
    const clientX = event?.clientX ?? 0;
    const clientY = event?.clientY ?? 0;
    const rect =
      event?.currentTarget?.getBoundingClientRect?.() || primaryTarget?.getBoundingClientRect?.();
    if (rect && rect.width && rect.height) {
      pointer.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1
      );
      return true;
    }
    if (hasWindow() && window.innerWidth && window.innerHeight) {
      pointer.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
      return true;
    }
    return false;
  };

  const handler = (event) => {
    if (!diceState.activeDieState || diceState.activeDieState.mesh !== mesh) return;
    if (event?.button != null && event.button !== 0) return;
    if (!updatePointerFromEvent(event)) return;
    raycaster.setFromCamera(pointer, camera);
    const intersections = raycaster.intersectObject(mesh, true);
    if (!intersections?.length) return;
    clearActiveDie();
  };

  pointerTargets.forEach((target) => {
    pointerEvents.forEach((type) => {
      try {
        target.addEventListener(type, handler, { passive: true });
      } catch (_) {
        target.addEventListener(type, handler);
      }
    });
  });

  return () => {
    pointerTargets.forEach((target) => {
      pointerEvents.forEach((type) => {
        try {
          target.removeEventListener(type, handler);
        } catch (_) {
          /* ignore */
        }
      });
    });
  };
}

// ── Public API ──────────────────────────────────────────────────────────────
export async function playD20RollOnGrid(options = {}) {
  if (!hasWindow()) return { success: false, value: null, reason: 'no-window' };
  const manager = getSceneManager();
  if (!manager || manager.degraded || !manager.scene) {
    return { success: false, value: null, reason: 'no-manager' };
  }

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
    resetDiceMaterialColors(clone);
    const animationOptions = { ...options };
    const upstreamOnSettle =
      typeof animationOptions.onSettle === 'function' ? animationOptions.onSettle : null;
    if (typeof animationOptions.restHeight !== 'number') {
      animationOptions.restHeight = DEFAULT_REST_HEIGHT;
    }
    let clickDismissCleanup = null;
    if (animationOptions.dismissOnClick !== false) {
      try {
        clickDismissCleanup = attachDieDismissOnClick(manager, clone);
      } catch (_) {
        clickDismissCleanup = null;
      }
    }

    let settled = false;
    let settleResolver;
    const settlePromise = new Promise((resolve) => {
      settleResolver = resolve;
    });

    animationOptions.onSettle = (payload) => {
      if (settled) return;
      settled = true;
      const faceValue = Number.isInteger(payload?.faceInfo?.value) ? payload.faceInfo.value : null;
      applyCriticalRollTint(clone, faceValue);
      if (upstreamOnSettle) {
        try {
          upstreamOnSettle(payload);
        } catch (callbackError) {
          logger.warn(
            '[dice3d] upstream onSettle callback failed',
            { error: toErrorPayload(callbackError) },
            DICE_LOG_CATEGORY
          );
        }
      }
      settleResolver({
        success: true,
        value: faceValue,
        faceInfo: payload?.faceInfo || null,
      });
    };

    const animationState = scheduleRollAnimation(manager, clone, metrics, animationOptions);
    diceState.activeDieState = {
      mesh: clone,
      dispose: animationState.dispose,
      interactionCleanup: clickDismissCleanup,
    };

    return await settlePromise;
  } catch (error) {
    logger.error(
      '[dice3d] Unable to play d20 animation',
      { error: toErrorPayload(error) },
      DICE_LOG_CATEGORY
    );
    return {
      success: false,
      value: null,
      reason: 'exception',
      error,
    };
  }
}

// ── Cleanup on page unload ──────────────────────────────────────────────────
if (hasWindow()) {
  window.addEventListener('beforeunload', () => {
    clearActiveDie();
  });
}
