import { GameManager } from '../../src/core/GameManager.js';
import { TerrainHeightUtils } from '../../src/utils/TerrainHeightUtils.js';

function buildHybridGM() {
  const gm = new GameManager({ cols: 4, rows: 4 });
  gm.renderMode = '3d';
  gm.spatial.reconfigure({ elevationUnit: 0.5 });
  gm.threeSceneManager = {
    camera: { top: 10, bottom: -10 },
    renderer: { domElement: { clientHeight: 600 } },
    canvas: { clientHeight: 600 },
    scene: {},
    isReady: () => true,
  };
  return gm;
}

describe('GameManager.sync3DElevationScaling', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('scales linearly relative to the default tile height', () => {
    const gm = buildHybridGM();
    const defaultPixels = gm._defaultElevationPixelsPerLevel;
    const baseline = gm._baselineWorldElevationUnit;
    const attenuation = gm._worldElevationAttenuation || 1;

    jest.spyOn(TerrainHeightUtils, 'getElevationUnit').mockReturnValue(defaultPixels * 1.5);

    const changed = gm.sync3DElevationScaling({ rebuild: false, hardSet: true });
    expect(changed).toBe(true);
    expect(gm.spatial.elevationUnit).toBeCloseTo(baseline * 1.5 * attenuation, 5);
  });

  test('returning the slider to default restores the original tile height', () => {
    const gm = buildHybridGM();
    const defaultPixels = gm._defaultElevationPixelsPerLevel;
    const baseline = gm._baselineWorldElevationUnit;
    const attenuation = gm._worldElevationAttenuation || 1;
    const spy = jest.spyOn(TerrainHeightUtils, 'getElevationUnit');

    spy.mockReturnValue(defaultPixels * 0.5);
    gm.sync3DElevationScaling({ rebuild: false, hardSet: true });
    expect(gm.spatial.elevationUnit).toBeCloseTo(baseline * 0.5 * attenuation, 5);

    spy.mockReturnValue(defaultPixels);
    gm.sync3DElevationScaling({ rebuild: false, hardSet: true });
    expect(gm.spatial.elevationUnit).toBeCloseTo(baseline * attenuation, 5);
  });
});
