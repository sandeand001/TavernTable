// Token3DAdapter.js - Orchestrator for 3D token rendering, movement, and interaction.
// Method groups are installed via mixins from ./token-adapter/*.

import {
  MANNEQUIN_MODEL,
  TOKEN_3D_MODELS,
  DEFAULT_BILLBOARD_SIZE,
  DEFAULT_MOVEMENT_PROFILE,
  DEFAULT_FALL_TRIGGER_PROGRESS,
  DEFAULT_HEIGHT_SNAP_PROGRESS,
  HARD_LANDING_HEIGHT_THRESHOLD,
  ROLLING_LANDING_HEIGHT_THRESHOLD,
  FALL_MIN_HEIGHT_THRESHOLD,
  CONTINUOUS_ROTATION_SPEED,
  FALL_EDGE_TRIGGER_TILE_RATIO,
  PATH_STALL_REPATH_DELAY,
  SELECTION_COLLIDER_HEIGHT,
  SELECTION_COLLIDER_RADIUS_RATIO,
  CLIMB_RECOVER_CROUCH_HOLD,
  CLIMB_RECOVER_STAND_RELEASE,
  TOKEN_WORLD_LOCK_PROP,
} from '../config/token-adapter/MannequinConfig.js';
import { installAnimationMethods } from './token-adapter/AnimationController.js';
import { installSelectionMethods } from './token-adapter/SelectionEffects.js';
import { installMeshFactoryMethods } from './token-adapter/MeshFactory.js';

import { installClimbMethods } from './token-adapter/movement/ClimbPhases.js';
import { installFallMethods } from './token-adapter/movement/FallPhases.js';
import { installMovementStyleMethods } from './token-adapter/movement/MovementStyle.js';
import { installMovementPhaseMethods } from './token-adapter/movement/MovementPhases.js';
import { installStepFactoryMethods } from './token-adapter/movement/StepFactory.js';

import { installNavigationMethods } from './token-adapter/pathing/Navigation.js';
import { installPathingLoggerMethods } from './token-adapter/pathing/PathingLogger.js';
import { installResumeProbeMethods } from './token-adapter/pathing/ResumeProbe.js';

import { installRootMotionMethods } from './token-adapter/spatial/RootMotion.js';
import { installSpatialUtilsMethods } from './token-adapter/spatial/SpatialUtils.js';
import { installWorldAuthorityMethods } from './token-adapter/spatial/WorldAuthority.js';

export class Token3DAdapter {
  // ── Constructor & Initialization ─────────────────────────────────────────────

  constructor(gameManager) {
    this.gameManager = gameManager;
    this._attached = false;
    this._verticalBias = 0;
    this._hoverToken = null;
    this._selectedToken = null;
    this._originalMaterials = new WeakMap();
    this._threePromise = null;
    this._fbxCtorPromise = null;
    this._skeletonUtilsPromise = null;
    this._modelCache = new Map();
    this._animationMixers = new Map();
    this._animationClipCache = new Map();
    this._tokenAnimationData = new Map();
    this._movementStates = new Map();
    this._rootBones = new Map();
    this._lastFrameTime = null;
    this._lastFacingRight = null;
    this._selectionColor = 0xffcc55;
    this._modifiers = { shift: false };
    this._raycastScratch = [];
    this._pathingLoggingEnabledOverride = undefined;
    this._pathingLogArchive = [];
    this._manualAnimationRevertTimers = new WeakMap();
    this._manualAnimationStates = new WeakMap();
  }

  // ── Pathing & Debug Logging (installed via PathingLogger mixin) ──────────

  // ── Resume Probe Management (installed via ResumeProbe mixin) ─────────────────

  // ── Lifecycle & Scene Attachment ─────────────────────────────────────────────

