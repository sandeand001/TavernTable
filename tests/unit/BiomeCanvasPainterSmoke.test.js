import { BiomeCanvasPainter } from '../../src/terrain/BiomeCanvasPainter.js';

/**
 * BiomeCanvasPainter smoke — construct, set seed, compute bounds, and call paint/clear without throwing.
 */
describe('BiomeCanvasPainter smoke', () => {
  function makeGM(rows = 4, cols = 4) {
    return {
      cols,
      rows,
      tileWidth: 64,
      tileHeight: 32,
      gridContainer: { addChild() {}, removeChild() {} },
      // minimal API referenced by painter in some branches
      getBiomeKey: () => 'grassland'
    };
  }

  function heights(rows = 4, cols = 4) {
    const arr = Array.from({ length: rows }, () => Array(cols).fill(0));
    if (rows > 2 && cols > 2) {
      arr[1][1] = 1;
      arr[2][1] = -1;
    } else if (rows > 1 && cols > 1) {
      arr[1][1] = 1;
    }
    return arr;
  }

  test('construct and clear without exceptions', () => {
    const gm = makeGM();
    const painter = new BiomeCanvasPainter(gm);
    painter.setSeed(123);
    // Access a simple method path: compute bounds indirectly via paint
    const h = heights();
    expect(() => painter.paint('grassland', h, () => {})).not.toThrow();
    expect(() => painter.clear(() => {})).not.toThrow();
  });

  test('paints multiple biomes without exceptions', () => {
    const gm = makeGM(6, 5);
    const painter = new BiomeCanvasPainter(gm);
    painter.setSeed(42);
    const biomes = [
      'grassland',   // plains
      'desert',      // arid
      'forest',      // forest
      'swamp',       // wetland
      'alpine',      // alpine
      'ocean',       // water
      'volcanic',    // volcanic
      'arcane',      // arcane
      'unknown'      // generic fallback
    ];
    const h = heights(6, 5);
    for (const b of biomes) {
      expect(() => painter.paint(b, h, () => {})).not.toThrow();
    }
    expect(() => painter.clear(() => {})).not.toThrow();
  });
});
