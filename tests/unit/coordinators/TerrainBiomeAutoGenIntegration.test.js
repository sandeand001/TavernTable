import { TerrainEngine } from '../../../src/terrain/TerrainEngine.js';

describe('TerrainEngine.generateBiomeElevationIfFlat', () => {
  test('generates elevations on a non-square flat grid and saves the committed result', () => {
    const e = new TerrainEngine(5, 3);
    expect(
      e
        .save()
        .heights.flat()
        .every((height) => height === 0)
    ).toBe(true);
    expect(e.generateBiomeElevationIfFlat('hills', { seed: 12345 })).toBe(true);
    expect(
      e
        .save()
        .heights.flat()
        .some((height) => height !== 0)
    ).toBe(true);
  });

  test('preserves edited terrain and refuses generation during active terrain editing', () => {
    const e = new TerrainEngine(3, 3);
    expect(e.generateBiomeElevationIfFlat('grassland', { seed: 1 })).toBe(true);
    const before = e.save();
    expect(e.generateBiomeElevationIfFlat('grassland', { seed: 2 })).toBe(false);
    expect(e.save()).toEqual(before);
    e.activate();
    expect(e.generateBiomeElevationIfFlat('grassland', { seed: 3 })).toBe(false);
    expect(e.save()).toEqual(before);
  });
});
