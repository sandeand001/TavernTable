/**
 * SpatialUtils.js
 *
 * Spatial queries, world/grid coordinate conversions, rotation helpers,
 * and world-position cloning utilities extracted from Token3DAdapter.
 * Each function is written with `this` semantics so it can be installed
 * on a class prototype via `installSpatialUtilsMethods()`.
 */

import { CONTINUOUS_ROTATION_SPEED } from '../../../config/token-adapter/MannequinConfig.js';

// ── World Position & Spatial Utilities ───────────────────────────────────

function _resolveTokenWorldPosition(tokenEntry) {
  if (!tokenEntry) return { x: 0, y: 0, z: 0 };
  try {
    const world = tokenEntry.world;
    if (world && Number.isFinite(world.x) && Number.isFinite(world.z)) {
      const y = Number.isFinite(world.y) ? world.y : 0;
      return { x: world.x, y, z: world.z };
    }
    const gm = this.gameManager;
    const rawX = Number.isFinite(tokenEntry.gridX) ? tokenEntry.gridX : 0;
    const rawY = Number.isFinite(tokenEntry.gridY) ? tokenEntry.gridY : 0;
    const gx = Math.round(rawX);
    const gy = Math.round(rawY);
    const height = this._getTerrainHeight(gx, gy);
    if (gm?.spatial?.gridToWorld) {
      return gm.spatial.gridToWorld(gx + 0.5, gy + 0.5, height);
    }
    return { x: gx, y: height, z: gy };
  } catch (_) {
    return { x: 0, y: 0, z: 0 };
  }
}

function _computeMovementBounds() {
  try {
    const gm = this.gameManager;
    const tile = gm?.spatial?.tileWorldSize || 1;
    const cols = Number.isFinite(gm?.cols) ? gm.cols : null;
    const rows = Number.isFinite(gm?.rows) ? gm.rows : null;
    const minX = cols != null ? tile * 0.5 : -Infinity;
    const maxX = cols != null ? tile * (cols - 0.5) : Infinity;
    const minZ = rows != null ? tile * 0.5 : -Infinity;
    const maxZ = rows != null ? tile * (rows - 0.5) : Infinity;
    return { minX, maxX, minZ, maxZ, tileSize: tile };
  } catch (_) {
    return { minX: -Infinity, maxX: Infinity, minZ: -Infinity, maxZ: Infinity, tileSize: 1 };
  }
}

function _getDirectionalVectorFromYaw(yaw, directionSign = 1) {
  if (!Number.isFinite(yaw) || directionSign === 0) {
    return { x: 0, z: 0 };
  }
  const sign = directionSign >= 0 ? 1 : -1;
  const x = Math.sin(yaw) * sign;
  const z = -Math.cos(yaw) * sign;
  const mag = Math.hypot(x, z) || 1;
  return { x: x / mag, z: z / mag };
}

function _sampleWorldHeight(x, z, fallbackY = 0) {
  try {
    const gm = this.gameManager;
    const spatial = gm?.spatial;
    if (!spatial) return fallbackY;

    const tileSize =
      Number.isFinite(spatial.tileWorldSize) && spatial.tileWorldSize > 0
        ? spatial.tileWorldSize
        : 1;

    const gridX = Math.floor(x / tileSize);
    const gridY = Math.floor(z / tileSize);
    const heightLevel = this._getTerrainHeight(gridX, gridY);
    if (!Number.isFinite(heightLevel)) {
      return fallbackY;
    }

    if (typeof spatial.elevationToWorldY === 'function') {
      return spatial.elevationToWorldY(heightLevel);
    }

    const unit = Number.isFinite(spatial.elevationUnit) ? spatial.elevationUnit : 1;
    return heightLevel * unit;
  } catch (_) {
    return fallbackY;
  }
}

function _estimateHeightFromWorld(worldY, gridX, gridY) {
  if (Number.isFinite(worldY)) {
    try {
      const gm = this.gameManager;
      const unit = Number.isFinite(gm?.spatial?.elevationUnit) ? gm.spatial.elevationUnit : 1;
      if (unit > 0) {
        return worldY / unit;
      }
    } catch (_) {
      /* ignore */
    }
  }
  return this._getTerrainHeight(gridX, gridY);
}

function _isGridWithinBounds(gx, gy) {
  const gm = this.gameManager;
  if (Number.isFinite(gm?.cols) && (gx < 0 || gx >= gm.cols)) return false;
  if (Number.isFinite(gm?.rows) && (gy < 0 || gy >= gm.rows)) return false;
  return true;
}

