import * as three from 'three';
import { TerrainEngine } from '../../../../src/terrain/TerrainEngine.js';
import { TerrainVolumeMeshBuilder } from '../../../../src/scene/terrain/TerrainVolumeMeshBuilder.js';
import {
  BoundaryWallCutaway,
  dungeonBoundaryWalls,
} from '../../../../src/scene/terrain/BoundaryWallCutaway.js';

test('only visible exterior Dungeon wall portions are cut from physical render geometry', () => {
  const engine = new TerrainEngine(25, 25);
  engine.generateBiomeElevation('dungeon', { seed: 42, dungeonRoomCount: 6 });
  const physical = engine.geometry.save();
  const boundary = dungeonBoundaryWalls({
    geometry: engine.geometry,
    cols: 25,
    rows: 25,
    tileWorldSize: 1,
  });
  const cutaway = new BoundaryWallCutaway({
    cols: 25,
    rows: 25,
    getHeight: (x, z) => engine.getHeightAt(x, z),
    tileWorldSize: 1,
    elevationUnit: 0.3,
    three,
    boundary,
  });
  const geometry = new TerrainVolumeMeshBuilder().build({
    geometry: engine.geometry,
    three,
    worldUnitsPerFoot: 0.2,
    getBoundaryWallCell: (x, z, span) => cutaway.boundaryCell(x, z, span),
    getDungeonLintelBounds: boundary.lintelBoundsFor,
  });
  const baseline = new TerrainVolumeMeshBuilder().build({
    geometry: engine.geometry,
    three,
    worldUnitsPerFoot: 0.2,
    getBoundaryWallCell: (x, z, span) => cutaway.boundaryCell(x, z, span),
  });
  const surfaceArea = (meshGeometry) => {
    const positions = meshGeometry.getAttribute('position');
    let area = 0;
    for (let index = 0; index < positions.count; index += 3) {
      const a = new three.Vector3().fromBufferAttribute(positions, index);
      const b = new three.Vector3().fromBufferAttribute(positions, index + 1);
      const c = new three.Vector3().fromBufferAttribute(positions, index + 2);
      area += b.sub(a).cross(c.sub(a)).length() / 2;
    }
    return area;
  };
  const material = new three.MeshBasicMaterial({ side: three.DoubleSide });
  const mesh = new three.Mesh(geometry, material);
  const camera = new three.PerspectiveCamera(35, 1, 0.1, 100);
  const target = new three.Vector3(12.5, 0, 23.5);
  camera.position.set(12.5, 5, 36);
  camera.lookAt(target);
  camera.updateProjectionMatrix();
  cutaway.attach(mesh);
  const targetHit = () => {
    const ndc = target.clone().project(camera);
    const ray = new three.Raycaster();
    ray.setFromCamera(new three.Vector2(ndc.x, ndc.y), camera);
    return ray.intersectObject(mesh)[0];
  };
  const southWall = (x) => {
    const ray = new three.Raycaster(new three.Vector3(x, 1, 23.5), new three.Vector3(0, 0, 1));
    return ray.intersectObject(mesh)[0];
  };
  const partition = engine.geometry
    .getStructures()
    .find((structure) => structure.name === 'Dungeon Room Partition');
  const hitPartition = () => {
    const horizontal = Math.abs(Math.sin(partition.angleRadians)) < 0.5;
    const center = new three.Vector3(partition.xFeet / 5, 1, partition.zFeet / 5);
    const direction = horizontal ? new three.Vector3(0, 0, -1) : new three.Vector3(-1, 0, 0);
    const origin = center.clone().addScaledVector(direction, -1);
    return new three.Raycaster(origin, direction).intersectObject(mesh)[0];
  };
  try {
    expect(targetHit().point.z).toBeGreaterThan(24);
    expect(surfaceArea(geometry)).toBeCloseTo(surfaceArea(baseline), 4);
    const interiorHit = hitPartition();
    expect(interiorHit).toBeDefined();
    cutaway.update(camera);
    expect(targetHit().point.distanceTo(target)).toBeLessThan(1e-5);
    expect(southWall(12.5)).toBeUndefined();
    expect(southWall(2.5)).toBeDefined();
    expect(hitPartition().point.distanceTo(interiorHit.point)).toBeLessThan(1e-5);
    camera.position.set(12.5, 30, 12.5);
    camera.lookAt(12.5, 0, 12.5);
    cutaway.update(camera);
    expect(southWall(12.5)).toBeDefined();
    const doorway = engine.geometry
      .getStructures()
      .find((structure) => structure.name.endsWith('Room Doorway'));
    const doorwayPoint = new three.Vector3(doorway.xFeet / 5, 0, doorway.zFeet / 5);
    camera.position.set(doorwayPoint.x, 30, doorwayPoint.z);
    camera.lookAt(doorwayPoint);
    cutaway.update(camera);
    const overhead = (point = doorwayPoint) =>
      new three.Raycaster(
        point.clone().add(new three.Vector3(0, 30, 0)),
        new three.Vector3(0, -1, 0)
      ).intersectObject(mesh)[0];
    expect(overhead().point.y).toBeCloseTo(0, 5);
    const jamb = doorwayPoint
      .clone()
      .add(
        new three.Vector3(
          Math.cos(doorway.angleRadians),
          0,
          Math.sin(doorway.angleRadians)
        ).multiplyScalar((doorway.openingWidthFeet / 2 + 0.5) / 5)
      );
    expect(overhead(jamb).point.y).toBeGreaterThan(1.5);
    camera.position.set(doorwayPoint.x, 8, doorwayPoint.z + 20);
    camera.lookAt(doorwayPoint);
    cutaway.update(camera);
    expect(overhead().point.y).toBeGreaterThan(1.5);
    expect(engine.geometry.save()).toEqual(physical);
  } finally {
    geometry.dispose();
    baseline.dispose();
    material.dispose();
  }
});

