import * as three from 'three';
import { TerrainConstructionPanel } from '../../../src/ui/TerrainConstructionPanel.js';
import { createTerrainWorld } from '../../helpers/terrainWorld.js';
import { createStructure, structureVolumes } from '../../../src/terrain/ConstructionBlueprints.js';
import { buildingWindows, createWindowLayout } from '../../../src/terrain/BuildingModel.js';
import {
  handlePanKeyDown,
  handlePanPointerDown,
  releasePanKey,
} from '../../../src/managers/interaction-manager/internals/pan.js';

let board;
function fixture() {
  const world = createTerrainWorld(25, 25, null);
  world.gm.threeSceneManager.three = three;
  world.gm.threeSceneManager.scene = new three.Scene();
  world.gm.pickingService.pickGroundSync = (x, z) => ({
    surface: { kind: 'floor', point: { x: x / 5, y: 0, z: z / 5 }, normal: { x: 0, y: 1, z: 0 } },
    grid: { gx: Math.floor(x / 5), gy: Math.floor(z / 5) },
  });
  world.engine.activate();
  const root = document.createElement('section');
  document.body.append(root);
  const panel = new TerrainConstructionPanel({ root, gameManager: world.gm });
  const canvas = world.gm.getEventCanvas();
  const pointer = (type, x, z, options = {}) =>
    canvas.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: type === 'pointerup' ? 0 : 1,
        clientX: x,
        clientY: z,
        ...options,
      })
    );
  board = { world, root, panel, pointer };
  return board;
}
afterEach(() => {
  board?.panel.dispose();
  board?.world.dispose();
  board?.root.remove();
  board = null;
});

test('illustrated cards replace numeric box/proof controls and a dome placement is one undoable edit', () => {
  const { world, root, pointer } = fixture();
  expect(
    root.querySelectorAll('[aria-label="Structure types"] .construction-card img')
  ).toHaveLength(8);
  expect(root.querySelectorAll('[aria-label="Roof type"] .construction-card img')).toHaveLength(7);
  expect(root.querySelector('[name="operation"]')).toBeNull();
  expect(root.querySelector('[data-proof-map]')).toBeNull();
  root.querySelector('[data-build-kind="dome"]').click();
  const before = world.engine.save();
  pointer('pointerdown', 45, 45);
  expect(world.engine.save()).toEqual(before);
  pointer('pointerup', 45, 45);
  expect(world.engine.geometry.getStructures()).toHaveLength(1);
  expect(root.querySelector('[role="status"]').textContent).toContain('placed');
  world.engine.undo();
  expect(world.engine.save()).toEqual(before);
});

test.each(['keyboard', 'pointer'])(
  'a %s Space-pan handoff cancels a construction drag but retains its tool',
  (source) => {
    const { world, root, panel, pointer } = fixture();
    root.querySelector('[data-build-kind="wall"]').click();
    const before = world.engine.save();
    pointer('pointerdown', 30, 30);
    pointer('pointermove', 60, 50);
    const manager = (world.gm.interactionManager ??= {});
    manager.gameManager = world.gm;
    if (source === 'keyboard') {
      expect(handlePanKeyDown(manager, { code: 'Space', target: world.gm.getEventCanvas() })).toBe(
        true
      );
    } else {
      expect(
        handlePanKeyDown(manager, {
          code: 'Space',
          target: root.querySelector('[data-build-kind="wall"]'),
        })
      ).toBe(false);
      expect(handlePanPointerDown(manager, { button: 0 })).toBe(true);
    }
    expect(panel.pointer).toBeNull();
    expect(panel.preview.mesh).toBeNull();
    expect(world.engine.save()).toEqual(before);
    expect(world.engine.constructionTool).toBe('wall');
    releasePanKey(manager);
    pointer('pointerdown', 30, 30);
    pointer('pointerup', 60, 50);
    expect(world.engine.geometry.getStructures()).toHaveLength(1);
  }
);

test('arbitrary wall drags preview without changing terrain and retain the plain/battlement choice', () => {
  const { world, root, pointer } = fixture();
  root.querySelector('[data-build-kind="wall"]').click();
  const before = world.engine.save();
  pointer('pointerdown', 30, 30);
  pointer('pointermove', 60, 50);
  world.input.handleMouseDown(world.event(2, 2));
  expect(world.engine.save()).toEqual(before);
  pointer('pointerup', 60, 50);
  expect(world.engine.geometry.getStructures()[0]).toMatchObject({
    kind: 'wall',
    style: 'plain',
    lengthFeet: Math.hypot(30, 20),
    angleRadians: Math.atan2(20, 30),
  });
  const style = root.querySelector('[name="style"]');
  style.value = 'battlement';
  style.dispatchEvent(new Event('input', { bubbles: true }));
  const ruined = root.querySelector('[name="ruined"]');
  ruined.checked = true;
  ruined.dispatchEvent(new Event('input', { bubbles: true }));
  pointer('pointerdown', 30, 80);
  pointer('pointerup', 60, 80);
  expect(world.engine.geometry.getStructures()[1]).toMatchObject({
    style: 'battlement',
    widthFeet: 10,
    ruined: true,
  });
});

