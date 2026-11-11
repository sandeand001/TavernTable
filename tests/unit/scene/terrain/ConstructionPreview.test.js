import * as three from 'three';
import { TerrainEngine } from '../../../../src/terrain/TerrainEngine.js';
import { ConstructionPreview } from '../../../../src/scene/terrain/ConstructionPreview.js';
import { createStructure } from '../../../../src/terrain/ConstructionBlueprints.js';

test('live drag previews never rebuild authoritative world solids or edit saved state', () => {
  const engine = new TerrainEngine(25, 25);
  const scene = new three.Scene();
  const gm = {
    cols: 25,
    rows: 25,
    terrainEngine: engine,
    spatial: { tileWorldSize: 1 },
    threeSceneManager: { three, scene },
  };
  const preview = new ConstructionPreview(gm);
  const solids = jest.spyOn(engine.geometry, 'getSolidCells');
  const saved = engine.save();
  try {
    for (let i = 0; i < 30; i++)
      preview.show(
        createStructure({
          id: 'preview',
          kind: 'wall',
          style: 'battlement',
          xFeet: 60,
          zFeet: 60,
          widthFeet: 10,
          lengthFeet: 20 + i,
          angleRadians: i / 30,
        })
      );
    expect(solids).not.toHaveBeenCalled();
    expect(engine.save()).toEqual(saved);
    expect(scene.children.filter((child) => child.name === 'ConstructionPreview')).toHaveLength(1);
    expect(preview.mesh.geometry.getAttribute('position').count).toBeLessThan(4000);
    preview.show(
      createStructure({
        id: 'selected',
        kind: 'dome',
        xFeet: 50,
        zFeet: 50,
      }),
      { wireframe: true }
    );
    expect(preview.mesh.isLineSegments).toBe(true);
    expect(preview.mesh.material.depthTest).toBe(false);
    const geometry = preview.mesh.geometry,
      dispose = jest.spyOn(geometry, 'dispose');
    preview.clear();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(scene.children).toHaveLength(0);
  } finally {
    preview.dispose();
  }
});

test('a cellar placement ghost is visible through the surface before it has been selected or committed', () => {
  const engine = new TerrainEngine(25, 25),
    scene = new three.Scene();
  const gm = {
    cols: 25,
    rows: 25,
    terrainEngine: engine,
    spatial: { tileWorldSize: 1 },
    threeSceneManager: { three, scene },
  };
  const preview = new ConstructionPreview(gm),
    before = engine.save();
  try {
    preview.show(createStructure({ id: 'preview', kind: 'cellar', xFeet: 60, zFeet: 60 }));
    expect(preview.mesh.material.depthTest).toBe(false);
    expect(engine.save()).toEqual(before);
  } finally {
    preview.dispose();
  }
});
