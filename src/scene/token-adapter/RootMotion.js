/**
 * RootMotion.js
 *
 * Root-bone registration and root-motion extraction/neutralisation methods
 * extracted from Token3DAdapter.
 * Each function is written with `this` semantics so it can be installed on a
 * class prototype via `installRootMotionMethods()`.
 */

// ── Root Bone Registration ───────────────────────────────────────────────

function _registerRootBones(tokenEntry, container) {
  if (!tokenEntry || !container) return;
  try {
    const roots = [];
    container.traverse?.((child) => {
      if (!child?.isBone) return;
      const parentIsBone = child.parent && child.parent.isBone;
      if (parentIsBone) return;
      const basePosition = child.position?.clone?.() || null;
      const baseQuaternion = child.quaternion?.clone?.() || null;
      roots.push({ bone: child, basePosition, baseQuaternion });
    });
    if (roots.length) {
      container.userData = container.userData || {};
      container.userData.__ttRootBones = roots;
      this._rootBones.set(tokenEntry, roots);
    }
  } catch (_) {
    /* ignore root registration errors */
  }
}

// ── Root Motion Neutralisation ───────────────────────────────────────────

function _neutralizeRootMotion(tokenEntry) {
  const roots = this._rootBones.get(tokenEntry);
  if (!roots || !roots.length) return;
  const manualState = this._getManualAnimationState(tokenEntry);
  if (manualState?.allowRootMotion) {
    return;
  }
  const state = this._movementStates.get(tokenEntry);
  const climbTranslationActive =
    state?.phase === 'climb' ||
    state?.climbActive ||
    state?.phase === 'climb-wall' ||
    state?.climbWallActive;
  const climbRotationActive =
    climbTranslationActive || state?.phase === 'climb-recover' || state?.climbRecoverActive;
  const isFallPhase = state?.phase === 'fall';
  const preserveRootTranslation = isFallPhase;
  const allowRootRotation = climbRotationActive || isFallPhase;
  const allowRootTranslation = climbTranslationActive || preserveRootTranslation;
  const clampClimbWallPlanarOffset =
    state?.phase === 'climb-wall' || state?.climbWallActive ? true : false;
  for (const info of roots) {
    const bone = info?.bone;
    if (!bone || !bone.position) continue;
    const base = info.basePosition;
    if (!allowRootTranslation) {
      if (base) {
        bone.position.x = base.x;
        bone.position.y = base.y;
        bone.position.z = base.z;
      } else {
        bone.position.x = 0;
        bone.position.y = 0;
        bone.position.z = 0;
      }
    } else if (clampClimbWallPlanarOffset) {
      if (base) {
        bone.position.x = base.x;
        bone.position.z = base.z;
      } else {
        bone.position.x = 0;
        bone.position.z = 0;
      }
    }
    const baseQuat = info.baseQuaternion;
    if (!allowRootRotation) {
      if (baseQuat && bone.quaternion && typeof bone.quaternion.copy === 'function') {
        bone.quaternion.copy(baseQuat);
      } else if (
        baseQuat &&
        bone.rotation &&
        typeof bone.rotation.setFromQuaternion === 'function'
      ) {
        bone.rotation.setFromQuaternion(baseQuat);
      }
    }
  }
}

// ── Root Motion Offset Extraction ────────────────────────────────────────

function _extractRootMotionOffset(state) {
  if (!state?.token) return null;
  const roots = this._rootBones.get(state.token);
  if (!roots?.length) return null;
  const yaw = state.mesh?.rotation?.y || 0;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const epsilon = 1e-4;
  for (const rootInfo of roots) {
    const bone = rootInfo?.bone;
    const base = rootInfo?.basePosition;
    if (!bone?.position || !base) {
      continue;
    }
    const offsetLocal = {
      x: Number.isFinite(bone.position.x) && Number.isFinite(base.x) ? bone.position.x - base.x : 0,
      y: Number.isFinite(bone.position.y) && Number.isFinite(base.y) ? bone.position.y - base.y : 0,
      z: Number.isFinite(bone.position.z) && Number.isFinite(base.z) ? bone.position.z - base.z : 0,
    };
    if (
      Math.abs(offsetLocal.x) < epsilon &&
      Math.abs(offsetLocal.y) < epsilon &&
      Math.abs(offsetLocal.z) < epsilon
    ) {
      continue;
    }
    const offsetWorld = {
      x: offsetLocal.x * cos - offsetLocal.z * sin,
      z: offsetLocal.x * sin + offsetLocal.z * cos,
      y: offsetLocal.y,
    };
    return {
      rootInfo,
      offsetLocal,
      offsetWorld,
    };
  }
  return null;
}

// ── Root Bone Pose Reset ─────────────────────────────────────────────────

function _resetRootBonePose(rootInfo) {
  if (!rootInfo?.bone) return;
  const { bone, basePosition, baseQuaternion } = rootInfo;
  if (bone.position && basePosition) {
    if (typeof bone.position.copy === 'function') {
      bone.position.copy(basePosition);
    } else {
      bone.position.x = basePosition.x;
      bone.position.y = basePosition.y;
      bone.position.z = basePosition.z;
    }
  } else if (bone.position) {
    bone.position.x = 0;
    bone.position.y = 0;
    bone.position.z = 0;
  }
  if (bone.quaternion) {
    if (baseQuaternion && typeof bone.quaternion.copy === 'function') {
      bone.quaternion.copy(baseQuaternion);
    } else if (baseQuaternion && bone.rotation?.setFromQuaternion) {
      bone.rotation.setFromQuaternion(baseQuaternion);
    }
  }
}

// ── World Offset Application ─────────────────────────────────────────────

function _applyWorldOffsetToState(state, offset) {
  if (!state || !offset) return;
  const dx = Number.isFinite(offset.x) ? offset.x : 0;
  const dy = Number.isFinite(offset.y) ? offset.y : 0;
  const dz = Number.isFinite(offset.z) ? offset.z : 0;
  const epsilon = 1e-5;
  if (Math.abs(dx) < epsilon && Math.abs(dy) < epsilon && Math.abs(dz) < epsilon) {
    return;
  }
  if (state.mesh?.position) {
    state.mesh.position.x = (state.mesh.position.x || 0) + dx;
    state.mesh.position.y = (state.mesh.position.y || 0) + dy;
    state.mesh.position.z = (state.mesh.position.z || 0) + dz;
  }
  const currentWorld = this._resolveTokenWorldPosition(state.token) || { x: 0, y: 0, z: 0 };
  const updatedWorld = {
    x: (currentWorld.x || 0) + dx,
    y: (currentWorld.y || 0) + dy,
    z: (currentWorld.z || 0) + dz,
  };
  this._updateTokenWorldDuringMovement(state.token, updatedWorld);
}

// ── Install ──────────────────────────────────────────────────────────────

export function installRootMotionMethods(prototype) {
  prototype._registerRootBones = _registerRootBones;
  prototype._neutralizeRootMotion = _neutralizeRootMotion;
  prototype._extractRootMotionOffset = _extractRootMotionOffset;
  prototype._resetRootBonePose = _resetRootBonePose;
  prototype._applyWorldOffsetToState = _applyWorldOffsetToState;
}
