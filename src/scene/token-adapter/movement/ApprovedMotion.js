import { validateSavedPlacement } from '../SavedPlacements.js';
import {
  FLIGHT_PACE_MULTIPLIER,
  FEET_PER_GRID_SQUARE,
} from '../../../config/TokenMovementConfig.js';
import { FALL_GRAVITY_FEET_PER_SECOND_SQUARED } from '../../../config/token-adapter/MannequinConfig.js';
import { facingAngleFromDirection } from '../../../entities/creatures/TokenMovement.js';
import { GameErrors } from '../../../utils/error/ErrorHandler.js';

const copy = (value) => JSON.parse(JSON.stringify(value));

function beginSegment(adapter, job) {
  const target = job.route[job.index];
  const token = job.state.token;
  const start = { ...token.world };
  const world = adapter.gameManager.campaignWorld;
  const endpoint =
    target.mapId === token.mapId
      ? target.pose.world
      : world.toMapPosition(token.mapId, world.toCampaignPosition(target.mapId, target.pose.world));
  const data = adapter._tokenAnimationData.get(token);
  const dx = endpoint.x - start.x;
  const dy = endpoint.y - start.y;
  const dz = endpoint.z - start.z;
  const direction =
    Math.hypot(dx, dz) > 1e-6 &&
    Math.cos(facingAngleFromDirection(dx, dz) - target.facingAngle) < -1e-6
      ? -1
      : 1;
  adapter._syncMovementVariant(job.state, direction, { force: true });
  job.falling = job.kind === 'fall' && dy < -1e-6;
  const flying = !job.falling && (job.sourceKind === 'flight' || target.pose.kind === 'flight');
  const climbing =
    !job.falling &&
    !flying &&
    (['wall', 'ledge', 'grip'].includes(job.sourceKind) ||
      ['wall', 'ledge', 'grip'].includes(target.pose.kind) ||
      (job.kind === 'traverse' && Math.abs(dy) > 1e-6));
  const key = job.falling
    ? 'fallLoop'
    : flying
      ? Math.hypot(dx, dz) > 1e-6
        ? 'fly'
        : 'hover'
      : climbing
        ? dy < 0
          ? 'climbWallDown'
          : 'climbWall'
        : job.state.loopActionKey;
  const speed = job.state.activeSpeed * (flying ? FLIGHT_PACE_MULTIPLIER : 1);
  if (!(speed > 0) || !Number.isFinite(speed) || !data?.actions[key])
    throw new Error('The approved movement animation is not available');
  token.flightActive = flying || job.falling;
  adapter._setAnimation(token, key, {
    force: data.current !== key,
    fadeIn: 0.2,
    fadeOut: 0.2,
  });
  adapter._applyOrientationImmediate(token, target.facingAngle);
  job.start = start;
  job.target = { ...endpoint };
  job.elapsed = 0;
  const gravity =
    (FALL_GRAVITY_FEET_PER_SECOND_SQUARED * adapter.gameManager.spatial.tileWorldSize) /
    FEET_PER_GRID_SQUARE;
  job.duration = Math.max(
    job.falling ? Math.sqrt((2 * Math.abs(dy)) / gravity) : Math.hypot(dx, dy, dz) / speed,
    1e-6
  );
  if (!Number.isFinite(job.duration)) throw new Error('The approved movement duration is invalid');
}

