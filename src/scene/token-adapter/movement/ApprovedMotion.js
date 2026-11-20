import { validateSavedPlacement, samePlacement } from '../SavedPlacements.js';
import { validatePlayerVisual } from '../../../campaigns/PlayerPublicProtocol.js';
import {
  FLIGHT_PACE_MULTIPLIER,
  FEET_PER_GRID_SQUARE,
} from '../../../config/TokenMovementConfig.js';
import { FALL_GRAVITY_FEET_PER_SECOND_SQUARED } from '../../../config/token-adapter/MannequinConfig.js';
import { facingAngleFromDirection } from '../../../entities/creatures/TokenMovement.js';
import { GameErrors } from '../../../utils/error/ErrorHandler.js';

const copy = (value) => JSON.parse(JSON.stringify(value));
const CONTINUATION_GRACE_SECONDS = 0.5;
const LIVE_CONTINUATION_TIMEOUT_SECONDS = 10;
const LIVE_GROUND_PLAYOUT_MARGIN_SECONDS = 0.2;
const MAX_PRESENTATION_FINGERPRINTS = 512;

function rememberProvisionalRoute(adapter, token, motion) {
  if (motion.completed !== false) return;
  adapter._provisionalMovementRoutes ??= new WeakMap();
  const previous = adapter._provisionalMovementRoutes.get(token);
  const points = samePlacement(previous?.points.at(-1), motion.from)
    ? previous.points
    : [motion.from];
  adapter._provisionalMovementRoutes.set(token, {
    points: [...points, ...motion.route].slice(-MAX_PRESENTATION_FINGERPRINTS),
    expiresAt: performance.now() + LIVE_CONTINUATION_TIMEOUT_SECONDS * 1000,
  });
}

function isLaggedMovementCheckpoint(token, canonical) {
  const route = this._provisionalMovementRoutes?.get(token);
  if (!route) return false;
  const index = route.points.findLastIndex((point) => samePlacement(point, canonical));
  if (index < 0 || index === route.points.length - 1 || route.expiresAt <= performance.now()) {
    this._provisionalMovementRoutes.delete(token);
    return false;
  }
  route.points = route.points.slice(index);
  return true;
}

function presentationFingerprint(motion) {
  if (typeof motion?.commandId !== 'string') return null;
  return JSON.stringify({
    commandId: motion.commandId,
    tokenId: motion.tokenId ?? null,
    from: motion.from,
    route: motion.route,
  });
}

function rememberPresentation(adapter, token, motion) {
  const fingerprint = presentationFingerprint(motion);
  if (!fingerprint) return { fingerprint: null, duplicate: false };
  adapter._approvedMovementFingerprints ??= new WeakMap();
  let fingerprints = adapter._approvedMovementFingerprints.get(token);
  if (!fingerprints) {
    fingerprints = new Set();
    adapter._approvedMovementFingerprints.set(token, fingerprints);
  }
  if (fingerprints.has(fingerprint)) return { fingerprint, duplicate: true };
  if (fingerprints.size >= MAX_PRESENTATION_FINGERPRINTS)
    fingerprints.delete(fingerprints.values().next().value);
  fingerprints.add(fingerprint);
  return { fingerprint, duplicate: false };
}

function forgetPresentation(adapter, token, fingerprint) {
  if (fingerprint) adapter._approvedMovementFingerprints?.get(token)?.delete(fingerprint);
}

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
  const gravity =
    (FALL_GRAVITY_FEET_PER_SECOND_SQUARED * adapter.gameManager.spatial.tileWorldSize) /
    FEET_PER_GRID_SQUARE;
  const duration = Math.max(
    job.falling ? Math.sqrt((2 * Math.abs(dy)) / gravity) : Math.hypot(dx, dy, dz) / speed,
    1e-6
  );
  // Build a small timing reserve while already moving, without ever extrapolating past a waypoint.
  const pad =
    job.provisional &&
    job.index === 0 &&
    job.route.length === 1 &&
    job.kind === 'walk' &&
    job.sourceKind === 'ground' &&
    target.pose.kind === 'ground' &&
    target.mapId === token.mapId &&
    Math.abs(dy) < 1e-6
      ? Math.min(LIVE_GROUND_PLAYOUT_MARGIN_SECONDS, duration / 2)
      : 0;
  job.duration = duration + pad;
  if (!Number.isFinite(job.duration)) throw new Error('The approved movement duration is invalid');
  const timeScale = duration / job.duration;
  token.flightActive = flying || job.falling;
  if (data.current === key) data.actions[key].setEffectiveTimeScale(timeScale);
  else adapter._setAnimation(token, key, { force: true, fadeIn: 0.2, fadeOut: 0.2, timeScale });
  adapter._applyOrientationImmediate(token, target.facingAngle);
  job.start = start;
  job.target = { ...endpoint };
  job.elapsed = 0;
}

