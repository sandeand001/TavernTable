/**
 * WorldAuthority.js
 *
 * World-authority locking, root-motion-to-world transfer, and landing offset
 * sanitisation methods extracted from Token3DAdapter.
 * Each function is written with `this` semantics so it can be installed on a
 * class prototype via `installWorldAuthorityMethods()`.
 */

import {
  TOKEN_WORLD_LOCK_PROP,
  LANDING_OFFSET_SANITIZE_LIMITS,
  LANDING_VARIANTS_FORCE_ZERO_ELEVATION,
  LANDING_VARIANTS_ALLOW_TILE_EXIT,
} from '../MannequinConfig.js';

// ── World Authority Lock / Unlock ────────────────────────────────────────

function _lockTokenWorldAuthority(state) {
  if (!state || !state.token || state.__worldLockActive) return;
  const token = state.token;
  const current = Number(token[TOKEN_WORLD_LOCK_PROP]) || 0;
  token[TOKEN_WORLD_LOCK_PROP] = current + 1;
  state.__worldLockActive = true;
}

function _unlockTokenWorldAuthority(state) {
  if (!state || !state.token || !state.__worldLockActive) return;
  const token = state.token;
  const current = Number(token[TOKEN_WORLD_LOCK_PROP]) || 0;
  const next = current - 1;
  if (next > 0) {
    token[TOKEN_WORLD_LOCK_PROP] = next;
    state.__worldLockActive = true;
    return;
  }

  delete token[TOKEN_WORLD_LOCK_PROP];
  state.__worldLockActive = false;

  if (state.__pendingMovementResetOptions) {
    const pendingOptions = state.__pendingMovementResetOptions;
    state.__pendingMovementResetOptions = null;
    this._applyMovementResetCore(state, pendingOptions);
  }
}

// ── Root Motion → World Transfer ─────────────────────────────────────────

function _transferRootMotionToWorld(state, targetWorld = null, precomputedTransfer = null) {
  if (!state) return null;
  const transfer = precomputedTransfer || this._extractRootMotionOffset(state);
  const currentWorld = this._resolveTokenWorldPosition(state.token);
  let combinedOffset = null;

  if (transfer?.offsetWorld) {
    combinedOffset = {
      x: transfer.offsetWorld.x || 0,
      y: transfer.offsetWorld.y || 0,
      z: transfer.offsetWorld.z || 0,
    };
  }

  if (targetWorld && currentWorld) {
    const planned = combinedOffset || { x: 0, y: 0, z: 0 };
    const correction = {
      x: targetWorld.x - (currentWorld.x + planned.x),
      y: targetWorld.y - (currentWorld.y + planned.y),
      z: targetWorld.z - (currentWorld.z + planned.z),
    };
    const hasCorrection =
      Math.abs(correction.x) > 1e-5 ||
      Math.abs(correction.y) > 1e-5 ||
      Math.abs(correction.z) > 1e-5;
    if (hasCorrection) {
      if (!combinedOffset) {
        combinedOffset = correction;
      } else {
        combinedOffset.x += correction.x;
        combinedOffset.y += correction.y;
        combinedOffset.z += correction.z;
      }
    }
  }

  if (combinedOffset) {
    this._applyWorldOffsetToState(state, combinedOffset);
  }

  if (transfer) {
    this._resetRootBonePose(transfer.rootInfo);
  }

  return transfer || null;
}

// ── Landing Offset Sanitisation ──────────────────────────────────────────

