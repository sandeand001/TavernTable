// Small DOM helpers to keep selectors DRY and consistent across UI modules

// ── Creature & Token Selectors ─────────────────────────
/** CSS selector string for all creature token buttons (including remove). */
const CREATURE_BUTTONS_SELECTOR = '#creature-content button[id^="token-"], #token-remove';

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

// ── Terrain Controls ──────────────────────────────────
/** Returns terrain tool buttons (raise/lower). */
export function getTerrainToolButtons() {
  return {
    raiseBtn: document.getElementById('terrain-raise-btn'),
    lowerBtn: document.getElementById('terrain-lower-btn'),
  };
}

// ── Grid Controls ──────────────────────────────────────
/** Returns grid size input elements. */
export function getGridSizeInputs() {
  return {
    widthInput: document.getElementById('grid-width'),
    heightInput: document.getElementById('grid-height'),
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
    valueEl: document.getElementById('elevation-scale-value'),
  };
}

/** Returns the tree density slider and display span. */
export function getTreeDensityControls() {
  return {
    slider: document.getElementById('tree-density-slider'),
    valueEl: document.getElementById('tree-density-value'),
  };
}

/** Returns the brush size display element. */
export function getBrushSizeDisplay() {
  return document.getElementById('brush-size-display');
}

/** Returns creature panel elements: the collapsible content and arrow. */
export function getCreaturePanelEls() {
  return {
    contentEl: document.getElementById('creature-content'),
    arrowEl: document.getElementById('creature-arrow'),
  };
}

/** Returns terrain mode elements: the toggle checkbox and tools container. */
export function getTerrainModeEls() {
  return {
    toggleEl: document.getElementById('terrain-mode-toggle'),
    toolsEl: document.getElementById('terrain-tools'),
  };
}

/** Returns a specific token button by creature type or 'remove'. */
export function getTokenButtonByType(tokenType) {
  return document.getElementById(`token-${tokenType}`);
}

// ── Dice UI ────────────────────────────────────────────
/** Returns all dice roll buttons in the dice panel. */
export function getDiceButtons() {
  // Only the top dice panel's buttons; does not include sidebar controls
  return document.querySelectorAll('#dice-panel button[data-sides]');
}

// ── Grid Actions & Display ─────────────────────────────
/** Returns grid apply/reset zoom buttons. */
export function getGridActionButtons() {
  return {
    applySize: document.getElementById('apply-grid-size'),
    resetZoom: document.getElementById('reset-zoom'),
  };
}

/** Returns the main game container element. */
export function getGameContainer() {
  return document.getElementById('game-container');
}

/** Returns the dice log content container element. */
export function getDiceLogContentEl() {
  return document.getElementById('dice-log-content');
}

// ── Shading & Biome Controls ───────────────────────────
/** Returns the rich shading controls elements (shading intensity, density, shoreline sand, perf). */
export function getShadingControls() {
  return {
    shadeToggle: document.getElementById('rich-shading-toggle'),
    intensity: document.getElementById('shading-intensity'),
    intensityVal: document.getElementById('shading-intensity-value'),
    density: document.getElementById('pattern-density'),
    densityVal: document.getElementById('pattern-density-value'),
    shore: document.getElementById('shoreline-sand-strength'),
    shoreVal: document.getElementById('shoreline-sand-strength-value'),
    perf: document.getElementById('performance-simplify'),
  };
}

/** Returns the biome menu root element. */
export function getBiomeRootEl() {
  return document.getElementById('biome-menu-root');
}

// ── Tab Navigation ─────────────────────────────────────
/** Returns the tab navigation buttons. */
export function getTabButtons() {
  return document.querySelectorAll('.tab-button');
}

/** Returns the tab panels. */
export function getTabPanels() {
  return document.querySelectorAll('.tab-panel');
}

// ── Slider Controls ───────────────────────────────────
/** Returns grid opacity slider and its value element (next sibling). */
export function getGridOpacityControl() {
  const slider = document.getElementById('grid-opacity');
  let valueEl = document.getElementById('grid-opacity-value');
  if (!valueEl && slider?.nextElementSibling?.classList?.contains('range-value')) {
    valueEl = slider.nextElementSibling;
  }
  return { slider, valueEl };
}

/** Returns sun time slider and associated value element. */
export function getSunTimeControl() {
  const slider = document.getElementById('sun-time-range');
  let valueEl = document.getElementById('sun-time-value');
  if (!valueEl && slider?.nextElementSibling?.classList?.contains('range-value')) {
    valueEl = slider.nextElementSibling;
  }
  return { slider, valueEl };
}

/** Returns the settings toggle controlling the 3D grid overlay visibility. */
export function getVisualGridToggle() {
  return document.getElementById('visual-grid-toggle');
}

// ── Biome Buttons ──────────────────────────────────────
/** Returns all biome button elements under the biome root (or provided root). */
export function getBiomeButtons(root = getBiomeRootEl()) {
  if (!root) return [];
  return root.querySelectorAll('.biome-btn');
}

/** Returns a specific biome button by biome key under the biome root (or provided root). */
export function getBiomeButtonByKey(biomeKey, root = getBiomeRootEl()) {
  if (!root) return null;
  return root.querySelector(`.biome-btn[data-biome="${biomeKey}"]`);
}

// ── Placeable UI ───────────────────────────────────────
/** Returns the root element where terrain placeable items should be injected. */
export function getTerrainPlaceablesRoot() {
  return document.getElementById('terrain-placeables-root');
}
