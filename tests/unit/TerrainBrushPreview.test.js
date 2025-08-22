import { TerrainBrushController } from '../../src/terrain/TerrainBrushController.js';

describe('Terrain brush preview footprint', () => {
    test('getFootprintCells returns a centered square of size brushSize', () => {
        const mockStore = { rows: 10, cols: 10, get: () => 0 };
        const brush = new TerrainBrushController(mockStore);
        brush.brushSize = 3;
        const cells = brush.getFootprintCells(5, 5);
        // For 3x3, expect 9 cells and include center
        expect(cells.length).toBe(9);
        const hasCenter = cells.some(c => c.x === 5 && c.y === 5);
        expect(hasCenter).toBe(true);
    });

    test('getFootprintCells clamps to bounds', () => {
        const mockStore = { rows: 3, cols: 3, get: () => 0 };
        const brush = new TerrainBrushController(mockStore);
        brush.brushSize = 3;
        const cells = brush.getFootprintCells(0, 0);
        // Near edge, should not include negatives; expect up to 4 cells (0,0),(0,1),(1,0),(1,1)
        expect(cells.every(c => c.x >= 0 && c.y >= 0)).toBe(true);
        expect(cells.length).toBeGreaterThan(0);
    });
});