test('short terrace stair height fields remain valid when selecting and applying a generated rise', () => {
  const { world, root, pointer } = fixture();
  world.engine.placeStructure({
    id: 'short-stair',
    kind: 'wall',
    style: 'battlement',
    wallStairs: true,
    wallStairExit: 'terrace',
    xFeet: 60,
    zFeet: 60,
    heightFeet: 3,
    lengthFeet: 30,
    widthFeet: 8,
  });
  root.querySelector('[data-build-select]').click();
  pointer('pointerdown', 60, 60);
  const height = root.querySelector('[name="heightFeet"]');
  expect(height.value).toBe('3');
  expect(height.min).toBe('0.5');
  expect(height.step).toBe('0.5');
  expect(height.checkValidity()).toBe(true);
  root
    .querySelector('form')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  expect(world.engine.geometry.getStructures()[0].heightFeet).toBe(3);
});

test('procedural formation tools are absent while the original Build tools remain available', () => {
  const { world, root } = fixture();
  for (const kind of ['stalagmite', 'stalactite']) {
    expect(root.querySelector(`[data-build-kind="${kind}"]`)).toBeNull();
    expect(() => world.engine.setConstructionTool(kind)).toThrow(/supported construction tool/);
  }
  for (const kind of ['wall', 'turret', 'dome', 'building', 'cave', 'cellar', 'tunnel'])
    expect(root.querySelector(`[data-build-kind="${kind}"]`)).not.toBeNull();
});

test('saved prototype formations remain selectable and removable with Undo', () => {
  const { world, root, panel, pointer } = fixture();
  const savedFormation = createStructure({
    id: 'saved-prototype',
    kind: 'stalagmite',
    xFeet: 45,
    zFeet: 45,
  });
  world.engine.placeStructure(savedFormation);
  const before = world.engine.save();
  root.querySelector('[data-build-select]').click();
  pointer('pointerdown', 45, 45);
  expect(panel.selectedId).toBe(savedFormation.id);
  root.querySelector('[data-build-remove]').click();
  expect(world.engine.geometry.getStructures()).toEqual([]);
  world.engine.undo();
  expect(world.engine.save()).toEqual(before);
});

test('select/resize changes diameter only on Apply, Cancel leaves saved geometry untouched', () => {
  const { world, root, pointer } = fixture();
  root.querySelector('[data-build-kind="dome"]').click();
  pointer('pointerdown', 45, 45);
  pointer('pointerup', 45, 45);
  root.querySelector('[data-build-select]').click();
  pointer('pointerdown', 45, 45);
  const before = world.engine.save();
  const diameter = root.querySelector('[name="diameterFeet"]');
  diameter.value = '40';
  diameter.dispatchEvent(new Event('input', { bubbles: true }));
  expect(world.engine.save()).toEqual(before);
  root.querySelector('[data-build-cancel]').click();
  expect(diameter.value).toBe('30');
  diameter.value = '40';
  diameter.dispatchEvent(new Event('input', { bubbles: true }));
  root
    .querySelector('form')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  expect(world.engine.geometry.getStructures()[0].diameterFeet).toBe(40);
  world.engine.undo();
  expect(world.engine.save()).toEqual(before);
});

test('Escape cancels a wall drag and disabling terrain mode clears its preview without a physical rebuild', () => {
  const { world, root, panel, pointer } = fixture();
  root.querySelector('[data-build-kind="wall"]').click();
  pointer('pointerdown', 30, 30);
  pointer('pointermove', 70, 60);
  document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }));
  pointer('pointerup', 70, 60);
  expect(world.engine.geometry.hasVolumes).toBe(false);
  expect(panel.pointer).toBeNull();
  world.engine.deactivate();
  expect(world.engine.constructionTool).toBeNull();
  expect(panel.preview.mesh).toBeNull();
});

test('roof cutaway is only a view and rejected size edits retain their original state', () => {
  const { world, root, pointer } = fixture();
  root.querySelector('[data-build-kind="dome"]').click();
  pointer('pointerdown', 45, 45);
  pointer('pointerup', 45, 45);
  const cutaway = root.querySelector('[data-build-cutaway]');
  cutaway.checked = true;
  cutaway.dispatchEvent(new Event('change', { bubbles: true }));
  expect(world.engine.geometry.findSupport(45, 45, { belowFeet: 30 }).heightFeet).toBe(12);
  root.querySelector('[data-build-select]').click();
  pointer('pointerdown', 45, 45);
  const before = world.engine.save();
  const diameter = root.querySelector('[name="diameterFeet"]');
  diameter.value = '500';
  diameter.dispatchEvent(new Event('input', { bubbles: true }));
  root
    .querySelector('form')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  expect(world.engine.save()).toEqual(before);
  expect(root.querySelector('[role="status"]').textContent).toMatch(/bounds|board/);
});

