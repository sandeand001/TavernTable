import { traceDiamondFacePath2D } from '../../src/utils/CanvasShapeUtils.js';

describe('CanvasShapeUtils.traceDiamondFacePath2D', () => {
  test('traces expected diamond face path centered at cx,cy', () => {
    const calls = [];
    const ctx = {
      moveTo(x, y) {
        calls.push({ op: 'moveTo', x, y });
      },
      lineTo(x, y) {
        calls.push({ op: 'lineTo', x, y });
      },
    };

    traceDiamondFacePath2D(ctx, 100, 200, 10, 6);

    expect(calls).toEqual([
      { op: 'moveTo', x: 100, y: 203 },
      { op: 'lineTo', x: 105, y: 200 },
      { op: 'lineTo', x: 100, y: 197 },
      { op: 'lineTo', x: 95, y: 200 },
    ]);
  });
});
