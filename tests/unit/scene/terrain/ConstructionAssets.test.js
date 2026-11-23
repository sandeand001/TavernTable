import * as three from 'three';
import {
  buildConstructionAssets,
  clipConstructionReplacementFace,
} from '../../../../src/scene/terrain/ConstructionAssets.js';
import { createStructure } from '../../../../src/terrain/ConstructionBlueprints.js';
import { buildingFeetToLocal, buildingLocalToFeet } from '../../../../src/terrain/BuildingModel.js';
import { getConstructionAppearance } from '../../../../src/config/biome/ConstructionPalettes.js';

const unit = 0.2;
const makeSpec = ({ building = {}, ...overrides } = {}) =>
  createStructure({
    id: 'cottage',
    kind: 'building',
    xFeet: 45,
    zFeet: 50,
    baseFeet: 5,
    lengthFeet: 30,
    widthFeet: 20,
    angleRadians: Math.PI / 2,
    ...overrides,
    building: { autoWindows: false, stairs: false, ...building },
    appearance: {
      ...getConstructionAppearance('town'),
      facadeModelKey: 'source-medieval-wall-door',
    },
  });

function fixtureCache() {
  const panels = {
    'source-medieval-wall-straight': [2, 3.125, 0.4],
    'source-medieval-roof': [8, 5, 8],
    'source-medieval-roof-front': [6.5, 4.5, 1.1],
    'source-medieval-balcony': [2, 1.25, 0.2],
  };
  const models = Object.fromEntries(
    Object.entries(panels).map(([key, size]) => {
      const group = new three.Group();
      const isPanel = key.endsWith('-straight');
      const mesh = new three.Mesh(
        new three.BoxGeometry(...size),
        new three.MeshBasicMaterial({ name: isPanel ? 'MI_Plaster' : 'MI_WoodTrim' })
      );
      mesh.position.y = size[1] / 2;
      mesh.position.z = 1;
      group.add(mesh);
      if (isPanel) group.scale.setScalar(3.2);
      return [key, group];
    })
  );
  return { getModel: jest.fn(async (key) => models[key]?.clone(true) ?? null) };
}

const assemble = (specs, options) =>
  buildConstructionAssets({
    specs,
    three,
    worldUnitsPerFoot: unit,
    modelAssetCache: fixtureCache(),
    ...options,
  });
const bounds = (object) => new three.Box3().setFromObject(object, true);

test('rotated modular walls leave the authored doorway and window clear, but not adjacent wall', async () => {
  const spec = makeSpec({
    building: {
      windows: [
        {
          id: 'front-window',
          floor: 0,
          side: 'south',
          u: 0.8,
          widthFeet: 4,
          sillFeet: 2,
          heightFeet: 5,
        },
      ],
    },
  });
  const assets = await assemble([spec], { visibleLayers: ['ground'] });
  const wallHit = (outside, inside) => {
    const vector = (local) => new three.Vector3().copy(buildingLocalToFeet(spec, local));
    const start = vector(outside);
    const ray = new three.Raycaster(
      start.clone().multiplyScalar(unit),
      vector(inside).sub(start).normalize(),
      0,
      1
    );
    assets.updateMatrixWorld(true);
    const hits = [];
    for (const module of assets.children) {
      if (module.isInstancedMesh) continue;
      module.traverse((mesh) => {
        if (mesh.isMesh) three.Mesh.prototype.raycast.call(mesh, ray, hits);
      });
    }
    return hits.length > 0;
  };
  const frontHit = (x, y) => wallHit({ x, y, z: 12 }, { x, y, z: 9 });
  expect(frontHit(0, 7.8)).toBe(false);
  expect(frontHit(7.1, 6.8)).toBe(false);
  expect(frontHit(9, 7.2)).toBe(true);
  expect(frontHit(9, 1.8)).toBe(true);
  expect(frontHit(14.99, 5)).toBe(true);
  expect(wallHit({ x: 17, y: 5, z: 9.99 }, { x: 14, y: 5, z: 9.99 })).toBe(true);
});

