import { attach3DControls } from '../../../src/ui/controls/Hybrid3DControls.js';

test('shows the current GPU when settings attach after initialization without duplicating controls', () => {
  const previousManager = window.gameManager;
  const panel = document.createElement('div');
  panel.id = 'settings-panel';
  document.body.appendChild(panel);
  window.gameManager = {
    is3DModeActive: () => false,
    getViewMode: () => 'isometric',
    threeSceneManager: {
      getGraphicsStatus: () => 'GPU: NVIDIA GeForce RTX 5070',
    },
  };
  try {
    attach3DControls();
    attach3DControls();

    const status = document.getElementById('graphics-status');
    expect(status.textContent).toBe('GPU: NVIDIA GeForce RTX 5070');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(panel.querySelectorAll('#graphics-status')).toHaveLength(1);
  } finally {
    panel.remove();
    if (previousManager === undefined) delete window.gameManager;
    else window.gameManager = previousManager;
  }
});

test('player camera instructions describe character-follow rather than map panning', () => {
  const previousManager = window.gameManager;
  const panel = document.createElement('div');
  panel.id = 'settings-panel';
  document.body.appendChild(panel);
  window.gameManager = {
    is3DModeActive: () => false,
    playerInput: {},
    getViewMode: () => 'isometric',
    threeSceneManager: {},
  };
  try {
    attach3DControls();
    const instructions = panel.querySelector('[data-camera-instructions]').textContent;
    expect(instructions).toContain('locked to the active character');
    expect(instructions).not.toContain('left-drag');
  } finally {
    panel.remove();
    if (previousManager === undefined) delete window.gameManager;
    else window.gameManager = previousManager;
  }
});
