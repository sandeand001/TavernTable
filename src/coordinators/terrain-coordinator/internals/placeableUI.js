// ── Placeable UI State Helpers ───────────────────────────────────
// Extracted from TerrainCoordinator so the coordinator stays as thin wiring.
// Each function receives the coordinator instance (c) as its first parameter.

/** Current selected placeable id (string|null). */
export function getSelectedPlaceable(c) {
  return c._selectedPlaceable || null;
}

/**
 * Set or clear the currently selected placeable id.
 * Blocked while removal mode is active.
 */
export function setSelectedPlaceable(c, id) {
  if (c._placeableRemovalMode) return false;
  if (id === null || id === undefined || id === '') {
    c._selectedPlaceable = null;
    return true;
  }
  if (typeof id === 'string') {
    c._selectedPlaceable = id;
    c._placeableRemovalMode = false;
    return true;
  }
  return false;
}

/** Whether the placeables panel is currently visible to the user. */
export function isPlaceablesPanelVisible(c) {
  return !!c._placeablesPanelVisible;
}

/** Inform coordinator of placeables panel visibility. */
export function setPlaceablesPanelVisible(c, visible) {
  c._placeablesPanelVisible = !!visible;
  if (!c._placeablesPanelVisible) {
    c._selectedPlaceable = null;
  }
}

/** Enable/disable placeable removal mode (clears selected placeable). */
export function setPlaceableRemovalMode(c, enabled) {
  c._placeableRemovalMode = !!enabled;
  if (c._placeableRemovalMode) {
    c._selectedPlaceable = null;
    if (typeof window !== 'undefined') {
      window.selectedTerrainPlaceable = null;
    }
  }
}

/** Returns true if placeable removal mode is active. */
export function isPlaceableRemovalMode(c) {
  return !!c._placeableRemovalMode;
}
