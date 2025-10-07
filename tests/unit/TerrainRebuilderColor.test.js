import { TerrainRebuilder } from '../../src/scene/TerrainRebuilder.js';
import { GRID_CONFIG } from '../../src/config/GameConstants.js';

describe('TerrainRebuilder biome color fallback', () => {
  const neutralColor = GRID_CONFIG.TILE_COLOR;

  const makeThreeStub = () => {
    class DummyLambertMaterial {
      constructor(opts = {}) {
        this.vertexColors = opts.vertexColors;
        this.isMaterial = true;
        this.isMeshLambertMaterial = true;
        this.dispose = jest.fn();
        this.side = null;
      }
    }

    class DummyStandardMaterial {
      constructor(opts = {}) {
        this.vertexColors = opts.vertexColors;
        this.isMaterial = true;
        this.isMeshStandardMaterial = true;
        this.dispose = jest.fn();
        this.side = null;
        this.roughness = opts.roughness;
        this.metalness = opts.metalness;
      }
    }

    class DummyBasicMaterial {
      constructor(opts = {}) {
        this.vertexColors = opts.vertexColors;
        this.isMaterial = true;
        this.isMeshBasicMaterial = true;
        this.dispose = jest.fn();
        this.side = null;
      }
    }

    class DummyMesh {
      constructor(geometry, material) {
        this.geometry = geometry;
        this.material = material;
        this.name = '';
        this.position = { set: jest.fn() };
        this.receiveShadow = false;
      }
    }

    return {
      BufferGeometry: class {},
      MeshLambertMaterial: DummyLambertMaterial,
      MeshStandardMaterial: DummyStandardMaterial,
      MeshBasicMaterial: DummyBasicMaterial,
      Mesh: DummyMesh,
      DoubleSide: 2,
    };
  };

  const makeGeometryStub = () => ({
    getAttribute: jest.fn().mockReturnValue(null),
    attributes: {},
    computeVertexNormals: jest.fn(),
  });

  const makeSceneStub = () => {
    const mesh = {
      geometry: { dispose: jest.fn() },
      material: {
        dispose: jest.fn(),
        isMeshBasicMaterial: true,
        isMeshStandardMaterial: false,
        isMeshLambertMaterial: false,
      },
      position: { set: jest.fn() },
      receiveShadow: false,
    };
    return {
      getObjectByName: jest.fn().mockReturnValue(mesh),
      add: jest.fn(),
    };
  };

  it('uses neutral grid color when no biome override is present', () => {
    const capturedColors = [];
    const builder = {
      build: jest.fn(({ getBiomeColor }) => {
        capturedColors.push(getBiomeColor(0, 0, 0));
        return makeGeometryStub();
      }),
    };

    const gm = {
      cols: 1,
      rows: 1,
      getTerrainHeight: () => 0,
      terrainCoordinator: { isTerrainModeActive: false },
      isTerrainModeActive: () => false,
      threeSceneManager: {
        scene: makeSceneStub(),
        three: makeThreeStub(),
      },
    };

    const rebuilder = new TerrainRebuilder({ gameManager: gm, builder, debounceMs: 0 });
    rebuilder.rebuild({ three: gm.threeSceneManager.three });

    expect(capturedColors).toHaveLength(1);
    expect(capturedColors[0]).toBe(neutralColor);
  });
});
