import GameManager from '../../../src/core/GameManager.js';
import { createTerrainWorld } from '../../helpers/terrainWorld.js';

function editor() {
  return createTerrainWorld(5, 5, null);
}

afterEach(() => {
  document.body.replaceChildren();
});

test('game queries, tool selection and dimensions use the one authoritative terrain engine', () => {
  const gm = new GameManager({ cols: 5, rows: 6 });
  try {
    gm.terrainEngine.setHeightAt(3, 4, 7);
    expect(gm.getTerrainHeight(3, 4)).toBe(7);
    gm.setTerrainTool('lower');
    expect(gm.terrainEngine.tool).toBe('lower');
    expect(gm.terrainCoordinator.dataStore).toBeUndefined();
    expect(gm.terrainCoordinator.brush).toBeUndefined();
    gm.resizeGrid(6, 5);
    expect([gm.cols, gm.rows]).toEqual([6, 5]);
    expect([gm.terrainEngine.cols, gm.terrainEngine.rows]).toEqual([6, 5]);
    expect(gm.getTerrainHeight(3, 4)).toBe(7);
    gm.resetTerrain();
    expect(gm.getTerrainHeight(3, 4)).toBe(0);
    gm.terrainEngine.undo();
    expect(gm.getTerrainHeight(3, 4)).toBe(7);
  } finally {
    gm.terrainCoordinator.dispose();
  }
});

test('real editing input previews a complete wall, commits once, and supports undo and redo', () => {
  const { gm, input, event } = editor();
  try {
    gm.enableTerrainMode();
    gm.setTerrainTool('wall');
    gm.terrainEngine.setWallTopLevel(4);
    gm.notifyTerrainHeightsChanged.mockClear();
    input.handleMouseDown(event(1, 1));
    input.handleMouseMove(event(3, 2));
    expect(gm.getTerrainHeight(2, 1)).toBe(0);
    expect(gm.notifyTerrainHeightsChanged).not.toHaveBeenCalled();
    expect(gm.threeSceneManager.setTerrainBrushPreview).toHaveBeenLastCalledWith(
      [
        { x: 1, y: 1, currentHeight: 0, previewHeight: 4 },
        { x: 2, y: 1, currentHeight: 0, previewHeight: 4 },
        { x: 3, y: 1, currentHeight: 0, previewHeight: 4 },
        { x: 1, y: 2, currentHeight: 0, previewHeight: 4 },
        { x: 2, y: 2, currentHeight: 0, previewHeight: 4 },
        { x: 3, y: 2, currentHeight: 0, previewHeight: 4 },
      ],
      expect.objectContaining({ previewMode: 'terrain-height', brushTool: 'wall' })
    );
    input.handleMouseUp(event(3, 2));
    input.handleMouseUp(event(3, 2));
    expect(gm.getTerrainHeight(2, 1)).toBe(4);
    expect(gm.notifyTerrainHeightsChanged).toHaveBeenCalledTimes(1);
    gm.terrainEngine.undo();
    expect(gm.getTerrainHeight(2, 1)).toBe(0);
    gm.terrainEngine.redo();
    expect(gm.getTerrainHeight(2, 1)).toBe(4);
  } finally {
    gm.terrainCoordinator.dispose();
  }
});

test('leaving the canvas or losing focus cancels a sculpt preview without modifying the map', () => {
  const { gm, input, event } = editor();
  try {
    gm.enableTerrainMode();
    input.handleMouseDown(event(1, 1));
    input.handleMouseMove(event(2, 1));
    input.handleMouseLeave();
    input.handleMouseUp(event(2, 1));
    expect(gm.getTerrainHeight(1, 1)).toBe(0);
    expect(gm.getTerrainHeight(2, 1)).toBe(0);
    expect(gm.terrainEngine.canUndo).toBe(false);

    input.setup();
    input.setup();
    input.handleMouseDown(event(1, 1));
    window.dispatchEvent(new Event('blur'));
    expect(gm.terrainEngine.hasPendingStroke).toBe(false);
    expect(gm.getTerrainHeight(1, 1)).toBe(0);
  } finally {
    gm.terrainCoordinator.dispose();
  }
});

test('keyboard history stays scoped to terrain editing and does not steal text-field undo', () => {
  const { gm, input } = editor();
  try {
    gm.enableTerrainMode();
    gm.terrainEngine.setHeightAt(1, 1, 3);
    const typing = {
      code: 'KeyZ',
      ctrlKey: true,
      target: document.createElement('input'),
      preventDefault: jest.fn(),
    };
    input.handleKeyDown(typing);
    expect(gm.getTerrainHeight(1, 1)).toBe(3);
    expect(typing.preventDefault).not.toHaveBeenCalled();
    const key = { ...typing, target: document.body, preventDefault: jest.fn() };
    input.handleKeyDown(key);
    expect(gm.getTerrainHeight(1, 1)).toBe(0);
    expect(key.preventDefault).toHaveBeenCalledTimes(1);
    input.handleKeyDown({ ...key, shiftKey: true });
    expect(gm.getTerrainHeight(1, 1)).toBe(3);
    gm.disableTerrainMode();
    input.handleKeyDown(key);
    expect(gm.getTerrainHeight(1, 1)).toBe(3);
  } finally {
    gm.terrainCoordinator.dispose();
  }
});

test('loading and reset refresh the scene, and detached adapters stop receiving terrain events', () => {
  const world = editor();
  const { gm, engine } = world;
  try {
    const heights = Array.from({ length: 6 }, () => Array(5).fill(2));
    gm.notifyTerrainHeightsChanged.mockClear();
    engine.load({ heights, biomeSeed: 0 });
    expect([gm.cols, gm.rows]).toEqual([5, 6]);
    expect(gm.getTerrainHeight(4, 5)).toBe(2);
    expect(gm.notifyTerrainHeightsChanged).toHaveBeenCalledTimes(1);
    engine.reset();
    expect(gm.getTerrainHeight(4, 5)).toBe(0);
    expect(gm.notifyTerrainHeightsChanged).toHaveBeenCalledTimes(2);
    gm.terrainCoordinator.detachScene();
    engine.setHeightAt(1, 1, 3);
    expect(gm.notifyTerrainHeightsChanged).toHaveBeenCalledTimes(2);
    gm.terrainCoordinator.attachScene();
    engine.setHeightAt(1, 1, 4);
    expect(gm.notifyTerrainHeightsChanged).toHaveBeenCalledTimes(3);
  } finally {
    world.dispose();
  }
});

test('the height indicator follows undo and redo without another pointer movement', () => {
  const display = document.createElement('span');
  display.id = 'terrain-height-display';
  document.body.appendChild(display);
  const world = editor();
  try {
    world.engine.activate();
    world.input.handleMouseDown(world.event(1, 1));
    world.input.handleMouseUp(world.event(1, 1));
    expect(display.textContent).toBe('1');
    world.engine.undo();
    expect(display.textContent).toBe('0');
    world.engine.redo();
    expect(display.textContent).toBe('1');
  } finally {
    world.dispose();
  }
});