function canContinueApprovedMovement(token, motion) {
  const job = this._approvedMovements?.get(token);
  const endpoint = job?.route.at(-1);
  return Boolean(
    job &&
    motion?.from &&
    samePlacement(endpoint, motion.from) &&
    Number.isFinite(endpoint?.facingAngle) &&
    Number.isFinite(motion.from?.facingAngle) &&
    Math.abs(this._normalizeAngle(endpoint.facingAngle - motion.from.facingAngle)) < 1e-6
  );
}

function appendApprovedMovement(adapter, token, motion) {
  const active = adapter._approvedMovements?.get(token);
  if (!active || !adapter.canContinueApprovedMovement(token, motion))
    throw new Error('Finish the existing approved movement presentation first');
  const waiting = active.waitingForContinuation !== null;
  active.route.push(...copy(motion.route));
  if (motion.kind) active.kind = motion.kind;
  active.continuing = motion.continuing === true;
  active.holdUntilFinish ||= motion.holdUntilFinish === true;
  if (waiting && active.index < active.route.length) {
    active.waitingForContinuation = null;
    beginSegment(adapter, active);
  }
  rememberProvisionalRoute(adapter, token, motion);
  return active.done;
}

function reconcileApprovedMovement(token, placement) {
  const job = this._approvedMovements?.get(token);
  const endpoint = job?.route.at(-1);
  if (
    !job ||
    !Number.isFinite(placement?.facingAngle) ||
    !endpoint ||
    !samePlacement(endpoint, placement)
  )
    return false;
  endpoint.facingAngle = placement.facingAngle;
  return true;
}

function retainApprovedMovementCheckpoint(token, placement) {
  if (
    !this._approvedMovements?.has(token) &&
    !this._approvedMovementRequests?.has(token) &&
    !this._restoringApprovedMovements?.has(token)
  )
    return false;
  this._approvedMovementCheckpoints ??= new WeakMap();
  this._approvedMovementCheckpoints.set(token, copy(placement));
  return true;
}

