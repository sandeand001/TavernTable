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
