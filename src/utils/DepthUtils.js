// DepthUtils.js - Consistent depth ordering for isometric diagonal + tie-breakers

export const DIAG_WEIGHT = 10000; // primary: diagonal depth (gx + gy)
export const X_TIE_WEIGHT = 10; // tie-breaker across a diagonal: higher gx in front

// Type biases: small integers; larger means drawn on top if all spatial keys are equal
export const TYPE_BIAS = {
  path: 2,
  plant: 8,
  token: 9,
  structure: 60,
};

export function computeDepthKey(gx, gy, typeBias = 0) {
  return (gx + gy) * DIAG_WEIGHT + gx * X_TIE_WEIGHT + typeBias;
}

export function withOverlayRaise(terrainManager, depthKey) {
  try {
    const previewZ = terrainManager?.previewContainer?.zIndex;
    const overlayZ = terrainManager?.terrainContainer?.zIndex;
    const baseAboveOverlay = Number.isFinite(previewZ)
      ? previewZ + 1
      : Number.isFinite(overlayZ)
        ? overlayZ + 11
        : null;
    return Number.isFinite(baseAboveOverlay) ? baseAboveOverlay + depthKey : depthKey;
  } catch (_) {
    return depthKey;
  }
}
