/**
 * UIController elevation slider smoke test
 * Verifies slider updates display text and triggers TerrainCoordinator.setElevationScale
 */

// Import the module to register DOMContentLoaded listener and expose handlers
import '../../src/ui/UIController.js';

function setupDOM() {
  document.body.innerHTML = `
    <div id="terrain-tools" style="display:none"></div>
    <input id="elevation-scale-range" type="range" min="0" max="20" value="5" />
    <span id="elevation-scale-value"></span>
    <div id="creature-content"></div>
  `;
}

describe('UI elevation scale slider', () => {
  beforeEach(() => {
    setupDOM();
    // Minimal gameManager with terrainCoordinator stub
    window.gameManager = {
      terrainCoordinator: {
        getElevationScale: jest.fn(() => 5),
        setElevationScale: jest.fn()
      }
    };
  });

  test('input event updates value text and debounced call is made on change', () => {
    jest.useFakeTimers();
    const slider = document.getElementById('elevation-scale-range');
    const valueEl = document.getElementById('elevation-scale-value');

    // Manually call attachDynamicUIHandlers by dispatching DOMContentLoaded
    document.dispatchEvent(new Event('DOMContentLoaded'));

    // Simulate user sliding
    slider.value = '9';
    slider.dispatchEvent(new Event('input', { bubbles: true }));

    // Value text should update immediately
    expect(valueEl.textContent).toContain('9');

    // Debounce not elapsed yet, no call
    expect(window.gameManager.terrainCoordinator.setElevationScale).not.toHaveBeenCalled();

    // Advance timers to flush debounce
    jest.advanceTimersByTime(150);
    expect(window.gameManager.terrainCoordinator.setElevationScale).toHaveBeenCalledWith(9);

    jest.useRealTimers();
  });
});