function getApprovedMovementCheckpoint(token) {
  return this._approvedMovementCheckpoints?.get(token);
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
  const remembered = rememberPresentation(this, token, motion);
  if (remembered.duplicate) return { completed: false, reason: 'duplicate-presentation' };
  this._approvedMovements ??= new Map();
  this._approvedMovementRequests ??= new Map();
  const active = this._approvedMovements.get(token);
  if (active) {
    try {
      return appendApprovedMovement(this, token, motion);
    } catch (error) {
      forgetPresentation(this, token, remembered.fingerprint);
      throw error;
    }
  }
  const pendingRequest = this._approvedMovementRequests.get(token);
  if (pendingRequest) {
    let resolve;
    let reject;
    const completion = new Promise((accepted, failed) => {
      resolve = accepted;
      reject = failed;
    });
    const queued = { motion, resolve, reject, handled: false };
    pendingRequest.queue.push(queued);
    const ready = await pendingRequest.ready;
    if (!ready) {
      forgetPresentation(this, token, remembered.fingerprint);
      return { completed: false, reason: 'presentation-replaced' };
    }
    if (queued.handled) return completion;
    return this.playApprovedMovement(token, motion);
  }
  let ready;
  const request = {
    ready: new Promise((resolve) => {
      ready = resolve;
    }),
    queue: [],
  };
  request.readyResolve = ready;
  this._approvedMovementRequests.set(token, request);
  const replaced = () => this._approvedMovementRequests.get(token) !== request;
  const cancelled = { completed: false, reason: 'presentation-replaced' };
  try {
    await token.__threeMeshPromise;
    if (replaced()) {
      forgetPresentation(this, token, remembered.fingerprint);
      return cancelled;
    }
    if (!this.gameManager.placedTokens.includes(token))
      throw new Error('The approved moving creature was removed while its model loaded');
    const data = this._tokenAnimationData.get(token);
    if (!data?.actions.walk || !data.profile)
      throw new Error('Wait for the creature locomotion animations to finish loading');
    if ([motion.from, ...motion.route].some((point) => point.pose.kind === 'flight'))
      await this._ensureFlightAnimations(token);
    if (replaced()) {
      forgetPresentation(this, token, remembered.fingerprint);
      return cancelled;
    }
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
      done,
      provisional: motion.completed === false,
      continuing: motion.continuing === true,
      holdUntilFinish: motion.holdUntilFinish === true,
      waitingForContinuation: null,
      finishing: false,
    };
    this._approvedMovements.set(token, job);
    try {
      beginSegment(this, job);
    } catch (error) {
      this._approvedMovements.delete(token);
      state.phase = 'idle';
      state.pathActive = false;
      this._unlockTokenWorldAuthority(state);
      request.readyResolve(false);
      throw error;
    }
    rememberProvisionalRoute(this, token, motion);
    request.job = job;
    for (const queued of request.queue) {
      try {
        queued.resolve(appendApprovedMovement(this, token, queued.motion));
      } catch (error) {
        queued.reject(error);
        forgetPresentation(this, token, presentationFingerprint(queued.motion));
      }
      queued.handled = true;
    }
    request.readyResolve(true);
    return done;
  } catch (error) {
    forgetPresentation(this, token, remembered.fingerprint);
    if (!replaced()) this._approvedMovementCheckpoints?.delete(token);
    request.readyResolve(false);
    throw error;
  } finally {
    if (!replaced()) this._approvedMovementRequests.delete(token);
  }
}

async function finishMovement(adapter, token, job) {
  if (job.finishing || adapter._approvedMovements.get(token) !== job) return;
  job.finishing = true;
  adapter._approvedMovements.delete(token);
  const request = adapter._approvedMovementRequests?.get(token);
  if (request?.job === job) adapter._approvedMovementRequests.delete(token);
  job.state.phase = 'idle';
  job.state.pathActive = false;
  adapter._unlockTokenWorldAuthority(job.state);
  const placement = job.route.at(-1);
  const provisional = adapter._provisionalMovementRoutes?.get(token);
  if (provisional && samePlacement(provisional.points.at(-1), placement))
    provisional.expiresAt = performance.now() + LIVE_CONTINUATION_TIMEOUT_SECONDS * 1000;
  adapter._setAnimation(token, placement.pose.kind === 'flight' ? 'hover' : 'idle', {
    force: true,
    fadeIn: 0.2,
    fadeOut: 0.2,
  });
  adapter._restoringApprovedMovements ??= new WeakSet();
  adapter._restoringApprovedMovements.add(token);
  try {
    await adapter.restoreStablePlacement(token, placement);
  } finally {
    adapter._restoringApprovedMovements.delete(token);
    adapter._approvedMovementCheckpoints?.delete(token);
  }
  job.resolve({ completed: true });
}

function finishApprovedMovement(token, placement) {
  const job = this._approvedMovements?.get(token);
  if (!job || !samePlacement(job.route.at(-1), placement)) return false;
  job.continuing = false;
  job.holdUntilFinish = false;
  if (job.waitingForContinuation !== null) {
    job.waitingForContinuation = null;
    void finishMovement(this, token, job).catch((error) => {
      job.reject(error);
      GameErrors.rendering(error, {
        component: 'ApprovedMotion',
        operation: 'finish-live',
        tokenId: token.id,
      });
    });
  }
  return true;
}

