import { FEET_PER_GRID_SQUARE } from '../../../config/TokenMovementConfig.js';
import { GameErrors } from '../../../utils/error/ErrorHandler.js';
import { finishCampaignPhysicalLanding } from '../../../campaigns/SceneWorld.js';

// -- Pause before descent while choosing a reaction --
function _beginRuleFall(state, step) {
  if (state.fallRulesPending) return true;
  const falling = this.gameManager.characterServices.falling;
  const world = this._resolveTokenWorldPosition(state.token);
  const distanceFeet =
    (Math.max(world.y - step.targetWorld.y, 0) * FEET_PER_GRID_SQUARE) /
    this.gameManager.spatial.tileWorldSize;
  state.__fallResumeContext ||= this._captureFallResumeContext(state);
  state.phase = 'fall-choice';
  state.fallRulesPending = true;
  this._lockTokenWorldAuthority(state);
  const data = this._tokenAnimationData.get(state.token);
  if (data.actions[data.current]) data.actions[data.current].paused = true;
  falling
    .begin(state.token, distanceFeet, {
      ignoreFlight: step.ignoreFlight === true,
      catching: step.catchingWall === true,
    })
    .then(
      (context) => {
        if (this._movementStates.get(state.token) !== state || state.activeStep !== step) {
          falling.cancel(state.token);
          return;
        }
        state.fallRules = context;
        state.fallRulesPending = false;
        state.phase = 'walk';
        this._maybeEnterFallPhase(state, data);
      },
      (error) => failRuleFall.call(this, state, error)
    )
    .catch((error) => failRuleFall.call(this, state, error));
  return true;
}

// -- Commit effects only at the completed landing --
function _resolveRuleLanding(state, finish) {
  if (!state.fallRules) return false;
  if (state.fallLandingPending) return true;
  const context = state.fallRules;
  const catchLanding = state.activeStep?.surfaceCatch;
  const landing = catchLanding || state.activeStep?.campaignLanding;
  state.phase = 'fall-resolve';
  state.fallLandingPending = true;
  if (!catchLanding && (context.damage > 0 || context.wasProne || landing))
    haltFallRoute.call(this, state);
  if (!landing) this.recordStablePlacement(state.token);
  this.gameManager.characterServices.falling
    .land(state.token, context, { placement: landing })
    .then(
      async () => {
        if (catchLanding) {
          try {
            this._finishSurfaceCatch(state);
          } catch (error) {
            this.gameManager.campaignMapFailure = new AggregateError(
              [error],
              'The wall catch was saved, but its presentation could not finish. Reload to reopen the saved grip.'
            );
            throw this.gameManager.campaignMapFailure;
          }
          return;
        }
        if (landing) {
          await finishCampaignPhysicalLanding(this.gameManager, state.token, landing);
          return;
        }
        if (this._movementStates.get(state.token) !== state) return;
        state.phase = 'fall';
        state.fallRules = null;
        state.fallLandingPending = false;
        finish();
        this._movementRangeDirty = true;
      },
      (error) => failRuleFall.call(this, state, error)
    )
    .catch((error) => failRuleFall.call(this, state, error));
  return true;
}

function haltFallRoute(state) {
  const job = this._movementRoutes.get(state.token);
  if (job) {
    job.spent = this._getFallMovementCost(job);
    job.segmentCharged = true;
    if (job.redirect) {
      this._landingMovementRedirects ||= new Map();
      this._landingMovementRedirects.set(state.token, {
        destination: job.redirect,
        allowance: Math.max(0, job.settings.speed - job.spent),
      });
      job.continuing = true;
    }
    this._finishPlannedMovement(state.token);
  }
  this._clearPathState(state);
  this._clearResumeProbe(state);
  state.lastRequestedGoal = null;
  state.climbContinuationGoal = null;
  state.__fallResumeContext = null;
  state.forwardKeys.clear();
  state.backwardKeys.clear();
}

function failRuleFall(state, error) {
  if (this._movementStates.get(state.token) !== state) return;
  state.phase = 'fall-error';
  GameErrors.gameState(error, {
    component: 'Token3DAdapter',
    operation: 'fallingRules',
    tokenId: state.token.id,
  });
}

export function installFallingRulesMotionMethods(prototype) {
  prototype._beginRuleFall = _beginRuleFall;
  prototype._resolveRuleLanding = _resolveRuleLanding;
}
