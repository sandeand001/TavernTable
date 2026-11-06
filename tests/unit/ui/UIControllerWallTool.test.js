import '../../../src/ui/UIController.js';
import { TerrainCoordinator } from '../../../src/coordinators/TerrainCoordinator.js';
import { TerrainEngine } from '../../../src/terrain/TerrainEngine.js';

let coordinator;
let terrain;
beforeEach(() => {
  document.body.innerHTML = `
    <button id="terrain-raise-btn">Raise</button><button id="terrain-lower-btn">Lower</button>
    <button id="terrain-wall-btn">Wall</button>
    <div id="terrain-brush-size-controls"><span id="brush-size-display"></span></div>
    <button id="terrain-undo-btn" disabled>Undo</button><button id="terrain-redo-btn" disabled>Redo</button>
    <small id="terrain-history-status"></small><section id="terrain-construction"></section>`;
  const gm = {
    cols: 25,
    rows: 25,
    threeSceneManager: {
      setTerrainBrushPreview: jest.fn(),
      clearTerrainBrushPreview: jest.fn(),
    },
  };
  terrain = new TerrainEngine(25, 25);
  gm.terrainEngine = terrain;
  coordinator = new TerrainCoordinator(gm);
  gm.terrainCoordinator = coordinator;
  gm.setTerrainTool = (tool) => terrain.setTool(tool);
  window.gameManager = gm;
  terrain.activate();
  document.dispatchEvent(new Event('DOMContentLoaded'));
});
afterEach(() => {
  coordinator.dispose();
  jest.restoreAllMocks();
  document.body.replaceChildren();
  delete window.gameManager;
});

test('the existing Wall button selects the same plain/battlement Build tool and hides the sculpting brush size', () => {
  document.getElementById('terrain-wall-btn').click();
  expect(terrain.constructionTool).toBe('wall');
  expect(document.getElementById('terrain-brush-size-controls').hidden).toBe(true);
  expect(document.getElementById('terrain-wall-btn').getAttribute('aria-pressed')).toBe('true');
  expect(document.getElementById('terrain-raise-btn').getAttribute('aria-pressed')).toBe('false');
  expect(document.querySelector('[name="style"]').value).toBe('plain');
  expect(document.querySelector('[name="heightFeet"]').value).toBe('10');
});

test('illustrated construction controls mount once at startup without numeric volume/proof controls', () => {
  const root = document.getElementById('terrain-construction');
  expect(
    root.querySelectorAll('[aria-label="Structure types"] .construction-card img')
  ).toHaveLength(8);
  expect(root.querySelector('[data-build-castle-wall]')).not.toBeNull();
  expect(root.querySelector('[data-build-kind="cellar"]')).not.toBeNull();
  expect(root.querySelector('[data-proof-map]')).toBeNull();
  expect(document.getElementById('terrain-wall-controls')).toBeNull();
  document.dispatchEvent(new Event('DOMContentLoaded'));
  expect(root.querySelectorAll('form')).toHaveLength(1);
});

test('keyboard sculpting shortcuts exit construction mode and keep pressed states synchronized', () => {
  document.getElementById('terrain-wall-btn').click();
  coordinator.input.handleKeyDown({ code: 'KeyL', preventDefault: jest.fn() });
  expect(terrain.constructionTool).toBeNull();
  expect(terrain.tool).toBe('lower');
  expect(document.getElementById('terrain-brush-size-controls').hidden).toBe(false);
  expect(document.getElementById('terrain-lower-btn').getAttribute('aria-pressed')).toBe('true');
});

test('construction dimensions do not consume terrain keyboard shortcuts or alter saved terrain', () => {
  document.getElementById('terrain-wall-btn').click();
  const input = document.querySelector('[name="heightFeet"]');
  const preventDefault = jest.fn();
  coordinator.input.handleKeyDown({ code: 'KeyR', target: input, preventDefault });
  expect(terrain.constructionTool).toBe('wall');
  expect(preventDefault).not.toHaveBeenCalled();
  expect(
    terrain
      .save()
      .heights.flat()
      .every((height) => height === 0)
  ).toBe(true);
});

test('repeated UI attachment does not duplicate the wall drawing handler', () => {
  document.dispatchEvent(new Event('DOMContentLoaded'));
  const choose = jest.spyOn(terrain, 'setConstructionTool');
  document.getElementById('terrain-wall-btn').click();
  expect(choose).toHaveBeenCalledTimes(1);
  expect(document.querySelectorAll('[data-build-kind="wall"]')).toHaveLength(1);
});

test('Undo and Redo remain shared with the real terrain history', () => {
  const undo = document.getElementById('terrain-undo-btn'),
    redo = document.getElementById('terrain-redo-btn');
  terrain.setHeightAt(1, 1, 4);
  expect(undo.disabled).toBe(false);
  undo.click();
  expect(terrain.getHeightAt(1, 1)).toBe(0);
  redo.click();
  expect(terrain.getHeightAt(1, 1)).toBe(4);
});
