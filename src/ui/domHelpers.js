// Small DOM helpers to keep selectors DRY and consistent across UI modules

/** CSS selector string for all creature token buttons (including remove). */
export const CREATURE_BUTTONS_SELECTOR = '#creature-content button[id^="token-"], #token-remove';

/**
 * Returns a NodeList of all creature buttons.
 * Note: Live queries are fine here since callers iterate immediately.
 */
export function getCreatureButtons() {
  return document.querySelectorAll(CREATURE_BUTTONS_SELECTOR);
}

/** Returns the facing toggle button element if present. */
export function getFacingButton() {
  return document.getElementById('facing-right');
}

/** Returns terrain tool buttons (raise/lower). */
export function getTerrainToolButtons() {
  return {
    raiseBtn: document.getElementById('terrain-raise-btn'),
    lowerBtn: document.getElementById('terrain-lower-btn')
  };
}

/** Returns grid size input elements. */
export function getGridSizeInputs() {
  return {
    widthInput: document.getElementById('grid-width'),
    heightInput: document.getElementById('grid-height')
  };
}

/** Returns the terrain reset button if present. */
export function getTerrainResetButton() {
  return document.querySelector('.terrain-reset');
}

/** Returns elevation scale controls: input range and display span. */
export function getElevationScaleControls() {
  return {
    slider: document.getElementById('elevation-scale-range'),
    valueEl: document.getElementById('elevation-scale-value')
  };
}

/** Returns the brush size display element. */
export function getBrushSizeDisplay() {
  return document.getElementById('brush-size-display');
}

/** Returns the sprite adjust log element. */
export function getSpriteAdjustLogEl() {
  return document.getElementById('sprite-adjust-log');
}