function advanceApprovedMovement(delta) {
  if (!Number.isFinite(delta) || delta < 0) throw new Error('Movement frame time is invalid');
  if (!delta || !this._approvedMovements?.size) return;
  for (const [token, job] of this._approvedMovements) {
    try {
      if (!this.gameManager.placedTokens.includes(token))
        throw new Error('The approved moving creature is no longer visible');
      if (job.waitingForContinuation !== null) {
        job.waitingForContinuation += delta;
        const timeout = job.continuing
          ? LIVE_CONTINUATION_TIMEOUT_SECONDS
          : CONTINUATION_GRACE_SECONDS;
        if (!job.holdUntilFinish && job.waitingForContinuation >= timeout)
          void finishMovement(this, token, job).catch((error) => {
            job.reject(error);
            GameErrors.rendering(error, {
              component: 'ApprovedMotion',
              operation: 'finish',
              tokenId: token.id,
            });
          });
        continue;
      }
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
          if (job.continuing) {
            job.waitingForContinuation = 0;
            this._setAnimation(token, token.flightActive ? 'hover' : 'idle', {
              force: true,
              fadeIn: 0.12,
              fadeOut: 0.12,
            });
          } else {
            void finishMovement(this, token, job).catch((error) => {
              job.reject(error);
              GameErrors.rendering(error, {
                component: 'ApprovedMotion',
                operation: 'finish',
                tokenId: token.id,
              });
            });
          }
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

async function playApprovedVisual(token, entry) {
  validatePlayerVisual(entry);
  if (!this.gameManager.placedTokens.includes(token) || entry.tokenId !== token.id)
    throw new Error('The approved visual action does not match this current creature');
  this._playedVisuals ??= new Set();
  if (this._playedVisuals.has(entry.commandId))
    return { completed: false, reason: 'duplicate-presentation' };
  const current = { ...token, mapId: token.mapId ?? 'map-main' };
  if (
    !samePlacement(current, entry.placement) &&
    !(entry.from && samePlacement(current, entry.from))
  )
    throw new Error('The approved visual action does not match this current placement');
  this._playedVisuals.add(entry.commandId);
  while (this._playedVisuals.size > 256)
    this._playedVisuals.delete(this._playedVisuals.values().next().value);
  try {
    await token.__threeMeshPromise;
    if (!this.gameManager.placedTokens.includes(token))
      return { completed: false, reason: 'presentation-replaced' };
    if (entry.from) {
      const state = this._ensureMovementState(token);
      this._syncTokenAndMeshWorld(state, { ...entry.from.pose.world });
      token.facingAngle = entry.from.facingAngle;
      this._applyOrientationImmediate(token, entry.from.facingAngle);
    }
    await this.playTokenAction(token, entry.actionId, {
      animationKey: entry.animationKey,
      approved: true,
      ...(entry.from ? { approvedDestination: entry.placement } : {}),
    });
    return { completed: true };
  } catch (error) {
    this._playedVisuals.delete(entry.commandId);
    throw error;
  }
}

function cancelApprovedMovement(token, error = null) {
  this._provisionalMovementRoutes?.delete(token);
  this._approvedMovementCheckpoints?.delete(token);
  const request = this._approvedMovementRequests?.get(token);
  if (request) {
    request.readyResolve(false);
    this._approvedMovementRequests.delete(token);
  }
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
  prototype.isLaggedMovementCheckpoint = isLaggedMovementCheckpoint;
  prototype.canContinueApprovedMovement = canContinueApprovedMovement;
  prototype.reconcileApprovedMovement = reconcileApprovedMovement;
  prototype.retainApprovedMovementCheckpoint = retainApprovedMovementCheckpoint;
  prototype.getApprovedMovementCheckpoint = getApprovedMovementCheckpoint;
  prototype.playApprovedVisual = playApprovedVisual;
  prototype.playApprovedMovement = playApprovedMovement;
  prototype.advanceApprovedMovement = advanceApprovedMovement;
  prototype.finishApprovedMovement = finishApprovedMovement;
  prototype.cancelApprovedMovement = cancelApprovedMovement;
}
