import { ActivationHelpers } from '../../../../src/coordinators/terrain-coordinator/ActivationHelpers.js';

describe('ActivationHelpers.enableTerrainMode', () => {
  test('validates, activates, and loads state in order', () => {
    const callOrder = [];
    const mk = (name) => jest.fn(() => callOrder.push(name));

    const coordinator = {
      // methods proxied by ActivationHelpers
      _activateTerrainMode: mk('activateTerrainMode'),
      _loadTerrainStateAndDisplay: mk('loadTerrainStateAndDisplay'),
      _validateTerrainSystemForActivation: mk('validateTerrainSystemForActivation'),
      // state used for logging (not essential but keeps message consistent)
      brush: { tool: 'raise', brushSize: 1 },
    };

    const helpers = new ActivationHelpers(coordinator);
    expect(() => helpers.enableTerrainMode()).not.toThrow();

    // Verify core steps were called
    expect(coordinator._validateTerrainSystemForActivation).toHaveBeenCalledTimes(1);
    expect(coordinator._activateTerrainMode).toHaveBeenCalledTimes(1);
    expect(coordinator._loadTerrainStateAndDisplay).toHaveBeenCalledTimes(1);

    // Verify order of operations (PIXI container steps removed per ADR-0001)
    expect(callOrder).toEqual([
      'validateTerrainSystemForActivation',
      'activateTerrainMode',
      'loadTerrainStateAndDisplay',
    ]);
  });
});