function _advanceRotationState(state, delta) {
  if (!state || !(delta > 0)) return;
  const intent = this._computeRotationIntent(state);
  if (intent === 0) {
    state.rotationDirection = 0;
    if (
      state.phase === 'idle' &&
      !this._hasActiveIntents(state) &&
      !this._shouldHoldMovementState(state)
    ) {
      this._movementStates.delete(state.token);
    }
    return;
  }

  state.rotationDirection = intent;
  const speed =
    Number.isFinite(state.rotationSpeed) && state.rotationSpeed > 0
      ? state.rotationSpeed
      : CONTINUOUS_ROTATION_SPEED;
  const deltaAngle = -speed * delta * intent;
  const token = state.token;
  const current = Number.isFinite(token?.facingAngle) ? token.facingAngle : 0;
  token.facingAngle = this._normalizeAngle(current + deltaAngle);
  this.updateTokenOrientation(token);
}

function _hasActiveIntents(state) {
  if (!state) return false;
  const movementActive = (state.forwardKeys?.size || 0) > 0 || (state.backwardKeys?.size || 0) > 0;
  const rotationActive =
    (state.rotationLeftKeys?.size || 0) > 0 || (state.rotationRightKeys?.size || 0) > 0;
  return movementActive || rotationActive;
}

function _shouldHoldMovementState(state) {
  return Boolean(state?.__resumeProbe);
}

// ── Movement Yaw & Facing ────────────────────────────────────────────────

function _getMovementYaw(tokenEntry) {
  const tau = Math.PI * 2;
  const rawFacing = Number.isFinite(tokenEntry?.facingAngle) ? tokenEntry.facingAngle : 0;
  const normalizedFacing = ((rawFacing % tau) + tau) % tau;
  return (tau - normalizedFacing + Math.PI / 2) % tau;
}

function _getFacingYaw(mesh) {
  try {
    if (mesh?.rotation && typeof mesh.rotation.y === 'number') return mesh.rotation.y;
  } catch (_) {
    /* ignore */
  }
  return 0;
}

function _getForwardGridDelta(yaw) {
  const rawX = Math.sin(yaw);
  const rawY = -Math.cos(yaw);
  let stepX = Math.round(rawX);
  let stepY = Math.round(rawY);
  if (stepX === 0 && Math.abs(rawX) > 0.2) stepX = rawX > 0 ? 1 : -1;
  if (stepY === 0 && Math.abs(rawY) > 0.2) stepY = rawY > 0 ? 1 : -1;
  if (stepX === 0 && stepY === 0) {
    stepY = -1;
  }
  return { stepX, stepY };
}

// ── Terrain & Grid ───────────────────────────────────────────────────────

function _getTerrainHeight(gx, gy) {
  try {
    const gm = this.gameManager;
    if (gm?.getTerrainHeight) {
      const h = gm.getTerrainHeight(gx, gy);
      if (Number.isFinite(h)) return h;
    }
  } catch (_) {
    /* ignore */
  }
  return 0;
}

function _mapWorldToGrid(world) {
  if (!world) return null;
  const spatial = this.gameManager?.spatial;
  if (!spatial?.worldToGrid) return null;
  try {
    const mapped = spatial.worldToGrid(world.x, world.z);
    const gridX = Number.isFinite(mapped?.gridX) ? Math.round(mapped.gridX) : null;
    const gridY = Number.isFinite(mapped?.gridY) ? Math.round(mapped.gridY) : null;
    if (gridX == null && gridY == null) {
      return null;
    }
    return { gridX, gridY };
  } catch (_) {
    return null;
  }
}

function _applyTokenGridFromWorld(tokenEntry, world) {
  if (!tokenEntry || !world) return;
  const mapped = this._mapWorldToGrid(world);
  if (!mapped) return;
  if (mapped.gridX != null) tokenEntry.gridX = mapped.gridX;
  if (mapped.gridY != null) tokenEntry.gridY = mapped.gridY;
}

function _applyStepGridFromWorld(step, world) {
  if (!step || !world) return;
  const mapped = this._mapWorldToGrid(world);
  if (!mapped) return;
  if (mapped.gridX != null) step.gridTargetX = mapped.gridX;
  if (mapped.gridY != null) step.gridTargetY = mapped.gridY;
}

function _lerp3(a, b, t) {
  const ratio = Math.min(Math.max(t, 0), 1);
  return {
    x: (a?.x ?? 0) + ((b?.x ?? 0) - (a?.x ?? 0)) * ratio,
    y: (a?.y ?? 0) + ((b?.y ?? 0) - (a?.y ?? 0)) * ratio,
    z: (a?.z ?? 0) + ((b?.z ?? 0) - (a?.z ?? 0)) * ratio,
  };
}

function _updateTokenWorldDuringMovement(tokenEntry, world) {
  if (!tokenEntry || !world) return;
  tokenEntry.world = { x: world.x, y: world.y, z: world.z };
}

