import { getManualAction } from '../../config/HumanoidActionCatalog.js';
import {
  facingAngleFromDirection,
  getTokenConditions,
} from '../../entities/creatures/TokenMovement.js';

function rootTrack(clip, root) {
  const track = clip.tracks.find((entry) => entry.name === `${root.bone.name}.position`);
  if (!track) throw new Error('A moving action requires an authored hip position track');
  return track;
}

export function createOutAndBackClip(outward, recovery, root, three) {
  const out = outward.clone();
  const back = recovery.clone();
  const a = rootTrack(out, root);
  const b = rootTrack(back, root);
  const end = a.values.length - 3;
  const displacement = { x: a.values[end] - a.values[0], z: a.values[end + 2] - a.values[2] };
  const returnEnd = b.values.length - 3;
  const rx = b.values[returnEnd] - b.values[0];
  const rz = b.values[returnEnd + 2] - b.values[2];
  const denominator = rx * rx + rz * rz;
  if (denominator < 1e-8) throw new Error('Dodge recovery requires a translated sidestep');
  const real = (-displacement.x * rx - displacement.z * rz) / denominator;
  const imaginary = (-displacement.z * rx + displacement.x * rz) / denominator;
  const ox = a.values[0];
  const oz = a.values[2];
  const bx = b.values[0];
  const bz = b.values[2];
  for (let i = 0; i < a.values.length; i += 3) {
    a.values[i] += root.basePosition.x - ox;
    a.values[i + 2] += root.basePosition.z - oz;
  }
  for (let i = 0; i < b.values.length; i += 3) {
    const x = b.values[i] - bx;
    const z = b.values[i + 2] - bz;
    b.values[i] = root.basePosition.x + displacement.x + real * x - imaginary * z;
    b.values[i + 2] = root.basePosition.z + displacement.z + imaginary * x + real * z;
  }
  const returnTracks = new Map(back.tracks.map((track) => [track.name, track]));
  const blend = 0.12;
  for (const track of out.tracks) {
    const second = returnTracks.get(track.name);
    if (!second) throw new Error(`Dodge recovery is missing track ${track.name}`);
    track.times = new Float32Array([
      ...track.times,
      ...Array.from(second.times, (time) => time + out.duration + blend),
    ]);
    track.values = new Float32Array([...track.values, ...second.values]);
  }
  return new three.AnimationClip(
    'Dodge and recovery',
    out.duration + blend + back.duration,
    out.tracks
  );
}

function findCoverWall(token, minimumHeight = 0) {
  const gm = this.gameManager;
  const { tileWorldSize: tile, elevationUnit } = gm.spatial;
  const world = this._resolveTokenWorldPosition(token);
  const grid = this._mapWorldToGrid(world);
  let nearest = null;
  for (const [dx, dz] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    const x = grid.gridX + dx;
    const z = grid.gridY + dz;
    if (x < 0 || z < 0 || x >= gm.cols || z >= gm.rows) continue;
    const top = gm.getTerrainHeight(x, z) * elevationUnit;
    if (top - world.y < Math.max(minimumHeight, 1e-6)) continue;
    const plane = dx
      ? (grid.gridX + (dx > 0 ? 1 : 0)) * tile
      : (grid.gridY + (dz > 0 ? 1 : 0)) * tile;
    const distance = dx ? Math.abs(plane - world.x) : Math.abs(plane - world.z);
    if (!nearest || distance < nearest.distance) nearest = { dx, dz, plane, distance, top };
  }
  return nearest;
}

function getManualActionAvailability(token, commandId) {
  const definition = getManualAction(commandId);
  if (!definition) return { allowed: false, reason: 'Unknown creature action.' };
  if (token?.flightActive) {
    return { allowed: false, reason: 'Reach the ground before playing a grounded visual action.' };
  }
  if (getTokenConditions(token).includes('prone'))
    return { allowed: false, reason: 'Stand up from Prone before playing a visual action.' };
  const data = this._tokenAnimationData.get(token);
  if (!data) return { allowed: false, reason: 'Creature animations are still loading.' };
  if (this.isMovementInProgress(token) || this.isWallAttached(token))
    return { allowed: false, reason: 'Finish movement or climbing first.' };
  if (data.loadingManualAction)
    return { allowed: false, reason: 'Another action is still loading.' };
  if (
    definition.requiresWall &&
    !findCoverWall.call(
      this,
      token,
      data.coverMetrics?.height ?? this.gameManager.spatial.tileWorldSize * 0.5
    )
  )
    return {
      allowed: false,
      reason: 'Take Cover requires an adjacent wall high enough for this pose.',
    };
  return { allowed: true };
}