  attach() {
    if (this._attached) return;
    this._attached = true;
    try {
      this.syncAll();
    } catch (_) {
      /* ignore */
    }
    try {
      const gm = this.gameManager;
      if (gm?.threeSceneManager?.addAnimationCallback && !this._frameCallback) {
        this._frameCallback = () => {
          const gmRef = this.gameManager;
          const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
          let delta = 0;
          if (this._lastFrameTime != null) {
            delta = Math.max(0, (now - this._lastFrameTime) / 1000);
            if (delta > 0.1) delta = 0.1;
          }
          this._lastFrameTime = now;

          if (delta > 0) {
            try {
              this._updateForwardMovements(delta);
            } catch (_) {
              /* ignore movement update errors */
            }
          }

          if (delta > 0 && this._animationMixers.size) {
            for (const [tokenEntry, mixer] of this._animationMixers.entries()) {
              try {
                mixer.update(delta);
              } catch (_) {
                /* ignore mixer update */
              }
              try {
                this._neutralizeRootMotion(tokenEntry);
              } catch (_) {
                /* ignore root reset */
              }
            }
          }

          try {
            this._syncFacingDirection();
          } catch (_) {
            /* ignore */
          }

          try {
            const camera = gmRef?.threeSceneManager?.camera;
            if (!camera) return;
            const tokens = gmRef?.placedTokens || [];
            for (const t of tokens) {
              const mesh = t.__threeMesh;
              if (!mesh || typeof mesh.lookAt !== 'function') continue;
              if (mesh.userData?.__ttBillboard === false) continue;
              try {
                mesh.lookAt(camera.position);
              } catch (_) {
                /* ignore */
              }
            }
          } catch (_) {
            /* ignore */
          }
        };
        gm.threeSceneManager.addAnimationCallback(this._frameCallback);
      }
    } catch (_) {
      /* ignore */
    }
  }

  syncAll() {
    const gm = this.gameManager;
    if (!gm || !gm.is3DModeActive?.()) return;
    const scene = gm.threeSceneManager?.scene;
    if (!scene) return;
    const tokens = gm.placedTokens || [];
    for (const t of tokens) this._ensureTokenMesh(t, scene);
  }

  onTokenAdded(tokenEntry) {
    const gm = this.gameManager;
    if (!gm || !gm.is3DModeActive?.()) return;
    const scene = gm.threeSceneManager?.scene;
    if (!scene) return;
    return this._ensureTokenMesh(tokenEntry, scene);
  }

  // ── Root Bone & Root Motion (installed via RootMotion mixin) ──────────

  // ── World Authority & Motion Transfer (installed via WorldAuthority mixin) ──────────

  // ── Movement State Management ─────────────────────────────────────────────

