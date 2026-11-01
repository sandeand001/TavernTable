import '../../../src/ui/UIController.js';
import { TerrainCoordinator } from '../../../src/coordinators/TerrainCoordinator.js';
import { TerrainEngine } from '../../../src/terrain/TerrainEngine.js';
import { TERRAIN_CONFIG } from '../../../src/config/terrain/TerrainConstants.js';
import {
  ErrorHandler,
  ERROR_SEVERITY,
  ERROR_CATEGORY,
} from '../../../src/utils/error/ErrorHandler.js';

let coordinator;
let terrain;

beforeEach(() => {
  document.body.innerHTML = `
    <button id="terrain-raise-btn" class="terrain-tool-btn">Raise</button>
    <button id="terrain-lower-btn" class="terrain-tool-btn">Lower</button>
    <button id="terrain-wall-btn" class="terrain-tool-btn">Wall</button>
    <div id="terrain-brush-size-controls"><span id="brush-size-display"></span></div>
    <div id="terrain-wall-controls" hidden>
      <label for="terrain-wall-height">Top level</label>
      <select id="terrain-wall-height"><option value="3" selected>3</option></select>
      <label for="terrain-wall-fill">Box style</label>
      <select id="terrain-wall-fill">
        <option value="filled" selected>Filled</option>
        <option value="outline">Outline</option>
      </select>
    </div>
    <div id="creature-content"></div>
    <button id="terrain-undo-btn" disabled>Undo</button>
    <button id="terrain-redo-btn" disabled>Redo</button>
    <small id="terrain-history-status"></small>
  `;
  const gm = {
    cols: 8,
    rows: 6,
    threeSceneManager: {
      setTerrainBrushPreview: jest.fn(),
      clearTerrainBrushPreview: jest.fn(),
    },
  };
  terrain = new TerrainEngine(gm.cols, gm.rows);
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

test('Wall selection exposes its height control and hides the unrelated brush size', () => {
  document.getElementById('terrain-wall-btn').click();
  expect(terrain.tool).toBe('wall');
  expect(document.getElementById('terrain-wall-controls').hidden).toBe(false);
  expect(document.getElementById('terrain-brush-size-controls').hidden).toBe(true);
  expect(document.getElementById('terrain-wall-btn').getAttribute('aria-pressed')).toBe('true');
  expect(document.getElementById('terrain-raise-btn').getAttribute('aria-pressed')).toBe('false');
  expect(document.getElementById('terrain-lower-btn').getAttribute('aria-pressed')).toBe('false');
});

test('the height dropdown offers every supported level and updates the actual wall brush', () => {
  document.getElementById('terrain-wall-btn').click();
  const select = document.getElementById('terrain-wall-height');
  const levels = Array.from(
    { length: TERRAIN_CONFIG.MAX_HEIGHT - TERRAIN_CONFIG.MIN_HEIGHT + 1 },
    (_, index) => String(TERRAIN_CONFIG.MIN_HEIGHT + index)
  );
  expect(select.tagName).toBe('SELECT');
  expect(Array.from(select.options, (option) => option.value)).toEqual(levels);
  expect(select.value).toBe('3');
  for (const level of levels) {
    select.value = level;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(terrain.wallTopLevel).toBe(Number(level));
  }
  expect(
    terrain
      .save()
      .heights.flat()
      .every((height) => height === 0)
  ).toBe(true);
});

test('the box style dropdown switches Filled and Outline without changing terrain', () => {
  document.getElementById('terrain-wall-btn').click();
  const select = document.getElementById('terrain-wall-fill');
  expect(Array.from(select.options, (option) => option.value)).toEqual(['filled', 'outline']);
  expect(select.value).toBe('filled');
  expect(terrain.wallFillMode).toBe('filled');
  select.value = 'outline';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  expect(terrain.wallFillMode).toBe('outline');
  document.getElementById('terrain-raise-btn').click();
  document.getElementById('terrain-wall-btn').click();
  expect(select.value).toBe('outline');
  expect(
    terrain
      .save()
      .heights.flat()
      .every((height) => height === 0)
  ).toBe(true);
});

test('an invalid box style is reported and restores the last valid choice', () => {
  const errors = jest.spyOn(ErrorHandler.prototype, 'handle').mockImplementation(() => {});
  const select = document.getElementById('terrain-wall-fill');
  const option = document.createElement('option');
  option.value = 'invalid';
  select.append(option);
  select.value = 'invalid';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  expect(select.value).toBe('filled');
  expect(terrain.wallFillMode).toBe('filled');
  expect(errors).toHaveBeenCalledWith(
    expect.any(RangeError),
    ERROR_SEVERITY.WARNING,
    ERROR_CATEGORY.INPUT,
    expect.objectContaining({ context: 'setWallFillMode' })
  );
});

test.each(['', '11', '-11', '2.5'])(
  'invalid height %s is reported and the last valid value stays visible',
  (value) => {
    const errors = jest.spyOn(ErrorHandler.prototype, 'handle').mockImplementation(() => {});
    const input = document.getElementById('terrain-wall-height');
    if (value !== '') {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      input.append(option);
    }
    input.value = value;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(terrain.wallTopLevel).toBe(3);
    expect(input.value).toBe('3');
    expect(errors).toHaveBeenCalledWith(
      expect.any(RangeError),
      ERROR_SEVERITY.WARNING,
      ERROR_CATEGORY.INPUT,
      expect.objectContaining({ context: 'setWallTopLevel' })
    );
  }
);

test('keyboard tool changes keep the height panel and pressed buttons synchronized', () => {
  document.getElementById('terrain-wall-btn').click();
  coordinator.input.handleKeyDown({
    code: 'KeyL',
    preventDefault: jest.fn(),
  });
  expect(terrain.tool).toBe('lower');
  expect(document.getElementById('terrain-wall-controls').hidden).toBe(true);
  expect(document.getElementById('terrain-brush-size-controls').hidden).toBe(false);
  expect(document.getElementById('terrain-wall-btn').getAttribute('aria-pressed')).toBe('false');
  expect(document.getElementById('terrain-lower-btn').getAttribute('aria-pressed')).toBe('true');
});

test.each(['terrain-wall-height', 'terrain-wall-fill'])(
  'tool shortcuts do not interfere with %s',
  (id) => {
    document.getElementById('terrain-wall-btn').click();
    const input = document.getElementById(id);
    const preventDefault = jest.fn();
    coordinator.input.handleKeyDown({
      code: 'KeyR',
      target: input,
      preventDefault,
    });
    expect(terrain.tool).toBe('wall');
    expect(preventDefault).not.toHaveBeenCalled();
  }
);

test('repeated UI attachment does not duplicate height or wall button handlers', () => {
  document.dispatchEvent(new Event('DOMContentLoaded'));
  const height = jest.spyOn(terrain, 'setWallTopLevel');
  const fill = jest.spyOn(terrain, 'setWallFillMode');
  const tool = jest.spyOn(terrain, 'setTool');
  document.getElementById('terrain-wall-btn').click();
  const input = document.getElementById('terrain-wall-height');
  input.value = '5';
  input.dispatchEvent(new Event('change', { bubbles: true }));
  const fillSelect = document.getElementById('terrain-wall-fill');
  fillSelect.value = 'outline';
  fillSelect.dispatchEvent(new Event('change', { bubbles: true }));
  expect(height).toHaveBeenCalledTimes(1);
  expect(fill).toHaveBeenCalledTimes(1);
  expect(tool).toHaveBeenCalledTimes(1);
  document.dispatchEvent(new Event('DOMContentLoaded'));
  expect(input.value).toBe('5');
  expect(fillSelect.value).toBe('outline');
  expect(fillSelect.options).toHaveLength(2);
  expect(input.options).toHaveLength(TERRAIN_CONFIG.MAX_HEIGHT - TERRAIN_CONFIG.MIN_HEIGHT + 1);
});

test('Undo and Redo buttons follow the real terrain history and update gameplay heights', () => {
  const undo = document.getElementById('terrain-undo-btn');
  const redo = document.getElementById('terrain-redo-btn');
  expect(undo.disabled).toBe(true);
  expect(redo.disabled).toBe(true);
  terrain.setHeightAt(1, 1, 4);
  expect(undo.disabled).toBe(false);
  undo.click();
  expect(terrain.getHeightAt(1, 1)).toBe(0);
  expect(undo.disabled).toBe(true);
  expect(redo.disabled).toBe(false);
  redo.click();
  expect(terrain.getHeightAt(1, 1)).toBe(4);
  expect(redo.disabled).toBe(true);
});

test('the history status distinguishes a preview from a committed edit', () => {
  terrain.beginBrushStroke(1, 1);
  expect(document.getElementById('terrain-history-status').textContent).toContain('Preview only');
  expect(terrain.getHeightAt(1, 1)).toBe(0);
  terrain.commitBrushStroke();
  expect(document.getElementById('terrain-history-status').textContent).not.toContain(
    'Preview only'
  );
  expect(terrain.getHeightAt(1, 1)).toBe(1);
});
