import * as three from 'three';
import { TerrainEngine } from '../../../src/terrain/TerrainEngine.js';
import { clipCell } from '../../../src/terrain/ConvexGeometry.js';
import {
  getConstructionAppearance,
  getConstructionPalette,
} from '../../../src/config/biome/ConstructionPalettes.js';
import { getTerrainLayerColor } from '../../../src/scene/terrain/TerrainMaterialFactory.js';
import { TerrainVolumeMeshBuilder } from '../../../src/scene/terrain/TerrainVolumeMeshBuilder.js';
import MapProjectionTerrain from '../../../src/scene/token-adapter/MapProjectionTerrain.js';
import {
  configureConstructionMaterial,
  cloneConstructionMaterial,
} from '../../../src/scene/terrain/ConstructionMaterials.js';

test.each(['town', 'city', 'castle'])(
  '%s has coordinated, genuinely varied architectural palettes',
  (biome) => {
    const palettes = Array.from({ length: 8 }, (_, i) => getConstructionAppearance(biome, i, 2));
    expect(new Set(palettes.map((p) => p.wallColor)).size).toBeGreaterThanOrEqual(
      biome === 'castle' ? 3 : 5
    );
    expect(new Set(palettes.map((p) => p.roofColor)).size).toBeGreaterThanOrEqual(3);
    expect(palettes).toEqual(
      Array.from({ length: 8 }, (_, i) => getConstructionAppearance(biome, i, 2))
    );
    if (biome === 'castle') expect(new Set(palettes.map((p) => p.accentColor)).size).toBe(1);
  }
);

test('appearance survives saving, geometry clipping, recolouring, undo and reopening without moving the building', () => {
  const engine = new TerrainEngine(25, 25),
    appearance = getConstructionAppearance('town', 1);
  engine.placeStructure({
    id: 'house',
    name: 'Foxglove Inn',
    kind: 'building',
    source: 'generated',
    xFeet: 50,
    zFeet: 50,
    lengthFeet: 25,
    widthFeet: 20,
    heightFeet: 20,
    appearance,
  });
  const before = engine.save();
  const cell = engine.geometry
    .getSolidCells()
    .find((c) => c.structureId === 'house' && c.materialRole === 'masonry');
  const cut = clipCell(cell, {
    normal: { x: 1, y: 0, z: 0 },
    distance: (cell.bounds.min.x + cell.bounds.max.x) / 2,
  });
  expect(cut).toMatchObject({
    materialColor: appearance.wallColor,
    materialStyle: appearance.wallMaterial,
    source: 'generated',
  });
  expect(getTerrainLayerColor('ground', 'town', 'masonry', cut.materialColor)).toBe(
    appearance.wallColor
  );
  engine.resizeStructure('house', { appearance: getConstructionAppearance('city', 2) });
  expect(engine.geometry.getStructures()[0]).toMatchObject({
    xFeet: 50,
    zFeet: 50,
    name: 'Foxglove Inn',
  });
  engine.undo();
  expect(engine.save()).toEqual(before);
  const reopened = new TerrainEngine(1, 1);
  reopened.load(engine.save());
  expect(reopened.save()).toEqual(before);
});

test('different building colours reach actual rendered vertex colours, not just saved palette metadata', () => {
  const engine = new TerrainEngine(25, 25);
  for (let i = 0; i < 5; i++)
    engine.placeStructure({
      id: `wall-${i}`,
      kind: 'wall',
      xFeet: 15 + i * 20,
      zFeet: 40,
      lengthFeet: 10,
      widthFeet: 2,
      appearance: getConstructionAppearance('city', i),
    });
  const mesh = new TerrainVolumeMeshBuilder().build({
    geometry: engine.geometry,
    three,
    worldUnitsPerFoot: 1,
  });
  try {
    const positions = mesh.getAttribute('position'),
      colours = mesh.getAttribute('color'),
      tops = [];
    for (let i = 0; i < 5; i++) {
      const x = 15 + i * 20;
      let index = -1;
      for (let vertex = 0; vertex < positions.count; vertex++)
        if (
          positions.getY(vertex) === 10 &&
          Math.abs(positions.getX(vertex) - x) <= 5 &&
          Math.abs(positions.getZ(vertex) - 40) <= 1
        ) {
          index = vertex;
          break;
        }
      expect(index).toBeGreaterThanOrEqual(0);
      tops.push([colours.getX(index), colours.getY(index), colours.getZ(index)].join(','));
    }
    expect(new Set(tops).size).toBe(5);
    expect(mesh.getAttribute('constructionMaterial').count).toBe(positions.count);
  } finally {
    mesh.dispose();
  }
});

