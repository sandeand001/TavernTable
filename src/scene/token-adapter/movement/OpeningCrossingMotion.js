import { sampleTraversalMotion } from './TraversalMotion.js';

const EPSILON = 1e-8;
const clamp = (value) => Math.max(0, Math.min(1, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

function playOpeningCrossing(token, plan, source) {
  const gm = this.gameManager;
  const data = this._tokenAnimationData.get(token);
  if (!data?.traversal || !data.actions.climbShort || !data.actions.recoverShort)
    throw new Error('The window climbing animations are unavailable');
  if (token.mapId !== gm.campaignMapId)
    throw new Error('A visible window crossing requires the destination view');
  const frame = plan.openingCrossing;
  const local = (point) => gm.campaignWorld.toMapPosition(token.mapId, point);
  const start = local(gm.campaignWorld.toCampaignPosition(source.mapId, source.pose.world));
  const end = { ...plan.targetWorld };
  const inner = local(frame.innerFeet);
  const sill = local(frame.sillFeet);
  const sourceMotion = data.traversal.motions.climbShort;
  const recover = data.traversal.motions.recoverShort;
  const phases = [];
  const phase = (key, points, begin, finish) =>
    phases.push({ key, points, begin, end: finish, duration: Math.abs(finish - begin) });
  let mantleStart = start;
  if (frame.direction === 'in') {
    const sillIndex = plan.routeFeet.findIndex((point) => distance(point, frame.sillFeet) < 1e-5);
    for (let index = 1; index < sillIndex; index++) {
      const from = local(plan.routeFeet[index - 1]),
        to = local(plan.routeFeet[index]);
      const key =
        to.y > from.y + EPSILON
          ? 'climbWall'
          : to.y < from.y - EPSILON
            ? 'climbWallDown'
            : source.pose.kind === 'ground' && to.y === start.y
              ? 'walk'
              : 'climbWall';
      const duration = this._extractClipDuration(data.actions[key]);
      const root = data.rootMotion[key === 'climbWallDown' ? 'wallDown' : 'wall'];
      const displacement =
        root && this._rootDisplacementToWorld(data.rootMotion.rootInfo, root.displacementLocal);
      const speed = key === 'walk' ? data.profile.walkSpeed : Math.abs(displacement?.y) / duration;
      if (!(speed > 0)) throw new Error('The window approach animation has no valid pace');
      phases.push({
        key,
        points: [from, to],
        begin: 0,
        end: duration,
        duration: distance(from, to) / speed,
        loop: true,
      });
      mantleStart = to;
    }
  }
  const rise = frame.direction === 'in' ? sill.y - mantleStart.y : sill.y - end.y;
  const first = sourceMotion.samples.find(
    (sample) => sample.handGap <= rise + gm.spatial.tileWorldSize * 0.02
  );
  const begin = Math.min(first?.time ?? 0, sourceMotion.duration - 0.25);
  if (frame.direction === 'in') {
    phase('climbShort', [mantleStart, sill, inner], begin, sourceMotion.duration);
    phase('recoverShort', [inner, end], 0, recover.duration);
  } else {
    const inside = local(frame.insideFeet);
    phase('recoverShort', [start, inside, inner], recover.duration, 0);
    phase('climbShort', [inner, sill, end], sourceMotion.duration, begin);
  }
  const held = plan.targetPose.kind === 'ledge' || plan.targetPose.kind === 'grip';
  phases.push({
    key: held ? 'ledgeHang' : 'idle',
    points: [end],
    begin: 0,
    end: 0,
    duration: 0.18,
    terminal: true,
  });
  const state = this._ensureMovementState(token);
  this._clearPathState(state);
  this._releaseManualAnimationForMovement(token);
  this.clearOpeningHoldVisual(token);
  delete token.openingHold;
  delete token.surfaceHold;
  this._applyOrientationImmediate(token, plan.targetFacingAngle ?? token.facingAngle);
  this._lockTokenWorldAuthority(state);
  this._setSelectionIndicatorSuppressed(state, true);
  state.phase = 'opening-crossing';
  state.activeStep = null;
  state.stepFinalized = true;
  const result = new Promise((resolve, reject) => {
    state.openingCrossing = {
      phases,
      index: 0,
      elapsed: 0,
      started: false,
      clip: null,
      resolve,
      reject,
      plan,
      end,
      held,
      lipY: sill.y,
    };
  });
  this._syncTokenAndMeshWorld(state, start);
  advanceOpeningCrossing.call(this, state, 0);
  return result;
}

function pointOnPath(adapter, points, progress) {
  if (points.length === 1) return { ...points[0] };
  const lengths = points.slice(1).map((point, index) => distance(points[index], point));
  let remaining = lengths.reduce((total, value) => total + value, 0) * clamp(progress);
  for (let index = 0; index < lengths.length; index++) {
    if (remaining <= lengths[index] || index === lengths.length - 1)
      return adapter._lerp3(
        points[index],
        points[index + 1],
        lengths[index] > EPSILON ? clamp(remaining / lengths[index]) : 1
      );
    remaining -= lengths[index];
  }
  throw new Error('The window crossing path has no endpoint');
}

function advanceOpeningCrossing(state, delta) {
  const motion = state.openingCrossing;
  if (!motion) throw new Error('The window crossing has no active presentation');
  const token = state.token;
  const data = this._tokenAnimationData.get(token);
  let remaining = Math.max(0, delta);
  for (let transitions = 0; transitions < 12; transitions++) {
    const phase = motion.phases[motion.index];
    if (!motion.started) {
      motion.started = true;
      motion.clip = phase.key;
      if (phase.key === 'ledgeHang') {
        token.surfaceHold = this.gameManager.campaignWorld.openingSurfaceGrip(
          token.mapId,
          motion.end,
          motion.plan.connectionId,
          {
            mapId: this.gameManager.campaignMapId,
            geometry: this.gameManager.terrainEngine.geometry,
          }
        );
        this.syncSurfaceGripVisual(token, 'ledgeHang', 0, motion.lipY, 0.18);
      } else {
        this.clearOpeningHoldVisual(token);
        delete token.surfaceHold;
        const wallLoop = ['climbWall', 'climbWallDown'];
        const fade =
          motion.index === 0 || wallLoop.includes(phase.key) || wallLoop.includes(data.current)
            ? 0
            : 0.18;
        this._setAnimation(token, phase.key, { force: true, fadeIn: fade, fadeOut: fade });
        if (phase.key !== 'idle') {
          data.actions[phase.key].paused = true;
          data.actions[phase.key].time = phase.begin;
          data.mixer.update(0);
        }
      }
    }
    const used = Math.min(remaining, Math.max(0, phase.duration - motion.elapsed));
    motion.elapsed += used;
    remaining -= used;
    const progress = phase.duration > EPSILON ? clamp(motion.elapsed / phase.duration) : 1;
    let pathProgress = progress;
    if (!phase.terminal) {
      const time = phase.loop
        ? motion.elapsed % phase.end
        : phase.begin + (phase.end - phase.begin) * progress;
      data.actions[phase.key].time = time;
      data.mixer.update(0);
      const source = data.traversal.motions[phase.key];
      if (source) {
        const first = sampleTraversalMotion(source, phase.begin);
        const last = sampleTraversalMotion(source, phase.end);
        const sample = sampleTraversalMotion(source, time);
        const axis = phase.key === 'climbShort' ? 'footY' : 'forward';
        const span = last[axis] - first[axis];
        if (Math.abs(span) > EPSILON) pathProgress = clamp((sample[axis] - first[axis]) / span);
      }
    }
    if (progress === 1) pathProgress = 1;
    this._syncTokenAndMeshWorld(state, pointOnPath(this, phase.points, pathProgress));
    if (phase.key === 'ledgeHang') this.syncSurfaceGripVisual(token, 'ledgeHang', 0, motion.lipY);
    this._neutralizeRootMotion(token);
    token.__threeMesh.updateMatrixWorld(true);
    if (progress < 1) return;
    if (++motion.index === motion.phases.length) {
      state.openingCrossing = null;
      state.phase = motion.held ? 'climb-hold' : 'idle';
      this._setSelectionIndicatorSuppressed(state, false);
      motion.resolve();
      return;
    }
    motion.elapsed = 0;
    motion.started = false;
    if (remaining <= EPSILON) return;
  }
  throw new Error('The window animation could not settle its phases');
}

function cancelOpeningCrossing(token, error) {
  const state = this._movementStates.get(token);
  const motion = state?.openingCrossing;
  if (!motion) return;
  state.openingCrossing = null;
  state.phase = 'idle';
  this.clearOpeningHoldVisual(token);
  this._setSelectionIndicatorSuppressed(state, false);
  motion.reject(error);
}

export function installOpeningCrossingMethods(prototype) {
  prototype.playOpeningCrossing = playOpeningCrossing;
  prototype.cancelOpeningCrossing = cancelOpeningCrossing;
  prototype._advanceOpeningCrossing = advanceOpeningCrossing;
}
