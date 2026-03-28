/**
 * ResumeProbe.js
 *
 * Resume-probe lifecycle methods extracted from Token3DAdapter.
 * Monitors movement progress after a resume event and retries
 * the last goal if forward progress stalls.
 *
 * Each function is written with `this` semantics so it can be installed
 * on a class prototype via `installResumeProbeMethods()`.
 */

// ── Resume Probe Management ──────────────────────────────────────────────

function _armResumeProbe(state, payload = {}) {
  if (!state) return;
  const now = this._getPathingTimestamp();
  const goal = payload.goal || null;
  let normalizedGoal = null;
  if (goal && (Number.isFinite(goal.gridX) || Number.isFinite(goal.gridY))) {
    normalizedGoal = {
      gridX: Number.isFinite(goal.gridX) ? Math.round(goal.gridX) : null,
      gridY: Number.isFinite(goal.gridY) ? Math.round(goal.gridY) : null,
      options: goal.options ? { ...goal.options } : undefined,
    };
  }
  state.__resumeProbe = {
    startedAt: now,
    resumeSource: payload.resumeSource || null,
    baselineDistance: state.freeDistance || 0,
    goal: normalizedGoal,
    retries: 0,
  };
}

function _clearResumeProbe(state) {
  if (!state) return;
  state.__resumeProbe = null;
}

function _abortResumeProbe(state, reason = 'unknown', extra = {}) {
  if (!state?.__resumeProbe) return;
  const probe = state.__resumeProbe;
  this._logPathing('movement:resume-aborted', {
    token: this._describeTokenForLogs(state.token),
    resumeSource: probe.resumeSource,
    reason,
    retries: probe.retries || 0,
    ...extra,
  });
  state.__resumeProbe = null;
}

function _handleResumeProbeProgress(state) {
  if (!state?.__resumeProbe) return;
  const probe = state.__resumeProbe;
  const distanceDelta = Math.abs((state.freeDistance || 0) - (probe.baselineDistance || 0));
  if (distanceDelta <= 1e-4) {
    return;
  }
  this._logPathing('movement:resume-progress', {
    token: this._describeTokenForLogs(state.token),
    resumeSource: probe.resumeSource,
    distanceDelta,
  });
  state.__resumeProbe = null;
}

function _checkResumeProbe(state) {
  if (!state?.__resumeProbe) return;
  const probe = state.__resumeProbe;
  const now = this._getPathingTimestamp();
  const elapsed = now - (probe.startedAt || 0);
  const distanceDelta = Math.abs((state.freeDistance || 0) - (probe.baselineDistance || 0));

  if (distanceDelta > 1e-4) {
    this._logPathing('movement:resume-progress-delayed', {
      token: this._describeTokenForLogs(state.token),
      resumeSource: probe.resumeSource,
      elapsed,
      distanceDelta,
    });
    state.__resumeProbe = null;
    return;
  }

  const pathActive = !!state.pathActive;
  const intentsActive = !!state.intentHold && state.movementSign !== 0;

  if (elapsed < 600) {
    return;
  }

  const pathInactive = !pathActive || !intentsActive;
  const retryTarget = probe.goal || state.lastRequestedGoal || null;
  if (!retryTarget || probe.retries >= 1) {
    let reason;
    if (probe.retries >= 1) {
      reason = 'no-progress-after-retry';
    } else if (pathInactive) {
      reason = 'path-inactive';
    } else {
      reason = 'no-target';
    }
    this._logPathing('movement:resume-stalled', {
      token: this._describeTokenForLogs(state.token),
      resumeSource: probe.resumeSource,
      reason,
    });
    state.__resumeProbe = null;
    return;
  }

  if (!probe.goal && retryTarget) {
    probe.goal = {
      gridX: retryTarget.gridX ?? null,
      gridY: retryTarget.gridY ?? null,
      options: retryTarget.options ? { ...retryTarget.options } : undefined,
    };
  }

  const retried = this._reissueMaintainedGoal(state, retryTarget, { allowSameTile: true });
  this._logPathing('movement:resume-retry', {
    token: this._describeTokenForLogs(state.token),
    resumeSource: probe.resumeSource,
    goal: retryTarget
      ? { gridX: retryTarget.gridX ?? null, gridY: retryTarget.gridY ?? null }
      : null,
    retried,
    reason: pathInactive ? 'path-inactive' : 'no-progress',
  });

  if (retried) {
    probe.retries += 1;
    probe.startedAt = now;
    probe.baselineDistance = state.freeDistance || 0;
  } else {
    state.__resumeProbe = null;
  }
}

// ── Install ──────────────────────────────────────────────────────────────

export function installResumeProbeMethods(prototype) {
  prototype._armResumeProbe = _armResumeProbe;
  prototype._clearResumeProbe = _clearResumeProbe;
  prototype._abortResumeProbe = _abortResumeProbe;
  prototype._handleResumeProbeProgress = _handleResumeProbeProgress;
  prototype._checkResumeProbe = _checkResumeProbe;
}