test('new building roof and wall-feature tools work immediately, before any Apply submission', () => {
  const { world, root, panel, pointer } = fixture();
  root.querySelector('[data-build-kind="building"]').click();
  const height = root.querySelector('[name="heightFeet"]');
  height.value = '3';
  height.dispatchEvent(new Event('input', { bubbles: true }));
  const length = root.querySelector('[name="lengthFeet"]');
  length.value = '30';
  length.dispatchEvent(new Event('input', { bubbles: true }));
  const width = root.querySelector('[name="widthFeet"]');
  width.value = '25';
  width.dispatchEvent(new Event('input', { bubbles: true }));
  root.querySelector('[data-building-roof="hipped"]').click();
  pointer('pointerdown', 60, 60);
  pointer('pointerup', 60, 60);
  expect(world.engine.geometry.getStructures()[0]).toMatchObject({
    heightFeet: 30,
    building: { roof: 'hipped' },
  });
  root.querySelector('[data-build-select]').click();
  pointer('pointerdown', 60, 60);
  root.querySelector('[name="featureFloor"]').value = '1';
  root.querySelector('[data-building-feature="balcony"]').click();
  expect(panel.featureTool).toBe('balcony');
  world.gm.pickingService.pickGroundSync = (x, z) => ({
    surface: { kind: 'wall', point: { x: x / 5, y: 2.8, z: z / 5 }, normal: { x: 0, y: 0, z: 1 } },
    grid: { gx: Math.floor(x / 5), gy: Math.floor(z / 5) },
  });
  jest
    .spyOn(panel.gizmos, 'point')
    .mockImplementation((event) => ({ x: event.clientX, y: 10, z: event.clientY }));
  pointer('pointerdown', 60, 72.5);
  pointer('pointermove', 65, 77.5);
  expect(world.engine.geometry.getStructures()[0].building.balconies).toEqual([]);
  pointer('pointerup', 65, 77.5);
  expect(root.querySelector('[data-construction-status]').textContent).toBe(
    'Building edit applied. Undo restores the previous shape and floors.'
  );
  expect(world.engine.geometry.getStructures()[0].building.balconies[0]).toMatchObject({
    floor: 1,
    side: 'south',
    widthFeet: 10,
    depthFeet: 5,
  });
});

test('a fine-mode handle click does not stretch the building by its handle grab offset', () => {
  const { world, root, panel, pointer } = fixture();
  world.engine.placeStructure({
    id: 'house',
    kind: 'building',
    xFeet: 60,
    zFeet: 60,
    heightFeet: 20,
    lengthFeet: 30,
    widthFeet: 25,
  });
  root.querySelector('[data-build-select]').click();
  pointer('pointerdown', 60, 60);
  const before = world.engine.save();
  jest.spyOn(panel.gizmos, 'pick').mockReturnValue('east');
  jest.spyOn(panel.gizmos, 'point').mockReturnValue({ x: 76.6, y: 0, z: 60 });
  pointer('pointerdown', 76, 60, { shiftKey: true });
  pointer('pointerup', 76, 60, { shiftKey: true });
  expect(world.engine.save()).toEqual(before);
});

test.each(['Escape', 'pointercancel', 'blur'])(
  '%s discards a wall-feature drag rather than applying the canceled balcony on a later submission',
  (cancel) => {
    const { world, root, panel, pointer } = fixture();
    world.engine.placeStructure({
      id: 'house',
      kind: 'building',
      xFeet: 60,
      zFeet: 60,
      heightFeet: 20,
      lengthFeet: 30,
      widthFeet: 25,
    });
    root.querySelector('[data-build-select]').click();
    pointer('pointerdown', 60, 60);
    root.querySelector('[data-building-feature="balcony"]').click();
    world.gm.pickingService.pickGroundSync = (x, z) => ({
      surface: {
        kind: 'wall',
        point: { x: x / 5, y: 2.8, z: z / 5 },
        normal: { x: 0, y: 0, z: 1 },
      },
    });
    jest.spyOn(panel.gizmos, 'point').mockReturnValue({ x: 65, y: 10, z: 77.5 });
    const before = world.engine.save();
    pointer('pointerdown', 60, 72.5);
    pointer('pointermove', 65, 77.5);
    if (cancel === 'Escape')
      document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }));
    else if (cancel === 'blur') window.dispatchEvent(new Event('blur'));
    else world.gm.getEventCanvas().dispatchEvent(new Event('pointercancel'));
    expect(panel.draft.building.balconies).toEqual([]);
    root
      .querySelector('form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(world.engine.save()).toEqual(before);
  }
);

test('wall-feature authoring rejects a different wall outside the selected building', () => {
  const { world, root, pointer } = fixture();
  world.engine.placeStructure({
    id: 'house',
    kind: 'building',
    xFeet: 60,
    zFeet: 60,
    heightFeet: 20,
    lengthFeet: 30,
    widthFeet: 25,
  });
  root.querySelector('[data-build-select]').click();
  pointer('pointerdown', 60, 60);
  root.querySelector('[name="featureFloor"]').value = '1';
  root.querySelector('[data-building-feature="window"]').click();
  world.gm.pickingService.pickGroundSync = () => ({
    surface: { kind: 'wall', point: { x: 12, y: 2.8, z: 22 }, normal: { x: 0, y: 0, z: 1 } },
  });
  const before = world.engine.save();
  pointer('pointerdown', 60, 110);
  expect(root.querySelector('[data-construction-status]').textContent).toMatch(
    /wall.*selected building/i
  );
  expect(world.engine.save()).toEqual(before);
});