async function _prepareManualActionMotion(token, definition, key) {
  const data = this._tokenAnimationData.get(token);
  const three = await this._getThree();
  const root = this._rootBones.get(token)?.[0];
  if (definition.returnAnimation && !data.preparedReturnActions?.has(key)) {
    const clip = createOutAndBackClip(
      data.actions[key].getClip(),
      data.actions[definition.returnAnimation.key].getClip(),
      root,
      three
    );
    data.actions[key].stop();
    const action = data.mixer.clipAction(clip);
    this._configureAction(action, definition.animation, three);
    data.actions[key] = action;
    data.clips[key] = clip.duration;
    (data.preparedReturnActions ||= new Set()).add(key);
  }
  if (!definition.requiresWall) return null;
  if (!data.coverMetrics) {
    const clone = await this._cloneTemplate(data.templateRoot);
    if (!clone) throw new Error('Unable to sample the cover pose');
    let hip;
    clone.traverse((node) => {
      if (node.isBone && !node.parent?.isBone) hip ||= node;
    });
    let clip = data.actions[key].getClip();
    const mixer = new three.AnimationMixer(clone);
    const action = mixer.clipAction(clip).setLoop(three.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    const grounded = clip.clone();
    const groundedPosition = rootTrack(grounded, root);
    const scaleY = hip.parent.getWorldScale(new three.Vector3()).y;
    for (let frame = 0; frame < groundedPosition.times.length; frame++) {
      mixer.setTime(groundedPosition.times[frame]);
      hip.position.x = root.basePosition.x;
      hip.position.z = root.basePosition.z;
      clone.updateMatrixWorld(true);
      const sampleBounds = new three.Box3();
      clone.traverse((node) => {
        if (node.isSkinnedMesh) sampleBounds.union(new three.Box3().setFromObject(node, true));
      });
      groundedPosition.values[frame * 3 + 1] -= sampleBounds.min.y / scaleY;
    }
    action.stop();
    clip = grounded;
    data.actions[key].stop();
    const groundedAction = data.mixer.clipAction(clip);
    this._configureAction(groundedAction, definition.animation, three);
    data.actions[key] = groundedAction;
    const sampledAction = mixer.clipAction(clip).setLoop(three.LoopOnce, 1);
    sampledAction.clampWhenFinished = true;
    sampledAction.play();
    mixer.setTime(clip.duration);
    const yaw = new three.Euler().setFromQuaternion(hip.quaternion, 'YXZ').y;
    hip.quaternion.premultiply(
      new three.Quaternion().setFromAxisAngle(new three.Vector3(0, 1, 0), -yaw)
    );
    hip.position.x = root.basePosition.x;
    hip.position.z = root.basePosition.z;
    clone.updateMatrixWorld(true);
    const bounds = new three.Box3();
    clone.traverse((node) => {
      if (node.isSkinnedMesh) bounds.union(new three.Box3().setFromObject(node, true));
    });
    const hold = clip.clone();
    hold.name = 'Aligned cover hold';
    hold.duration = 1 / 30;
    for (const track of hold.tracks) {
      const pose = Array.from(track.createInterpolant().evaluate(clip.duration));
      if (track.name === `${hip.name}.position`) {
        pose[0] = root.basePosition.x;
        pose[2] = root.basePosition.z;
      } else if (track.name === `${hip.name}.quaternion`) {
        hip.quaternion.toArray(pose);
      }
      track.times = new Float32Array([0, hold.duration]);
      track.values = new Float32Array([...pose, ...pose]);
    }
    const holdAction = data.mixer.clipAction(hold);
    this._configureAction(holdAction, { loop: 'repeat' }, three);
    data.actions.actionCoverHold = holdAction;
    data.clips.actionCoverHold = hold.duration;
    data.coverMetrics = {
      height: bounds.max.y,
      back: Math.max(-bounds.min.z, 0.02),
      yaw,
      quaternion: hip.quaternion.clone(),
    };
    mixer.stopAllAction();
    mixer.uncacheRoot(clone);
  }
  const wall = findCoverWall.call(this, token, data.coverMetrics.height);
  if (!wall)
    throw new Error('Take Cover requires an adjacent wall high enough for the crouched creature');
  const start = this._resolveTokenWorldPosition(token);
  const goal = { ...start };
  const inset = data.coverMetrics.back + this.gameManager.spatial.tileWorldSize * 0.02;
  if (wall.dx) goal.x = wall.plane - wall.dx * inset;
  else goal.z = wall.plane - wall.dz * inset;
  const outward = facingAngleFromDirection(-wall.dx, -wall.dz);
  return {
    start,
    goal,
    initialFacing: token.facingAngle || 0,
    approachFacing: this._normalizeAngle(outward - data.coverMetrics.yaw),
    finalFacing: outward,
    key,
    held: false,
  };
}

function _advanceManualActionMotion(token, manual) {
  const placement = manual.coverPlacement;
  if (!placement) return;
  const data = this._tokenAnimationData.get(token);
  if (!findCoverWall.call(this, token, data.coverMetrics.height)) {
    this.releaseManualActionForFacing(token);
    return;
  }
  const action = data.actions[placement.key];
  const t = placement.held ? 1 : Math.min(action.time / data.clips[placement.key], 1);
  const root = this._rootBones.get(token)[0];
  if (!placement.held) {
    const first = this._getActionRootPosition(root, action, 0);
    const last = this._getActionRootPosition(root, action, data.clips[placement.key]);
    const current = this._getActionRootPosition(root, action);
    const dx = last.x - first.x;
    const dz = last.z - first.z;
    const squared = dx * dx + dz * dz;
    const progress =
      squared > 1e-8
        ? Math.min(
            1,
            Math.max(0, ((current.x - first.x) * dx + (current.z - first.z) * dz) / squared)
          )
        : t * t * (3 - 2 * t);
    this._syncTokenAndMeshWorld(
      { token, mesh: token.__threeMesh },
      this._lerp3(placement.start, placement.goal, progress)
    );
    const turn = Math.min(t / 0.18, 1);
    token.facingAngle = this._normalizeAngle(
      placement.initialFacing +
        this._normalizeAngle(placement.approachFacing - placement.initialFacing) * turn
    );
    this._applyOrientationImmediate(token, token.facingAngle);
  } else {
    root.bone.quaternion.copy(data.coverMetrics.quaternion);
  }
}

function _finishCoverPlacement(token, placement) {
  const manual = this._getManualAnimationState(token);
  if (!manual || manual.coverPlacement !== placement) return;
  placement.held = true;
  this._syncTokenAndMeshWorld({ token, mesh: token.__threeMesh }, placement.goal);
  token.facingAngle = placement.finalFacing;
  if (token.creature) token.creature.facingAngle = token.facingAngle;
  this._applyOrientationImmediate(token, token.facingAngle);
  this._setAnimation(token, 'actionCoverHold', {
    immediate: true,
    force: true,
    __manualOverride: true,
  });
  manual.key = 'actionCoverHold';
  this._movementRangeDirty = true;
}

function isFacingLocked(token) {
  return this._isManualMotionInProgress(token);
}

function _isManualMotionInProgress(token) {
  const state = this._getManualAnimationState(token);
  return !!(state?.blocksMovement || (state?.coverPlacement && !state.coverPlacement.held));
}

function releaseManualActionForFacing(token) {
  if (!this._getManualAnimationState(token)?.coverPlacement) return;
  this._clearManualAnimationState(token);
  this._setAnimation(token, 'idle', { force: true, __releaseManual: true });
}

export function installManualActionMotionMethods(prototype) {
  Object.assign(prototype, {
    getManualActionAvailability,
    _prepareManualActionMotion,
    _advanceManualActionMotion,
    _finishCoverPlacement,
    _isManualMotionInProgress,
    isFacingLocked,
    releaseManualActionForFacing,
  });
}
