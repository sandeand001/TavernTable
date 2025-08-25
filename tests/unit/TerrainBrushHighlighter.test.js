import { buildBrushHighlightDescriptor } from '../../src/terrain/TerrainBrushHighlighter.js';

function makeBrush(size = 1) {
    return {
        tool: 'raise',
        brushSize: size,
        getFootprintCells: (cx, cy) => {
            const half = Math.floor(size / 2);
            const cells = [];
            for (let dy = -half; dy <= half; dy++) {
                for (let dx = -half; dx <= half; dx++) {
                    cells.push({ x: cx + dx, y: cy + dy });
                }
            }
            return cells;
        }
    };
}

describe('TerrainBrushHighlighter', () => {
    test('returns empty when not in terrain mode', () => {
        const brush = makeBrush(1);
        const desc = buildBrushHighlightDescriptor({ brush, center: { gridX: 5, gridY: 5 }, terrainModeActive: false });
        expect(desc.cells.length).toBe(0);
    });

    test('returns correct cells for odd brush sizes', () => {
        const brush = makeBrush(3);
        const desc = buildBrushHighlightDescriptor({ brush, center: { gridX: 5, gridY: 5 }, terrainModeActive: true });
        expect(desc.cells.length).toBe(9);
        expect(desc.cells.some(c => c.x === 5 && c.y === 5)).toBe(true);
    });

    test('uses distinct cyan color and style defaults', () => {
        const brush = makeBrush(1);
        const desc = buildBrushHighlightDescriptor({ brush, center: { gridX: 0, gridY: 0 }, terrainModeActive: true });
        expect(desc.style.color).toBe(0x22d3ee);
        expect(desc.style.fillAlpha).toBeGreaterThan(0);
        expect(desc.style.lineWidth).toBeGreaterThan(0);
    });
});