test('both framed gable ends join the rotated end walls without extending past the tiles', async () => {
  const spec = makeSpec({ lengthFeet: 25 });
  const assets = await assemble([spec], { visibleLayers: ['roof'] });
  const roof = bounds(assets.getObjectByName('ConstructionAsset:cottage:source-medieval-roof'));
  expect(roof.max.x - roof.min.x).toBeCloseTo(4.5, 6);
  expect(roof.max.z - roof.min.z).toBeCloseTo(5.5, 6);
  const gables = assets.children
    .filter((child) => child.name?.endsWith(':source-medieval-roof-front'))
    .map(bounds)
    .sort((a, b) => a.min.z - b.min.z);
  expect(gables).toHaveLength(2);
  for (const [index, gable] of gables.entries()) {
    const wallEndZ = (spec.zFeet + ((index === 0 ? -1 : 1) * spec.lengthFeet) / 2) * unit;
    expect(gable.min.z).toBeLessThan(wallEndZ);
    expect(gable.max.z).toBeGreaterThan(wallEndZ);
    expect(gable.min.z).toBeGreaterThan(roof.min.z + 0.1);
    expect(gable.max.z).toBeLessThan(roof.max.z - 0.1);
    expect(gable.min.y).toBeLessThan(roof.min.y);
  }
});

test('modeled rails stay seated inside an off-center side balcony and replace only old rail faces', async () => {
  const spec = makeSpec({
    heightFeet: 20,
    building: {
      roof: 'hipped',
      balconies: [{ id: 'side', floor: 1, side: 'east', u: 0.6, widthFeet: 10, depthFeet: 5 }],
    },
  });
  const assets = await assemble([spec], { visibleLayers: ['balcony'] });
  const rails = assets.children.filter((child) =>
    child.name?.includes(':source-medieval-balcony-')
  );
  expect(rails).toHaveLength(3);
  for (const rail of rails) {
    const box = bounds(rail);
    const center = buildingFeetToLocal(spec, box.getCenter(new three.Vector3()).divideScalar(unit));
    expect(box.min.y).toBeCloseTo(3, 6);
    expect(box.max.y).toBeCloseTo(3.6, 6);
    expect(center.x).toBeGreaterThan(spec.lengthFeet / 2);
    expect(center.x).toBeLessThan(spec.lengthFeet / 2 + 5);
    expect(center.z).toBeGreaterThan(-3);
    expect(center.z).toBeLessThan(7);
  }
  const frontRail = rails.find((rail) => rail.name.endsWith('-front'));
  const frontCenter = buildingFeetToLocal(
    spec,
    bounds(frontRail).getCenter(new three.Vector3()).divideScalar(unit)
  );
  expect(frontCenter.z).toBeCloseTo(2);
  expect(frontCenter.x).toBeGreaterThan(spec.lengthFeet / 2 + 4.5);
  const points = [{ x: 0, y: 1, z: 2 }];
  const clip = (id, layerId) =>
    clipConstructionReplacementFace({
      source: { id: `${spec.id}-${id}`, structureId: spec.id, layerId },
      points,
      replacements: assets.userData.replacements,
    });
  expect(clip('balcony-side-outer-rail', 'balcony')).toEqual([]);
  expect(clip('balcony-side-deck', 'balcony')).toEqual([points]);
  expect(clip('roof-shape', 'roof')).toEqual([points]);
});

test('ruins keep their existing geometry and do not request the intact village kit', async () => {
  const cache = fixtureCache();
  const assets = await assemble([makeSpec({ ruined: true })], { modelAssetCache: cache });
  expect(assets.children).toHaveLength(0);
  expect(assets.userData.replacements).toHaveLength(0);
  expect(cache.getModel).not.toHaveBeenCalled();
});

