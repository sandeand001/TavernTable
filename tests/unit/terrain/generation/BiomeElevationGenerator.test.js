import { createHash } from 'node:crypto';
import { TERRAIN_CONFIG } from '../../../../src/config/terrain/TerrainConstants.js';
import {
  BIOME_GENERATION_FAMILIES,
  normalizeBiomeGenerationChoices,
} from '../../../../src/config/biome/BiomeGenerationFamilies.js';
import { TerrainHeightUtils } from '../../../../src/utils/terrain/TerrainHeightUtils.js';
import {
  isAllDefaultHeight,
  generateBiomeElevationField,
  applyBiomeElevationIfFlat,
} from '../../../../src/terrain/generation/BiomeElevationGenerator.js';
import { TerrainEngine } from '../../../../src/terrain/TerrainEngine.js';
import { structureBounds } from '../../../../src/terrain/ConstructionBlueprints.js';
import { buildSurfaceRange, getSurfaceRoute } from '../../../../src/terrain/SurfaceNavigation.js';

function allWithin(arr, min, max) {
  for (let y = 0; y < arr.length; y++) {
    for (let x = 0; x < arr[0].length; x++) {
      const v = arr[y][x];
      if (v < min || v > max) return false;
    }
  }
  return true;
}

function averageSlope(heights) {
  let total = 0;
  let edges = 0;
  for (let y = 0; y < heights.length; y++) {
    for (let x = 0; x < heights[y].length; x++) {
      if (x > 0) {
        total += Math.abs(heights[y][x] - heights[y][x - 1]);
        edges++;
      }
      if (y > 0) {
        total += Math.abs(heights[y][x] - heights[y - 1][x]);
        edges++;
      }
    }
  }
  return total / edges;
}

function averageHeight(heights) {
  const cells = heights.flat();
  return cells.reduce((sum, height) => sum + height, 0) / cells.length;
}

function variantsWithControl(id) {
  return BIOME_GENERATION_FAMILIES.flatMap((family) => {
    const field = family.fields.find((entry) => entry.id === id);
    if (!field) return [];
    return family.variants
      .filter(({ key }) => !field.variants || field.variants.includes(key))
      .map(({ key }) => key);
  });
}

