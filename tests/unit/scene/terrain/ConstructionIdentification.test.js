import * as three from 'three';
import { TerrainEngine } from '../../../../src/terrain/TerrainEngine.js';
import { ConstructionIdentification } from '../../../../src/scene/terrain/ConstructionIdentification.js';

test('map identifiers are clickable, the chosen cellar target is outlined in gold and nothing changes campaign geometry', () => {
  const engine = new TerrainEngine(30, 30),
    scene = new three.Scene(),
    frames = new Set();
  engine.placeStructure({ id: 'structure-1', kind: 'building', xFeet: 50, zFeet: 50 });
  engine.placeStructure({ id: 'structure-2', kind: 'building', xFeet: 100, zFeet: 100 });
  engine.activate();
  const gm = {
    cols: 30,
    rows: 30,
    terrainEngine: engine,
    spatial: { tileWorldSize: 1 },
    threeSceneManager: {
      three,
      scene,
      addAnimationCallback: (fn) => frames.add(fn),
      removeAnimationCallback: (fn) => frames.delete(fn),
    },
  };
  const select = jest.fn(),
    view = new ConstructionIdentification(gm, select),
    saved = engine.save();
  try {
    view.update({ selectedId: 'structure-2', targetId: 'structure-1' });
    const label = document.querySelector('[data-structure-id="structure-1"]');
    expect(label.textContent).toBe('Building 1');
    expect(label.dataset.state).toBe('connection-target');
    expect(scene.getObjectByName('ConstructionConnectionTarget').material.color.getHex()).toBe(
      0xffcc66
    );
    label.click();
    expect(select).toHaveBeenCalledWith(expect.objectContaining({ id: 'structure-1' }));
    view.update({ selectedId: 'structure-2', targetId: 'structure-2' });
    expect(document.querySelector('[data-structure-id="structure-1"]').dataset.state).toBe('');
    expect(document.querySelector('[data-structure-id="structure-2"]').dataset.state).toBe(
      'connection-target'
    );
    expect(engine.save()).toEqual(saved);
    engine.deactivate();
    for (const fn of [...frames]) fn();
    expect(document.querySelector('[aria-label="Structure identifiers"]').hidden).toBe(true);
    expect(scene.getObjectByName('ConstructionConnectionTarget')).toBeUndefined();
  } finally {
    view.dispose();
  }
  expect(document.querySelector('[aria-label="Structure identifiers"]')).toBeNull();
});
