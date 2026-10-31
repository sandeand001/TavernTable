/**
 * SelectionEffects.js
 *
 * Selection, hover, facing/orientation, and visual-state helpers for tokens.
 * Every function uses `this` and is designed to be installed on a class
 * prototype via `installSelectionMethods(prototype)`.
 */

import { GameErrors } from '../../utils/error/ErrorHandler.js';

// ── Material Creation ──────────────────────────────────────────────

function _createMaterialForToken(three, tokenEntry) {
  try {
    const sprite = tokenEntry?.creature?.sprite;
    const bt = sprite?.texture?.baseTexture;
    const src = bt?.resource?.source || bt?.resource;
    if (src && (src instanceof HTMLImageElement || src instanceof HTMLCanvasElement)) {
      const tex = new three.Texture(src);
      tex.needsUpdate = true;
      return new three.MeshBasicMaterial({
        map: tex,
        transparent: true,
        alphaTest: 0.05,
        depthWrite: false,
        side: three.DoubleSide,
      });
    }
    if (sprite && typeof document !== 'undefined') {
      const w = Math.max(1, sprite.width || 64);
      const h = Math.max(1, sprite.height || 64);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (ctx && src) {
        ctx.drawImage(src, 0, 0, w, h);
        const tex = new three.Texture(canvas);
        tex.needsUpdate = true;
        return new three.MeshBasicMaterial({
          map: tex,
          transparent: true,
          alphaTest: 0.05,
          depthWrite: false,
          side: three.DoubleSide,
        });
      }
    }
  } catch (_) {
    /* ignore and fallback */
  }
  return new three.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    side: three.DoubleSide,
  });
}

// ── Facing / Orientation ───────────────────────────────────────────

function _syncFacingDirection() {
  const gm = this.gameManager;
  if (!gm || !gm.is3DModeActive?.()) return;
  const facingRight = this._getGlobalFacingRight();
  if (facingRight === this._lastFacingRight) return;
  this._lastFacingRight = facingRight;
  try {
    const tokens = gm.placedTokens || [];
    for (const token of tokens) {
      this.updateTokenOrientation(token);
    }
  } catch (_) {
    /* ignore */
  }
}

// ── Selection & Hover State ───────────────────────────────────────

function getSelectedToken() {
  return this._selectedToken || null;
}

function setHoverToken(tokenEntry) {
  if (this._hoverToken === tokenEntry) return;
  const previous = this._hoverToken;
  this._hoverToken = tokenEntry || null;
  if (previous) void this._refreshVisualState(previous);
  if (tokenEntry) void this._refreshVisualState(tokenEntry);
}

async function setSelectedToken(tokenEntry) {
  const previous = this._selectedToken;
  this._selectedToken = tokenEntry || null;
  this.refreshMovementRange?.();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('taverntable:tokenSelected', {
        detail: { token: this._selectedToken, gameManager: this.gameManager },
      })
    );
  }
  if (previous === this._selectedToken) return;
  if (previous) {
    await this._refreshVisualState(previous);
  }
  if (tokenEntry) {
    await this._refreshVisualState(tokenEntry);
  }
}

function updateTokenOrientation(tokenEntry) {
  if (!tokenEntry) return;
  const normalized = this._normalizeAngle(
    Number.isFinite(tokenEntry.facingAngle) ? tokenEntry.facingAngle : 0
  );
  tokenEntry.facingAngle = normalized;

  const state = this._movementStates.get(tokenEntry);
  if (this._shouldDeferOrientation(state)) {
    state.pendingFacingAngle = normalized;
    return;
  }

  this._applyOrientationImmediate(tokenEntry, normalized);
  if (state) {
    state.pendingFacingAngle = undefined;
  }
}

function _shouldDeferOrientation(state) {
  if (!state) return false;
  if (state.phase === 'stop') return false;
  if (state.phase?.startsWith('climb') || state.phase === 'fall') return true;
  if (!state.activeStep) return false;
  if (state.stepFinalized) return false;
  return true;
}

function _applyPendingOrientation(state) {
  if (!state || state.pendingFacingAngle == null) return;
  this._applyOrientationImmediate(state.token, state.pendingFacingAngle);
}