test('perimeter and overhead lintel models are hidden independently and restored', () => {
  const cells = new Uint8Array(25 * 25);
  const tops = new Float64Array(25 * 25);
  for (let x = 0; x < 25; x++) {
    cells[24 * 25 + x] = 1;
    tops[24 * 25 + x] = 2;
  }
  const cutaway = new BoundaryWallCutaway({
    cols: 25,
    rows: 25,
    getHeight: () => 0,
    tileWorldSize: 1,
    elevationUnit: 0.3,
    three,
    boundary: {
      cells,
      tops,
      includesSpan: () => false,
      lintels: new Map([
        [
          'doorway',
          {
            bounds: { min: { x: 60, z: 60 }, max: { x: 65, z: 65 } },
            bottom: 8,
            top: 10,
          },
        ],
      ]),
    },
  });

  const terrain = new three.BufferGeometry();
  terrain.setAttribute(
    'position',
    new three.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 0, 1], 3)
  );
  terrain.setAttribute('boundaryWallCell', new three.Float32BufferAttribute([0, 0, 0], 1));
  const terrainMaterial = new three.MeshBasicMaterial();
  const mesh = new three.Mesh(terrain, terrainMaterial);
  const assets = new three.Group();
  const modelGeometry = new three.BoxGeometry(1, 2, 0.4);
  const modelMaterial = new three.MeshBasicMaterial();
  const models = new three.InstancedMesh(modelGeometry, modelMaterial, 5);
  models.userData.structureIds = ['perimeter', 'interior', 'building', 'doorway', 'doorway'];
  for (let index = 0; index < 3; index++)
    models.setMatrixAt(index, new three.Matrix4().makeTranslation(12.5, 1, 24.7));
  models.setMatrixAt(
    3,
    new three.Matrix4().compose(
      new three.Vector3(12.5, 1.8, 12.5),
      new three.Quaternion(),
      new three.Vector3(1, 0.2, 1)
    )
  );
  models.setMatrixAt(4, new three.Matrix4().makeTranslation(12.5, 1, 12.5));
  assets.add(models);
  const single = new three.Mesh(modelGeometry, modelMaterial);
  single.userData.structureId = 'perimeter';
  single.position.set(13.5, 1, 24.7);
  assets.add(single);
  mesh.add(assets);
  const camera = new three.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(12.5, 5, 36);
  camera.lookAt(12.5, 0, 23.5);
  camera.updateProjectionMatrix();
  try {
    cutaway.attach(mesh);
    cutaway.attachWallModels(assets, new Set(['perimeter']));
    cutaway.update(camera);
    const matrix = new three.Matrix4();
    models.getMatrixAt(0, matrix);
    expect(matrix.elements[0]).toBe(0);
    expect(single.visible).toBe(false);
    for (const index of [1, 2]) {
      models.getMatrixAt(index, matrix);
      expect(matrix.elements[0]).toBe(1);
      expect(matrix.elements[12]).toBeCloseTo(12.5);
    }
    models.getMatrixAt(3, matrix);
    expect(matrix.elements[0]).toBe(1);
    camera.position.set(12.5, 30, 12.5);
    camera.lookAt(12.5, 0, 12.5);
    cutaway.update(camera);
    models.getMatrixAt(3, matrix);
    expect(matrix.elements[0]).toBe(0);
    models.getMatrixAt(4, matrix);
    expect(matrix.elements[0]).toBe(1);
    camera.position.set(12.5, 5, 36);
    camera.lookAt(12.5, 0, 23.5);
    cutaway.update(camera);
    models.getMatrixAt(3, matrix);
    expect(matrix.elements[0]).toBe(1);
    cutaway.restore();
    models.getMatrixAt(0, matrix);
    expect(matrix.elements[0]).toBe(1);
    expect(matrix.elements[12]).toBeCloseTo(12.5);
    expect(single.visible).toBe(true);
  } finally {
    terrain.dispose();
    terrainMaterial.dispose();
    modelGeometry.dispose();
    modelMaterial.dispose();
    models.dispose();
  }
});

