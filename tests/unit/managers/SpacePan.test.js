import { InteractionManager } from '../../../src/managers/InteractionManager.js';
import { TerrainInputHandlers } from '../../../src/coordinators/terrain-coordinator/TerrainInputHandlers.js';

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
    terrainCoordinator: { cancelStroke: jest.fn() },
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
  const coordinator = {
    gameManager: gm,
    isTerrainModeActive: true,
    isPlaceableRemovalMode: () => true,
    getGridCoordinatesFromEvent: jest.fn(() => ({ gridX: 1, gridY: 1 })),
  };
  const terrain = new TerrainInputHandlers(coordinator);
  view.addEventListener('mousedown', (event) => terrain.handleMouseDown(event));
  space('keydown');
  mouse(view, 'mousedown', 100, 100, { buttons: 1 });
  expect(manager.isDragging).toBe(true);
  expect(coordinator.getGridCoordinatesFromEvent).not.toHaveBeenCalled();
  expect(coordinator.isDragging).not.toBe(true);
  terrain.handleMouseDown({ button: 0 });
  expect(coordinator.getGridCoordinatesFromEvent).not.toHaveBeenCalled();
});