test('a selected automatic window can move floors and be removed without respawning either default', () => {
  const { world, root, panel, pointer } = fixture();
  world.engine.placeStructure({
    id: 'house',
    kind: 'building',
    xFeet: 60,
    zFeet: 60,
    heightFeet: 30,
    lengthFeet: 30,
    widthFeet: 25,
    building: { version: 2 },
  });
  root.querySelector('[data-build-select]').click();
  pointer('pointerdown', 60, 60);
  world.gm.campaignMapId = 'map-main';
  world.gm.pickingService.pickConnectionSync = () => ({
    connection: {
      building: {
        ownerMapId: 'map-main',
        structureId: 'house',
        kind: 'window',
        featureId: 'window-f1-south-0',
      },
    },
  });
  root.querySelector('[data-building-feature="window"]').click();
  pointer('pointerdown', 60, 72.5);
  pointer('pointerup', 60, 72.5);
  const floor = root.querySelector('[name="featureFloor"]');
  floor.value = '2';
  floor.dispatchEvent(new Event('change', { bubbles: true }));
  expect(panel.draft.building.windows[0].floor).toBe(2);
  expect(world.engine.geometry.getStructures()[0].building.windows).toEqual([]);
  root
    .querySelector('form')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  expect(world.engine.geometry.getStructures()[0].building.windows[0].floor).toBe(2);
  root.querySelector('[data-building-feature="window"]').click();
  pointer('pointerdown', 60, 72.5);
  pointer('pointerup', 60, 72.5);
  root.querySelector('[data-feature-remove]').click();
  const spec = world.engine.geometry.getStructures()[0];
  expect(spec.building.windows).toEqual([]);
  expect(
    buildingWindows(spec).some((window) => ['f1-south-0', 'f2-south-0'].includes(window.id))
  ).toBe(false);
});

test('a seeded tall automatic window uses the normal size controls and persists a manual override without replacing its recipe', () => {
  const { world, root, pointer } = fixture();
  world.engine.placeStructure({
    id: 'hall',
    kind: 'building',
    xFeet: 60,
    zFeet: 60,
    lengthFeet: 40,
    widthFeet: 30,
    heightFeet: 30,
    building: { windowLayout: createWindowLayout('fortress', undefined, 42) },
  });
  const spec = world.engine.geometry.getStructures()[0];
  const window = buildingWindows(spec).find((w) => w.heightFeet > 10);
  expect(window).toBeDefined();
  const before = world.engine.save();
  root.querySelector('[data-build-select]').click();
  pointer('pointerdown', 60, 60);
  world.gm.campaignMapId = 'map-main';
  world.gm.pickingService.pickConnectionSync = () => ({
    connection: {
      building: {
        ownerMapId: 'map-main',
        structureId: 'hall',
        kind: 'window',
        featureId: `window-${window.id}`,
      },
    },
  });
  root.querySelector('[data-building-feature="window"]').click();
  pointer('pointerdown', 60, 75);
  pointer('pointerup', 60, 75);
  const width = root.querySelector('[name="featureWidthFeet"]');
  expect(Number(width.value)).toBe(window.widthFeet);
  width.value = String(window.widthFeet + 1);
  width.dispatchEvent(new Event('change', { bubbles: true }));
  root.querySelector('[data-feature-apply]').click();
  const changed = world.engine.geometry.getStructures()[0];
  expect(changed.building.windowLayout).toEqual(spec.building.windowLayout);
  expect(buildingWindows(changed)).toContainEqual({ ...window, widthFeet: window.widthFeet + 1 });
  world.engine.undo();
  expect(world.engine.save()).toEqual(before);
});

test('legacy shells are only upgraded into complete storeys after an explicit preview and Apply', () => {
  const { world, root, panel, pointer } = fixture();
  const legacy = createStructure(
    {
      id: 'old-house',
      kind: 'building',
      xFeet: 60,
      zFeet: 60,
      heightFeet: 25,
      lengthFeet: 30,
      widthFeet: 25,
    },
    { legacy: true }
  );
  world.engine.load({
    ...world.engine.save(),
    geometry: {
      version: 3,
      structures: [legacy],
      volumes: structureVolumes(legacy),
    },
  });
  root.querySelector('[data-build-select]').click();
  pointer('pointerdown', 60, 60);
  const before = world.engine.save();
  expect(world.engine.geometry.getStructures()[0].building).toBeUndefined();
  root.querySelector('[data-building-upgrade]').click();
  expect(panel.draft).toMatchObject({ heightFeet: 30, building: { version: 2 } });
  expect(world.engine.save()).toEqual(before);
  root
    .querySelector('form')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  expect(world.engine.geometry.getStructures()[0]).toMatchObject({
    heightFeet: 30,
    building: { version: 2 },
  });
  world.engine.undo();
  expect(world.engine.save()).toEqual(before);
});

test('the base choices preview a round building or a rectangular building without placing anything early', () => {
  const { world, root, panel, pointer } = fixture();
  root.querySelector('[data-build-kind="building"]').click();
  const before = world.engine.save();
  root.querySelector('[data-building-base="turret"]').click();
  expect(panel.draft).toMatchObject({ kind: 'turret', building: { roof: 'conical' } });
  expect(world.engine.save()).toEqual(before);
  pointer('pointerdown', 60, 60);
  pointer('pointerup', 60, 60);
  expect(world.engine.geometry.getStructures()[0].kind).toBe('turret');
});

