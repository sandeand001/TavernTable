import { InteractionManager } from '../../../src/managers/InteractionManager.js';
import { TerrainInputHandlers } from '../../../src/coordinators/terrain-coordinator/TerrainInputHandlers.js';
import { TerrainEngine } from '../../../src/terrain/TerrainEngine.js';

let view;
let manager;
let gm;
let documentListeners;
let windowListeners;

const mouse = (target, type, x, y, extra = {}) =>
  target.dispatchEvent(
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: x,
      clientY: y,
      ...extra,
    })
  );
const space = (type, target = document.body, extra = {}) => {
  const event = new KeyboardEvent(type, {
    key: ' ',
    code: 'Space',
    bubbles: true,
    cancelable: true,
    ...extra,
  });
  target.dispatchEvent(event);
  return event;
};

beforeEach(() => {
  view = document.createElement('canvas');
  document.body.append(view);
  gm = {
    getEventCanvas: () => view,
    placedTokens: [],
    threeSceneManager: { panBy: jest.fn() },
    is3DModeActive: () => true,
    isTerrainModeActive: () => false,
    terrainEngine: { cancelBrushStroke: jest.fn() },
  };
  manager = new InteractionManager(gm);
  gm.interactionManager = manager;
  manager.handleLeftClick = jest.fn();
  documentListeners = jest.spyOn(document, 'addEventListener');
  windowListeners = jest.spyOn(window, 'addEventListener');
  manager.setupKeyboardInteractions();
  manager.setupMouseInteractions();
});

afterEach(() => {
  manager._facingGesture.detach();
  manager.stopGridDragging();
  for (const [type, listener, options] of documentListeners.mock.calls)
    document.removeEventListener(type, listener, options);
  for (const [type, listener, options] of windowListeners.mock.calls)
    window.removeEventListener(type, listener, options);
  documentListeners.mockRestore();
  windowListeners.mockRestore();
  document.body.replaceChildren();
});

test('Space plus left drag pans once per movement without triggering a map click, even outside the canvas', () => {
  expect(space('keydown').defaultPrevented).toBe(true);
  expect(manager.isSpacePressed).toBe(true);
  expect(view.style.cursor).toBe('grab');
  mouse(view, 'mousedown', 100, 100, { buttons: 1 });
  expect(manager.isDragging).toBe(true);
  expect(view.style.cursor).toBe('grabbing');
  mouse(view, 'mousemove', 150, 125, { buttons: 1 });
  mouse(document, 'mousemove', 170, 140, { buttons: 1 });
  expect(gm.threeSceneManager.panBy.mock.calls).toEqual([
    [50, 25, { x: 100, y: 100 }],
    [20, 15, { x: 150, y: 125 }],
  ]);
  mouse(document, 'mouseup', 170, 140, { buttons: 0 });
  expect(manager.isDragging).toBe(false);
  expect(manager._globalMouseMoveListening).toBe(false);
  expect(view.style.cursor).toBe('grab');
  space('keyup');
  expect(manager.isSpacePressed).toBe(false);
  expect(view.style.cursor).toBe('default');
  expect(manager.handleLeftClick).not.toHaveBeenCalled();
});

test('returning after a mouse release outside the window cannot continue panning', () => {
  space('keydown');
  mouse(view, 'mousedown', 100, 100, { buttons: 1 });
  mouse(view, 'mousemove', 150, 125, { buttons: 0 });
  expect(manager.isDragging).toBe(false);
  expect(manager._globalMouseMoveListening).toBe(false);
  expect(view.style.cursor).toBe('grab');
  expect(gm.threeSceneManager.panBy).not.toHaveBeenCalled();
});

test.each(['keyup', 'blur'])(
  '%s cancels a held-Space drag and cannot leave the map stuck',
  (type) => {
    space('keydown');
    mouse(view, 'mousedown', 100, 100, { buttons: 1 });
    if (type === 'blur') window.dispatchEvent(new Event('blur'));
    else space('keyup');
    mouse(document, 'mousemove', 160, 130, { buttons: 1 });
    expect(manager.isDragging).toBe(false);
    expect(manager.isSpacePressed).toBe(false);
    expect(view.style.cursor).toBe('default');
    expect(gm.threeSceneManager.panBy).not.toHaveBeenCalled();
  }
);

test.each(['input', 'textarea', 'select', 'button', 'contenteditable'])(
  'Space does not steal %s keyboard input',
  (tag) => {
    const field = document.createElement(tag === 'contenteditable' ? 'div' : tag);
    if (tag === 'contenteditable') field.setAttribute('contenteditable', 'true');
    document.body.append(field);
    field.focus();
    const event = space('keydown', field);
    expect(event.defaultPrevented).toBe(false);
    expect(manager.isSpacePressed).toBe(false);
    expect(view.style.cursor).not.toBe('grab');
  }
);