test('two textured cottages share instanced draws instead of duplicating model draw sets', async () => {
  const assets = await assemble([
    makeSpec({ id: 'one', xFeet: 30 }),
    makeSpec({ id: 'two', xFeet: 70 }),
  ]);
  expect(
    assets.children
      .filter((child) => child.isInstancedMesh)
      .some((mesh) => ['one', 'two'].every((id) => mesh.userData.structureIds.includes(id)))
  ).toBe(true);
});

test('Dungeon walls instance the reviewed model around a physically open doorway', async () => {
  const wall = createStructure({
    id: 'dungeon-door',
    kind: 'wall',
    xFeet: 50,
    zFeet: 50,
    lengthFeet: 30,
    widthFeet: 2,
    heightFeet: 10,
    angleRadians: Math.PI / 2,
    opening: true,
    openingWidthFeet: 10,
    openingHeightFeet: 8,
    source: 'generated',
    appearance: {
      ...getConstructionAppearance('dungeon'),
      facadeModelKey: 'source-dungeon-wall',
    },
  });

  const geometry = new three.BoxGeometry(10, 10, 2);
  geometry.clearGroups();
  geometry.addGroup(0, geometry.index.count, 0);
  const material = [new three.MeshBasicMaterial(), new three.MeshBasicMaterial()];
  const source = new three.Group();
  const sourceMesh = new three.Mesh(geometry, material);
  sourceMesh.position.y = 5;
  source.add(sourceMesh);
  const cache = { getModel: jest.fn(async () => source.clone(true)) };
  const assets = await assemble([wall], { modelAssetCache: cache });
  const pieces = assets.children.filter((child) =>
    child.name.startsWith('ConstructionAsset:dungeon-door:')
  );
  expect(cache.getModel).toHaveBeenCalledWith('source-dungeon-wall');
  expect(pieces).toHaveLength(3);
  expect(
    assets.children.some((child) => child.isInstancedMesh && Array.isArray(child.material))
  ).toBe(true);
  const openings = pieces.map((piece) => bounds(piece));
  expect(openings.filter((box) => box.min.y === 0)).toHaveLength(2);
  expect(openings.find((box) => box.min.y > 0).min.y).toBeCloseTo(1.6, 6);
  const originalFace = [
    { x: 49, y: 0, z: 35 },
    { x: 49, y: 10, z: 35 },
    { x: 49, y: 10, z: 45 },
  ];
  expect(
    clipConstructionReplacementFace({
      source: { id: 'dungeon-door-wall', structureId: wall.id, layerId: 'castle' },
      points: originalFace,
      replacements: assets.userData.replacements,
    })
  ).toEqual([]);
});

test('long Dungeon walls repeat masonry modules rather than stretching one across the room', async () => {
  const wall = createStructure({
    id: 'long-dungeon-wall',
    kind: 'wall',
    xFeet: 50,
    zFeet: 50,
    lengthFeet: 45,
    widthFeet: 2,
    heightFeet: 10,
    appearance: {
      ...getConstructionAppearance('dungeon'),
      facadeModelKey: 'source-dungeon-wall',
    },
  });
  const source = new three.Mesh(new three.BoxGeometry(10, 10, 2), new three.MeshBasicMaterial());
  const cache = { getModel: jest.fn(async () => source.clone()) };
  const assets = await assemble([wall], { modelAssetCache: cache });
  const sections = assets.children
    .filter((child) => child.name.startsWith('ConstructionAsset:long-dungeon-wall:'))
    .map(bounds)
    .sort((a, b) => a.min.x - b.min.x);

  expect(sections.length).toBeGreaterThan(1);
  expect(sections[0].min.x).toBeCloseTo((wall.xFeet - wall.lengthFeet / 2) * unit, 6);
  expect(sections.at(-1).max.x).toBeCloseTo((wall.xFeet + wall.lengthFeet / 2) * unit, 6);
  for (const [index, section] of sections.entries()) {
    expect(section.max.x - section.min.x).toBeLessThanOrEqual(10 * unit);
    if (index) expect(section.min.x).toBeCloseTo(sections[index - 1].max.x, 6);
  }
});