test.each([2, 42])('generated Dungeon seed %i reveals doorway centers but not jambs', (seed) => {
  const engine = new TerrainEngine(18, 18);
  engine.generateBiomeElevation('dungeon', { seed, dungeonRoomCount: 6 });
  const boundary = dungeonBoundaryWalls({
    geometry: engine.geometry,
    cols: 18,
    rows: 18,
    tileWorldSize: 1,
  });
  const cutaway = new BoundaryWallCutaway({
    cols: 18,
    rows: 18,
    getHeight: (x, z) => engine.getHeightAt(x, z),
    tileWorldSize: 1,
    elevationUnit: 0.3,
    three,
    boundary,
  });
  const geometry = new TerrainVolumeMeshBuilder().build({
    geometry: engine.geometry,
    three,
    worldUnitsPerFoot: 0.2,
    getBoundaryWallCell: (x, z, span) => cutaway.boundaryCell(x, z, span),
    getDungeonLintelBounds: boundary.lintelBoundsFor,
  });
  const material = new three.MeshBasicMaterial({ side: three.DoubleSide });
  const mesh = new three.Mesh(geometry, material);
  const camera = new three.OrthographicCamera(-12, 12, 12, -12, 0.1, 100);
  camera.position.set(9, 30, 9);
  camera.lookAt(9, 0, 9);
  camera.updateProjectionMatrix();
  const hit = (point) =>
    new three.Raycaster(
      point.clone().add(new three.Vector3(0, 30, 0)),
      new three.Vector3(0, -1, 0)
    ).intersectObject(mesh)[0];
  try {
    cutaway.attach(mesh);
    cutaway.update(camera);
    const doorways = engine.geometry
      .getStructures()
      .filter((structure) => structure.name.endsWith('Room Doorway'));
    expect(doorways.length).toBeGreaterThan(0);
    for (const doorway of doorways) {
      const center = new three.Vector3(doorway.xFeet / 5, 0, doorway.zFeet / 5);
      expect(hit(center).point.y).toBeCloseTo(0, 5);
      const offset = (doorway.openingWidthFeet / 2 + 0.25) / 5;
      const jamb = center
        .clone()
        .add(
          new three.Vector3(
            Math.cos(doorway.angleRadians) * offset,
            0,
            Math.sin(doorway.angleRadians) * offset
          )
        );
      expect(hit(jamb).point.y).toBeGreaterThan(1.5);
    }
  } finally {
    geometry.dispose();
    material.dispose();
  }
});

