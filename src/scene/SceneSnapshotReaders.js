export function captureCameraView(manager) {
  return {
    target: manager.getCameraTarget(),
    yaw: manager._isoYaw,
    pitch: manager._isoPitch,
    zoom: manager._targetZoom,
    isometric: manager._isoMode,
    topDown: manager._topDownView === true,
    manualLock: manager._isoManualLock === true,
    orbit: manager._savedOrbitView ? { ...manager._savedOrbitView } : null,
  };
}

export function readPlaceablePlacements(pool) {
  const placements = [];
  for (const metadata of pool._metadata.values()) {
    for (const entry of metadata.values()) {
      if (!entry.source)
        throw new Error(
          'A placeable is missing its original placement record; the board was not overwritten'
        );
      placements.push({ ...entry.source, persistedScale: { ...entry.scale } });
    }
  }
  return placements;
}