  _ensureMovementState(tokenEntry) {
    if (!tokenEntry) return null;
    let state = this._movementStates.get(tokenEntry);
    const mesh = tokenEntry.__threeMesh;
    const animationData = this._tokenAnimationData.get(tokenEntry);
    if (state && mesh && state.mesh !== mesh) {
      state = null;
    }
    if (!state) {
      state = {
        token: tokenEntry,
        mesh: mesh || null,
        profile: animationData?.profile || DEFAULT_MOVEMENT_PROFILE,
        phase: 'idle',
        phaseElapsed: 0,
        activeStep: null,
        stepFinalized: true,
        hasLoopStarted: false,
        pendingFacingAngle: undefined,
        forwardKeys: new Set(),
        backwardKeys: new Set(),
        rotationLeftKeys: new Set(),
        rotationRightKeys: new Set(),
        movementSign: 0,
        lastMoveSign: 0,
        intentHold: false,
        pendingStop: false,
        stopTriggered: false,
        stopElapsed: 0,
        stopMovementElapsed: 0,
        stopMovementTime: 0,
        stopSpeed: 0,
        stopBlendedToIdle: false,
        stopMovementDuration: 0,
        freeStartWorld: null,
        freeLastWorld: null,
        freeDistance: 0,
        lastMoveSpeed: 0,
        rotationDirection: 0,
        rotationSpeed: CONTINUOUS_ROTATION_SPEED,
        fallMode: null,
        fallSpeed: 0,
        fallDuration: 0,
        fallLandingKey: null,
        fallLandingDuration: 0,
        fallLandingThreshold: 0,
        runDuration: 0,
        isSprinting: false,
        movementStyle: 'standard',
        isRunning: false,
        loopActionKey: 'walk',
        startActionKey: null,
        stopActionKey: null,
        startDuration: 0,
        loopDuration: 0,
        stopDuration: 0,
        startMoveDelay:
          animationData?.profile?.startMoveDelay ?? DEFAULT_MOVEMENT_PROFILE.startMoveDelay,
        startBlendLead:
          animationData?.profile?.startToWalkBlendLead ??
          DEFAULT_MOVEMENT_PROFILE.startToWalkBlendLead,
        stopBlendLead:
          animationData?.profile?.stopBlendLead ?? DEFAULT_MOVEMENT_PROFILE.stopBlendLead,
        activeSpeed: animationData?.profile?.walkSpeed ?? DEFAULT_MOVEMENT_PROFILE.walkSpeed,
        activeDirectionSign: 1,
        stopTravelPortionCurrent:
          animationData?.profile?.stopTravelPortion ?? DEFAULT_MOVEMENT_PROFILE.stopTravelPortion,
        pathActive: false,
        pathGoal: null,
        pathSpeedMode: null,
        pathKey: null,
        pathTolerance: 0,
        pathReached: false,
        pathStallTime: 0,
        lastRequestedGoal: null,
        climbQueued: null,
        climbPendingInfo: null,
        climbActive: false,
        climbElapsed: 0,
        climbDuration: 0,
        climbStartWorld: null,
        climbTargetWorld: null,
        climbFinalWorld: null,
        climbData: null,
        climbWallQueue: null,
        climbWallActive: false,
        climbWallElapsed: 0,
        climbWallDuration: 0,
        climbWallStartWorld: null,
        climbWallTargetWorld: null,
        climbWallBaseDuration: 0,
        climbWallAnimationPlaying: false,
        climbRecoverActive: false,
        climbRecoverElapsed: 0,
        climbRecoverDuration: 0,
        climbRecoverStartWorld: null,
        climbRecoverAnchorPosition: null,
        climbRecoverCrouchWorld: null,
        climbRecoverCrouchDrop: 1.0,
        climbRecoverRiseHold: CLIMB_RECOVER_CROUCH_HOLD,
        climbRecoverStandRelease: CLIMB_RECOVER_STAND_RELEASE,
        climbLastWorld: null,
        climbAdvanceActive: false,
        climbAdvanceTargetWorld: null,
        climbContinuationGoal: null,
        __pathingLogFlags: new Set(),
        __resumeProbe: null,
      };
      this._movementStates.set(tokenEntry, state);
    } else {
      if (!state.mesh && mesh) {
        state.mesh = mesh;
      }
      if (!state.profile || state.profile === DEFAULT_MOVEMENT_PROFILE) {
        state.profile = animationData?.profile || DEFAULT_MOVEMENT_PROFILE;
      }
    }

    if (typeof state.pathStallTime !== 'number') {
      state.pathStallTime = 0;
    }
    if (!Object.prototype.hasOwnProperty.call(state, 'lastRequestedGoal')) {
      state.lastRequestedGoal = null;
    }

    return state;
  }

  // ── Movement Intent, Style & Sprint (installed via MovementStyle mixin) ──────────

  // ── World Position & Spatial Utilities (installed via SpatialUtils mixin) ──────────

  // ── Public Movement & Navigation API ─────────────────────────────────────────────

  beginForwardMovement(tokenEntry, sourceKey = '__forward') {
    this._releaseManualAnimationForMovement(tokenEntry);
    this._beginDirectionalMovement(tokenEntry, 1, sourceKey);
  }

