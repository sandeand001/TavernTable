import { getDiceButtons, getGridActionButtons, getTerrainModeEls } from '../../src/ui/domHelpers.js';

/**
 * Minimal DOM wiring smoke test to ensure selectors don't throw
 */
describe('DOM helpers selectors', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div>
    <div id="dice-panel">
          <button data-sides="4"></button>
          <button data-sides="6"></button>
        </div>
        <button id="apply-grid-size"></button>
        <button id="reset-zoom"></button>
    <input id="terrain-mode-toggle" type="checkbox" />
        <div id="terrain-tools" style="display:none"></div>
      </div>
    `;
  });

  test('getDiceButtons returns elements with data-sides', () => {
  const btns = getDiceButtons();
  expect(btns).toBeTruthy();
  expect(btns.length).toBe(2);
  expect(btns[0].getAttribute('data-sides')).toBe('4');
  });

  test('getGridActionButtons returns apply/reset buttons', () => {
    const { applySize, resetZoom } = getGridActionButtons();
    expect(applySize).toBeInstanceOf(HTMLElement);
    expect(resetZoom).toBeInstanceOf(HTMLElement);
  });

  test('getTerrainModeEls returns toggle and tools', () => {
  const { toggleEl, toolsEl } = getTerrainModeEls();
  expect(toggleEl).not.toBeNull();
  expect(toolsEl).not.toBeNull();
  });
});
