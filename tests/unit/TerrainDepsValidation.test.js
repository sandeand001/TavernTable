import { TerrainCoordinator } from '../../src/coordinators/TerrainCoordinator.js';
import {
  GameValidators as DefaultGV,
  Sanitizers as DefaultSZ,
} from '../../src/utils/Validation.js';

describe('TerrainCoordinator dependency resolution', () => {
  test('falls back to module defaults and attaches them when globals missing', () => {
    const prevGV = global.GameValidators;
    const prevSZ = global.Sanitizers;
    try {
      // Temporarily remove globals to simulate browser missing globals
      delete global.GameValidators;
      delete global.Sanitizers;

      const c = new TerrainCoordinator({ cols: 1, rows: 1 });
      expect(c.GameValidators).toBe(DefaultGV);
      expect(c.Sanitizers).toBe(DefaultSZ);
    } finally {
      // Restore globals to not affect other tests
      if (prevGV) global.GameValidators = prevGV;
      else delete global.GameValidators;
      if (prevSZ) global.Sanitizers = prevSZ;
      else delete global.Sanitizers;
    }
  });
});
