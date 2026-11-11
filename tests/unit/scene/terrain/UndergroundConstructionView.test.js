import * as three from 'three';
import { TerrainEngine } from '../../../../src/terrain/TerrainEngine.js';
import { UndergroundConstructionView } from '../../../../src/scene/terrain/UndergroundConstructionView.js';
import { ConstructionPreview } from '../../../../src/scene/terrain/ConstructionPreview.js';
import { createStructure } from '../../../../src/terrain/ConstructionBlueprints.js';

function fixture() {
  const engine = new TerrainEngine(30, 30);
  engine.placeStructure({
    id: 'cellar',
    kind: 'cellar',
    xFeet: 65,
    zFeet: 65,
    heightFeet: 20,
    lengthFeet: 40,
    widthFeet: 30,
  });
  const scene = new three.Scene(),
    callbacks = new Set();
  const terrain = new three.Mesh(
    new three.BoxGeometry(30, 1, 30),
    new three.MeshLambertMaterial({ opacity: 0.8, transparent: true })
  );
  terrain.name = 'TerrainMesh';
  scene.add(terrain);
  const gm = {
    cols: 30,
    rows: 30,
    terrainEngine: engine,
    spatial: { tileWorldSize: 1 },
    threeSceneManager: {
      three,
      scene,
      addAnimationCallback: (fn) => callbacks.add(fn),
      removeAnimationCallback: (fn) => callbacks.delete(fn),
    },
  };
  engine.activate();
  return { gm, engine, terrain, callbacks, view: new UndergroundConstructionView(gm) };
}

test('the underground toggle reveals buried cellars before selection, changes rendering only and restores the original materials', () => {
  const { gm, engine, terrain, view, callbacks } = fixture();
  const saved = engine.save(),
    material = terrain.material,
    solids = jest.spyOn(engine.geometry, 'getSolidCells');
  try {
    view.update({ enabled: true });
    expect(terrain.material.wireframe).toBe(true);
    expect(terrain.material).not.toBe(material);
    const root = gm.threeSceneManager.scene.getObjectByName('UndergroundConstructionView');
    expect(root.visible).toBe(true);
    expect(root.getObjectByName('cellar:cellar')).toBeDefined();
    expect(engine.save()).toEqual(saved);
    expect(solids).not.toHaveBeenCalled();
    for (let frame = 0; frame < 60; frame++) for (const fn of callbacks) fn();
    expect(solids).not.toHaveBeenCalled();
    view.update({ enabled: false });
    expect(root.visible).toBe(false);
    expect(terrain.material).toBe(material);
    expect(material.opacity).toBe(0.8);
    expect(material.wireframe).toBe(false);
  } finally {
    view.dispose();
    terrain.geometry.dispose();
    material.dispose();
  }
});

test('underground picking reaches the buried floor despite the opaque physical surface and selects its level', () => {
  const { gm, view, terrain } = fixture(),
    material = terrain.material;
  try {
    view.update({ enabled: true });
    const ray = new three.Raycaster(new three.Vector3(13, 10, 13), new three.Vector3(0, -1, 0));
    const hit = view.pick(ray);
    expect(hit).toMatchObject({ spec: { id: 'cellar' }, levelId: 0 });
    expect(hit.distance).toBeGreaterThan(10);
    expect(terrain.material.wireframe).toBe(true);
    expect(gm.terrainEngine.geometry.findSupport(65, 65, { belowFeet: 1 }).heightFeet).toBe(0);
  } finally {
    view.dispose();
    terrain.geometry.dispose();
    material.dispose();
  }
});

test('replaced terrain meshes do not leak cloned materials and leaving the exterior restores all rendering', () => {
  const { gm, view, terrain, callbacks } = fixture(),
    material = terrain.material;
  try {
    view.update({ enabled: true });
    const clone = terrain.material,
      disposed = jest.spyOn(clone, 'dispose');
    terrain.removeFromParent();
    const next = new three.Mesh(terrain.geometry, new three.MeshLambertMaterial());
    const original = next.material;
    next.name = 'TerrainMesh';
    gm.threeSceneManager.scene.add(next);
    for (const frame of [...callbacks]) frame();
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(terrain.material).toBe(material);
    expect(next.material.wireframe).toBe(true);
    gm.terrainEngine.configureGeometryBase(0.5);
    for (const frame of [...callbacks]) frame();
    expect(next.material).toBe(original);
    expect(view.root.visible).toBe(false);
    original.dispose();
  } finally {
    view.dispose();
    terrain.geometry.dispose();
    material.dispose();
  }
});

test('selected cellar levels are visible through ground and new previews do not mutate authoritative terrain', () => {
  const { gm, engine, view, terrain } = fixture();
  const material = terrain.material;
  const preview = new ConstructionPreview(gm),
    saved = engine.save();
  const candidate = createStructure({
    id: 'preview',
    kind: 'cellar',
    xFeet: 80,
    zFeet: 80,
    heightFeet: 20,
    lengthFeet: 50,
    widthFeet: 40,
  });

  try {
    preview.show(candidate);
    expect(preview.mesh.material.depthTest).toBe(false);
    view.update({ enabled: true, candidate, selectedId: null, levelId: 0 });
    const floor = gm.threeSceneManager.scene.getObjectByName('UndergroundActiveFloor');
    expect(floor).toBeDefined();
    expect(floor.material.depthTest).toBe(false);
    expect(floor.geometry.getAttribute('position').count).toBeGreaterThan(0);
    const geometry = floor.geometry;
    view.update({ enabled: true, candidate, selectedId: null, levelId: 0 });
    expect(gm.threeSceneManager.scene.getObjectByName('UndergroundActiveFloor').geometry).toBe(
      geometry
    );
    expect(engine.save()).toEqual(saved);
    engine.deactivate();
    expect(terrain.material).toBe(material);
  } finally {
    view.dispose();
    preview.dispose();
    terrain.geometry.dispose();
    material.dispose();
  }
});