  endForwardMovement(tokenEntry, sourceKey = '__forward') {
    this._endDirectionalMovement(tokenEntry, 1, sourceKey);
  }

  beginBackwardMovement(tokenEntry, sourceKey = '__backward') {
    this._releaseManualAnimationForMovement(tokenEntry);
    this._beginDirectionalMovement(tokenEntry, -1, sourceKey);
  }

  endBackwardMovement(tokenEntry, sourceKey = '__backward') {
    this._endDirectionalMovement(tokenEntry, -1, sourceKey);
  }

  setShiftModifier(isActive) {
    if (!this._modifiers) {
      this._modifiers = { shift: false };
    }
    const active = !!isActive;
    if (this._modifiers.shift === active) return;
    this._modifiers.shift = active;
    for (const state of this._movementStates.values()) {
      if (!state) continue;
      const direction = state.movementSign || state.lastMoveSign || state.activeDirectionSign || 1;
      this._syncMovementVariant(state, direction, { force: false });
    }
  }

  // ── Navigation & Path Orchestration (installed via Navigation mixin) ──

  beginRotation(tokenEntry, direction = 1, sourceKey = '__rotate') {
    try {
      if (!tokenEntry) return;
      this._releaseManualAnimationForMovement(tokenEntry);
      const gm = this.gameManager;
      if (!gm || !gm.is3DModeActive?.()) return;
      const state = this._ensureMovementState(tokenEntry);
      if (!state) return;
      const key = sourceKey || `rotate_${direction}`;
      if (direction >= 0) {
        state.rotationRightKeys.add(key);
      } else {
        state.rotationLeftKeys.add(key);
      }
      state.rotationDirection = this._computeRotationIntent(state);
    } catch (_) {
      /* ignore rotation begin errors */
    }
  }

  endRotation(tokenEntry, direction = 1, sourceKey = '__rotate') {
    try {
      const state = this._movementStates.get(tokenEntry);
      if (!state) return;
      const key = sourceKey || `rotate_${direction}`;
      if (direction >= 0) {
        state.rotationRightKeys.delete(key);
      } else {
        state.rotationLeftKeys.delete(key);
      }
      state.rotationDirection = this._computeRotationIntent(state);
      if (
        state.phase === 'idle' &&
        !this._hasActiveIntents(state) &&
        !this._shouldHoldMovementState(state)
      ) {
        this._movementStates.delete(tokenEntry);
      }
    } catch (_) {
      /* ignore rotation end errors */
    }
  }

  _beginDirectionalMovement(tokenEntry, directionSign, sourceKey) {
    try {
      if (!tokenEntry || !directionSign) return;
      const gm = this.gameManager;
      if (!gm || !gm.is3DModeActive?.()) return;
      const mesh = tokenEntry.__threeMesh;
      if (!mesh) return;
      const animationData = this._tokenAnimationData.get(tokenEntry);
      if (!animationData) return;

      const state = this._ensureMovementState(tokenEntry);
      if (!state) return;

      const key = sourceKey || `move_${directionSign}`;
      if (directionSign > 0) {
        state.forwardKeys.add(key);
      } else {
        state.backwardKeys.add(key);
      }

      if (state.phase && state.phase !== 'idle') {
        this._syncMovementVariant(state, directionSign);
      }

      const netIntent = this._recalculateMovementIntent(state);
      if (netIntent === 0) return;

      if (state.phase === 'idle') {
        this._startMovementPhase(state, netIntent);
        return;
      }

      if (state.phase === 'stop') {
        this._abortStopPhase(state);
        this._startMovementPhase(state, netIntent);
        return;
      }

      state.movementSign = netIntent;
      state.lastMoveSign = netIntent;
      state.intentHold = true;
      state.pendingStop = false;
      state.stopTriggered = false;
    } catch (_) {
      /* ignore directional begin errors */
    }
  }