async function playApprovedMovement(token, motion) {
  if (!this.gameManager.placedTokens.includes(token))
    throw new Error('The approved moving creature is not in this view');
  if (!motion?.from || !Array.isArray(motion.route) || !motion.route.length)
    throw new Error('Approved movement requires an explicit origin and route');
  for (const point of [motion.from, ...motion.route]) {
    validateSavedPlacement(point);
    if (
      typeof point.mapId !== 'string' ||
      !Number.isInteger(point.gridX) ||
      !Number.isInteger(point.gridY)
    )
      throw new Error('The approved movement presentation requires map-local waypoints');
    this.gameManager.campaignWorld?.getMap(point.mapId);
  }
  motion = copy(motion);
  this._approvedMovements ??= new Map();
  this._approvedMovementRequests ??= new Map();
  if (this._approvedMovements.has(token) || this._approvedMovementRequests.has(token))
    throw new Error('Finish the existing approved movement presentation first');
  const request = {};
  this._approvedMovementRequests.set(token, request);
  const replaced = () => this._approvedMovementRequests.get(token) !== request;
  const cancelled = { completed: false, reason: 'presentation-replaced' };
  try {
    await token.__threeMeshPromise;
    if (replaced()) return cancelled;
    if (!this.gameManager.placedTokens.includes(token))
      throw new Error('The approved moving creature was removed while its model loaded');
    const data = this._tokenAnimationData.get(token);
    if (!data?.actions.walk || !data.profile)
      throw new Error('Wait for the creature locomotion animations to finish loading');
    if ([motion.from, ...motion.route].some((point) => point.pose.kind === 'flight'))
      await this._ensureFlightAnimations(token);
    if (replaced()) return cancelled;
    if (
      !this.gameManager.placedTokens.includes(token) ||
      this._tokenAnimationData.get(token) !== data
    )
      throw new Error('The approved moving creature changed while its animations loaded');
    this._clearManualAnimationRevert(token);
    this._clearManualAnimationState(token);
    const state = this._ensureMovementState(token);
    state.phase = 'approved-walk';
    state.pathActive = true;
    state.pathSpeedMode = token.movementSettings?.mode;
    state.pathMovementType = token.movementSettings?.type;
    state.forwardKeys.clear();
    state.backwardKeys.clear();
    token.mapId = motion.from.mapId;
    token.gridX = motion.from.gridX;
    token.gridY = motion.from.gridY;
    this._syncTokenAndMeshWorld(state, { ...motion.from.pose.world });
    this._lockTokenWorldAuthority(state);
    let resolve;
    let reject;
    const done = new Promise((accepted, failed) => {
      resolve = accepted;
      reject = failed;
    });
    const job = {
      state,
      kind: motion.kind || 'walk',
      sourceKind: motion.from.pose.kind,
      route: copy(motion.route),
      index: 0,
      resolve,
      reject,
    };
    this._approvedMovements.set(token, job);
    try {
      beginSegment(this, job);
    } catch (error) {
      this._approvedMovements.delete(token);
      state.phase = 'idle';
      state.pathActive = false;
      this._unlockTokenWorldAuthority(state);
      throw error;
    }
    return done;
  } finally {
    if (!replaced()) this._approvedMovementRequests.delete(token);
  }
}

async function finishMovement(adapter, token, job) {
  adapter._approvedMovements.delete(token);
  job.state.phase = 'idle';
  job.state.pathActive = false;
  adapter._unlockTokenWorldAuthority(job.state);
  const placement = job.route.at(-1);
  adapter._setAnimation(token, placement.pose.kind === 'flight' ? 'hover' : 'idle', {
    force: true,
    fadeIn: 0.2,
    fadeOut: 0.2,
  });
  await adapter.restoreStablePlacement(token, placement);
  job.resolve({ completed: true });
}

function advanceApprovedMovement(delta) {
  if (!Number.isFinite(delta) || delta < 0) throw new Error('Movement frame time is invalid');
  if (!delta || !this._approvedMovements?.size) return;
  for (const [token, job] of this._approvedMovements) {
    try {
      if (!this.gameManager.placedTokens.includes(token))
        throw new Error('The approved moving creature is no longer visible');
      let remaining = delta;
      while (remaining > 0) {
        const elapsed = Math.min(remaining, job.duration - job.elapsed);
        job.elapsed += elapsed;
        remaining -= elapsed;
        const progress = Math.min(1, job.elapsed / job.duration);
        const position = this._lerp3(job.start, job.target, progress);
        if (job.falling) position.y = job.start.y + (job.target.y - job.start.y) * progress ** 2;
        this._syncTokenAndMeshWorld(job.state, position);
        this._applyTokenGridFromWorld(token, token.world);
        if (progress < 1) break;
        const target = job.route[job.index++];
        token.mapId = target.mapId;
        token.gridX = target.gridX;
        token.gridY = target.gridY;
        token.facingAngle = target.facingAngle;
        token.flightActive = target.pose.kind === 'flight';
        token.world = { ...target.pose.world };
        job.sourceKind = target.pose.kind;
        this._positionMesh(token.__threeMesh, token);
        this._applyOrientationImmediate(token, target.facingAngle);
        if (job.index === job.route.length) {
          void finishMovement(this, token, job).catch((error) => {
            job.reject(error);
            GameErrors.rendering(error, {
              component: 'ApprovedMotion',
              operation: 'finish',
              tokenId: token.id,
            });
          });
          break;
        }
        beginSegment(this, job);
      }
    } catch (error) {
      this.cancelApprovedMovement(token, error);
      GameErrors.rendering(error, {
        component: 'ApprovedMotion',
        operation: 'animate',
        tokenId: token.id,
      });
    }
  }
}

function cancelApprovedMovement(token, error = null) {
  this._approvedMovementRequests?.delete(token);
  const job = this._approvedMovements?.get(token);
  if (!job) return;
  this._approvedMovements.delete(token);
  job.state.phase = 'idle';
  job.state.pathActive = false;
  this._unlockTokenWorldAuthority(job.state);
  if (error) job.reject(error);
  else job.resolve({ completed: false, reason: 'presentation-replaced' });
}

export function installApprovedMotionMethods(prototype) {
  prototype.playApprovedMovement = playApprovedMovement;
  prototype.advanceApprovedMovement = advanceApprovedMovement;
  prototype.cancelApprovedMovement = cancelApprovedMovement;
}