test('coplanar paving colours the ground without changing its physical support identity', () => {
  const engine = new TerrainEngine(5, 5);
  engine.addVolume({
    id: 'street',
    source: 'generated',
    layerId: 'street',
    materialRole: 'paving',
    materialColor: 0x998877,
    materialStyle: 'paving',
    bounds: { min: { x: 5, y: -0.1, z: 5 }, max: { x: 20, y: 0, z: 20 } },
  });
  expect(engine.geometry.findSupport(10, 10, { clearanceFeet: 5 })).toMatchObject({
    id: 'terrain',
    heightFeet: 0,
  });
  expect(engine.geometry.getSolidSpansAt(10, 10)[0]).toMatchObject({
    materialColor: 0x998877,
    materialStyle: 'paving',
  });
});

test('legacy structures still use their original biome colours without receiving new appearance fields', () => {
  const engine = new TerrainEngine(25, 25);
  engine.placeStructure({ id: 'legacy', kind: 'building', xFeet: 50, zFeet: 50 });
  expect(engine.geometry.getStructures()[0].appearance).toBeUndefined();
  expect(getTerrainLayerColor('ground', 'town', 'masonry')).toBe(
    getConstructionPalette('town').masonry
  );
});

test('one rendered floor batch retains the original per-map picking identities and material attributes', () => {
  const gm = {
    campaignWorld: {},
    threeSceneManager: { three, scene: new three.Scene() },
    terrainEngine: { onChanged: () => () => {} },
  };
  const projection = new MapProjectionTerrain(gm);
  const original = [];
  for (const [id, x, y] of [
    ['floor-a', 5, 0],
    ['floor-b', 25, 10],
  ]) {
    const geometry = new three.BoxGeometry(10, 0.5, 10).toNonIndexed().translate(x, y - 0.25, 5);
    const count = geometry.getAttribute('position').count;
    geometry.setAttribute(
      'color',
      new three.Float32BufferAttribute(new Float32Array(count * 3).fill(0.5), 3)
    );
    geometry.setAttribute(
      'constructionMaterial',
      new three.Float32BufferAttribute(new Float32Array(count).fill(4), 1)
    );
    const mesh = new three.Mesh(geometry, projection.material);
    mesh.userData.campaignMapId = id;
    projection.floorMeshes.set(id, mesh);
    projection.floors.add(mesh);
    original.push(geometry);
  }
  try {
    projection._batchPhysicalFloors();
    expect(projection.floors.children).toHaveLength(1);
    expect([...projection.floorMeshes.values()].map((mesh) => mesh.geometry)).toEqual(original);
    const ray = new three.Raycaster(new three.Vector3(25, 20, 5), new three.Vector3(0, -1, 0));
    const hits = ray.intersectObject(projection.floorBatch);
    expect(hits[0].object.userData.campaignMapId).toBe('floor-b');
    expect(projection.floorBatch.geometry.getAttribute('constructionMaterial').count).toBe(
      projection.floorBatch.geometry.getAttribute('position').count
    );
  } finally {
    projection.dispose();
  }
});

test('procedural construction materials retain the physical scale and shader hook when cloned for underground editing', () => {
  const original = new three.MeshLambertMaterial({ vertexColors: true });
  const previous = jest.fn();
  original.onBeforeCompile = previous;
  configureConstructionMaterial(original, 0.2);
  const shader = () => ({
    uniforms: {},
    vertexShader: '#include <common>\n#include <begin_vertex>',
    fragmentShader: '#include <common>\n#include <color_fragment>',
  });
  const first = shader();
  original.onBeforeCompile(first, null);
  expect(previous).toHaveBeenCalledTimes(1);
  expect(first.uniforms.uConstructionScale.value).toBe(0.2);
  expect(first.fragmentShader).toContain('constructionSurface(diffuseColor.rgb)');
  const clone = cloneConstructionMaterial(original),
    second = shader();
  clone.onBeforeCompile(second, null);
  expect(second.uniforms.uConstructionScale.value).toBe(0.2);
  configureConstructionMaterial(clone, 0.4);
  expect(second.uniforms.uConstructionScale.value).toBe(0.4);
  clone.dispose();
  original.dispose();
});

test.each([
  { wallColor: -1 },
  { roofColor: NaN },
  { wallMaterial: 'missing' },
  { detail: 'missing' },
  { unexpected: true },
])('invalid appearance edits are atomic: %j', (invalid) => {
  const engine = new TerrainEngine(25, 25),
    appearance = getConstructionAppearance('town', 0);
  engine.placeStructure({ id: 'house', kind: 'building', xFeet: 50, zFeet: 50, appearance });
  const before = engine.save();
  expect(() =>
    engine.resizeStructure('house', { appearance: { ...appearance, ...invalid } })
  ).toThrow(/appearance/);
  expect(engine.save()).toEqual(before);
});
