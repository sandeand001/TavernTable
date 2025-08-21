import { TerrainCoordinator } from '../../src/coordinators/TerrainCoordinator.js';
import { TERRAIN_CONFIG } from '../../src/config/TerrainConstants.js';

function makeCoordinatorWithHeights(heights) {
    const gameManager = { cols: heights?.[0]?.length || 0, rows: heights?.length || 0 };
    const c = new TerrainCoordinator(gameManager);
    // override datastore working array directly for the test
    c.dataStore.working = heights;
    return c;
}

describe('TerrainCoordinator.getTerrainHeight (delegated)', () => {
    test('returns height for valid coordinates', () => {
        const heights = [
            [0, 1, 2],
            [3, 4, 5]
        ];
        const c = makeCoordinatorWithHeights(heights);
        expect(c.getTerrainHeight(2, 1)).toBe(5);
    });

    test('returns default height when out of bounds or invalid', () => {
        const heights = [[7]];
        const c = makeCoordinatorWithHeights(heights);
        expect(c.getTerrainHeight(-1, 0)).toBe(TERRAIN_CONFIG.DEFAULT_HEIGHT);
        expect(c.getTerrainHeight(1, 0)).toBe(TERRAIN_CONFIG.DEFAULT_HEIGHT);
        expect(c.getTerrainHeight(0, -1)).toBe(TERRAIN_CONFIG.DEFAULT_HEIGHT);
        expect(c.getTerrainHeight(0, 1)).toBe(TERRAIN_CONFIG.DEFAULT_HEIGHT);
        expect(c.getTerrainHeight(0.5, 0)).toBe(TERRAIN_CONFIG.DEFAULT_HEIGHT);
        expect(c.getTerrainHeight(0, 0.5)).toBe(TERRAIN_CONFIG.DEFAULT_HEIGHT);
    });
});