  _endDirectionalMovement(tokenEntry, directionSign, sourceKey) {
    try {
      const state = this._movementStates.get(tokenEntry);
      if (!state) return;
      const key = sourceKey || `move_${directionSign}`;
      if (directionSign > 0) {
        state.forwardKeys.delete(key);
      } else {
        state.backwardKeys.delete(key);
      }

      if (state.phase && state.phase !== 'idle') {
        this._syncMovementVariant(state, directionSign);
      }

      const netIntent = this._recalculateMovementIntent(state);
      if (netIntent === 0) {
        state.intentHold = false;
        state.pendingStop = true;
        state.movementSign = 0;
        if (
          state.phase === 'idle' &&
          !this._hasActiveIntents(state) &&
          !this._shouldHoldMovementState(state)
        ) {
          this._movementStates.delete(tokenEntry);
        }
        return;
      }

      if (state.phase === 'stop') {
        this._abortStopPhase(state);
      }

      if (netIntent !== state.movementSign) {
        state.freeStartWorld = this._resolveTokenWorldPosition(tokenEntry);
        state.freeLastWorld = this._cloneWorld(state.freeStartWorld);
        state.freeDistance = 0;
        state.phaseElapsed = 0;
      }

      state.movementSign = netIntent;
      state.lastMoveSign = netIntent;
      state.intentHold = true;
      state.pendingStop = false;
    } catch (_) {
      /* ignore directional end errors */
    }
  }

  // ── Movement Update Loop & Phase Advancement (installed via MovementPhases mixin) ──────────

  // ── Free Movement & Step Factory (installed via StepFactory mixin) ──────────
  // ── Utility Helpers (installed via SpatialUtils mixin) ──────────

  // ── Vertical Bias, Cleanup & Visual Effects ─────────────────────────────────────────────

  setVerticalBias(v) {
    if (!Number.isFinite(v)) return;
    this._verticalBias = v;
    this.resyncHeights();
  }

  resyncHeights() {
    try {
      const gm = this.gameManager;
      if (!gm || !gm.is3DModeActive?.()) return;
      const tokens = gm.placedTokens || [];
      for (const t of tokens) {
        const mesh = t.__threeMesh;
        if (!mesh) continue;
        this._positionMesh(mesh, t);
      }
    } catch (_) {
      /* ignore */
    }
  }

  onTokenRemoved(tokenEntry) {
    if (!tokenEntry || !tokenEntry.__threeMesh) return;
    const mesh = tokenEntry.__threeMesh;
    if (this._hoverToken === tokenEntry) this._hoverToken = null;
    if (this._selectedToken === tokenEntry) this._selectedToken = null;
    this._clearManualAnimationRevert(tokenEntry);
    this._clearManualAnimationState(tokenEntry);
    this._discardSelectionIndicator(tokenEntry);

    const mixer = this._animationMixers.get(tokenEntry);
    if (mixer) {
      try {
        mixer.stopAllAction();
      } catch (_) {
        /* ignore */
      }
      this._animationMixers.delete(tokenEntry);
    }

    this._rootBones.delete(tokenEntry);
    this._movementStates.delete(tokenEntry);
    this._tokenAnimationData.delete(tokenEntry);

    const gm = this.gameManager;
    const scene = gm?.threeSceneManager?.scene;
    if (scene && typeof scene.remove === 'function') {
      try {
        scene.remove(mesh);
      } catch (_) {
        /* ignore */
      }
    }

    try {
      mesh.traverse?.((child) => {
        if (child.geometry && typeof child.geometry.dispose === 'function') {
          child.geometry.dispose();
        }
        if (child.material) {
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach((mat) => {
            if (mat && typeof mat.dispose === 'function') {
              mat.dispose();
            }
          });
        }
      });
    } catch (_) {
      /* ignore */
    }

    try {
      mesh.geometry && typeof mesh.geometry.dispose === 'function' && mesh.geometry.dispose();
    } catch (_) {
      /* ignore */
    }
    try {
      mesh.material && typeof mesh.material.dispose === 'function' && mesh.material.dispose();
    } catch (_) {
      /* ignore */
    }

    delete tokenEntry.__threeMesh;
    delete tokenEntry.__threeMeshPromise;
    delete tokenEntry[TOKEN_WORLD_LOCK_PROP];
  }

