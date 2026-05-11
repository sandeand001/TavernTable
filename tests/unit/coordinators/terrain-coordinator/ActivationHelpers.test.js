import { ActivationHelpers } from '../../../../src/coordinators/terrain-coordinator/ActivationHelpers.js';

describe('ActivationHelpers.disableTerrainMode', () => {
  test('clears flags, applies base integration, resets UI, and repaints biome', () => {
    const c = {
      isTerrainModeActive: true,
      isDragging: true,
      lastModifiedCell: '0,0',
      gameManager: {},
      applyTerrainToBaseGrid: jest.fn(),
      resetHeightIndicator: jest.fn(),
      applyBiomePaletteToBaseGrid: jest.fn(),
    };

    global.window = global.window || {};
    window.selectedBiome = 'forest';

    const helpers = new ActivationHelpers(c);
    helpers.disableTerrainMode();

    // Flags cleared
    expect(c.isTerrainModeActive).toBe(false);
    expect(c.isDragging).toBe(false);
    expect(c.lastModifiedCell).toBeNull();

    // Base integration
    expect(c.applyTerrainToBaseGrid).toHaveBeenCalled();

    // UI reset
    expect(c.resetHeightIndicator).toHaveBeenCalled();

    // Biome repaint called when a biome is selected and terrain mode is off
    expect(c.applyBiomePaletteToBaseGrid).toHaveBeenCalled();
  });
});
