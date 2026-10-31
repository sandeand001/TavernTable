import { cloneHumanoidRig } from '../HumanoidRig.js';
import { facingAngleFromDirection } from '../../../entities/creatures/TokenMovement.js';

const EPSILON = 1e-8;
const mix = (a, b, t) => a + (b - a) * t;
const clamp = (value) => Math.min(1, Math.max(0, value));

function sampleClip(template, clip, rootInfo, three) {
  const rig = cloneHumanoidRig(template, three);
  const hip = rig.skeleton.getBoneByName(rootInfo.bone.name);
  const toes = ['LeftToeBase', 'RightToeBase'].map((name) =>
    rig.skeleton.getBoneByName(`mixamorig${name}`)
  );
  const hands = ['LeftHand', 'RightHand'].map((name) =>
    rig.skeleton.getBoneByName(`mixamorig${name}`)
  );
  const floor = Math.min(...toes.map((bone) => bone.getWorldPosition(new three.Vector3()).y));
  const scale = hip.parent.getWorldScale(new three.Vector3());
  const mixer = new three.AnimationMixer(rig);
  const action = mixer.clipAction(clip).setLoop(three.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  const samples = [];
  const frames = Math.ceil(clip.duration * 30);
  for (let frame = 0; frame <= frames; frame++) {
    const time = Math.min(frame / 30, clip.duration);
    mixer.setTime(time);
    const forward = hip.position.z * scale.z;
    const lateral = hip.position.x * scale.x;
    const y = hip.position.y;
    hip.position.x = rootInfo.basePosition.x;
    hip.position.z = rootInfo.basePosition.z;
    rig.updateMatrixWorld(true);
    const feet = toes.map((bone) => bone.getWorldPosition(new three.Vector3()));
    const minimum = Math.min(...feet.map((point) => point.y));
    const handY =
      hands.reduce((total, bone) => total + bone.getWorldPosition(new three.Vector3()).y, 0) /
      hands.length;
    samples.push({
      time,
      forward,
      lateral,
      footY: minimum - floor,
      groundedY: y - (minimum - floor) / scale.y,
      handGap: handY - minimum,
      feet: feet.map((point) => ({ x: point.x, z: point.z, y: point.y - minimum })),
    });
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(rig);
  return { samples, duration: clip.duration };
}

function at(motion, time) {
  const samples = motion.samples;
  const index = Math.min(Math.floor(time * 30), samples.length - 1);
  const a = samples[index];
  const b = samples[Math.min(index + 1, samples.length - 1)];
  const ratio = b.time > a.time ? clamp((time - a.time) / (b.time - a.time)) : 0;
  return {
    time,
    forward: mix(a.forward, b.forward, ratio),
    lateral: mix(a.lateral, b.lateral, ratio),
    footY: mix(a.footY, b.footY, ratio),
    groundedY: mix(a.groundedY, b.groundedY, ratio),
    handGap: mix(a.handGap, b.handGap, ratio),
    feet: a.feet.map((point, i) => ({
      x: mix(point.x, b.feet[i].x, ratio),
      y: mix(point.y, b.feet[i].y, ratio),
      z: mix(point.z, b.feet[i].z, ratio),
    })),
  };
}

function _prepareTraversalData(token, data, rawClimb, three) {
  if (!data.actions.vault || !data.actions.hopDown || !rawClimb) return null;
  const root = this._rootBones.get(token)[0];
  const sourceClips = {
    vault: data.actions.vault.getClip(),
    hopDown: data.actions.hopDown.getClip(),
    climbShort: rawClimb,
    recoverShort: data.actions.climbRecover.getClip(),
  };
  const motions = {
    vault: sampleClip(data.templateRoot, sourceClips.vault, root, three),
    hopDown: sampleClip(data.templateRoot, sourceClips.hopDown, root, three),
    climbShort: sampleClip(data.templateRoot, rawClimb, root, three),
    recoverShort: sampleClip(data.templateRoot, sourceClips.recoverShort, root, three),
  };
  for (const [key, source] of Object.entries(sourceClips)) {
    const grounded = source.clone();
    const position = grounded.tracks.find((track) => track.name === `${root.bone.name}.position`);
    if (!position) throw new Error(`Traversal animation has no root translation: ${key}`);
    for (let frame = 0; frame < position.times.length; frame++) {
      position.values[frame * 3] = root.basePosition.x;
      position.values[frame * 3 + 1] = at(motions[key], position.times[frame]).groundedY;
      position.values[frame * 3 + 2] = root.basePosition.z;
    }
    data.actions[key]?.stop();
    const action = data.mixer.clipAction(grounded);
    this._configureAction(action, { loop: 'once', clampWhenFinished: true }, three);
    data.actions[key] = action;
    data.clips[key] = grounded.duration;
  }
  const hop = motions.hopDown;
  const initialY = hop.samples[0].footY;
  const finalY = hop.samples.at(-1).footY;
  const leave = hop.samples.find((sample) => Math.abs(sample.footY - initialY) > 0.02);
  const landing = hop.samples.find(
    (sample) => sample.time > (leave?.time || 0) && sample.footY <= finalY + 0.01
  );
  hop.start = Math.max(0, (leave?.time || 0) - 0.2);
  hop.end = Math.min(hop.duration, (landing?.time || hop.duration) + 0.4);
  return { motions };
}

function _startShortTraversal(token, cell, kind) {
  const data = this._tokenAnimationData.get(token);
  const job = this._movementRoutes.get(token);
  if (!data?.traversal || !job) throw new Error('Short traversal animations are unavailable');
  if (job.segmentCost > job.settings.speed - job.spent + EPSILON)
    return this._stopPlannedMovement(token);
  this._releaseManualAnimationForMovement(token);
  const state = this._ensureMovementState(token);
  this._clearPathState(state);
  this._clearClimbState(state);
  const start = this._resolveTokenWorldPosition(token);
  const spatial = this.gameManager.spatial;
  const goal = spatial.gridToWorld(cell.gridX + 0.5, cell.gridY + 0.5, cell.height);
  if (cell.vault) {
    const occupied = this.gameManager.placedTokens.some(
      (other) => other !== token && other.gridX === cell.gridX && other.gridY === cell.gridY
    );
    const entries =
      this.gameManager.terrainManager?.placeables?.get(`${cell.gridX},${cell.gridY}`) || [];
    if (
      occupied ||
      entries.some((entry) => ['plant', 'structure'].includes(entry.placeableType)) ||
      Math.abs(this._getTerrainHeight(cell.gridX, cell.gridY) * spatial.elevationUnit - start.y) >
        1e-8 ||
      this._getTerrainHeight(cell.vault.gridX, cell.vault.gridY) !== cell.vault.height
    ) {
      throw new Error('The approved vault obstacle or landing is no longer clear and supported');
    }
  }
  const distance = Math.hypot(goal.x - start.x, goal.z - start.z);
  if (!(distance > EPSILON)) throw new Error('Traversal requires horizontal clearance');
  const direction = { x: (goal.x - start.x) / distance, z: (goal.z - start.z) / distance };
  const facing =
    kind === 'lower-low'
      ? facingAngleFromDirection(-direction.x, -direction.z)
      : facingAngleFromDirection(direction.x, direction.z);
  const tile = spatial.tileWorldSize;
  const phases = [];
  const walkSpeed = job.settings.mode === 'run' ? data.profile.runSpeed : data.profile.walkSpeed;
  const ground = (from, to) => {
    const length = Math.hypot(to.x - from.x, to.z - from.z);
    if (length > EPSILON) phases.push({ from, to, duration: length / Math.max(walkSpeed, 0.1) });
  };
  const clip = (key, from, to, begin, end, extra = {}) => {
    phases.push({ key, from, to, begin, end, duration: Math.abs(end - begin), ...extra });
  };
  const motions = data.traversal.motions;
  if (kind === 'vault') {
    const descriptor = data.animationsConfig.vault;
    const begin = descriptor.traversalStart;
    const end = descriptor.traversalEnd;
    const first = at(motions.vault, begin);
    const last = at(motions.vault, end);
    const span = end - begin;
    const peak = Math.max(
      ...motions.vault.samples
        .filter((sample) => sample.time >= begin && sample.time <= end)
        .map((sample) => sample.footY - mix(first.footY, last.footY, (sample.time - begin) / span))
    );
    if (!(peak > EPSILON)) throw new Error('Vault animation has no airborne clearance');
    clip('vault', start, goal, begin, end, {
      obstacle: cell.vault,
      rise: cell.vault.rise * spatial.elevationUnit,
      peak,
      first,
      last,
    });
  } else {
    const from = this._mapWorldToGrid(start);
    const dx = Math.sign(cell.gridX - from.gridX);
    const plane = dx
      ? (Math.min(from.gridX, cell.gridX) + 1) * tile
      : (Math.min(from.gridY, cell.gridY) + 1) * tile;
    const ascent = kind === 'climb-low';
    const low = ascent ? start : goal;
    const high = ascent ? goal : start;
    const towardWall = ascent ? direction : { x: -direction.x, z: -direction.z };
    const foot = { ...low };
    if (dx) foot.x = plane - towardWall.x * tile * 0.38;
    else foot.z = plane - towardWall.z * tile * 0.38;
    const lip = { ...high };
    if (dx) lip.x = plane + towardWall.x * tile * 0.2;
    else lip.z = plane + towardWall.z * tile * 0.2;
    if (kind === 'hop-down') {
      ground(start, lip);
      const hop = motions.hopDown;
      clip('hopDown', lip, goal, hop.start, hop.end);
    } else {
      const rise = high.y - low.y;
      const climb = motions.climbShort;
      const first = climb.samples.find((sample) => sample.handGap <= rise + tile * 0.02);
      const begin = Math.min(first?.time ?? 0, climb.duration - 0.25);
      const recovery = motions.recoverShort;
      const recoveryFirst = at(recovery, 0);
      const recoveryLast = at(recovery, recovery.duration);
      const recoveryTravel = {
        x:
          towardWall.x * (recoveryLast.forward - recoveryFirst.forward) +
          towardWall.z * (recoveryLast.lateral - recoveryFirst.lateral),
        z:
          towardWall.z * (recoveryLast.forward - recoveryFirst.forward) -
          towardWall.x * (recoveryLast.lateral - recoveryFirst.lateral),
      };
      if (ascent) {
        ground(start, foot);
        clip('climbShort', foot, lip, begin, climb.duration);
        const recovered = {
          ...lip,
          x: lip.x + recoveryTravel.x,
          z: lip.z + recoveryTravel.z,
        };
        clip('recoverShort', lip, recovered, 0, recovery.duration);
        ground(recovered, goal);
      } else {
        ground(start, lip);
        const hanging = {
          ...lip,
          x: lip.x - recoveryTravel.x,
          z: lip.z - recoveryTravel.z,
        };
        clip('recoverShort', lip, hanging, recovery.duration, 0);
        clip('climbShort', hanging, foot, climb.duration, begin);
        ground(foot, goal);
      }
    }
  }
  state.traversal = {
    kind,
    phases,
    index: 0,
    elapsed: 0,
    goal,
    direction,
    facing,
    originalFacing: token.facingAngle || 0,
    turnDuration:
      0.18 *
      Math.min(
        1,
        Math.abs(this._normalizeAngle(facing - (token.facingAngle || 0))) / (Math.PI / 2)
      ),
    turnTime: 0,
    sample: null,
  };
  state.phase = 'traversal';
  state.pendingStop = false;
  state.intentHold = false;
  state.pathActive = false;
  state.activeStep = null;
  state.mesh = token.__threeMesh;
  state.profile = data.profile;
  state.pathSpeedMode = job.settings.mode;
  state.pathMovementType = job.settings.type;
  job.current.world = { ...goal };
  this._lockTokenWorldAuthority(state);
  this._setSelectionIndicatorSuppressed(state, true);
  return {
    goal: { gridX: cell.gridX, gridY: cell.gridY, world: goal },
    speedMode: job.settings.mode,
  };
}

function _advanceShortTraversal(state, delta) {
  const motion = state.traversal;
  const data = this._tokenAnimationData.get(state.token);
  let remaining = delta;
  if (motion.turnTime < motion.turnDuration) {
    const used = Math.min(motion.turnDuration - motion.turnTime, remaining);
    motion.turnTime += used;
    remaining -= used;
    state.token.facingAngle = this._normalizeAngle(
      motion.originalFacing +
        (this._normalizeAngle(motion.facing - motion.originalFacing) * motion.turnTime) /
          motion.turnDuration
    );
    this._applyOrientationImmediate(state.token, state.token.facingAngle);
  }
  while (remaining > EPSILON) {
    const phase = motion.phases[motion.index];
    if (!phase) {
      this._syncTokenAndMeshWorld(state, motion.goal);
      motion.sample = null;
      state.traversal = null;
      state.phase = 'idle';
      this._setSelectionIndicatorSuppressed(state, false);
      this._unlockTokenWorldAuthority(state);
      this._resetMovementState(state);
      this._movementRangeDirty = true;
      return;
    }
    if (!phase.started) {
      phase.started = true;
      const key =
        phase.key ||
        (motion.kind === 'lower-low'
          ? state.pathMovementType === 'drunk'
            ? 'drunkWalkBackward'
            : 'walkBackward'
          : state.pathMovementType === 'drunk'
            ? state.pathSpeedMode === 'run'
              ? 'drunkRunForward'
              : 'drunkWalk'
            : state.pathSpeedMode === 'run'
              ? 'run'
              : 'walk');
      this._setAnimation(state.token, key, { force: true, fadeIn: 0.1, fadeOut: 0.1 });
      if (phase.key) data.actions[phase.key].paused = true;
    }
    const available = Math.max(phase.duration - motion.elapsed, 0);
    const used = available > EPSILON ? Math.min(remaining, available) : remaining;
    motion.elapsed = Math.min(phase.duration, motion.elapsed + used);
    remaining -= used;
    const progress = phase.duration > EPSILON ? clamp(motion.elapsed / phase.duration) : 1;
    const world = this._lerp3(phase.from, phase.to, progress);
    if (phase.key) {
      const time = mix(phase.begin, phase.end, progress);
      const source = data.traversal.motions[phase.key];
      const sample = at(source, time);
      motion.sample = sample;
      motion.action = data.actions[phase.key];
      motion.action.time = time;
      data.mixer.update(0);
      const first = at(source, phase.begin);
      const last = at(source, phase.end);
      if (phase.key === 'recoverShort') {
        const distance = sample.forward - first.forward;
        const lateral = sample.lateral - first.lateral;
        world.x =
          phase.from.x + Math.cos(motion.facing) * distance + Math.sin(motion.facing) * lateral;
        world.z =
          phase.from.z + Math.sin(motion.facing) * distance - Math.cos(motion.facing) * lateral;
      } else if (phase.key === 'hopDown' && Math.abs(last.forward - first.forward) > EPSILON) {
        const horizontal = clamp((sample.forward - first.forward) / (last.forward - first.forward));
        world.x = mix(phase.from.x, phase.to.x, horizontal);
        world.z = mix(phase.from.z, phase.to.z, horizontal);
      }
      if (phase.key === 'vault') {
        const arc = Math.max(0, sample.footY - mix(first.footY, last.footY, progress));
        world.y =
          phase.from.y +
          (arc / phase.peak) * (phase.rise + this.gameManager.spatial.tileWorldSize * 0.12);
      } else if (Math.abs(last.footY - first.footY) > EPSILON) {
        const vertical = (sample.footY - first.footY) / (last.footY - first.footY);
        world.y = mix(phase.from.y, phase.to.y, vertical);
      }
      if (phase.obstacle) {
        const tile = this.gameManager.spatial.tileWorldSize;
        const axis = Math.abs(motion.direction.x) > 0.5 ? 'x' : 'z';
        const dir = motion.direction[axis];
        const obstacleStart = (axis === 'x' ? phase.obstacle.gridX : phase.obstacle.gridY) * tile;
        const obstacleEnd = obstacleStart + tile;
        for (const foot of sample.feet) {
          const offset =
            axis === 'x'
              ? motion.direction.z * foot.x + motion.direction.x * foot.z
              : -motion.direction.x * foot.x + motion.direction.z * foot.z;
          const top = phase.from.y + phase.rise;
          if (world.y + foot.y >= top + tile * 0.015) continue;
          if (progress < 0.5) {
            const edge = dir > 0 ? obstacleStart : obstacleEnd;
            world[axis] =
              dir > 0
                ? Math.min(world[axis], edge - offset - tile * 0.02)
                : Math.max(world[axis], edge - offset + tile * 0.02);
          } else {
            const edge = dir > 0 ? obstacleEnd : obstacleStart;
            world[axis] =
              dir > 0
                ? Math.max(world[axis], edge - offset + tile * 0.02)
                : Math.min(world[axis], edge - offset - tile * 0.02);
          }
          const adjusted = world[axis] + offset;
          if (adjusted > obstacleStart && adjusted < obstacleEnd)
            world.y = Math.max(world.y, top + tile * 0.02 - foot.y);
        }
        const previous = this._resolveTokenWorldPosition(state.token);
        const horizontal = Math.hypot(world.x - previous.x, world.z - previous.z);
        const maximum =
          (Math.hypot(phase.to.x - phase.from.x, phase.to.z - phase.from.z) / phase.duration) *
          3 *
          used;
        if (horizontal > maximum && horizontal > EPSILON) {
          world.x = mix(previous.x, world.x, maximum / horizontal);
          world.z = mix(previous.z, world.z, maximum / horizontal);
        }
        for (const foot of sample.feet) {
          const offset =
            axis === 'x'
              ? motion.direction.z * foot.x + motion.direction.x * foot.z
              : -motion.direction.x * foot.x + motion.direction.z * foot.z;
          const coordinate = world[axis] + offset;
          if (coordinate > obstacleStart && coordinate < obstacleEnd)
            world.y = Math.max(world.y, phase.from.y + phase.rise + tile * 0.02 - foot.y);
        }
      }
    } else {
      motion.sample = null;
    }
    this._syncTokenAndMeshWorld(state, world);
    this._applyTokenGridFromWorld(state.token, world);
    if (progress < 1) break;
    if (
      phase.obstacle &&
      Math.hypot(world.x - phase.to.x, world.y - phase.to.y, world.z - phase.to.z) > 1e-5
    )
      break;
    motion.elapsed = 0;
    motion.index++;
  }
}

function _neutralizeTraversalRoot(token, roots) {
  const motion = this._movementStates.get(token)?.traversal;
  if (!motion?.sample) return false;
  for (const info of roots) {
    info.bone.position.x = info.basePosition.x;
    info.bone.position.z = info.basePosition.z;
  }
  return true;
}

export function installTraversalMotionMethods(prototype) {
  Object.assign(prototype, {
    _prepareTraversalData,
    _startShortTraversal,
    _advanceShortTraversal,
    _neutralizeTraversalRoot,
  });
}