test.each([true, false])(
  'box-based Dungeon openings remain visible overhead (perimeter: %s)',
  (perimeter) => {
    const engine = new TerrainEngine(10, 10);
    if (perimeter)
      engine.geometry.addSolid({
        id: 'generated-dungeon-1-1-wall',
        layerId: 'castle',
        source: 'generated',
        bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 50, y: 10, z: 2 } },
      });
    engine.geometry.addSolid({
      id: 'generated-dungeon-1-2-wall',
      layerId: 'castle',
      source: 'generated',
      bounds: { min: { x: 0, y: 0, z: 24 }, max: { x: 50, y: 10, z: 26 } },
    });
    engine.geometry.carve({
      id: 'generated-dungeon-1-2-door',
      source: 'generated',
      bounds: { min: { x: 20, y: 0, z: 24 }, max: { x: 30, y: 8, z: 26 } },
    });
    engine.geometry.addSolid({
      id: 'structure-3-wall',
      layerId: 'castle',
      bounds: { min: { x: 0, y: 0, z: 35 }, max: { x: 50, y: 10, z: 37 } },
    });
    engine.geometry.carve({
      id: 'structure-3-door',
      bounds: { min: { x: 20, y: 0, z: 35 }, max: { x: 30, y: 8, z: 37 } },
    });
    const boundary = dungeonBoundaryWalls({
      geometry: engine.geometry,
      cols: 10,
      rows: 10,
      tileWorldSize: 1,
    });
    const cutaway = new BoundaryWallCutaway({
      cols: 10,
      rows: 10,
      getHeight: () => 0,
      tileWorldSize: 1,
      elevationUnit: 0.3,
      three,
      boundary,
    });
    const geometry = new TerrainVolumeMeshBuilder().build({
      geometry: engine.geometry,
      three,
      worldUnitsPerFoot: 0.2,
      getBoundaryWallCell: (x, z, span) => cutaway.boundaryCell(x, z, span),
      getDungeonLintelBounds: boundary.lintelBoundsFor,
    });
    const material = new three.MeshBasicMaterial({ side: three.DoubleSide });
    const mesh = new three.Mesh(geometry, material);
    const camera = new three.OrthographicCamera(-8, 8, 8, -8, 0.1, 100);
    camera.position.set(5, 30, 5);
    camera.lookAt(5, 0, 5);
    camera.updateProjectionMatrix();
    const hit = (x) =>
      new three.Raycaster(new three.Vector3(x, 30, 5), new three.Vector3(0, -1, 0)).intersectObject(
        mesh
      )[0]?.point.y;
    try {
      expect(engine.geometry.hasCurves).toBe(false);
      cutaway.attach(mesh);
      cutaway.update(camera);
      expect(hit(5)).toBeCloseTo(0, 5);
      expect(hit(3.9)).toBeGreaterThan(1.5);
      const manual = new three.Raycaster(
        new three.Vector3(5, 30, 7.2),
        new three.Vector3(0, -1, 0)
      ).intersectObject(mesh)[0];
      expect(manual.point.y).toBeGreaterThan(1.5);
    } finally {
      geometry.dispose();
      material.dispose();
    }
  }
);
