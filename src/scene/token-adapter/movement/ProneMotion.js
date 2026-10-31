import { getTokenConditions } from '../../../entities/creatures/TokenMovement.js';
import { PRONE_ANIMATION_KEYS } from '../../../config/token-adapter/MannequinConfig.js';
import { cloneHumanoidRig } from '../HumanoidRig.js';

// -- Persistent pose and voluntary recovery --
function syncProneState(token) {
  if (!this._tokenAnimationData.has(token) || this.isMovementInProgress(token)) return;
  if (token.flightActive) {
    this._setAnimation(token, 'hover', { fadeIn: 0.25, fadeOut: 0.25 });
    this._movementRangeDirty = true;
    return;
  }
  if (this.isWallAttached(token)) return;
  const key = getTokenConditions(token).includes('prone')
    ? 'prone'
    : token.flightActive
      ? 'hover'
      : 'idle';
  this._setAnimation(token, key, { fadeIn: 0.2, fadeOut: 0.2 });
  this._neutralizeRootMotion(token);
  this._movementRangeDirty = true;
}

function playStandUp(token) {
  if (token.flightActive)
    throw new Error('Reach the ground before playing the getting-up animation');
  const data = this._tokenAnimationData.get(token);
  if (!data?.actions?.standUp) throw new Error('The getting-up animation is unavailable');
  if (getTokenConditions(token).includes('prone'))
    throw new Error('Commit standing movement before playing the getting-up animation');
  const state = this._ensureMovementState(token);
  this._clearPathState(state);
  state.forwardKeys.clear();
  state.backwardKeys.clear();
  state.phase = 'stand-up';
  state.phaseElapsed = 0;
  state.standDuration = data.actions.standUp.getClip().duration;
  this._lockTokenWorldAuthority(state);
  this._setAnimation(token, 'standUp', { force: true, fadeIn: 0.16, fadeOut: 0.16 });
  this._movementRangeDirty = true;
}

function _advanceStandUp(state, delta) {
  state.phaseElapsed += delta;
  const action = this._tokenAnimationData.get(state.token)?.actions.standUp;
  if (!action) throw new Error('The getting-up animation disappeared during recovery');
  if (action.time < state.standDuration - 1e-3 && state.phaseElapsed < state.standDuration + 0.1)
    return;
  this._unlockTokenWorldAuthority(state);
  this._resetMovementState(state, { clearStopFlags: true });
  this._movementRangeDirty = true;
}

// -- Ground contact for horizontal bodies --
function _prepareProneGrounding(token, container, data, three) {
  const root = this._rootBones.get(token)?.[0];
  for (const key of PRONE_ANIMATION_KEYS) {
    const previous = data.actions[key];
    if (!previous) continue;
    const clip = previous.getClip().clone();
    const position = clip.tracks.find((track) => track.name === `${root?.bone.name}.position`);
    if (!position || !root?.basePosition) {
      throw new Error(`Prone animation has no usable hip position track: ${key}`);
    }
    for (let frame = 0; frame < position.values.length; frame += 3) {
      position.values[frame] = root.basePosition.x;
      position.values[frame + 2] = root.basePosition.z;
    }
    const referenceKey = data.animationsConfig[key]?.matchEndHeading;
    if (referenceKey !== undefined) {
      const reference = data.actions[referenceKey]?.getClip();
      if (!reference) throw new Error(`Prone heading reference is unavailable: ${referenceKey}`);
      const referenceYaw = clipBodyHeading(
        data.templateRoot,
        reference,
        reference.duration,
        root.bone.name,
        three
      );
      const startYaw = clipBodyHeading(data.templateRoot, clip, 0, root.bone.name, three);
      rotateClipHeading(clip, root.bone.name, referenceYaw - startYaw, three);
    }
    previous.stop();
    data.mixer.uncacheClip(previous.getClip());
    const action = data.mixer.clipAction(clip);
    this._configureAction(action, data.animationsConfig[key], three);
    data.actions[key] = action;
  }
  const skins = [];
  container.traverse((node) => {
    if (node.isSkinnedMesh) skins.push(node);
  });
  data.proneGrounding = { skins, bounds: new three.Box3() };
}

