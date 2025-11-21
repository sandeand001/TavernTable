const TAU = Math.PI * 2;

function normalizeAngleInternal(angle) {
  if (!Number.isFinite(angle)) return 0;
  let normalized = angle;
  while (normalized < -Math.PI) normalized += TAU;
  while (normalized > Math.PI) normalized -= TAU;
  return normalized;
}

export function normalizeAngle(angle) {
  return normalizeAngleInternal(angle);
}

export function rotateToken(c, tokenEntry, deltaRadians) {
  if (!tokenEntry || !Number.isFinite(deltaRadians) || deltaRadians === 0) {
    return null;
  }

  const current = Number.isFinite(tokenEntry.facingAngle) ? tokenEntry.facingAngle : 0;
  const updated = normalizeAngleInternal(current + deltaRadians);
  tokenEntry.facingAngle = updated;

  try {
    const gm = c?.gameManager || null;
    gm?.token3DAdapter?.updateTokenOrientation?.(tokenEntry);
  } catch (_) {
    /* orientation update errors are non-fatal */
  }

  try {
    if (tokenEntry?.creature) {
      tokenEntry.creature.facingAngle = updated;
    }
  } catch (_) {
    /* ignore creature sync issues */
  }

  return updated;
}
