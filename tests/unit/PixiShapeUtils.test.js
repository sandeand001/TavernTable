import { traceDiamondPath } from '../../src/utils/PixiShapeUtils.js';

function makeGraphicsRecorder() {
    const calls = [];
    return {
        calls,
        moveTo(x, y) { calls.push({ op: 'moveTo', x, y }); },
        lineTo(x, y) { calls.push({ op: 'lineTo', x, y }); },
    };
}

describe('PixiShapeUtils.traceDiamondPath', () => {
    test('traces expected isometric diamond path', () => {
        const g = makeGraphicsRecorder();
        traceDiamondPath(g, 10, 6);
        expect(g.calls).toEqual([
            { op: 'moveTo', x: 0, y: 3 },
            { op: 'lineTo', x: 5, y: 0 },
            { op: 'lineTo', x: 10, y: 3 },
            { op: 'lineTo', x: 5, y: 6 },
            { op: 'lineTo', x: 0, y: 3 },
        ]);
    });
});