test('selecting an existing balcony does not shrink it or create an edit', () => {
  const { world, root, panel, pointer } = fixture();
  world.engine.placeStructure({
    id: 'house',
    kind: 'building',
    xFeet: 60,
    zFeet: 60,
    heightFeet: 30,
    lengthFeet: 40,
    widthFeet: 30,
    building: {
      balconies: [{ id: 'deck', floor: 1, side: 'south', u: 0.5, widthFeet: 10, depthFeet: 7.5 }],
    },
  });
  root.querySelector('[data-build-select]').click();
  pointer('pointerdown', 60, 60);
  world.gm.campaignMapId = 'map-main';
  world.gm.pickingService.pickConnectionSync = () => ({
    connection: {
      building: {
        ownerMapId: 'map-main',
        structureId: 'house',
        kind: 'balcony',
        featureId: 'balcony-deck',
      },
    },
  });
  root.querySelector('[data-building-feature="balcony"]').click();
  jest.spyOn(panel.gizmos, 'point').mockReturnValue({ x: 60, y: 10, z: 75 });
  const before = world.engine.save();
  pointer('pointerdown', 60, 75);
  pointer('pointerup', 60, 75);
  expect(world.engine.save()).toEqual(before);
  expect(panel.selectedFeature).toEqual({ kind: 'balcony', id: 'deck' });
  expect(root.querySelector('[name="featureWidthFeet"]').value).toBe('10');
  expect(root.querySelector('[name="featureDepthFeet"]').value).toBe('7.5');
});

test('a placed window corner handle previews width and multi-storey height, commits on release and undoes together', () => {
  const { world, root, panel, pointer } = fixture();
  world.engine.placeStructure({
    id: 'house',
    kind: 'building',
    xFeet: 60,
    zFeet: 60,
    heightFeet: 40,
    lengthFeet: 40,
    widthFeet: 30,
    building: {
      autoWindows: false,
      windows: [
        { id: 'wide', floor: 1, side: 'south', u: 0.5, widthFeet: 5, heightFeet: 5, sillFeet: 2 },
      ],
    },
  });
  root.querySelector('[data-build-select]').click();
  pointer('pointerdown', 60, 60);
  world.gm.campaignMapId = 'map-main';
  world.gm.pickingService.pickConnectionSync = () => ({
    connection: {
      building: {
        ownerMapId: 'map-main',
        structureId: 'house',
        kind: 'window',
        featureId: 'window-wide',
      },
    },
  });
  root.querySelector('[data-building-feature="window"]').click();
  jest
    .spyOn(panel.gizmos, 'point')
    .mockImplementation((event) => ({ x: event.clientX, y: event.clientY, z: 75 }));
  pointer('pointerdown', 60, 14.5);
  pointer('pointerup', 60, 14.5);
  const before = world.engine.save();
  jest.spyOn(panel.gizmos, 'pick').mockReturnValue('feature-top-east');
  pointer('pointerdown', 62.5, 17);
  pointer('pointermove', 72.5, 29.5);
  expect(world.engine.save()).toEqual(before);
  expect(panel.draft.building.windows[0]).toMatchObject({ widthFeet: 15, heightFeet: 17.5 });
  pointer('pointerup', 72.5, 29.5);
  expect(world.engine.geometry.getStructures()[0].building.windows[0]).toMatchObject({
    widthFeet: 15,
    heightFeet: 17.5,
    floor: 1,
    sillFeet: 2,
    u: 0.625,
  });
  world.engine.undo();
  expect(world.engine.save()).toEqual(before);
});

test('castle wall and turret cards expose the original battlement shapes, with parallel stairs optional', () => {
  const { world, root, panel, pointer } = fixture();
  root.querySelector('[data-build-castle-wall]').click();
  expect(panel.draft).toMatchObject({
    kind: 'wall',
    style: 'battlement',
    wallStairs: true,
    widthFeet: 15,
  });
  pointer('pointerdown', 30, 70);
  pointer('pointermove', 90, 70);
  pointer('pointerup', 90, 70);
  expect(world.engine.geometry.getStructures()[0]).toMatchObject({
    lengthFeet: 60,
    wallStairs: true,
    style: 'battlement',
  });
  root.querySelector('[data-build-kind="turret"]').click();
  expect(panel.draft.building.roof).toBe('battlement');
});

test('room-height changes and whole-floor removal stay previews until Apply and retain other level IDs', () => {
  const { world, root, panel, pointer } = fixture();
  world.engine.placeStructure({
    id: 'hall',
    kind: 'building',
    xFeet: 60,
    zFeet: 60,
    heightFeet: 30,
    lengthFeet: 40,
    widthFeet: 30,
  });
  root.querySelector('[data-build-select]').click();
  pointer('pointerdown', 60, 60);
  const before = world.engine.save();
  root.querySelector('[name="roomHeightFeet"]').value = '20';
  root.querySelector('[data-level-height]').click();
  expect(panel.draft.heightFeet).toBe(40);
  expect(world.engine.save()).toEqual(before);
  root
    .querySelector('form')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  expect(
    world.engine.geometry.getStructures()[0].building.levels.map((level) => level.elevationFeet)
  ).toEqual([0, 20, 30]);
  const field = root.querySelector('[name="editFloor"]');
  field.value = '1';
  field.dispatchEvent(new Event('change', { bubbles: true }));
  root.querySelector('[data-level-remove]').click();
  expect(world.engine.geometry.getStructures()[0].building.levels).toHaveLength(3);
  root
    .querySelector('form')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  expect(world.engine.geometry.getStructures()[0].building.levels.map((level) => level.id)).toEqual(
    [0, 2]
  );
});