  pickTokenByRay(raycaster) {
    try {
      if (!raycaster) return null;
      const gm = this.gameManager;
      const tokens = gm?.placedTokens || [];
      if (!tokens.length) return null;
      const scratch = this._raycastScratch || (this._raycastScratch = []);
      let closest = null;
      let minDistance = Infinity;

      for (const tokenEntry of tokens) {
        const mesh = tokenEntry?.__threeMesh;
        if (!mesh || mesh.visible === false) {
          continue;
        }
        scratch.length = 0;
        let intersections = null;
        try {
          intersections = raycaster.intersectObject(mesh, true, scratch);
        } catch (_) {
          intersections = scratch;
        }
        if (!intersections || !intersections.length) {
          continue;
        }
        const hit = intersections[0];
        const distance = typeof hit?.distance === 'number' ? hit.distance : Infinity;
        if (distance >= minDistance) {
          continue;
        }
        const point = hit?.point;
        closest = {
          token: tokenEntry,
          distance,
          point: point && typeof point.clone === 'function' ? point.clone() : point || null,
        };
        minDistance = distance;
      }

      scratch.length = 0;
      return closest;
    } catch (_) {
      return null;
    }
  }

  _applyTint(mesh, colorHex) {
    if (!mesh) return;
    const mats = mesh.userData?.__ttTintMaterials || this._collectTintTargets(mesh);
    mesh.userData = mesh.userData || {};
    mesh.userData.__ttTintMaterials = mats;
    if (!mats || !mats.length) return;
    for (const mat of mats) {
      if (!mat) continue;
      if (!this._originalMaterials.has(mat)) {
        this._originalMaterials.set(mat, {
          color: mat.color?.clone?.() || null,
          emissive: mat.emissive?.clone?.() || null,
        });
      }
      try {
        if (mat.color) mat.color.setHex(colorHex);
        if (mat.emissive) mat.emissive.setHex(colorHex);
        mat.needsUpdate = true;
      } catch (_) {
        /* ignore */
      }
    }
  }

  _restoreMaterial(mesh) {
    if (!mesh) return;
    const mats = mesh.userData?.__ttTintMaterials || [];
    for (const mat of mats) {
      if (!mat) continue;
      const snap = this._originalMaterials.get(mat);
      if (!snap) continue;
      try {
        if (snap.color && mat.color) mat.color.copy(snap.color);
        if (snap.emissive && mat.emissive) mat.emissive.copy(snap.emissive);
        mat.needsUpdate = true;
      } catch (_) {
        /* ignore */
      }
    }
  }
}

// Install mixin methods onto prototype.
installAnimationMethods(Token3DAdapter.prototype);
installSelectionMethods(Token3DAdapter.prototype);
installMeshFactoryMethods(Token3DAdapter.prototype);
installPathingLoggerMethods(Token3DAdapter.prototype);
installClimbMethods(Token3DAdapter.prototype);
installFallMethods(Token3DAdapter.prototype);
installNavigationMethods(Token3DAdapter.prototype);
installMovementStyleMethods(Token3DAdapter.prototype);
installMovementPhaseMethods(Token3DAdapter.prototype);
installRootMotionMethods(Token3DAdapter.prototype);
installWorldAuthorityMethods(Token3DAdapter.prototype);
installStepFactoryMethods(Token3DAdapter.prototype);
installSpatialUtilsMethods(Token3DAdapter.prototype);
installResumeProbeMethods(Token3DAdapter.prototype);
