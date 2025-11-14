import SidebarController from '../../src/ui/SidebarController.js';

function buildBasicSidebarDOM() {
  document.body.innerHTML = `
    <div id="sidebar-tabs">
      <button id="dice-tab" class="tab-button" data-tab="dice-log" aria-controls="dice-log-panel"></button>
      <button id="terrain-tab" class="tab-button" data-tab="terrain" aria-controls="terrain-panel"></button>
    </div>
    <div id="dice-log-panel" class="tab-panel"></div>
    <div id="terrain-panel" class="tab-panel"></div>
    <div id="dice-log-content"></div>
    <input type="checkbox" id="terrain-mode-toggle" />
    <div id="terrain-tools" style="display:none;"></div>
    <input type="checkbox" id="placeable-removal-toggle" />
  `;
}

function createGameManagerSpies() {
  return {
    disableTerrainMode: jest.fn(),
    terrainCoordinator: {
      setPlaceablesPanelVisible: jest.fn(),
      setPlaceableRemovalMode: jest.fn(),
    },
  };
}

describe('SidebarController terrain mode auto-reset', () => {
  beforeEach(() => {
    buildBasicSidebarDOM();
    window.richShadingSettings = window.richShadingSettings || {};
  });

  test('turns off terrain mode via change handler when leaving the tab', () => {
    window.gameManager = createGameManagerSpies();

    const toggleEl = document.getElementById('terrain-mode-toggle');
    const toolsEl = document.getElementById('terrain-tools');
    const removalToggle = document.getElementById('placeable-removal-toggle');

    toggleEl.dataset.boundChange = 'true';
    toggleEl.addEventListener('change', () => {
      toolsEl.style.display = toggleEl.checked ? 'block' : 'none';
      if (!toggleEl.checked) {
        window.gameManager.disableTerrainMode();
        window.gameManager.terrainCoordinator.setPlaceableRemovalMode(false);
        removalToggle.checked = false;
      }
    });

    const controller = new SidebarController();
    window.sidebarController = controller;

    // Enter terrain tab and enable terrain mode
    controller.switchTab('terrain');
    toggleEl.checked = true;
    toggleEl.dispatchEvent(new Event('change', { bubbles: true }));
    toolsEl.style.display = 'block';
    removalToggle.checked = true;

    // Switch to another tab should auto-disable terrain mode
    controller.switchTab('dice-log');

    expect(toggleEl.checked).toBe(false);
    expect(toolsEl.style.display).toBe('none');
    expect(removalToggle.checked).toBe(false);
    expect(window.gameManager.disableTerrainMode).toHaveBeenCalledTimes(1);
    expect(window.gameManager.terrainCoordinator.setPlaceableRemovalMode).toHaveBeenCalledWith(
      false
    );
  });

  test('fallback path disables terrain mode even without bound change handler', () => {
    window.gameManager = createGameManagerSpies();

    const controller = new SidebarController();
    window.sidebarController = controller;
    controller.switchTab('terrain');

    const toggleEl = document.getElementById('terrain-mode-toggle');
    const toolsEl = document.getElementById('terrain-tools');
    const removalToggle = document.getElementById('placeable-removal-toggle');

    toggleEl.checked = true;
    toolsEl.style.display = 'block';
    removalToggle.checked = true;

    controller.switchTab('dice-log');

    expect(toggleEl.checked).toBe(false);
    expect(toolsEl.style.display).toBe('none');
    expect(removalToggle.checked).toBe(false);
    expect(window.gameManager.disableTerrainMode).toHaveBeenCalledTimes(1);
    expect(window.gameManager.terrainCoordinator.setPlaceableRemovalMode).toHaveBeenCalledWith(
      false
    );
  });
});
