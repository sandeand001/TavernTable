import { ActivationHelpers } from '../../src/coordinators/terrain-coordinator/ActivationHelpers.js';

describe('ActivationHelpers.enableTerrainMode', () => {
  test('validates, resets container, prepares grid, activates, and loads state in order', () => {
    const callOrder = [];
    const mk = (name) => jest.fn(() => callOrder.push(name));

    const coordinator = {
      // methods proxied by ActivationHelpers
      _prepareBaseGridForEditing: mk('prepareBaseGridForEditing'),
      _resetTerrainContainerSafely: mk('resetTerrainContainerSafely'),
      _validateContainerIntegrity: mk('validateContainerIntegrity'),
      _activateTerrainMode: mk('activateTerrainMode'),
      _loadTerrainStateAndDisplay: mk('loadTerrainStateAndDisplay'),
      _validateTerrainSystemForActivation: mk('validateTerrainSystemForActivation'),
      // state used for logging (not essential but keeps message consistent)
      brush: { tool: 'raise', brushSize: 1 },
      terrainManager: { dummy: true },
    };

    const helpers = new ActivationHelpers(coordinator);
    expect(() => helpers.enableTerrainMode()).not.toThrow();

    // Verify each step was called exactly once
    expect(coordinator._validateTerrainSystemForActivation).toHaveBeenCalledTimes(1);
    expect(coordinator._resetTerrainContainerSafely).toHaveBeenCalledTimes(1);
    expect(coordinator._validateContainerIntegrity).toHaveBeenCalledTimes(1);
    expect(coordinator._prepareBaseGridForEditing).toHaveBeenCalledTimes(1);
    expect(coordinator._activateTerrainMode).toHaveBeenCalledTimes(1);
    expect(coordinator._loadTerrainStateAndDisplay).toHaveBeenCalledTimes(1);

    // Verify order of operations
    expect(callOrder).toEqual([
      'validateTerrainSystemForActivation',
      'resetTerrainContainerSafely',
      'validateContainerIntegrity',
      'prepareBaseGridForEditing',
      'activateTerrainMode',
      'loadTerrainStateAndDisplay',
    ]);
  });
});