test('dragged floor openings preview at the selected level, commit once on release and undo without changing other floors', () => {
  const { world, root, panel, pointer } = fixture();
  world.engine.placeStructure({
    id: 'hall',
    kind: 'building',
    xFeet: 60,
    zFeet: 60,
    heightFeet: 30,
    lengthFeet: 40,
    widthFeet: 30,
  });
  root.querySelector('[data-build-select]').click();
  pointer('pointerdown', 60, 60);
  const field = root.querySelector('[name="editFloor"]');
  field.value = '1';
  field.dispatchEvent(new Event('change', { bubbles: true }));
  root.querySelector('[data-floor-cut]').click();
  jest
    .spyOn(panel.gizmos, 'point')
    .mockImplementation((event) => ({ x: event.clientX, y: 10, z: event.clientY }));
  const before = world.engine.save();
  pointer('pointerdown', 60, 55);
  pointer('pointermove', 70, 65);
  expect(world.engine.save()).toEqual(before);
  expect(panel.draft.building.levels[1].openings[0]).toMatchObject({
    xFeet: 20,
    zFeet: 10,
    lengthFeet: 10,
    widthFeet: 10,
  });
  pointer('pointerup', 70, 65);
  expect(world.engine.geometry.getStructures()[0].building.levels[1].openings).toHaveLength(1);
  expect(world.engine.geometry.getStructures()[0].building.levels[2].openings).toEqual([]);
  root.querySelector('[data-floor-fill]').click();
  expect(world.engine.geometry.getStructures()[0].building.levels[1].openings).toEqual([]);
  world.engine.undo();
  expect(world.engine.geometry.getStructures()[0].building.levels[1].openings).toHaveLength(1);
  world.engine.undo();
  expect(world.engine.save()).toEqual(before);
});

test('cellars have their own placement/edit control and preserve the optional access selection', () => {
  const { world, root, panel, pointer } = fixture();
  root.querySelector('[data-build-kind="cellar"]').click();
  expect(panel.draft.kind).toBe('cellar');
  const select = root.querySelector('[name="cellarAccess"]');
  select.value = 'ladder';
  select.dispatchEvent(new Event('input', { bubbles: true }));
  expect(panel.draft.building.access.kind).toBe('ladder');
  pointer('pointerdown', 65, 65);
  pointer('pointerup', 65, 65);
  expect(world.engine.geometry.getStructures()[0].kind).toBe('cellar');
  const edit = root.querySelector('[data-cellar-edit]');
  edit.value = 'structure-1';
  edit.dispatchEvent(new Event('change', { bubbles: true }));
  expect(panel.selectedId).toBe('structure-1');
  expect(root.querySelector('[name="cellarAccess"]').value).toBe('ladder');
});

test('Apply includes a typed room height even when the optional Preview height button was skipped', () => {
  const { world, root, pointer } = fixture();
  world.engine.placeStructure({
    id: 'hall',
    kind: 'building',
    xFeet: 60,
    zFeet: 60,
    heightFeet: 20,
    lengthFeet: 40,
    widthFeet: 30,
  });
  root.querySelector('[data-build-select]').click();
  pointer('pointerdown', 60, 60);
  root.querySelector('[name="roomHeightFeet"]').value = '15';
  root
    .querySelector('form')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  expect(world.engine.geometry.getStructures()[0].heightFeet).toBe(25);
  expect(world.engine.geometry.getStructures()[0].building.levels[1].elevationFeet).toBe(15);
});

test('changing a castle base from rectangular to round retains an explicitly chosen battlement crown', () => {
  const { root, panel } = fixture();
  root.querySelector('[data-build-kind="building"]').click();
  root.querySelector('[data-building-roof="battlement"]').click();
  root.querySelector('[data-building-base="turret"]').click();
  expect(panel.draft).toMatchObject({ kind: 'turret', building: { roof: 'battlement' } });
});

test('a placed building moves with its centre handle only on release and Undo restores its location', () => {
  const { world, root, panel, pointer } = fixture();
  world.engine.placeStructure({
    id: 'house',
    kind: 'building',
    xFeet: 60,
    zFeet: 60,
    heightFeet: 20,
    lengthFeet: 30,
    widthFeet: 25,
  });
  root.querySelector('[data-build-select]').click();
  pointer('pointerdown', 60, 60);
  jest.spyOn(panel.gizmos, 'pick').mockReturnValue('structure-position');
  jest
    .spyOn(panel.gizmos, 'point')
    .mockImplementation((event) => ({ x: event.clientX, y: 0, z: event.clientY }));
  const before = world.engine.save();
  pointer('pointerdown', 60, 60);
  pointer('pointermove', 70, 65);
  expect(world.engine.save()).toEqual(before);
  expect(panel.draft).toMatchObject({ xFeet: 70, zFeet: 65 });
  pointer('pointerup', 70, 65);
  expect(world.engine.geometry.getStructures()[0]).toMatchObject({ xFeet: 70, zFeet: 65 });
  world.engine.undo();
  expect(world.engine.save()).toEqual(before);
});

