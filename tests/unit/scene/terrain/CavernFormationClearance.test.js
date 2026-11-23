import * as three from 'three';
import { resolveCavernSceneryClearance } from '../../../../src/scene/terrain/CavernSceneryClearance.js';

test('new cavern formations use transformed model bounds without altering authored scenery or rocks', () => {
  const pool = {
    _three: three,
    _groups: new Map(),
    _metadata: new Map(),
    removePlaceable({ __meshPoolHandle }) {
      this._metadata.get(__meshPoolHandle.key).delete(__meshPoolHandle.index);
    },
  };
  const add = (key, size, placements) => {
    const geometry = new three.BoxGeometry(...size);
    const material = new three.MeshBasicMaterial();
    const mesh = new three.InstancedMesh(geometry, material, placements.length);
    const entries = new Map();
    for (const [index, placement] of placements.entries()) {
      const matrix = new three.Matrix4().compose(
        new three.Vector3(...placement.position),
        new three.Quaternion().setFromAxisAngle(new three.Vector3(0, 1, 0), placement.angle ?? 0),
        new three.Vector3(...(placement.scale ?? [1, 1, 1]))
      );
      mesh.setMatrixAt(index, matrix);
      entries.set(index, {
        source: {
          generatedBiome: placement.generated ?? true,
          biomeKey: placement.biome ?? 'cavern',
          modelKey: key,
        },
      });
    }
    pool._groups.set(key, { instancedMesh: mesh });
    pool._metadata.set(key, entries);
    return mesh;
  };
  const rock = add('rock-medium-2', [4, 2, 4], [{ position: [0, 1, 0] }, { position: [2, 1, 0] }]);
  const formations = add(
    'source-cave-stalagmite',
    [2, 3, 0.5],
    [
      { position: [2.4, 1, 0], angle: Math.PI / 2, scale: [1, 1, 2] },
      { position: [8, 1, 0] },
      { position: [0, 1, 0], generated: false },
      { position: [0, 1, 0], biome: 'crystalSpires' },
    ]
  );
  try {
    expect(resolveCavernSceneryClearance(pool)).toBe(1);
    expect([...pool._metadata.get('source-cave-stalagmite').keys()]).toEqual([1, 2, 3]);
    expect(pool._metadata.get('rock-medium-2').size).toBe(2);
  } finally {
    for (const mesh of [rock, formations]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
      mesh.dispose();
    }
  }
});

test('an empty generated cavern needs no loaded model resources', () => {
  expect(resolveCavernSceneryClearance({ _groups: new Map(), _metadata: new Map() })).toBe(0);
});

test('real scenery footprints leave a five-foot route without removing nearby decorations', () => {
  const pool = {
    _three: three,
    _groups: new Map(),
    _metadata: new Map(),
    gameManager: {
      spatial: { elevationUnit: 0.3 },
      getTerrainHeight: () => 0,
    },
    removePlaceable({ __meshPoolHandle }) {
      this._metadata.get(__meshPoolHandle.key).delete(__meshPoolHandle.index);
    },
  };
  const geometry = new three.BoxGeometry(4, 2, 4);
  const material = new three.MeshBasicMaterial();
  const rocks = new three.InstancedMesh(geometry, material, 2);
  rocks.setMatrixAt(0, new three.Matrix4().makeTranslation(2.5, 1, 2.5));
  rocks.setMatrixAt(1, new three.Matrix4().makeTranslation(10, 1, 10));
  pool._groups.set('rocks', { instancedMesh: rocks });
  pool._metadata.set(
    'rocks',
    new Map(
      [0, 1].map((index) => [
        index,
        {
          source: {
            type: 'plant',
            generatedBiome: true,
            biomeKey: 'cavern',
            modelKey: 'rock-medium-2',
          },
        },
      ])
    )
  );
  const formationGeometry = new three.BoxGeometry(0.5, 2, 0.5);
  const formation = new three.InstancedMesh(formationGeometry, material, 2);
  formation.setMatrixAt(0, new three.Matrix4().makeTranslation(4.5, 1, 2.5));
  formation.setMatrixAt(1, new three.Matrix4().makeTranslation(4.5, 1, 1.2));
  pool._groups.set('formations', { instancedMesh: formation });
  pool._metadata.set(
    'formations',
    new Map([
      ...[0, 1].map((index) => [
        index,
        {
          source: {
            type: 'plant',
            generatedBiome: true,
            biomeKey: 'cavern',
            modelKey: 'source-cave-stalagmite',
          },
        },
      ]),
    ])
  );
  try {
    expect(
      resolveCavernSceneryClearance(pool, { routeCells: [{ x: 4, z: 2 }], tileWorldSize: 1 })
    ).toBe(2);
    expect([...pool._metadata.get('rocks').keys()]).toEqual([1]);
    expect([...pool._metadata.get('formations').keys()]).toEqual([1]);
  } finally {
    geometry.dispose();
    formationGeometry.dispose();
    material.dispose();
    rocks.dispose();
    formation.dispose();
  }
});

test('a shifted formation is rejected if its actual base spans unequal floor heights', () => {
  const geometry = new three.BoxGeometry(0.6, 2, 0.4);
  const material = new three.MeshBasicMaterial();
  const mesh = new three.InstancedMesh(geometry, material, 2);
  mesh.setMatrixAt(0, new three.Matrix4().makeTranslation(1.85, 1, 1.5));
  mesh.setMatrixAt(1, new three.Matrix4().makeTranslation(3.5, 1.3, 3.5));
  const source = (gridX, gridY) => ({
    type: 'plant',
    generatedBiome: true,
    biomeKey: 'cavern',
    modelKey: 'source-cave-stalagmite',
    gridX,
    gridY,
  });
  const pool = {
    _three: three,
    _groups: new Map([
      [
        'formations',
        {
          instancedMesh: mesh,
          supportBounds: new three.Box3(
            new three.Vector3(-0.3, -1, -0.2),
            new three.Vector3(0.3, -0.9, 0.2)
          ),
        },
      ],
    ]),
    _metadata: new Map([
      [
        'formations',
        new Map([
          [0, { source: source(1, 1) }],
          [1, { source: source(3, 3) }],
        ]),
      ],
    ]),
    gameManager: {
      cols: 5,
      rows: 5,
      spatial: { elevationUnit: 0.3, gridToWorld: (x, z) => ({ x, z }) },
      getTerrainHeight: (x) => (x >= 2 ? 1 : 0),
    },
    removePlaceable({ __meshPoolHandle }) {
      this._metadata.get(__meshPoolHandle.key).delete(__meshPoolHandle.index);
    },
  };
  try {
    expect(resolveCavernSceneryClearance(pool, { tileWorldSize: 1, checkSupport: true })).toBe(1);
    expect([...pool._metadata.get('formations').keys()]).toEqual([1]);
  } finally {
    geometry.dispose();
    material.dispose();
    mesh.dispose();
  }
});