function _applyOrientationImmediate(tokenEntry, angle) {
  const mesh = tokenEntry?.__threeMesh;
  const globalFlip = this._getGlobalFacingRight() ? 0 : Math.PI;

  const is3DToken = !!mesh?.userData?.__tt3DToken;
  if (mesh && is3DToken) {
    const baseYaw = mesh.userData.__ttBaseYaw || 0;
    const yaw = baseYaw + globalFlip + angle;
    try {
      if (mesh.rotation) {
        mesh.rotation.y = yaw;
      } else {
        mesh.rotation = { y: yaw };
      }
    } catch (_) {
      /* ignore mesh rotation errors */
    }
  } else if (mesh) {
    this._applyBillboardFacing(mesh, globalFlip);
  }

  try {
    const sprite = tokenEntry?.creature?.sprite;
    if (sprite) {
      const sign = globalFlip === 0 ? 1 : -1;
      if (sprite.scale && typeof sprite.scale.x === 'number') {
        const absX = Math.abs(sprite.scale.x || 1);
        sprite.scale.x = sign * absX;
      }
      if (typeof sprite.rotation === 'number') {
        sprite.rotation = angle;
      }
    }
  } catch (_) {
    /* ignore sprite orientation errors */
  }
}

function _applyBillboardFacing(mesh, globalFlip) {
  if (!mesh) return;
  const facingRight = globalFlip === 0;
  const sign = facingRight ? 1 : -1;
  if (!mesh.scale) mesh.scale = { x: sign, y: 1, z: 1 };
  mesh.scale.x = sign * Math.abs(mesh.scale.x || 1);
}

function _getGlobalFacingRight() {
  const gm = this.gameManager;
  try {
    if (gm?.tokenManager?.getTokenFacingRight) {
      return !!gm.tokenManager.getTokenFacingRight();
    }
    if (typeof gm?.tokenManager?.tokenFacingRight === 'boolean') {
      return !!gm.tokenManager.tokenFacingRight;
    }
  } catch (_) {
    /* ignore */
  }
  return true;
}

function _normalizeAngle(angle) {
  if (!Number.isFinite(angle)) return 0;
  const tau = Math.PI * 2;
  let normalized = angle;
  while (normalized < -Math.PI) normalized += tau;
  while (normalized > Math.PI) normalized -= tau;
  return normalized;
}

// ── Selection Indicator Lifecycle ─────────────────────────────────

function clearHighlights() {
  this.setHoverToken(null);
  this.setSelectedToken(null);
}

async function _showSelectionIndicator(tokenEntry) {
  try {
    const marker = await this._ensureSelectionIndicator(tokenEntry);
    if (!marker) return;
    this._updateSelectionIndicatorTransform(tokenEntry);
    marker.visible =
      this._selectedToken === tokenEntry &&
      !this._movementStates.get(tokenEntry)?.selectionIndicatorSuppressed;
  } catch (error) {
    GameErrors.rendering(error, {
      component: 'Token3DAdapter',
      operation: 'showSelectionIndicator',
      tokenId: tokenEntry?.id,
    });
  }
}

function _hideSelectionIndicator(tokenEntry) {
  try {
    const marker = tokenEntry?.__ttSelectionIndicator;
    if (marker) marker.visible = false;
  } catch (_) {
    /* ignore */
  }
}

function _discardSelectionIndicator(tokenEntry) {
  try {
    const marker = tokenEntry?.__ttSelectionIndicator;
    if (marker) {
      marker.visible = false;
      if (marker.parent && typeof marker.parent.remove === 'function') {
        marker.parent.remove(marker);
      }
      if (marker.geometry?.dispose) marker.geometry.dispose();
      if (marker.material?.dispose) marker.material.dispose();
    }
    delete tokenEntry.__ttSelectionIndicator;
  } catch (_) {
    /* ignore */
  }
}

async function _ensureSelectionIndicator(tokenEntry) {
  if (!tokenEntry || !tokenEntry.__threeMesh) return null;
  const mesh = tokenEntry.__threeMesh;
  if (mesh.userData?.__tt3DToken === false) return null;
  if (tokenEntry.__ttSelectionIndicator) return tokenEntry.__ttSelectionIndicator;
  const three = await this._getThree();
  if (!three || tokenEntry.__threeMesh !== mesh) return null;
  if (tokenEntry.__ttSelectionIndicator) return tokenEntry.__ttSelectionIndicator;
  try {
    const inner = 0.34;
    const outer = 0.47;
    const geometry = new three.RingGeometry(inner, outer, 48);
    const material = new three.MeshBasicMaterial({
      color: this._selectionColor,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      side: three.DoubleSide,
    });
    const ring = new three.Mesh(geometry, material);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    ring.userData = ring.userData || {};
    ring.userData.__ttBaseY = ring.position.y;
    if (typeof three.Box3 === 'function') {
      ring.userData.__ttBodyBounds = {
        bounds: new three.Box3(),
        vertex: new three.Vector3(),
        pose: [],
        valid: false,
      };
    }
    ring.name = 'TokenSelectionIndicator';
    ring.visible = false;
    if (typeof mesh.add === 'function') {
      mesh.add(ring);
    }
    tokenEntry.__ttSelectionIndicator = ring;
    this._updateSelectionIndicatorTransform(tokenEntry);
    return ring;
  } catch (error) {
    GameErrors.rendering(error, {
      component: 'Token3DAdapter',
      operation: 'createSelectionIndicator',
      tokenId: tokenEntry.id,
    });
    return null;
  }
}