test('a connected-interior preview can be canceled through the UI without applying on a later submit', () => {
  const { world, root, pointer } = fixture();
  for (const spec of [
    { id: 'keep', xFeet: 40, lengthFeet: 40 },
    { id: 'wing', xFeet: 82.5, lengthFeet: 30 },
  ])
    world.engine.placeStructure({
      ...spec,
      kind: 'building',
      zFeet: 40,
      widthFeet: 30,
      heightFeet: 10,
      building: { version: 2, roof: 'flat', stairs: false, autoWindows: false },
    });
  root.querySelector('[data-build-select]').click();
  pointer('pointerdown', 82.5, 40);
  pointer('pointerup', 82.5, 40);
  const before = world.engine.save(),
    target = root.querySelector('[name="joinTarget"]');
  expect(target).not.toBeNull();
  target.value = 'keep';
  target.dispatchEvent(new Event('change', { bubbles: true }));
  root.querySelector('[data-building-join-preview]').click();
  expect(root.querySelector('[data-construction-status]').textContent).toMatch(
    /connected interior preview/i
  );
  expect(world.engine.save()).toEqual(before);
  root.querySelector('[data-build-cancel]').click();
  root
    .querySelector('form')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  expect(world.engine.save()).toEqual(before);
});

test('Apply commits the previewed connected interiors once and Undo restores both walls and the source pose', () => {
  const { world, root, pointer } = fixture();
  for (const spec of [
    { id: 'keep', xFeet: 40, lengthFeet: 40 },
    { id: 'wing', xFeet: 82.5, lengthFeet: 30 },
  ])
    world.engine.placeStructure({
      ...spec,
      kind: 'building',
      zFeet: 40,
      widthFeet: 30,
      heightFeet: 10,
      building: { version: 2, roof: 'flat', stairs: false, autoWindows: false },
    });
  root.querySelector('[data-build-select]').click();
  pointer('pointerdown', 82.5, 40);
  pointer('pointerup', 82.5, 40);
  const before = world.engine.save();
  root.querySelector('[name="joinTarget"]').value = 'keep';
  root.querySelector('[data-building-join-preview]').click();
  root
    .querySelector('form')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  expect(world.engine.geometry.getStructures().find((spec) => spec.id === 'wing').xFeet).toBe(75);
  expect(
    world.engine.geometry.isSpaceClear({
      min: { x: 57.5, y: 1e-5, z: 37.5 },
      max: { x: 62.5, y: 6, z: 42.5 },
    })
  ).toBe(true);
  expect(world.engine.undo()).toBe(true);
  expect(world.engine.save()).toEqual(before);
});

test('a rejected occupied-building move restores the authoring draft as well as the saved structure', () => {
  const { world, root, panel, pointer } = fixture();
  world.engine.placeStructure({
    id: 'house',
    kind: 'building',
    xFeet: 60,
    zFeet: 60,
    heightFeet: 20,
    lengthFeet: 30,
    widthFeet: 25,
  });
  root.querySelector('[data-build-select]').click();
  pointer('pointerdown', 60, 60);
  jest.spyOn(panel.gizmos, 'pick').mockReturnValue('structure-position');
  jest
    .spyOn(panel.gizmos, 'point')
    .mockImplementation((event) => ({ x: event.clientX, y: 0, z: event.clientY }));
  const before = world.engine.save(),
    remove = world.engine.validateGeometryEdits(() => {
      throw new Error('A creature occupies this structure; move it outside before editing');
    });
  try {
    pointer('pointerdown', 60, 60);
    pointer('pointermove', 70, 65);
    pointer('pointerup', 70, 65);
    expect(world.engine.save()).toEqual(before);
    expect(panel.draft).toMatchObject({ xFeet: 60, zFeet: 60 });
    expect(root.querySelector('[data-construction-status]').textContent).toMatch(
      /creature occupies/
    );
  } finally {
    remove();
  }
});

test('stair direction, side and position preview independently of wall rotation and commit with Undo', () => {
  const { world, root, panel, pointer } = fixture();
  world.engine.placeStructure({
    id: 'wall',
    kind: 'wall',
    style: 'battlement',
    wallStairs: true,
    xFeet: 60,
    zFeet: 70,
    heightFeet: 20,
    lengthFeet: 80,
    widthFeet: 10,
  });

  root.querySelector('[data-build-select]').click();
  pointer('pointerdown', 60, 70);
  const before = world.engine.save();
  root.querySelector('[data-stair-flip-direction]').click();
  root.querySelector('[data-stair-flip-side]').click();
  const position = root.querySelector('[name="wallStairOffsetFeet"]');
  position.value = '10';
  position.dispatchEvent(new Event('input', { bubbles: true }));
  expect(panel.draft).toMatchObject({
    angleRadians: 0,
    wallStairLayout: 'auto',
    wallStairDirection: 'reverse',
    wallStairSide: 'far',
    wallStairOffsetFeet: 10,
  });
  expect(world.engine.save()).toEqual(before);
  root
    .querySelector('form')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  expect(world.engine.geometry.getStructures()[0]).toMatchObject({
    angleRadians: 0,
    wallStairDirection: 'reverse',
    wallStairSide: 'far',
    wallStairOffsetFeet: 10,
  });
  world.engine.undo();
  expect(world.engine.save()).toEqual(before);
});