// -- Authored clip heading alignment --
function clipBodyHeading(template, clip, time, rootName, three) {
  const rig = cloneHumanoidRig(template, three);
  const mixer = new three.AnimationMixer(rig);
  const action = mixer.clipAction(clip).setLoop(three.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  mixer.setTime(time);
  rig.updateMatrixWorld(true);
  const at = (name) =>
    rig.skeleton.getBoneByName(`mixamorig${name}`).getWorldPosition(new three.Vector3());
  const feet = at('LeftToeBase').add(at('RightToeBase')).multiplyScalar(0.5);
  const parent = rig.skeleton.getBoneByName(rootName).parent;
  // Lying hips approach gimbal lock; measure the body's long axis instead of Euler yaw.
  const direction = parent.worldToLocal(at('Head')).sub(parent.worldToLocal(feet));
  mixer.stopAllAction();
  mixer.uncacheRoot(rig);
  if (
    !Number.isFinite(direction.x) ||
    !Number.isFinite(direction.z) ||
    Math.hypot(direction.x, direction.z) < 1e-6
  ) {
    throw new Error(`The prone clip has no usable horizontal heading: ${clip.name}`);
  }
  return Math.atan2(direction.x, direction.z);
}

function rotateClipHeading(clip, rootName, radians, three) {
  const track = clip.tracks.find((entry) => entry.name === `${rootName}.quaternion`);
  if (!track) throw new Error(`The prone clip has no hip rotation track: ${clip.name}`);
  const rotation = new three.Quaternion().setFromAxisAngle(new three.Vector3(0, 1, 0), radians);
  const sample = new three.Quaternion();
  for (let frame = 0; frame < track.values.length; frame += 4) {
    sample
      .fromArray(track.values, frame)
      .premultiply(rotation)
      .normalize()
      .toArray(track.values, frame);
  }
}

function _neutralizeProneRoot(token, roots) {
  const data = this._tokenAnimationData.get(token);
  const state = this._movementStates.get(token);
  const mesh = state?.mesh || token.__threeMesh;
  const active = PRONE_ANIMATION_KEYS.has(data?.current);
  let supportWeight = active ? 1 : 0;
  if (!active && data?.current === 'idle') {
    for (const key of PRONE_ANIMATION_KEYS) {
      const action = data.actions[key];
      if (action?.isScheduled?.()) supportWeight += action.getEffectiveWeight();
    }
    supportWeight = Math.min(1, Math.max(0, supportWeight));
  }
  if (!(supportWeight > 0) && mesh?.userData?.__ttProneGroundOffset === undefined) return false;
  const world = this._resolveTokenWorldPosition(token);
  if (mesh?.userData?.__ttProneGroundOffset !== undefined) {
    this._applyMeshWorldPosition(mesh, world);
    delete mesh.userData.__ttProneGroundOffset;
  }
  if (
    !(supportWeight > 0) ||
    !mesh ||
    !data.proneGrounding?.skins.length ||
    (state?.phase === 'fall' && !state.stepFinalized)
  )
    return false;
  for (const { bone, basePosition } of roots) {
    bone.position.x = basePosition.x;
    bone.position.z = basePosition.z;
  }
  // Attached skins refresh their inverse bind matrices through updateMatrixWorld.
  mesh.updateMatrixWorld(true);
  let minimum = Infinity;
  const { skins, bounds } = data.proneGrounding;
  for (const skin of skins) {
    skin.computeBoundingBox();
    bounds.copy(skin.boundingBox).applyMatrix4(skin.matrixWorld);
    minimum = Math.min(minimum, bounds.min.y);
  }
  if (!Number.isFinite(minimum)) throw new Error('The prone pose has no finite body bounds');
  // Feet alone are not the support points of a lying body.
  const offset = (world.y - minimum) * supportWeight;
  mesh.position.y += offset;
  mesh.userData.__ttProneGroundOffset = offset;
  return true;
}

export function installProneMotionMethods(prototype) {
  prototype.syncProneState = syncProneState;
  prototype.playStandUp = playStandUp;
  prototype._advanceStandUp = _advanceStandUp;
  prototype._prepareProneGrounding = _prepareProneGrounding;
  prototype._neutralizeProneRoot = _neutralizeProneRoot;
}
