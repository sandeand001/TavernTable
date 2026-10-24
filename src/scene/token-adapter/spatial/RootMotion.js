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
      const feet = new Map();
      roots[0].bone.traverse?.((child) => {
        if (child.isBone && child.name?.endsWith('ToeBase') && !feet.has(child.name)) {
          feet.set(child.name, child);
        }
      });
      roots[0].footBones = [...feet.values()];
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
  const mesh = state?.mesh || tokenEntry.__threeMesh;
  const isRecovery = state?.phase === 'climb-recover';
  if (mesh?.userData?.__ttRecoveryGroundOffset || isRecovery) {
    this._applyMeshWorldPosition(mesh, this._resolveTokenWorldPosition(tokenEntry));
    mesh.userData.__ttRecoveryGroundOffset = 0;
  }
  const actionKey =
    state?.phase === 'climb'
      ? 'climb'
      : isRecovery
        ? 'climbRecover'
        : state?.phase === 'fall' && state.fallMode === 'landing'
          ? state.fallLandingKey
          : null;
  const action = this._tokenAnimationData.get(tokenEntry)?.actions?.[actionKey];
  for (const info of roots) {
    const bone = info?.bone;
    if (!bone || !bone.position) continue;
    const base = info.basePosition;
    bone.position.x = base?.x || 0;
    bone.position.z = base?.z || 0;
    const sample = this._getActionRootPosition(info, action);
    if (sample) {
      // Ignore locomotion still present in an outgoing walk/run crossfade.
      const weight = action.time > 0 ? Math.min(Math.max(action.getEffectiveWeight(), 0), 1) : 0;
      bone.position.x += (sample.x - bone.position.x) * weight;
      bone.position.z += (sample.z - bone.position.z) * weight;
    }
  }

  const feet = roots[0].footBones;
  if (isRecovery && mesh?.position && feet?.length) {
    mesh.updateWorldMatrix(true, true);
    const floorY = state.climbRecoverStartWorld?.y ?? tokenEntry.world?.y ?? 0;
    const lowestToe = Math.min(...feet.map((bone) => bone.matrixWorld.elements[13]));
    const lift = Math.max(floorY - lowestToe, 0);
    mesh.position.y += lift;
    mesh.userData.__ttRecoveryGroundOffset = lift;
  }
}

function _getActionRootPosition(rootInfo, action, time = action?.time || 0) {
  const clip = action?.getClip?.();
  if (!clip?.tracks) return null;
  const cache = (rootInfo.positionInterpolants ||= new WeakMap());
  if (!cache.has(clip)) {
    const track = clip.tracks.find((entry) => entry.name === `${rootInfo.bone.name}.position`);
    cache.set(clip, track?.createInterpolant() || null);
  }
  const interpolant = cache.get(clip);
  if (!interpolant) return null;
  const value = interpolant.evaluate(time);
  return { x: value[0], y: value[1], z: value[2] };
}

// ── Root Motion Offset Extraction ────────────────────────────────────────

function _rootDisplacementToWorld(rootInfo, offset) {
  const parent = rootInfo?.bone?.parent;
  parent?.updateWorldMatrix?.(true, false);
  const matrix = parent?.matrixWorld?.elements;
  if (!matrix) return { ...offset };
  return {
    x: matrix[0] * offset.x + matrix[4] * offset.y + matrix[8] * offset.z,
    y: matrix[1] * offset.x + matrix[5] * offset.y + matrix[9] * offset.z,
    z: matrix[2] * offset.x + matrix[6] * offset.y + matrix[10] * offset.z,
  };
}

function _extractRootMotionOffset(state) {
  if (!state?.token) return null;
  const roots = this._rootBones.get(state.token);
  if (!roots?.length) return null;
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
    const offsetWorld = this._rootDisplacementToWorld(rootInfo, offsetLocal);
    return {
      rootInfo,
      offsetLocal,
      offsetWorld,
    };
  }
  return null;
}

