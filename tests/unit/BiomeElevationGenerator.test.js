import { TERRAIN_CONFIG } from '../../src/config/TerrainConstants.js';
import { TerrainHeightUtils } from '../../src/utils/TerrainHeightUtils.js';
import {
    isAllDefaultHeight,
    generateBiomeElevationField,
    applyBiomeElevationIfFlat
} from '../../src/terrain/BiomeElevationGenerator.js';

function allWithin(arr, min, max) {
    for (let y = 0; y < arr.length; y++) {
        for (let x = 0; x < arr[0].length; x++) {
            const v = arr[y][x];
            if (v < min || v > max) return false;
        }
    }
    return true;
}

describe('BiomeElevationGenerator', () => {
    test('isAllDefaultHeight detects flat arrays', () => {
        const a = TerrainHeightUtils.createHeightArray(3, 4, TERRAIN_CONFIG.DEFAULT_HEIGHT);
        expect(isAllDefaultHeight(a)).toBe(true);
        a[1][2] = TERRAIN_CONFIG.DEFAULT_HEIGHT + 1;
        expect(isAllDefaultHeight(a)).toBe(false);
    });

    test('generateBiomeElevationField returns correct dimensions and bounds', () => {
        const rows = 16, cols = 20;
        const arr = generateBiomeElevationField('grassland', rows, cols, { seed: 42 });
        expect(arr.length).toBe(rows);
        expect(arr[0].length).toBe(cols);
        expect(allWithin(arr, TERRAIN_CONFIG.MIN_HEIGHT, TERRAIN_CONFIG.MAX_HEIGHT)).toBe(true);
    });

    test('deterministic with same seed', () => {
        const a1 = generateBiomeElevationField('hills', 12, 12, { seed: 123 });
        const a2 = generateBiomeElevationField('hills', 12, 12, { seed: 123 });
        expect(a1).toEqual(a2);
    });

    test('different biomes differ statistically', () => {
        const rows = 24, cols = 24;
        const g = generateBiomeElevationField('grassland', rows, cols, { seed: 7 });
        const m = generateBiomeElevationField('mountain', rows, cols, { seed: 7 });
        // Compare simple variance proxy
        const flat = v => v.reduce((s, r) => s + r.reduce((a, b) => a + b, 0), 0) / (rows * cols);
        const meanG = flat(g);
        const meanM = flat(m);
        // Means can be similar; compare avg abs value to detect stronger relief in mountains
        const avgAbs = v => v.reduce((s, r) => s + r.reduce((a, b) => a + Math.abs(b), 0), 0) / (rows * cols);
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
