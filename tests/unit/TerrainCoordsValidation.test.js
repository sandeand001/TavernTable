import { TerrainCoordinator } from '../../src/coordinators/TerrainCoordinator.js';

describe('TerrainCoordinator.isValidGridPosition (delegated)', () => {
    test('valid and invalid grid coordinates are detected correctly', () => {
        const gameManager = { cols: 3, rows: 2 };
        const c = new TerrainCoordinator(gameManager);
        expect(c.isValidGridPosition(0, 0)).toBe(true);
        expect(c.isValidGridPosition(2, 1)).toBe(true);
        expect(c.isValidGridPosition(3, 0)).toBe(false);
        expect(c.isValidGridPosition(0, 2)).toBe(false);
        expect(c.isValidGridPosition(-1, 0)).toBe(false);
    });
});
