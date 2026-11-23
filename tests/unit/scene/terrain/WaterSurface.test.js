import * as three from 'three';
import {
  createWaterSurface,
  syncWaterSurface,
} from '../../../../src/scene/terrain/WaterSurface.js';

test.each([0.5, 1, 2])(
  'water covers submerged cells without intercepting picks at tile size %s',
  (tileWorldSize) => {
    const heights = [
      [-2, 0, 1],
      [-1, -3, 1],
    ];
    const mesh = createWaterSurface({
      biomeKey: 'riverLake',
      cols: 3,
      rows: 2,
      getHeight: (x, z) => heights[z][x],
      tileWorldSize,
      three,
    });
    try {
      expect(mesh).not.toBeNull();
      expect(mesh.material.transparent).toBe(true);
      expect(mesh.material.opacity).toBeGreaterThan(0);
      expect(mesh.material.opacity).toBeLessThan(1);
      mesh.updateMatrixWorld(true);
      const surfaceHit = (x, z) => {
        const ray = new three.Raycaster(
          new three.Vector3(x * tileWorldSize, 10, z * tileWorldSize),
          new three.Vector3(0, -1, 0)
        );
        const hits = [];
        three.Mesh.prototype.raycast.call(mesh, ray, hits);
        return hits;
      };
      for (const [x, z] of [
        [0.5, 0.5],
        [0.5, 1.5],
        [1.5, 1.5],
      ])
        expect(surfaceHit(x, z)[0].point.y).toBeCloseTo(0);
      for (const [x, z] of [
        [1.5, 0.5],
        [2.5, 0.5],
        [2.5, 1.5],
      ])
        expect(surfaceHit(x, z)).toHaveLength(0);
      const ray = new three.Raycaster(
        new three.Vector3(0.5 * tileWorldSize, 10, 0.5 * tileWorldSize),
        new three.Vector3(0, -1, 0)
      );
      expect(ray.intersectObject(mesh)).toHaveLength(0);
    } finally {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
  }
);

test('underground and dry biomes do not turn below-zero terrain into water', () => {
  for (const biomeKey of ['cavern', 'dungeon', 'screeSlope', 'desertHot']) {
    expect(
      createWaterSurface({
        biomeKey,
        cols: 1,
        rows: 1,
        getHeight: () => -3,
        tileWorldSize: 1,
        three,
      })
    ).toBeNull();
  }
});

test.each([
  'coast',
  'riverLake',
  'ocean',
  'coralReef',
  'swamp',
  'wetlands',
  'floodplain',
  'bloodMarsh',
  'mangrove',
  'oasis',
  'shore',
  'bog',
  'delta',
])('%s renders water only when the terrain is below its waterline', (biomeKey) => {
  const options = { biomeKey, cols: 1, rows: 1, tileWorldSize: 1, three };
  expect(createWaterSurface({ ...options, getHeight: () => 0 })).toBeNull();
  const mesh = createWaterSurface({ ...options, getHeight: () => -1 });
  try {
    expect(mesh).not.toBeNull();
  } finally {
    mesh?.geometry.dispose();
    mesh?.material.dispose();
  }
});

test('water updates reuse unchanged geometry and dispose removed surfaces', () => {
  const parent = new three.Group();
  let height = -1;
  const options = {
    biomeKey: 'riverLake',
    cols: 1,
    rows: 1,
    getHeight: () => height,
    tileWorldSize: 1,
    three,
  };
  const first = syncWaterSurface(parent, options);
  const geometryDisposed = jest.fn();
  const materialDisposed = jest.fn();
  first.geometry.addEventListener('dispose', geometryDisposed);
  first.material.addEventListener('dispose', materialDisposed);
  expect(syncWaterSurface(parent, options)).toBe(first);
  height = NaN;
  expect(() => syncWaterSurface(parent, options)).toThrow('valid terrain heights');
  expect(parent.getObjectByName('TerrainWater')).toBe(first);
  expect(geometryDisposed).not.toHaveBeenCalled();
  height = 0;
  expect(syncWaterSurface(parent, options)).toBeNull();
  expect(parent.getObjectByName('TerrainWater')).toBeUndefined();
  expect(geometryDisposed).toHaveBeenCalledTimes(1);
  expect(materialDisposed).toHaveBeenCalledTimes(1);
  height = -1;
  expect(syncWaterSurface(parent, options)).not.toBeNull();
  syncWaterSurface(parent, { ...options, biomeKey: null });
});

test('water retains the biome palette, including blue oceans and red marshes', () => {
  const options = { cols: 1, rows: 1, getHeight: () => -2, tileWorldSize: 1, three };
  const ocean = createWaterSurface({ ...options, biomeKey: 'ocean' });
  const marsh = createWaterSurface({ ...options, biomeKey: 'bloodMarsh' });
  try {
    const oceanColor = ocean.geometry.getAttribute('color');
    const marshColor = marsh.geometry.getAttribute('color');
    expect(oceanColor.getZ(0)).toBeGreaterThan(oceanColor.getX(0));
    expect(marshColor.getX(0)).toBeGreaterThan(marshColor.getZ(0));
  } finally {
    ocean.geometry.dispose();
    ocean.material.dispose();
    marsh.geometry.dispose();
    marsh.material.dispose();
  }
});

test('flat connected water can be merged without covering dry gaps', () => {
  const options = {
    biomeKey: 'ocean',
    cols: 20,
    rows: 20,
    getHeight: (x, z) => (x === 10 && z === 10 ? 0 : -2),
    tileWorldSize: 1,
    three,
  };
  const full = createWaterSurface(options);
  const merged = createWaterSurface({ ...options, mergeCells: true });
  try {
    expect(merged.geometry.index.count).toBeLessThan(full.geometry.index.count / 10);
    merged.updateMatrixWorld(true);
    const covers = (x, z) => {
      const ray = new three.Raycaster(new three.Vector3(x, 10, z), new three.Vector3(0, -1, 0));
      const hits = [];
      three.Mesh.prototype.raycast.call(merged, ray, hits);
      return hits.length > 0;
    };
    expect(covers(1.5, 1.5)).toBe(true);
    expect(covers(10.5, 10.5)).toBe(false);
    expect(covers(18.5, 18.5)).toBe(true);
  } finally {
    full.geometry.dispose();
    full.material.dispose();
    merged.geometry.dispose();
    merged.material.dispose();
  }
});
