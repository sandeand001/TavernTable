import { TerrainCoordinator } from '../../src/coordinators/TerrainCoordinator.js';

// Minimal fake GameManager stub sufficient for coordinator construction
const fakeGM = {
    cols: 10,
    rows: 10,
    app: { view: { addEventListener: () => { } } },
    gridContainer: true
};

describe('TerrainCoordinator PT brush independence', () => {
    test('ptBrushSize is independent from terrain brushSize', async () => {
        const tc = new TerrainCoordinator(fakeGM);
        // initialize internal brush state
        expect(tc.brush.brushSize).toBeDefined();
        expect(tc.ptBrushSize).toBeDefined();

        const originalTerrain = tc.brush.brushSize;
        const originalPT = tc.ptBrushSize;

        // change terrain brush
        tc.brush.brushSize = Math.min(originalTerrain + 2, 5);
        expect(tc.brush.brushSize).not.toBe(originalPT);
        // ensure PT unchanged
        expect(tc.ptBrushSize).toBe(originalPT);

        // change PT brush via API
        tc.ptBrushSize = originalPT + 3;
        expect(tc.ptBrushSize).toBe(originalPT + 3);
        // terrain brush remains same
        expect(tc.brush.brushSize).toBe(originalTerrain + 2);
    });
});