// ── World Cloning ────────────────────────────────────────────────────────

function _cloneWorld(world) {
  return world ? { ...world } : null;
}

function _cloneClimbWorldInfo(info) {
  if (!info) return null;
  return {
    ...info,
    footWorld: this._cloneWorld(info.footWorld),
    edgeWorld: this._cloneWorld(info.edgeWorld),
    finalWorld: this._cloneWorld(info.finalWorld),
  };
}

function _cloneWorldWithFallback(...worlds) {
  for (const world of worlds) {
    const cloned = this._cloneWorld(world);
    if (cloned) return cloned;
  }
  return null;
}

function _cloneClimbContinuationGoal(goal) {
  if (!goal) return null;
  return {
    gridX: goal.gridX,
    gridY: goal.gridY,
    options: goal.options ? { ...goal.options } : undefined,
  };
}

function _assignClimbRecoverAnchorPosition(state, anchorWorld) {
  if (!state) return;
  const mesh = state.mesh;
  if (anchorWorld) {
    const composed = this._applyMeshWorldPosition(mesh, anchorWorld);
    if (composed) {
      state.climbRecoverAnchorPosition = { x: composed.x, y: composed.y, z: composed.z };
      return;
    }
  }
  if (mesh?.position) {
    state.climbRecoverAnchorPosition = {
      x: Number(mesh.position.x) || 0,
      y: Number(mesh.position.y) || 0,
      z: Number(mesh.position.z) || 0,
    };
  } else {
    state.climbRecoverAnchorPosition = null;
  }
}

// ── Mesh Position Composition ────────────────────────────────────────────

function _composeMeshPosition(world, mesh) {
  const baseOffset = this._getMeshVerticalOffset(mesh);
  return {
    x: world?.x ?? 0,
    y: (world?.y ?? 0) + this._verticalBias + baseOffset,
    z: world?.z ?? 0,
  };
}

function _applyMeshWorldPosition(mesh, world) {
  if (!mesh?.position?.set) return null;
  const composed = this._composeMeshPosition(world, mesh);
  mesh.position.set(composed.x, composed.y, composed.z);
  return composed;
}

function _syncTokenAndMeshWorld(state, world, options = {}) {
  if (!state || !world) return null;
  const tokenEntry = options.token ?? state.token;
  if (!tokenEntry) return null;
  const meshOption = options.mesh;
  const mesh = meshOption === undefined ? state.mesh || tokenEntry.__threeMesh : meshOption;
  this._updateTokenWorldDuringMovement(tokenEntry, world);
  if (!mesh) {
    return null;
  }
  return this._applyMeshWorldPosition(mesh, world);
}

// ── Install ──────────────────────────────────────────────────────────────

export function installSpatialUtilsMethods(prototype) {
  prototype._resolveTokenWorldPosition = _resolveTokenWorldPosition;
  prototype._computeMovementBounds = _computeMovementBounds;
  prototype._getDirectionalVectorFromYaw = _getDirectionalVectorFromYaw;
  prototype._sampleWorldHeight = _sampleWorldHeight;
  prototype._estimateHeightFromWorld = _estimateHeightFromWorld;
  prototype._isGridWithinBounds = _isGridWithinBounds;
  prototype._advanceRotationState = _advanceRotationState;
  prototype._hasActiveIntents = _hasActiveIntents;
  prototype._shouldHoldMovementState = _shouldHoldMovementState;
  prototype._getMovementYaw = _getMovementYaw;
  prototype._getFacingYaw = _getFacingYaw;
  prototype._getForwardGridDelta = _getForwardGridDelta;
  prototype._getTerrainHeight = _getTerrainHeight;
  prototype._mapWorldToGrid = _mapWorldToGrid;
  prototype._applyTokenGridFromWorld = _applyTokenGridFromWorld;
  prototype._applyStepGridFromWorld = _applyStepGridFromWorld;
  prototype._lerp3 = _lerp3;
  prototype._updateTokenWorldDuringMovement = _updateTokenWorldDuringMovement;
  prototype._cloneWorld = _cloneWorld;
  prototype._cloneClimbWorldInfo = _cloneClimbWorldInfo;
  prototype._cloneWorldWithFallback = _cloneWorldWithFallback;
  prototype._cloneClimbContinuationGoal = _cloneClimbContinuationGoal;
  prototype._assignClimbRecoverAnchorPosition = _assignClimbRecoverAnchorPosition;
  prototype._composeMeshPosition = _composeMeshPosition;
  prototype._applyMeshWorldPosition = _applyMeshWorldPosition;
  prototype._syncTokenAndMeshWorld = _syncTokenAndMeshWorld;
}
