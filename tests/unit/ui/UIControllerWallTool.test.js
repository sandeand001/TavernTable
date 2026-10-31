import '../../../src/ui/UIController.js';
import { TerrainCoordinator } from '../../../src/coordinators/TerrainCoordinator.js';
import { TERRAIN_CONFIG } from '../../../src/config/terrain/TerrainConstants.js';
import {
  ErrorHandler,
  ERROR_SEVERITY,
  ERROR_CATEGORY,
} from '../../../src/utils/error/ErrorHandler.js';

let coordinator;

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
  `;
  const gm = {
    cols: 8,
    rows: 6,
    threeSceneManager: {
      setTerrainBrushPreview: jest.fn(),
      clearTerrainBrushPreview: jest.fn(),
    },
  };
  coordinator = new TerrainCoordinator(gm);
  coordinator.isTerrainModeActive = true;
  gm.terrainCoordinator = coordinator;
  gm.setTerrainTool = (tool) => coordinator.setTerrainTool(tool);
  window.gameManager = gm;
  document.dispatchEvent(new Event('DOMContentLoaded'));
});

afterEach(() => {
  jest.restoreAllMocks();
  document.body.replaceChildren();
  delete window.gameManager;
});

test('Wall selection exposes its height control and hides the unrelated brush size', () => {
  document.getElementById('terrain-wall-btn').click();
  expect(coordinator.brush.tool).toBe('wall');
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
    expect(coordinator.wallTopLevel).toBe(Number(level));
    expect(coordinator.brush.wallTopLevel).toBe(Number(level));
  }
  expect(coordinator.dataStore.working.flat().every((height) => height === 0)).toBe(true);
});

test('the box style dropdown switches Filled and Outline without changing terrain', () => {
  document.getElementById('terrain-wall-btn').click();
  const select = document.getElementById('terrain-wall-fill');
  expect(Array.from(select.options, (option) => option.value)).toEqual(['filled', 'outline']);
  expect(select.value).toBe('filled');
  expect(coordinator.wallFillMode).toBe('filled');
  select.value = 'outline';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  expect(coordinator.wallFillMode).toBe('outline');
  expect(coordinator.brush.wallFillMode).toBe('outline');
  document.getElementById('terrain-raise-btn').click();
  document.getElementById('terrain-wall-btn').click();
  expect(select.value).toBe('outline');
  expect(coordinator.dataStore.working.flat().every((height) => height === 0)).toBe(true);
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
  expect(coordinator.wallFillMode).toBe('filled');
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
    expect(coordinator.wallTopLevel).toBe(3);
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
  coordinator._inputHandlers.handleKeyDown({
    code: 'KeyL',
    preventDefault: jest.fn(),
  });
  expect(coordinator.brush.tool).toBe('lower');
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
    coordinator._inputHandlers.handleKeyDown({
      code: 'KeyR',
      target: input,
      preventDefault,
    });
    expect(coordinator.brush.tool).toBe('wall');
    expect(preventDefault).not.toHaveBeenCalled();
  }
);

test('repeated UI attachment does not duplicate height or wall button handlers', () => {
  document.dispatchEvent(new Event('DOMContentLoaded'));
  const height = jest.spyOn(coordinator, 'setWallTopLevel');
  const fill = jest.spyOn(coordinator, 'setWallFillMode');
  const tool = jest.spyOn(coordinator, 'setTerrainTool');
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
