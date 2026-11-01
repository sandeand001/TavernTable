import { TerrainConstructionPanel } from '../../../src/ui/TerrainConstructionPanel.js';
import { createTerrainWorld } from '../../helpers/terrainWorld.js';

test('construction controls commit a bounded box and isolate its view without changing collision', () => {
  const world = createTerrainWorld(25, 25, null);
  const root = document.createElement('section');
  document.body.appendChild(root);
  const panel = new TerrainConstructionPanel({ root, gameManager: world.gm });
  try {
    const set = (name, value) => {
      root.querySelector(`[name="${name}"]`).value = String(value);
    };
    set('x', 10);
    set('z', 10);
    set('bottom', 9);
    set('width', 20);
    set('depth', 10);
    set('height', 1);
    set('layer', 'upper');
    root
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(
      world.engine.geometry.getSurfacesAt(15, 15).map((surface) => surface.heightFeet)
    ).toEqual([0, 10]);
    const view = root.querySelector('[data-layer-view]');
    view.value = 'ground';
    view.dispatchEvent(new Event('change', { bubbles: true }));
    expect(world.engine.visibleLayers).toEqual(['ground']);
    expect(world.engine.geometry.findSupport(15, 15, { belowFeet: 20 }).heightFeet).toBe(10);
    world.engine.undo();
    expect(world.engine.geometry.hasVolumes).toBe(false);
  } finally {
    panel.dispose();
    world.dispose();
    root.remove();
  }
});
