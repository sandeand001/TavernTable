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
    lowerBtn: document.getElementById('terrain-lower-btn'),
  };
}

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

/** Returns the brush size display element. */
export function getBrushSizeDisplay() {
  return document.getElementById('brush-size-display');
}

/** Returns the sprite adjust log element. */
export function getSpriteAdjustLogEl() {
  return document.getElementById('sprite-adjust-log');
}

/** Returns the token info element used for UI hints. */
export function getTokenInfoEl() {
  return document.getElementById('token-info');
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

/** Returns the auto-apply offsets toggle button. */
export function getAutoApplyButton() {
  return document.getElementById('toggle-auto-apply');
}

/** Returns dice UI elements. */
export function getDiceCountEl() {
  return document.getElementById('dice-count');
}

export function getDiceResultEl() {
  return document.getElementById('dice-result');
}

/** Returns all dice roll buttons in the dice panel. */
export function getDiceButtons() {
  // Only the top dice panel's buttons; does not include sidebar controls
  return document.querySelectorAll('#dice-panel button[data-sides]');
}

/** Returns the dice panel clear-history button. */
export function getDiceClearButton() {
  return document.querySelector('#dice-log-panel .panel-footer .clear-button');
}

/** Returns sprite nudge and adjust buttons. */
export function getSpriteAdjustButtons() {
  return {
    up: document.getElementById('nudge-up'),
    down: document.getElementById('nudge-down'),
    left: document.getElementById('nudge-left'),
    right: document.getElementById('nudge-right'),
    center: document.getElementById('nudge-center'),
    save: document.getElementById('save-offset'),
    reset: document.getElementById('reset-offset'),
    auto: document.getElementById('toggle-auto-apply'),
  };
}

/** Returns grid apply/reset zoom buttons. */
export function getGridActionButtons() {
  return {
    applySize: document.getElementById('apply-grid-size'),
    resetZoom: document.getElementById('reset-zoom'),
  };
}

/** Returns the terrain height display element. */
export function getTerrainHeightDisplay() {
  return document.getElementById('terrain-height-display');
}

/** Returns the main game container element. */
export function getGameContainer() {
  return document.getElementById('game-container');
}

/** Returns the dice log content container element. */
export function getDiceLogContentEl() {
  return document.getElementById('dice-log-content');
}

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

/** Returns NodeList of terrain height scale marks. */
export function getScaleMarks() {
  return document.querySelectorAll('.scale-mark');
}

/** Returns the tab navigation buttons. */
export function getTabButtons() {
  return document.querySelectorAll('.tab-button');
}

/** Returns the tab panels. */
export function getTabPanels() {
  return document.querySelectorAll('.tab-panel');
}

/** Returns grid opacity slider and its value element (next sibling). */
export function getGridOpacityControl() {
  const slider = document.getElementById('grid-opacity');
  let valueEl = document.getElementById('grid-opacity-value');
  if (!valueEl && slider?.nextElementSibling?.classList?.contains('range-value')) {
    valueEl = slider.nextElementSibling;
  }
  return { slider, valueEl };
}

/** Returns animation speed slider and its value element (next sibling). */
export function getAnimationSpeedControl() {
  const slider = document.getElementById('animation-speed');
  let valueEl = document.getElementById('animation-speed-value');
  if (!valueEl && slider?.nextElementSibling?.classList?.contains('range-value')) {
    valueEl = slider.nextElementSibling;
  }
  return { slider, valueEl };
}

/** Returns the settings toggle controlling the 3D grid overlay visibility. */
export function getVisualGridToggle() {
  return document.getElementById('visual-grid-toggle');
}

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

/** Returns the root element where terrain placeable items should be injected. */
export function getTerrainPlaceablesRoot() {
  return document.getElementById('terrain-placeables-root');
}

/** Helper to create a placeable button by id (used by Sidebar builder) */
export function createPlaceableButton(id, label, imgSrc) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'placeable-btn';
  btn.dataset.placeable = id;
  btn.title = label || id;
  // Always include an img element so later async thumbnail generation has a target.
  const img = document.createElement('img');
  img.className = 'placeable-preview';
  img.alt = label || id;
  // Use provided src or a 1x1 transparent pixel placeholder.
  img.src =
    imgSrc ||
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9YkZyy8AAAAASUVORK5CYII=';
  btn.appendChild(img);
  const span = document.createElement('span');
  span.className = 'placeable-label';
  span.textContent = label || id;
  btn.appendChild(span);
  return btn;
}

/** Error UI helpers */
export function getErrorContainer() {
  return document.getElementById('tavern-error-container');
}

export function getErrorStylesEl() {
  return document.getElementById('tavern-error-styles');
}
