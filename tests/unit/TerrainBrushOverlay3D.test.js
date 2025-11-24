import * as THREE from 'three';
import { TerrainBrushOverlay3D } from '../../src/scene/TerrainBrushOverlay3D.js';
import { BRUSH_COLORS } from '../../src/terrain/brush/BrushCommon.js';

describe('TerrainBrushOverlay3D', () => {
  const buildOverlay = (heights = {}) => {
    const getHeight = (x, y) => {
      const key = `${x},${y}`;
      return Number.isFinite(heights[key]) ? heights[key] : 0;
    };
    const gameManager = {
      terrainCoordinator: {
        getTerrainHeight: jest.fn(getHeight),
      },
      getTerrainHeight: jest.fn(getHeight),
      spatial: {
        tileWorldSize: 1,
        elevationUnit: 0.5,
      },
    };
    const scene = new THREE.Scene();
    return new TerrainBrushOverlay3D({ three: THREE, scene, gameManager });
  };

  it('renders a single-cell highlight using the teal default color', () => {
    const overlay = buildOverlay();
    overlay.setHighlight([{ x: 0, y: 0 }], {});

    expect(overlay._instanced?.count).toBe(1);
    expect(overlay._instanced.material.color.getHex()).toBe(BRUSH_COLORS.preview);
    expect(overlay._instanced.material.opacity).toBeCloseTo(0.12);
    expect(overlay._outlinePool.length).toBeGreaterThan(0);
    expect(overlay._outlinePool[0].visible).toBe(true);
    expect(overlay._outlinePool[0].material.opacity).toBeCloseTo(0.9);

    overlay.dispose();
  });

  it('handles adjacent footprint cells without duplicating instances', () => {
    const overlay = buildOverlay();
    overlay.setHighlight(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ],
      {}
    );

    expect(overlay._instanced?.count).toBe(3);

    overlay.dispose();
  });

  it('applies custom brush styles when provided', () => {
    const overlay = buildOverlay();
    const style = { color: 0xff00ff, fillAlpha: 0.3, lineAlpha: 0.5 };
    overlay.setHighlight([{ x: 2, y: 3 }], style);

    expect(overlay._instanced.material.color.getHex()).toBe(style.color);
    expect(overlay._instanced.material.opacity).toBeCloseTo(style.fillAlpha);
    expect(overlay._outlinePool[0].material.opacity).toBeCloseTo(style.lineAlpha);

    overlay.dispose();
  });
});