function _sanitizeLandingRootOffset(step, offsetWorld, landingKey = null) {
  if (!offsetWorld) return null;
  const tileSize = Math.max(this.gameManager?.spatial?.tileWorldSize || 1, 0.25);
  const offsetX = Number.isFinite(offsetWorld.x) ? offsetWorld.x : 0;
  const offsetY = Number.isFinite(offsetWorld.y) ? offsetWorld.y : 0;
  const offsetZ = Number.isFinite(offsetWorld.z) ? offsetWorld.z : 0;
  if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY) || !Number.isFinite(offsetZ)) {
    return null;
  }

  const landingVariant = landingKey || step?.landingVariant || null;
  const variantConfig =
    LANDING_OFFSET_SANITIZE_LIMITS[landingVariant] || LANDING_OFFSET_SANITIZE_LIMITS.default;
  const horizontalMultiplier = Math.max(Number(variantConfig?.horizontalMultiplier) || 1.5, 0.25);
  const horizontalBonusTiles = Math.max(Number(variantConfig?.horizontalBonusTiles) || 0, 0);
  const horizontalMaxTiles = Math.max(Number(variantConfig?.horizontalMaxTiles) || 0, 0) || 4;

  const horizontalMagnitude = Math.hypot(offsetX, offsetZ);
  const stepHorizontal = Math.max(step?.horizontalDistance || 0, 0);
  const horizontalLimitBase = stepHorizontal > 0 ? stepHorizontal : tileSize * 0.85;
  const configuredMax = horizontalMaxTiles > 0 ? horizontalMaxTiles : 6;
  const horizontalLimit = Math.max(
    Math.min(
      horizontalLimitBase * horizontalMultiplier + tileSize * horizontalBonusTiles,
      tileSize * configuredMax
    ),
    tileSize * 0.25
  );
  let clampedX = offsetX;
  let clampedZ = offsetZ;
  if (horizontalLimit > 0 && horizontalMagnitude > horizontalLimit + 1e-4) {
    const scale = horizontalLimit / horizontalMagnitude;
    clampedX *= scale;
    clampedZ *= scale;
  }

  const startWorldY = Number.isFinite(step?.startWorld?.y) ? step.startWorld.y : null;
  const targetWorldY = Number.isFinite(step?.targetWorld?.y) ? step.targetWorld.y : null;
  const verticalDelta =
    startWorldY != null && targetWorldY != null ? Math.abs(targetWorldY - startWorldY) : 0;
  const heightDrop = Math.max(Math.abs(step?.heightDrop || 0), verticalDelta);
  const verticalLimitBase = Math.max(heightDrop, tileSize * 0.35);
  const verticalLimit = Math.max(
    Math.min(verticalLimitBase * 1.5 + 0.35, tileSize * 5),
    tileSize * 0.2
  );

  const forceZeroY = landingVariant && LANDING_VARIANTS_FORCE_ZERO_ELEVATION.has(landingVariant);
  let clampedY;
  if (forceZeroY) {
    clampedY = 0;
  } else if (verticalLimit > 0) {
    const verticalClamp = Math.min(Math.max(offsetY, -verticalLimit), verticalLimit);
    clampedY = verticalClamp;
  } else {
    clampedY = offsetY;
  }

  const epsilon = 1e-4;
  if (
    Math.abs(clampedX) < epsilon &&
    Math.abs(clampedY) < epsilon &&
    Math.abs(clampedZ) < epsilon
  ) {
    return null;
  }

  return { x: clampedX, y: clampedY, z: clampedZ };
}

// ── Landing Offset Tile Clamping ─────────────────────────────────────────

function _clampLandingOffsetToTargetTile(step, landingWorld, offset, landingKey = null) {
  if (!step || !landingWorld || !offset) return offset;
  const landingVariant = landingKey || step?.landingVariant || null;
  if (landingVariant && LANDING_VARIANTS_ALLOW_TILE_EXIT.has(landingVariant)) {
    return offset;
  }
  const targetGridX = Number.isFinite(step.gridTargetX) ? step.gridTargetX : null;
  const targetGridY = Number.isFinite(step.gridTargetY) ? step.gridTargetY : null;
  if (targetGridX == null && targetGridY == null) {
    return offset;
  }

  const withinTargetTile = (world) => {
    if (!world) return true;
    const mapped = this._mapWorldToGrid(world);
    if (!mapped) return true;
    if (targetGridX != null && mapped.gridX !== targetGridX) return false;
    if (targetGridY != null && mapped.gridY !== targetGridY) return false;
    return true;
  };

  const composeWorld = (baseWorld, appliedOffset) => ({
    x: (baseWorld?.x || 0) + (appliedOffset?.x || 0),
    y: (baseWorld?.y || 0) + (appliedOffset?.y || 0),
    z: (baseWorld?.z || 0) + (appliedOffset?.z || 0),
  });

  const initialWorld = composeWorld(landingWorld, offset);
  if (withinTargetTile(initialWorld)) {
    return offset;
  }

  let lo = 0;
  let hi = 1;
  let bestOffset = null;
  for (let i = 0; i < 15; i += 1) {
    const mid = (lo + hi) / 2;
    const scaledOffset = {
      x: offset.x * mid,
      y: offset.y * mid,
      z: offset.z * mid,
    };
    const scaledWorld = composeWorld(landingWorld, scaledOffset);
    if (withinTargetTile(scaledWorld)) {
      bestOffset = scaledOffset;
      lo = mid;
    } else {
      hi = mid;
    }
    if (hi - lo < 1e-3) {
      break;
    }
  }

  if (!bestOffset) {
    return null;
  }

  const epsilon = 1e-4;
  if (
    Math.abs(bestOffset.x) < epsilon &&
    Math.abs(bestOffset.y) < epsilon &&
    Math.abs(bestOffset.z) < epsilon
  ) {
    return null;
  }
  return bestOffset;
}

// ── Install ──────────────────────────────────────────────────────────────

export function installWorldAuthorityMethods(prototype) {
  prototype._lockTokenWorldAuthority = _lockTokenWorldAuthority;
  prototype._unlockTokenWorldAuthority = _unlockTokenWorldAuthority;
  prototype._transferRootMotionToWorld = _transferRootMotionToWorld;
  prototype._sanitizeLandingRootOffset = _sanitizeLandingRootOffset;
  prototype._clampLandingOffsetToTargetTile = _clampLandingOffsetToTargetTile;
}