function getSelectionBodyCenter(mesh, marker, target) {
  const cache = marker.userData.__ttBodyBounds;
  if (!cache) return false;
  // Frozen holds reuse exact skinned bounds until their pose or transform changes.
  const bodies = [];
  let index = 0;
  let changed = !cache.valid;
  const sample = (value) => {
    if (cache.pose[index] !== value) changed = true;
    cache.pose[index++] = value;
  };
  mesh.traverseVisible((child) => {
    if (!child.isMesh || child === marker || child === mesh.userData.__ttSelectionCollider) return;
    const position = child.geometry?.attributes?.position;
    if (!position) return;
    bodies.push(child);
    sample(child.id);
    sample(child.geometry.id);
    sample(position.version ?? position.data?.version);
    for (const value of child.matrixWorld.elements) sample(value);
    for (const value of child.morphTargetInfluences || []) sample(value);
    if (child.isSkinnedMesh) {
      sample(child.skeleton.uuid);
      for (const matrix of [child.bindMatrix, child.bindMatrixInverse])
        for (const value of matrix.elements) sample(value);
      for (const bone of child.skeleton.bones)
        for (const value of bone.matrixWorld.elements) sample(value);
    }
  });
  if (cache.pose.length !== index) changed = true;
  cache.pose.length = index;
  if (changed) {
    cache.bounds.makeEmpty();
    for (const body of bodies) {
      for (let i = 0; i < body.geometry.attributes.position.count; i++) {
        body.getVertexPosition(i, cache.vertex).applyMatrix4(body.matrixWorld);
        cache.bounds.expandByPoint(cache.vertex);
      }
    }
    cache.valid = true;
  }
  if (cache.bounds.isEmpty()) return false;
  cache.bounds.getCenter(target);
  return true;
}

function _updateSelectionIndicatorTransform(tokenEntry) {
  const mesh = tokenEntry?.__threeMesh;
  const marker = tokenEntry?.__ttSelectionIndicator;
  if (!mesh || !marker) return;
  const baseY = marker.userData.__ttBaseY;
  const state = this._movementStates.get(tokenEntry);
  const motion = state?.wallMotion;
  if (tokenEntry.flightActive) {
    const world = this._resolveTokenWorldPosition(tokenEntry);
    const ground = this._sampleWorldHeight(world.x, world.z);
    const position = (marker.userData.__ttFlightProjection ||= marker.position.clone());
    position.set(world.x, ground + this.gameManager.spatial.tileWorldSize * 0.015, world.z);
    mesh.updateWorldMatrix(true, false);
    marker.position.copy(mesh.worldToLocal(position));
    marker.rotation.set(-Math.PI / 2, 0, 0);
    return;
  }
  const onWall =
    motion?.stage === 'surface' &&
    (state.phase === 'climb-surface' || state.phase === 'climb-hold');
  if (!onWall) {
    const manualOffset = Number.isFinite(mesh.userData?.__ttManualVerticalOffset)
      ? mesh.userData.__ttManualVerticalOffset
      : 0;
    marker.position.x = 0;
    marker.position.y = baseY - manualOffset;
    marker.position.z = 0;
    marker.rotation.x = -Math.PI / 2;
    marker.rotation.y = 0;
    marker.rotation.z = 0;
    return;
  }
  const { low, high } = motion.face;
  const nx = low.gridX - high.gridX;
  const nz = low.gridY - high.gridY;
  if (Math.abs(nx) + Math.abs(nz) !== 1)
    throw new Error('A wall selection ring requires a cardinal terrain face');
  const plane = this.gameManager.spatial.gridToWorld(
    (low.gridX + high.gridX + 1) / 2,
    (low.gridY + high.gridY + 1) / 2,
    0
  );
  const world = this._resolveTokenWorldPosition(tokenEntry);
  const scratch = (marker.userData.__ttSurfaceScratch ||= {
    position: marker.position.clone(),
    normal: marker.position.clone(),
    forward: marker.position.clone().set(0, 0, 1),
  });
  scratch.position.set(world.x, world.y, world.z);
  const centerBody = this._selectedToken === tokenEntry && !state.selectionIndicatorSuppressed;
  mesh.updateWorldMatrix(true, false);
  if (centerBody) {
    mesh.updateMatrixWorld(true);
    getSelectionBodyCenter(mesh, marker, scratch.position);
  }
  if (nx) scratch.position.x = plane.x + nx * baseY;
  if (nz) scratch.position.z = plane.z + nz * baseY;
  marker.position.copy(mesh.worldToLocal(scratch.position));
  const matrix = mesh.matrixWorld.elements;
  // World-to-local normals use the transpose, including non-uniform parent scale.
  scratch.normal
    .set(
      matrix[0] * nx + matrix[2] * nz,
      matrix[4] * nx + matrix[6] * nz,
      matrix[8] * nx + matrix[10] * nz
    )
    .normalize();
  marker.quaternion.setFromUnitVectors(scratch.forward, scratch.normal);
}