test('Space pan wins over terrain painting and placeable removal', () => {
  gm.terrainEngine = new TerrainEngine(5, 5);
  gm.terrainEngine.activate();
  gm.terrainEngine.setPlaceableRemovalMode(true);
  const terrain = new TerrainInputHandlers(gm);
  const pick = jest.spyOn(terrain, 'getGridCoordinatesFromEvent');
  try {
    view.addEventListener('mousedown', (event) => terrain.handleMouseDown(event));
    space('keydown');
    mouse(view, 'mousedown', 100, 100, { buttons: 1 });
    expect(manager.isDragging).toBe(true);
    expect(pick).not.toHaveBeenCalled();
    expect(gm.terrainEngine.hasPendingStroke).toBe(false);
    terrain.handleMouseDown({ button: 0 });
    expect(pick).not.toHaveBeenCalled();
  } finally {
    terrain.dispose();
  }
});

test.each(['button', 'input', 'select'])(
  'Space held after focusing a terrain %s still starts a map pan without painting',
  (tag) => {
    gm.terrainEngine = new TerrainEngine(5, 5);
    gm.terrainEngine.activate();
    gm.isTerrainModeActive = () => gm.terrainEngine.isActive;
    const terrain = new TerrainInputHandlers(gm);
    jest.spyOn(terrain, 'getGridCoordinatesFromEvent').mockReturnValue({ gridX: 1, gridY: 1 });
    terrain.setup();
    const constructionPointer = jest.fn();
    view.addEventListener('pointerdown', constructionPointer, true);
    const control = document.createElement(tag);
    document.body.append(control);
    control.focus();
    const before = gm.terrainEngine.save();
    const tool = gm.terrainEngine.tool;
    try {
      expect(space('keydown', control).defaultPrevented).toBe(false);
      expect(manager.isSpacePressed).toBe(false);
      mouse(view, 'pointerdown', 100, 100, { buttons: 1 });
      mouse(view, 'mousedown', 100, 100, { buttons: 1 });
      expect(manager.isDragging).toBe(true);
      expect(document.activeElement).toBe(view);
      expect(constructionPointer).not.toHaveBeenCalled();
      space('keydown', view, { repeat: true });
      expect(view.style.cursor).toBe('grabbing');
      mouse(view, 'mousemove', 130, 125, { buttons: 1 });
      expect(gm.threeSceneManager.panBy).toHaveBeenCalledWith(30, 25, { x: 100, y: 100 });
      mouse(document, 'mouseup', 130, 125, { buttons: 0 });
      space('keyup', document.activeElement);
      expect(manager.isDragging).toBe(false);
      expect(manager.isSpacePressed).toBe(false);
      expect(manager.isSpaceKeyHeld).toBe(false);
      expect(gm.terrainEngine.save()).toEqual(before);
      expect(gm.terrainEngine.tool).toBe(tool);
      expect(gm.terrainEngine.isActive).toBe(true);
      expect(view.style.cursor).toBe('crosshair');
    } finally {
      view.removeEventListener('pointerdown', constructionPointer, true);
      terrain.dispose();
    }
  }
);

test.each(['keyup', 'blur'])(
  '%s clears Space held over a control before the next canvas click',
  (type) => {
    const control = document.createElement('button');
    document.body.append(control);
    control.focus();
    space('keydown', control);
    if (type === 'blur') window.dispatchEvent(new Event('blur'));
    else expect(space('keyup', control).defaultPrevented).toBe(false);
    mouse(view, 'pointerdown', 100, 100, { buttons: 1 });
    mouse(view, 'mousedown', 100, 100, { buttons: 1 });
    expect(manager.isDragging).toBe(false);
    expect(manager.isSpaceKeyHeld).toBe(false);
    expect(manager.handleLeftClick).toHaveBeenCalledTimes(1);
  }
);

test('focusing a control pauses panning without forgetting Space is still held', () => {
  space('keydown');
  const control = document.createElement('button');
  document.body.append(control);
  control.focus();
  expect(manager.isSpacePressed).toBe(false);
  expect(manager.isSpaceKeyHeld).toBe(true);
  mouse(view, 'pointerdown', 100, 100, { buttons: 1 });
  mouse(view, 'mousedown', 100, 100, { buttons: 1 });
  expect(manager.isDragging).toBe(true);
  mouse(document, 'mouseup', 100, 100, { buttons: 0 });
  space('keyup', view);
  expect(manager.isSpaceKeyHeld).toBe(false);
  expect(manager.isDragging).toBe(false);
});