test('the stair position handle slides along its wall without committing during the drag', () => {
  const { world, root, panel, pointer } = fixture();
  world.engine.placeStructure({
    id: 'wall',
    kind: 'wall',
    style: 'battlement',
    wallStairs: true,
    xFeet: 60,
    zFeet: 70,
    heightFeet: 20,
    lengthFeet: 80,
    widthFeet: 10,
  });
  root.querySelector('[data-build-select]').click();
  pointer('pointerdown', 60, 70);
  jest.spyOn(panel.gizmos, 'pick').mockReturnValue('stairs-position');
  jest
    .spyOn(panel.gizmos, 'point')
    .mockImplementation((event) => ({ x: event.clientX, y: 0, z: event.clientY }));
  const before = world.engine.save();
  pointer('pointerdown', 45, 60);
  pointer('pointermove', 60, 60);
  expect(world.engine.save()).toEqual(before);
  expect(panel.draft.wallStairOffsetFeet).toBe(15);
  pointer('pointerup', 60, 60);
  expect(world.engine.geometry.getStructures()[0].wallStairOffsetFeet).toBe(15);
});

test('Show underground works before selecting a cellar and selecting the Cellar tool also enables it', () => {
  const { world, root, panel } = fixture();
  world.engine.placeStructure({ id: 'cellar', kind: 'cellar', xFeet: 60, zFeet: 60 });
  const saved = world.engine.save(),
    toggle = root.querySelector('[data-underground-view]');
  expect(toggle).not.toBeNull();
  toggle.checked = true;
  toggle.dispatchEvent(new Event('change', { bubbles: true }));
  expect(world.engine.constructionTool).toBe('select');
  expect(panel.underground.root.visible).toBe(true);
  expect(panel.underground.root.getObjectByName('cellar:cellar')).toBeDefined();
  expect(world.engine.save()).toEqual(saved);
  toggle.checked = false;
  toggle.dispatchEvent(new Event('change', { bubbles: true }));
  expect(panel.underground.root.visible).toBe(false);
  root.querySelector('[data-build-kind="wall"]').click();
  toggle.checked = true;
  toggle.dispatchEvent(new Event('change', { bubbles: true }));
  expect(world.engine.constructionTool).toBe('select');
  toggle.checked = false;
  toggle.dispatchEvent(new Event('change', { bubbles: true }));
  root.querySelector('[data-build-kind="cellar"]').click();
  expect(toggle.checked).toBe(true);
});

test('cellar targets are identified on the map and limited to buildings containing the current hatch and landing', () => {
  const { world, root, panel } = fixture();
  world.engine.placeStructure({
    id: 'structure-1',
    kind: 'building',
    xFeet: 45,
    zFeet: 60,
    lengthFeet: 30,
    widthFeet: 30,
  });
  world.engine.placeStructure({
    id: 'structure-2',
    kind: 'building',
    xFeet: 105,
    zFeet: 60,
    lengthFeet: 30,
    widthFeet: 30,
  });
  world.engine.placeStructure({
    id: 'cellar',
    kind: 'cellar',
    xFeet: 70,
    zFeet: 60,
    lengthFeet: 80,
    widthFeet: 40,
    building: { access: { kind: 'ladder', structureId: 'structure-1', xFeet: -25, zFeet: 0 } },
  });
  const choose = root.querySelector('[data-cellar-edit]');
  choose.value = 'cellar';
  choose.dispatchEvent(new Event('change', { bubbles: true }));
  const target = root.querySelector('[name="cellarTarget"]'),
    before = world.engine.save();
  expect([...target.options].map((option) => option.textContent)).toEqual([
    'Exterior surface',
    'Building 1',
  ]);
  expect(target.value).toBe('structure-1');
  expect(document.querySelector('[data-structure-id="structure-1"]').dataset.state).toBe(
    'connection-target'
  );
  expect(
    world.gm.threeSceneManager.scene.getObjectByName('ConstructionConnectionTarget')
  ).toBeDefined();
  const position = root.querySelector('[name="cellarAccessX"]');
  position.value = '30';
  position.dispatchEvent(new Event('input', { bubbles: true }));
  expect([...target.options].find((option) => option.value === 'structure-1').disabled).toBe(true);
  expect([...target.options].find((option) => option.value === 'structure-2').textContent).toBe(
    'Building 2'
  );
  expect(target.value).toBe('structure-1');
  expect(root.querySelector('[data-cellar-target-help]').textContent).toMatch(/no longer fits/);
  target.value = 'structure-2';
  target.dispatchEvent(new Event('input', { bubbles: true }));
  expect(panel.draft.building.access.structureId).toBe('structure-2');
  expect(document.querySelector('[data-structure-id="structure-2"]').dataset.state).toBe(
    'connection-target'
  );
  expect(world.engine.save()).toEqual(before);
});