// ── Root Bone Pose Reset ─────────────────────────────────────────────────

function _resetRootBonePose(rootInfo, { preservePose = false } = {}) {
  if (!rootInfo?.bone) return;
  const { bone, basePosition, baseQuaternion } = rootInfo;
  const poseY = bone.position?.y;
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
  if (preservePose && bone.position) {
    bone.position.y = poseY;
  }
  if (!preservePose && bone.quaternion) {
    if (baseQuaternion && typeof bone.quaternion.copy === 'function') {
      bone.quaternion.copy(baseQuaternion);
    } else if (baseQuaternion && bone.rotation?.setFromQuaternion) {
      bone.rotation.setFromQuaternion(baseQuaternion);
    }
  }
}

// ── Controller-driven Climbing Clips ─────────────────────────────────────

function _prepareClimbRootMotion(tokenEntry, sourceClips) {
  const rootInfo = this._rootBones.get(tokenEntry)?.[0];
  const trackName = rootInfo?.bone?.name ? `${rootInfo.bone.name}.position` : null;
  const positionTrack = (clip) => clip?.tracks?.find((track) => track.name === trackName);
  const climbTrack = positionTrack(sourceClips.climb);
  const recoverTrack = positionTrack(sourceClips.climbRecover);
  const wallTrack = positionTrack(sourceClips.climbWall);
  const prepared = { ...sourceClips, rootMotion: { rootInfo } };

  if (climbTrack && recoverTrack && climbTrack.times.length > 1) {
    const end = climbTrack.values.length - 3;
    const transfer = {
      x: climbTrack.values[end] - recoverTrack.values[0],
      y: climbTrack.values[end + 1] - recoverTrack.values[1],
      z: climbTrack.values[end + 2] - recoverTrack.values[2],
    };
    prepared.rootMotion.climbTransferLocal = transfer;
    prepared.climb = sourceClips.climb.clone();
    const normalizedTrack = positionTrack(prepared.climb);
    const firstTime = climbTrack.times[0];
    const span = climbTrack.times[climbTrack.times.length - 1] - firstTime;
    for (let i = 0; i < normalizedTrack.times.length; i += 1) {
      // Transfer locomotion to the support anchor, retaining the authored crouch pose.
      const progress = span > 0 ? (normalizedTrack.times[i] - firstTime) / span : 1;
      normalizedTrack.values[i * 3] -= transfer.x * progress;
      normalizedTrack.values[i * 3 + 1] -= transfer.y * progress;
      normalizedTrack.values[i * 3 + 2] -= transfer.z * progress;
    }
  }

  if (wallTrack) {
    const end = wallTrack.values.length - 3;
    prepared.rootMotion.wall = {
      interpolant: wallTrack.createInterpolant(),
      start: { x: wallTrack.values[0], y: wallTrack.values[1], z: wallTrack.values[2] },
      displacementLocal: {
        x: wallTrack.values[end] - wallTrack.values[0],
        y: wallTrack.values[end + 1] - wallTrack.values[1],
        z: wallTrack.values[end + 2] - wallTrack.values[2],
      },
    };
    prepared.climbWall = sourceClips.climbWall.clone();
    const normalizedTrack = positionTrack(prepared.climbWall);
    for (let i = 0; i < normalizedTrack.values.length; i += 3) {
      normalizedTrack.values[i] = wallTrack.values[0];
      normalizedTrack.values[i + 1] = wallTrack.values[1];
      normalizedTrack.values[i + 2] = wallTrack.values[2];
    }
  }

  return prepared;
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
  prototype._getActionRootPosition = _getActionRootPosition;
  prototype._rootDisplacementToWorld = _rootDisplacementToWorld;
  prototype._extractRootMotionOffset = _extractRootMotionOffset;
  prototype._resetRootBonePose = _resetRootBonePose;
  prototype._prepareClimbRootMotion = _prepareClimbRootMotion;
  prototype._applyWorldOffsetToState = _applyWorldOffsetToState;
}