describe('BiomeElevationGenerator', () => {
  test('isAllDefaultHeight detects flat arrays', () => {
    const a = TerrainHeightUtils.createHeightArray(3, 4, TERRAIN_CONFIG.DEFAULT_HEIGHT);
    expect(isAllDefaultHeight(a)).toBe(true);
    a[1][2] = TERRAIN_CONFIG.DEFAULT_HEIGHT + 1;
    expect(isAllDefaultHeight(a)).toBe(false);
  });

  test('generateBiomeElevationField returns correct dimensions and bounds', () => {
    const rows = 16,
      cols = 20;
    const arr = generateBiomeElevationField('grassland', rows, cols, { seed: 42 });
    expect(arr.length).toBe(rows);
    expect(arr[0].length).toBe(cols);
    expect(allWithin(arr, TERRAIN_CONFIG.MIN_HEIGHT, TERRAIN_CONFIG.MAX_HEIGHT)).toBe(true);
  });

  test('builds an unsmoothed field with one height matrix and identical output', () => {
    const expected = generateBiomeElevationField('hills', 24, 28, { seed: 42 });
    const allocation = jest.spyOn(TerrainHeightUtils, 'createHeightArray');
    try {
      const actual = generateBiomeElevationField('hills', 24, 28, { seed: 42 });
      expect(actual).toEqual(expected);
      expect(allocation).toHaveBeenCalledTimes(1);
    } finally {
      allocation.mockRestore();
    }
  });

  test('uses only one smoothing scratch matrix and preserves the smoothed field', () => {
    const expected = generateBiomeElevationField('grassland', 24, 28, { seed: 42 });
    const allocation = jest.spyOn(TerrainHeightUtils, 'createHeightArray');
    try {
      const actual = generateBiomeElevationField('grassland', 24, 28, { seed: 42 });
      expect(actual).toEqual(expected);
      expect(allocation).toHaveBeenCalledTimes(2);
    } finally {
      allocation.mockRestore();
    }
  });

  test('deterministic with same seed', () => {
    const a1 = generateBiomeElevationField('hills', 12, 12, { seed: 123 });
    const a2 = generateBiomeElevationField('hills', 12, 12, { seed: 123 });
    expect(a1).toEqual(a2);
  });

  test.each(variantsWithControl('roughness'))(
    'the surface-character control makes rugged %s rougher than smooth terrain',
    (biomeKey) => {
      let smoothSlope = 0;
      let ruggedSlope = 0;
      for (const seed of [1, 7, 42]) {
        const generate = (roughness) =>
          generateBiomeElevationField(biomeKey, 25, 25, {
            ...normalizeBiomeGenerationChoices(biomeKey, { variant: biomeKey, roughness }),
            seed,
          });
        const smooth = generate('smooth');
        const rugged = generate('rugged');
        const ruggedCells = rugged.flat();
        const changes = smooth.flat().filter((height, index) => height !== ruggedCells[index]);
        expect(changes.length).toBeGreaterThan(25 * 25 * 0.1);
        smoothSlope += averageSlope(smooth);
        ruggedSlope += averageSlope(rugged);
      }
      expect(ruggedSlope).toBeGreaterThan(smoothSlope);
    }
  );

  test.each(['grassland', 'hills', 'forestConifer'])(
    'balanced surface character preserves the default %s terrain',
    (biomeKey) => {
      expect(generateBiomeElevationField(biomeKey, 25, 25, { seed: 42, roughness: 1 })).toEqual(
        generateBiomeElevationField(biomeKey, 25, 25, { seed: 42 })
      );
    }
  );

  test.each([15, 50])('surface character remains deterministic on a %s-square map', (size) => {
    const options = { seed: 7, roughness: 1.35 };
    const rugged = generateBiomeElevationField('grassland', size, size, options);
    expect(rugged).toEqual(generateBiomeElevationField('grassland', size, size, options));
    expect(rugged).not.toEqual(
      generateBiomeElevationField('grassland', size, size, { ...options, roughness: 0.75 })
    );
    expect(allWithin(rugged, TERRAIN_CONFIG.MIN_HEIGHT, TERRAIN_CONFIG.MAX_HEIGHT)).toBe(true);
  });

  test.each(['tundra', 'packIce', 'screeSlope'])(
    'terrain relief changes the actual elevation range of %s',
    (biomeKey) => {
      for (const size of [25, 50]) {
        const engine = new TerrainEngine(size, size);
        for (const seed of [1, 7, 42]) {
          const generate = (relief) =>
            engine.planBiomeGeneration(biomeKey, {
              ...normalizeBiomeGenerationChoices(biomeKey, { variant: biomeKey, relief }),
              seed,
              structures: false,
            }).heights;
          const gentle = generate('gentle').flat();
          const balanced = generate('balanced').flat();
          const dramatic = generate('dramatic').flat();
          const meanMagnitude = (heights) =>
            heights.reduce((total, height) => total + Math.abs(height), 0) / heights.length;
          expect(Math.max(...dramatic) - Math.min(...dramatic)).toBeGreaterThan(
            Math.max(...gentle) - Math.min(...gentle)
          );
          expect(meanMagnitude(balanced)).toBeGreaterThan(meanMagnitude(gentle));
          expect(meanMagnitude(dramatic)).toBeGreaterThan(meanMagnitude(balanced));
        }
      }
    }
  );

  test.each(['dry', 'balanced', 'wet'])(
    'Salt Flats relief changes the actual terrain while remaining flat in %s conditions',
    (moisture) => {
      for (const size of [5, 12, 25, 50])
        for (const seed of [0, 1, 2, 3, 7, 42, 99, 12345]) {
          const generate = (relief) =>
            new TerrainEngine(size, size).planBiomeGeneration('saltFlats', {
              ...normalizeBiomeGenerationChoices('saltFlats', {
                variant: 'saltFlats',
                relief,
                moisture,
              }),
              seed,
              structures: false,
            }).heights;
          const gentle = generate('gentle');
          const balanced = generate('balanced');
          const dramatic = generate('dramatic');
          const balancedCells = balanced.flat();
          const dramaticCells = dramatic.flat();
          expect(
            gentle.flat().filter((height, index) => height !== balancedCells[index]).length
          ).toBeGreaterThan(size * size * 0.05);
          expect(
            balancedCells.filter((height, index) => height !== dramaticCells[index]).length
          ).toBeGreaterThan(size * size * 0.05);
          expect(
            gentle.flat().filter((height, index) => height !== dramaticCells[index]).length
          ).toBeGreaterThan(size * size * 0.1);
          expect(averageSlope(dramatic)).toBeGreaterThan(averageSlope(gentle));
          expect(Math.max(...dramaticCells) - Math.min(...dramaticCells)).toBeLessThanOrEqual(4);
          let maxStep = 0;
          for (let y = 0; y < size; y++)
            for (let x = 0; x < size; x++) {
              if (x > 0) maxStep = Math.max(maxStep, Math.abs(dramatic[y][x] - dramatic[y][x - 1]));
              if (y > 0) maxStep = Math.max(maxStep, Math.abs(dramatic[y][x] - dramatic[y - 1][x]));
            }
          expect(maxStep).toBeLessThanOrEqual(1);
        }
    }
  );

  test.each(['gentle', 'balanced', 'dramatic'])(
    'Salt Flats moisture stays directional at %s relief',
    (relief) => {
      for (const size of [5, 25])
        for (const seed of [0, 7, 42, 99]) {
          const generate = (moisture) =>
            new TerrainEngine(size, size).planBiomeGeneration('saltFlats', {
              ...normalizeBiomeGenerationChoices('saltFlats', {
                variant: 'saltFlats',
                relief,
                moisture,
              }),
              seed,
              structures: false,
            }).heights;
          expect(averageHeight(generate('wet'))).toBeLessThan(averageHeight(generate('balanced')));
          expect(averageHeight(generate('balanced'))).toBeLessThan(averageHeight(generate('dry')));
        }
    }
  );

  test('Salt Flats save their calibrated recipe without changing legacy terrain', () => {
    const seed = 42;
    const engine = new TerrainEngine(25, 25);
    const legacy = engine.planBiomeGeneration('saltFlats', {
      seed,
      relief: 1,
      waterBias: 0,
      structures: false,
    });
    expect(createHash('sha256').update(JSON.stringify(legacy.heights.flat())).digest('hex')).toBe(
      'a8ab08772a0c254ff51dcd914634d701fe5776f2ba0beb553f8f27f0c213fda6'
    );
    engine.generateBiomeElevation('saltFlats', {
      seed,
      relief: 1,
      waterBias: 0,
      structures: false,
    });
    const oldSave = engine.save();
    const reopened = new TerrainEngine(1, 1);
    reopened.load(oldSave);
    expect(reopened.save()).toEqual(oldSave);
    expect(reopened.generationRecipe.values).not.toHaveProperty('saltFlatReliefVersion');

    const calibrated = normalizeBiomeGenerationChoices('saltFlats', {
      variant: 'saltFlats',
      relief: 'balanced',
      moisture: 'balanced',
    });
    expect(calibrated.saltFlatReliefVersion).toBe(1);
    engine.generateBiomeElevation('saltFlats', { ...calibrated, seed, structures: false });
    const newSave = engine.save();
    reopened.load(newSave);
    expect(reopened.save()).toEqual(newSave);
    expect(reopened.generationRecipe.values.saltFlatReliefVersion).toBe(1);
    expect(newSave.heights.flat().some((height) => !Number.isInteger(height))).toBe(true);
    expect(
      reopened.planBiomeGeneration('saltFlats', {
        ...reopened.generationRecipe.values,
        seed,
        structures: false,
      }).heights
    ).toEqual(newSave.heights);
    const height = reopened.getHeightAt(12, 12);
    reopened.setBrushSize(1);
    reopened.setTool('raise');
    reopened.beginBrushStroke(12, 12);
    reopened.commitBrushStroke();
    expect(reopened.getHeightAt(12, 12)).toBeGreaterThan(height);
    reopened.undo();
    expect(reopened.getHeightAt(12, 12)).toBe(height);
    const invalid = JSON.parse(JSON.stringify(newSave));
    invalid.generationRecipe.values.saltFlatReliefVersion = 2;
    expect(() => reopened.load(invalid)).toThrow(/generation recipe/i);
    expect(reopened.save()).toEqual(newSave);
  });

  test.each([
    ['saltFlats', { saltFlatReliefVersion: 2 }],
    ['saltFlats', { saltFlatReliefVersion: 1, relief: -1 }],
    ['saltFlats', { saltFlatReliefVersion: 1, waterBias: 'wet' }],
    ['dungeon', { saltFlatReliefVersion: 1 }],
  ])('invalid calibrated relief options for %s fail explicitly', (biomeKey, options) => {
    expect(() => generateBiomeElevationField(biomeKey, 5, 5, options)).toThrow(/salt flats/i);
  });

  test.each([5, 25])('Salt Flats remain walkable on a %i-square map', (size) => {
    const engine = new TerrainEngine(size, size);
    engine.configureGeometryScale(1.5);
    for (const relief of ['gentle', 'balanced', 'dramatic'])
      for (const moisture of ['dry', 'wet']) {
        engine.generateBiomeElevation('saltFlats', {
          ...normalizeBiomeGenerationChoices('saltFlats', {
            variant: 'saltFlats',
            relief,
            moisture,
          }),
          seed: 7,
          structures: false,
        });
        const center = Math.floor(size / 2);
        const range = buildSurfaceRange({
          geometry: engine.geometry,
          start: {
            gridX: center,
            gridY: center,
            heightFeet: engine.getHeightAt(center, center) * 1.5,
          },
          speedFeet: size * 15,
        });
        for (const [x, z] of [
          [0, 0],
          [size - 1, 0],
          [0, size - 1],
          [size - 1, size - 1],
        ])
          expect(getSurfaceRoute(range, x, z)).not.toBeNull();
      }
  });

  test.each(variantsWithControl('relief'))(
    'visible relief changes at least ten percent of %s terrain at representative sizes',
    (biomeKey) => {
      for (const size of [25, 50]) {
        const engine = new TerrainEngine(size, size);
        for (const seed of [1, 7, 42]) {
          const generate = (relief) =>
            engine
              .planBiomeGeneration(biomeKey, {
                ...normalizeBiomeGenerationChoices(biomeKey, { variant: biomeKey, relief }),
                seed,
                structures: false,
              })
              .heights.flat();
          const gentle = generate('gentle');
          const dramatic = generate('dramatic');
          const changed = gentle.filter((height, index) => height !== dramatic[index]);
          expect(changed.length).toBeGreaterThan(size * size * 0.1);
        }
      }
    }
  );

  test.each(variantsWithControl('moisture'))(
    'wetter %s generation lowers the ground compared with drier generation',
    (biomeKey) => {
      for (const seed of [1, 7, 42]) {
        const generate = (moisture) =>
          generateBiomeElevationField(biomeKey, 25, 25, {
            ...normalizeBiomeGenerationChoices(biomeKey, { variant: biomeKey, moisture }),
            seed,
          });
        expect(averageHeight(generate('wet'))).toBeLessThan(averageHeight(generate('dry')));
      }
    }
  );

  test.each(variantsWithControl('density'))(
    'visible density changes %s scenery on sampled compact and standard maps',
    (biomeKey) => {
      for (const size of [12, 25])
        for (const seed of [1, 7, 42]) {
          const engine = new TerrainEngine(size, size);
          const generate = (density) =>
            engine.planBiomeGeneration(biomeKey, {
              ...normalizeBiomeGenerationChoices(biomeKey, { variant: biomeKey, density }),
              seed,
              structures: false,
            }).placements;
          expect(generate('dense').length).toBeGreaterThan(generate('sparse').length);
        }
    }
  );

  test.each([0, 45, 90, 135, 180, 225, 270, 315])(
    'coastal orientation %i retains playable land and water across seeds and sizes',
    (orientation) => {
      for (const { cols, rows } of [
        { cols: 25, rows: 25 },
        { cols: 50, rows: 50 },
        { cols: 31, rows: 17 },
      ]) {
        const engine = new TerrainEngine(cols, rows);
        for (const seed of [1, 42]) {
          const options = normalizeBiomeGenerationChoices('coast', {
            variant: 'coast',
            density: 'dense',
          });
          const plan = engine.planBiomeGeneration('coast', {
            ...options,
            seed,
            orientation,
            structures: false,
          });
          const heights = plan.heights.flat();
          expect(heights.filter((height) => height < 0).length).toBeGreaterThan(cols * rows * 0.05);
          expect(heights.filter((height) => height > 0).length).toBeGreaterThan(cols * rows * 0.05);
          expect(plan.placements.length).toBeGreaterThan(0);
          expect(
            engine.planBiomeGeneration('coast', {
              ...options,
              seed,
              orientation,
              structures: false,
            }).heights
          ).toEqual(plan.heights);
        }
      }
    }
  );

  test.each(['riverLake', 'floodplain'])(
    '%s generates usable banks and density-controlled vegetation around water',
    (biomeKey) => {
      for (const size of [25, 50]) {
        const engine = new TerrainEngine(size, size);
        for (const seed of [1, 7, 42]) {
          const generate = (density) =>
            engine.planBiomeGeneration(biomeKey, {
              ...normalizeBiomeGenerationChoices(biomeKey, { variant: biomeKey, density }),
              seed,
              structures: false,
            });
          const sparse = generate('sparse');
          const dense = generate('dense');
          const heights = dense.heights.flat();
          expect(heights.filter((height) => height < 0).length).toBeGreaterThan(size * size * 0.05);
          expect(heights.filter((height) => height > 0).length).toBeGreaterThan(size * size * 0.05);
          expect(dense.placements.length).toBeGreaterThan(sparse.placements.length);
          for (const { gridX, gridY } of dense.placements)
            expect(dense.heights[gridY][gridX]).toBeGreaterThanOrEqual(
              biomeKey === 'riverLake' ? 0 : 1
            );
        }
      }
    }
  );

  test('a compact River / Lake uses shoreline for density-controlled scenery', () => {
    const engine = new TerrainEngine(12, 12);
    const generate = (density) =>
      engine.planBiomeGeneration('riverLake', {
        ...normalizeBiomeGenerationChoices('riverLake', { variant: 'riverLake', density }),
        seed: 42,
        structures: false,
      });
    const sparse = generate('sparse');
    const dense = generate('dense');
    expect(dense.placements.length).toBeGreaterThan(sparse.placements.length);
    expect(dense.placements.some(({ gridX, gridY }) => dense.heights[gridY][gridX] === 0)).toBe(
      true
    );
    expect(dense.placements.every(({ gridX, gridY }) => dense.heights[gridY][gridX] >= 0)).toBe(
      true
    );
    expect(dense.heights.flat().some((height) => height < 0)).toBe(true);
  });

  test('a compact Graveyard distinguishes dense from sparse scenery on dry ground', () => {
    const engine = new TerrainEngine(12, 12);
    const generate = (density) =>
      engine.planBiomeGeneration('graveyard', {
        ...normalizeBiomeGenerationChoices('graveyard', { variant: 'graveyard', density }),
        seed: 7,
        structures: false,
      });
    const sparse = generate('sparse');
    const dense = generate('dense');
    expect(dense.placements.length).toBeGreaterThan(sparse.placements.length);
    expect(dense.placements.every(({ gridX, gridY }) => dense.heights[gridY][gridX] >= 0)).toBe(
      true
    );
  });

  test.each([
    ['castle', 25, 42],
    ['castle', 50, 1],
    ['castle', 50, 42],
    ['ruinedCastle', 50, 7],
    ['cliffsideCastle', 40, 1],
    ['cliffsideCastle', 40, 42],
    ['mountainCastle', 25, 1],
    ['mountainCastle', 25, 42],
    ['mountainCastle', 40, 42],
    ['mountainCastle', 50, 42],
    ['city', 12, 1],
    ['city', 12, 42],
    ['ruinedUrban', 12, 42],
    ['ruinedTown', 25, 42],
  ])(
    '%s density increases supported scenery on %i squares at seed %i without overlapping structures',
    (biomeKey, size, seed) => {
      const engine = new TerrainEngine(size, size);
      const before = engine.save();
      const generate = (density) =>
        engine.planBiomeGeneration(biomeKey, {
          ...normalizeBiomeGenerationChoices(biomeKey, { variant: biomeKey, density }),
          seed,
          structures: true,
        });
      const sparse = generate('sparse');
      const dense = generate('dense');
      expect(dense.placements.length).toBeGreaterThan(sparse.placements.length);
      const structures = dense.geometry.structures.map((entry) => structureBounds(entry));
      for (const { gridX, gridY } of dense.placements) {
        expect(dense.heights[gridY][gridX]).toBeGreaterThanOrEqual(0);
        const x = (gridX + 0.5) * 5;
        const z = (gridY + 0.5) * 5;
        expect(
          structures.some(
            ({ min, max }) =>
              x >= min.x - 2.5 && x <= max.x + 2.5 && z >= min.z - 2.5 && z <= max.z + 2.5
          )
        ).toBe(false);
      }
      expect(generate('dense').placements).toEqual(dense.placements);
      expect(engine.save()).toEqual(before);
    }
  );

  test.each(['dry', 'balanced', 'wet'])(
    '%s mangroves have wet ground, supported shore plants and meaningful density',
    (moisture) => {
      for (const size of [25, 50]) {
        const engine = new TerrainEngine(size, size);
        for (const seed of [1, 7, 42]) {
          const generate = (density) =>
            engine.planBiomeGeneration('mangrove', {
              ...normalizeBiomeGenerationChoices('mangrove', {
                variant: 'mangrove',
                density,
                moisture,
              }),
              seed,
              structures: false,
            });
          const sparse = generate('sparse');
          const dense = generate('dense');
          const heights = dense.heights.flat();
          expect(heights.filter((height) => height < 0).length).toBeGreaterThan(size * size * 0.05);
          expect(heights.filter((height) => height > 0).length).toBeGreaterThan(size * size * 0.05);
          expect(dense.placements.length).toBeGreaterThan(sparse.placements.length);
          for (const { gridX, gridY } of dense.placements) {
            expect(dense.heights[gridY][gridX]).toBeGreaterThan(0);
            const neighbors = [
              [gridX - 1, gridY],
              [gridX + 1, gridY],
              [gridX, gridY - 1],
              [gridX, gridY + 1],
            ];
            expect(
              neighbors.some(
                ([x, y]) => x >= 0 && x < size && y >= 0 && y < size && dense.heights[y][x] <= 0
              )
            ).toBe(true);
          }
        }
      }
    }
  );

  test.each(['dry', 'balanced', 'wet'])(
    '%s Blood Marsh retains shallow planting ground and responds to density',
    (moisture) => {
      for (const size of [12, 25, 50])
        for (const seed of [0, 7, 42])
          for (const relief of ['gentle', 'balanced', 'dramatic']) {
            const engine = new TerrainEngine(size, size);
            const generate = (density) =>
              engine.planBiomeGeneration('bloodMarsh', {
                ...normalizeBiomeGenerationChoices('bloodMarsh', {
                  variant: 'bloodMarsh',
                  density,
                  moisture,
                  relief,
                }),
                seed,
                structures: false,
              });
            const sparse = generate('sparse');
            const dense = generate('dense');
            expect(Math.min(...dense.heights.flat())).toBeLessThan(0);
            expect(dense.placements.length).toBeGreaterThan(sparse.placements.length);
            for (const { gridX, gridY } of dense.placements)
              expect(dense.heights[gridY][gridX]).toBeGreaterThanOrEqual(-2);
            expect(generate('dense').placements).toEqual(dense.placements);
          }
    }
  );

  test('a minimum-size wet Blood Marsh still has shallow ground for scenery', () => {
    const plan = new TerrainEngine(5, 5).planBiomeGeneration('bloodMarsh', {
      ...normalizeBiomeGenerationChoices('bloodMarsh', {
        variant: 'bloodMarsh',
        density: 'dense',
        moisture: 'wet',
      }),
      seed: 0,
      structures: false,
    });
    expect(plan.placements.length).toBeGreaterThan(0);
    expect(plan.placements.every(({ gridX, gridY }) => plan.heights[gridY][gridX] >= -2)).toBe(
      true
    );
  });

  test.each([5, 12, 25, 50])(
    'Blood Marsh moisture stays directional on a %i-square map',
    (size) => {
      for (const seed of [0, 7, 42, 99])
        for (const relief of ['gentle', 'balanced', 'dramatic']) {
          const generate = (moisture) =>
            new TerrainEngine(size, size).planBiomeGeneration('bloodMarsh', {
              ...normalizeBiomeGenerationChoices('bloodMarsh', {
                variant: 'bloodMarsh',
                moisture,
                relief,
              }),
              seed,
              structures: false,
            }).heights;
          expect(averageHeight(generate('wet'))).toBeLessThan(averageHeight(generate('balanced')));
          expect(averageHeight(generate('balanced'))).toBeLessThan(averageHeight(generate('dry')));
        }
    }
  );

  test.each(['swamp', 'wetlands'])(
    '%s has supported vegetation at every moisture and relief setting',
    (biomeKey) => {
      for (const size of [12, 25])
        for (const seed of [0, 7, 42])
          for (const moisture of ['dry', 'balanced', 'wet'])
            for (const relief of ['gentle', 'balanced', 'dramatic']) {
              const engine = new TerrainEngine(size, size);
              const generate = (density) =>
                engine.planBiomeGeneration(biomeKey, {
                  ...normalizeBiomeGenerationChoices(biomeKey, {
                    variant: biomeKey,
                    density,
                    moisture,
                    relief,
                  }),
                  seed,
                  structures: false,
                });
              const sparse = generate('sparse');
              const dense = generate('dense');
              expect(Math.min(...dense.heights.flat())).toBeLessThan(0);
              expect(dense.placements.length).toBeGreaterThan(sparse.placements.length);
              for (const { gridX, gridY } of dense.placements)
                expect(dense.heights[gridY][gridX]).toBeGreaterThanOrEqual(-3.2);
            }
    }
  );

  test.each(['swamp', 'wetlands'])(
    'a minimum-size dry %s keeps a wet pocket and supported vegetation',
    (biomeKey) => {
      const plan = new TerrainEngine(5, 5).planBiomeGeneration(biomeKey, {
        ...normalizeBiomeGenerationChoices(biomeKey, {
          variant: biomeKey,
          density: 'dense',
          moisture: 'dry',
        }),
        seed: 42,
        structures: false,
      });
      expect(Math.min(...plan.heights.flat())).toBeLessThan(0);
      expect(plan.placements.length).toBeGreaterThan(0);
    }
  );

  test.each(['swamp', 'wetlands'])(
    '%s moisture remains directional on small and standard maps',
    (biomeKey) => {
      for (const size of [5, 25])
        for (const seed of [0, 7, 42])
          for (const relief of ['gentle', 'balanced', 'dramatic']) {
            const generate = (moisture) =>
              new TerrainEngine(size, size).planBiomeGeneration(biomeKey, {
                ...normalizeBiomeGenerationChoices(biomeKey, {
                  variant: biomeKey,
                  moisture,
                  relief,
                }),
                seed,
                structures: false,
              }).heights;
            expect(averageHeight(generate('wet'))).toBeLessThan(
              averageHeight(generate('balanced'))
            );
            expect(averageHeight(generate('balanced'))).toBeLessThan(
              averageHeight(generate('dry'))
            );
          }
    }
  );

  test.each(['steppe', 'tundra'])(
    '%s includes level ground and responds to density on small maps',
    (biomeKey) => {
      let levelPlacements = 0;
      for (const seed of [1, 7, 42]) {
        const engine = new TerrainEngine(12, 12);
        const generate = (density) =>
          engine.planBiomeGeneration(biomeKey, {
            ...normalizeBiomeGenerationChoices(biomeKey, { variant: biomeKey, density }),
            seed,
            structures: false,
          });
        const sparse = generate('sparse');
        const dense = generate('dense');
        expect(dense.placements.length).toBeGreaterThan(sparse.placements.length);
        levelPlacements += dense.placements.filter(
          ({ gridX, gridY }) => dense.heights[gridY][gridX] === 0
        ).length;
      }
      expect(levelPlacements).toBeGreaterThan(0);
    }
  );

  test('Scree Slope can populate supported terrain below the zero elevation', () => {
    const engine = new TerrainEngine(12, 12);
    const generate = (density) =>
      engine.planBiomeGeneration('screeSlope', {
        ...normalizeBiomeGenerationChoices('screeSlope', {
          variant: 'screeSlope',
          relief: 'gentle',
          density,
        }),
        seed: 2,
        structures: false,
      });
    const sparse = generate('sparse');
    const dense = generate('dense');
    expect(Math.max(...dense.heights.flat())).toBeLessThan(0);
    expect(dense.placements.length).toBeGreaterThan(sparse.placements.length);
    expect(dense.placements.every(({ gridX, gridY }) => dense.heights[gridY][gridX] < 0)).toBe(
      true
    );
  });

  test.each(['dry', 'balanced', 'wet'])(
    '%s Geyser Basin retains supported scenery and responds to density',
    (moisture) => {
      for (const size of [12, 25, 50]) {
        const engine = new TerrainEngine(size, size);
        for (const seed of [1, 7, 39, 42]) {
          const generate = (density) =>
            engine.planBiomeGeneration('geyserBasin', {
              ...normalizeBiomeGenerationChoices('geyserBasin', {
                variant: 'geyserBasin',
                density,
                moisture,
              }),
              seed,
              structures: false,
            });
          const sparse = generate('sparse');
          const dense = generate('dense');
          expect(dense.placements.length).toBeGreaterThan(sparse.placements.length);
          expect(dense.heights.flat().some((height) => height < 0)).toBe(true);
          for (const { gridX, gridY } of dense.placements)
            expect(dense.heights[gridY][gridX]).toBeGreaterThanOrEqual(0);
          expect(generate('dense')).toEqual(dense);
        }
      }
    }
  );

  test.each(['deadForest', 'ashWastes', 'wasteland', 'graveyard'])(
    '%s generates dry-ground scenery that responds to density',
    (biomeKey) => {
      for (const size of [25, 50]) {
        const engine = new TerrainEngine(size, size);
        for (const seed of [1, 7, 42]) {
          const generate = (density) =>
            engine.planBiomeGeneration(biomeKey, {
              ...normalizeBiomeGenerationChoices(biomeKey, { variant: biomeKey, density }),
              seed,
              structures: false,
            });
          const sparse = generate('sparse');
          const dense = generate('dense');
          expect(dense.placements.length).toBeGreaterThan(sparse.placements.length);
          for (const { gridX, gridY } of dense.placements)
            expect(dense.heights[gridY][gridX]).toBeGreaterThanOrEqual(0);
          if (biomeKey === 'deadForest')
            expect(
              dense.placements.some(({ placeableId }) => /^tree-(dead|bare)/.test(placeableId))
            ).toBe(true);
        }
      }
    }
  );

  test('different biomes differ statistically', () => {
    const rows = 24,
      cols = 24;
    const g = generateBiomeElevationField('grassland', rows, cols, { seed: 7 });
    const m = generateBiomeElevationField('mountain', rows, cols, { seed: 7 });
    // Compare simple variance proxy
    const flat = (v) => v.reduce((s, r) => s + r.reduce((a, b) => a + b, 0), 0) / (rows * cols);
    const meanG = flat(g);
    const meanM = flat(m);
    // Means can be similar; compare avg abs value to detect stronger relief in mountains
    const avgAbs = (v) =>
      v.reduce((s, r) => s + r.reduce((a, b) => a + Math.abs(b), 0), 0) / (rows * cols);
    expect(avgAbs(m)).toBeGreaterThan(avgAbs(g));
    // Avoid degenerate equality
    expect(meanG).not.toBeNaN();
    expect(meanM).not.toBeNaN();
  });

  test('applyBiomeElevationIfFlat applies only if at default height', () => {
    const base = TerrainHeightUtils.createHeightArray(10, 10, TERRAIN_CONFIG.DEFAULT_HEIGHT);
    const applied = applyBiomeElevationIfFlat(base, 'wetlands', { seed: 9 });
    expect(isAllDefaultHeight(applied)).toBe(false);

    const edited = TerrainHeightUtils.copyHeightArray(base);
    edited[3][3] = TERRAIN_CONFIG.DEFAULT_HEIGHT + 2;
    const untouched = applyBiomeElevationIfFlat(edited, 'wetlands', { seed: 9 });
    expect(untouched).toEqual(edited);
  });
});