// ── Visual State Refresh ──────────────────────────────────────────

function _setSelectionIndicatorSuppressed(state, suppressed) {
  if (!state) return;
  const next = !!suppressed;
  if (state.selectionIndicatorSuppressed === next) return;
  state.selectionIndicatorSuppressed = next;
  if (next) {
    this._hideSelectionIndicator(state.token);
  } else if (this._selectedToken === state.token) {
    this._refreshVisualState(state.token);
  }
}

function _refreshVisualState(tokenEntry) {
  const mesh = tokenEntry?.__threeMesh;
  if (!mesh) return null;
  const is3DToken = mesh.userData?.__tt3DToken !== false;
  const state = this._movementStates.get(tokenEntry);
  const indicatorSuppressed = !!state?.selectionIndicatorSuppressed;
  const canShowSelectionIndicator = is3DToken && !indicatorSuppressed;

  if (this._selectedToken === tokenEntry) {
    this._restoreMaterial(mesh);
    if (is3DToken) {
      if (canShowSelectionIndicator) {
        return this._showSelectionIndicator(tokenEntry);
      } else {
        this._hideSelectionIndicator(tokenEntry);
      }
    } else {
      this._hideSelectionIndicator(tokenEntry);
      this._applyTint(mesh, this._selectionColor);
    }
    return null;
  }

  if (this._hoverToken === tokenEntry) {
    this._restoreMaterial(mesh);
    if (is3DToken) {
      this._hideSelectionIndicator(tokenEntry);
    } else {
      this._applyTint(mesh, 0x88ccff);
      this._hideSelectionIndicator(tokenEntry);
    }
    return null;
  }

  this._restoreMaterial(mesh);
  this._hideSelectionIndicator(tokenEntry);
  return null;
}

/**
 * Attach all selection/hover/orientation methods to the given prototype.
 */
function installSelectionMethods(prototype) {
  prototype._createMaterialForToken = _createMaterialForToken;
  prototype._syncFacingDirection = _syncFacingDirection;
  prototype.getSelectedToken = getSelectedToken;
  prototype.setHoverToken = setHoverToken;
  prototype.setSelectedToken = setSelectedToken;
  prototype.updateTokenOrientation = updateTokenOrientation;
  prototype._shouldDeferOrientation = _shouldDeferOrientation;
  prototype._applyPendingOrientation = _applyPendingOrientation;
  prototype._applyOrientationImmediate = _applyOrientationImmediate;
  prototype._applyBillboardFacing = _applyBillboardFacing;
  prototype._getGlobalFacingRight = _getGlobalFacingRight;
  prototype._normalizeAngle = _normalizeAngle;
  prototype.clearHighlights = clearHighlights;
  prototype._showSelectionIndicator = _showSelectionIndicator;
  prototype._hideSelectionIndicator = _hideSelectionIndicator;
  prototype._discardSelectionIndicator = _discardSelectionIndicator;
  prototype._ensureSelectionIndicator = _ensureSelectionIndicator;
  prototype._updateSelectionIndicatorTransform = _updateSelectionIndicatorTransform;
  prototype._setSelectionIndicatorSuppressed = _setSelectionIndicatorSuppressed;
  prototype._refreshVisualState = _refreshVisualState;
}

export { installSelectionMethods };
