import { Scene, Vector3 } from 'three';
import TargetingController from '../../../src/ui/characters/TargetingController.js';
import CombatSession from '../../../src/entities/characters/CombatSession.js';
import { CharacterLibrary } from '../../../src/entities/characters/CharacterLibrary.js';
import { performPlayAction } from '../../../src/ui/characters/playActions.js';
import { rollDiceExpression } from '../../../src/systems/dice/dice.js';
import CharacterSheetWindow from '../../../src/ui/components/CharacterSheetWindow.js';
import { CompendiumCatalog } from '../../../src/entities/characters/CompendiumCatalog.js';
import data from '../../../assets/data/resources/srd-2024-5.2.1-seed.1.json';
import CampaignWorld from '../../../src/campaigns/CampaignWorld.js';
import { sceneState } from '../../helpers/sceneState.js';
import { GameErrors } from '../../../src/utils/error/ErrorHandler.js';

jest.mock('../../../src/systems/dice/dice.js', () => ({ rollDiceExpression: jest.fn() }));

let library, session, controller, gm, caster, target, canvas, context;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const addSpell = (entryId) => {
  const owned = library.add(caster.characterSheetId, entryId);
  library.prepare(caster.characterSheetId, owned, true);
  return `spell:${owned}`;
};
const choose = async (actionId) => {
  const ticket = session.prepareAction(caster, actionId);
  const result = controller.choose(caster, ticket);
  await settle();
  return { ticket, result };
};
const confirm = () => controller.root.querySelector('[data-target-action="confirm"]').click();

beforeEach(() => {
  localStorage.clear();
  library = new CharacterLibrary({
    ruleset: '2024',
    storage: localStorage,
    catalog: data.entries,
    classes: data.classes,
  });
  caster = {
    id: 'caster',
    characterSheetId: library.create('Caster'),
    world: { x: 1.5, y: 0, z: 1.5 },
    allegiance: 'friendly',
    facingAngle: Math.PI / 2,
  };
  target = {
    id: 'target',
    characterSheetId: library.create('Enemy'),
    world: { x: 2.5, y: 0, z: 1.5 },
    allegiance: 'hostile',
  };
  library.edit(caster.characterSheetId, { classId: 'wizard', level: 10 });
  canvas = document.createElement('canvas');
  document.body.append(canvas);
  gm = {
    placedTokens: [caster, target],
    cols: 20,
    rows: 20,
    getTerrainHeight: jest.fn(() => 0),
    spatial: {
      tileWorldSize: 1,
      gridToWorld: (x, z, y) => ({ x, y, z }),
      worldToGrid: (x, z) => ({ gridX: Math.floor(x), gridY: Math.floor(z) }),
    },
    getEventCanvas: () => canvas,
    pickingService: { pickGroundSync: jest.fn(() => ({ token: target, world: target.world })) },
    threeSceneManager: {
      scene: new Scene(),
      addAnimationCallback: jest.fn(),
      removeAnimationCallback: jest.fn(),
    },
    token3DAdapter: {
      getTokenGroundPosition: jest.fn((token) => ({ ...token.world, y: 0 })),
    },
    characterServices: { library },
  };
  session = new CombatSession({ library });
  controller = new TargetingController({ gameManager: gm, library, session, onChanged: jest.fn() });
  session.targeting = controller;
  context = {
    token: caster,
    characterId: caster.characterSheetId,
    gameManager: gm,
    services: { library, combat: session, targeting: controller },
    rollMode: 'normal',
    rollStatus: document.createElement('p'),
    disposed: false,
    _failure: jest.fn(),
    _run: jest.fn(),
  };
  rollDiceExpression.mockReset().mockResolvedValue({ cancelled: false, text: 'Attack: 15' });
});

afterEach(() => {
  controller.dispose();
  jest.restoreAllMocks();
  document.body.replaceChildren();
});

test('only one overlay is created by concurrent requests, and no idle frame scans terrain', async () => {
  await Promise.all([controller.ensureOverlay(), controller.ensureOverlay()]);
  expect(
    gm.threeSceneManager.scene.children.filter((node) => node.name === 'TargetingAndSpellAreas')
  ).toHaveLength(1);
  gm.getTerrainHeight.mockClear();
  controller.finish();
  controller.frame();
  expect(gm.getTerrainHeight).not.toHaveBeenCalled();
});

test('two free-play characters finish independent sheet actions while the first roll is still pending', async () => {
  session.targeting = null;
  context.services.targeting = null;
  let finishFirstRoll;
  rollDiceExpression.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishFirstRoll = resolve;
      })
  );
  const first = performPlayAction(context, 'attack:unarmed');
  await settle();
  const ticket = session.pending;
  const other = {
    ...context,
    token: target,
    characterId: target.characterSheetId,
    rollStatus: document.createElement('p'),
    _failure: jest.fn(),
  };
  expect(await performPlayAction(other, 'attack:unarmed')).toBeTruthy();
  expect(session.isActionPending(ticket)).toBe(true);
  expect(context._failure).not.toHaveBeenCalled();
  expect(other._failure).not.toHaveBeenCalled();
  finishFirstRoll({ cancelled: false, text: 'First attack: 15' });
  expect(await first).toBeTruthy();
  expect(session.pending).toBeNull();
});

test('a second action for the same sprite waits and starts only after its pending roll finishes', async () => {
  session.targeting = null;
  context.services.targeting = null;
  let finishFirstRoll;
  rollDiceExpression.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishFirstRoll = resolve;
      })
  );
  const first = performPlayAction(context, 'attack:unarmed');
  await settle();
  const second = performPlayAction(context, 'attack:unarmed');
  await settle();
  expect(rollDiceExpression).toHaveBeenCalledTimes(1);
  expect(context.rollStatus.textContent).toContain('queued');
  finishFirstRoll({ cancelled: false, text: 'First attack: 15' });
  expect((await Promise.all([first, second])).every(Boolean)).toBe(true);
  expect(rollDiceExpression).toHaveBeenCalledTimes(2);
  expect(context._failure).not.toHaveBeenCalled();
});

test('independent free-play targeting requests share only the local targeting panel, not action reservations', async () => {
  const a = session.prepareAction(caster, 'attack:unarmed');
  const b = session.prepareAction(target, 'attack:unarmed');
  const first = controller.choose(caster, a);
  const second = controller.choose(target, b);
  await settle();
  expect(controller.active.token).toBe(caster);
  expect(session.isActionPending(b)).toBe(true);
  controller.cancel();
  expect(await first).toEqual({ cancelled: true });
  await settle();
  expect(controller.active.token).toBe(target);
  expect(session.isActionPending(b)).toBe(true);
  controller.cancel();
  expect(await second).toEqual({ cancelled: true });
  expect(session.pending).toBeNull();
});

test('connected-map spell picking stores physical coordinates while its overlay stays on the viewed grid', async () => {
  const scene = sceneState({
    ruleset: '2024',
    characterId: caster.characterSheetId,
    name: 'Caster',
  });
  scene.terrain.heights = scene.terrain.heights.map((row) => row.map(() => 0));
  scene.creatures = [caster, target].map((token, index) => ({
    ...scene.creatures[0],
    id: token.id,
    characterId: token.characterSheetId,
    instanceNumber: index + 1,
    name: index ? 'Enemy' : 'Caster',
    gridX: index + 1,
    pose: { kind: 'ground', world: { ...token.world } },
  }));
  scene.tokenCounters.types[0][1] = 2;
  const validation = { ruleset: '2024', library };
  let world = CampaignWorld.fromScene(scene, validation);
  const saved = world.save();
  saved.maps[0].originFeet = { x: 100, y: 10, z: 40 };
  saved.maps[0].quarterTurns = 1;
  world = CampaignWorld.fromScene(saved, validation);
  gm.campaignWorld = world;
  gm.campaignMapId = 'map-main';
  caster.mapId = target.mapId = 'map-main';
  const selection = await choose(addSpell('spell:fog-cloud'));
  controller.updatePoint({ x: 2.5, y: 0, z: 2.5 }, true);
  expect(controller.active.selection.origin).toEqual({ x: 87.5, y: 10, z: 52.5 });
  controller.overlay.group.updateMatrixWorld(true);
  const displayed = controller.overlay.group.localToWorld(new Vector3(87.5, 10, 52.5));
  expect(displayed.x).toBeCloseTo(2.5);
  expect(displayed.y).toBeCloseTo(0);
  expect(displayed.z).toBeCloseTo(2.5);
  controller.cancel();
  await selection.result;
});

test('disposing during overlay loading cannot attach a renderer after disposal', async () => {
  const loading = controller.ensureOverlay();
  controller.dispose();
  await loading;
  expect(gm.threeSceneManager.scene.children).toEqual([]);
});

test('Moonbeam placement and its Move button share the real targeting flow without another cast', async () => {
  const errors = jest.spyOn(GameErrors, 'gameState').mockImplementation(() => {});
  const id = addSpell('spell:moonbeam');
  session.startTurn(caster);
  const casting = performPlayAction(context, id);
  await settle();
  expect(controller.root.textContent).toContain('5 ft radius cylinder; 40 ft high');
  controller.updatePoint({ x: 5.5, y: 0, z: 1.5 }, true);
  confirm();
  const cast = await casting;
  expect(errors).not.toHaveBeenCalled();
  expect(session.effects[0].area.origin).toEqual({ x: 5.5, y: 0, z: 1.5 });
  expect(controller.effectRoot.querySelector('[data-move-effect]').disabled).toBe(true);
  session.endTurn();
  session.startTurn(caster);
  const slots = [...library.get(caster.characterSheetId).slotsUsed];
  controller.effectRoot.querySelector('[data-move-effect]').click();
  await settle();
  expect(controller.active.action.kind).toBe('spell-effect');
  expect(controller.root.querySelector('[data-target-slot-level]')).toBeNull();
  expect(controller.root.textContent).toContain('Confirm move');
  controller.updatePoint({ x: 17.5, y: 0, z: 1.5 }, true);
  expect(controller.root.querySelector('[data-target-action="confirm"]').disabled).toBe(false);
  confirm();
  await settle();
  expect(session.effects[0]).toMatchObject({
    id: cast.sequence,
    remainingTurns: 9,
    area: { origin: { x: 17.5, y: 0, z: 1.5 } },
  });
  expect(library.get(caster.characterSheetId).slotsUsed).toEqual(slots);
  expect(session.status(caster).actions).toBe(0);
  expect(errors).not.toHaveBeenCalled();
});

test('wall-template buttons preview a ring without changing the original reservation or spending early', async () => {
  const id = addSpell('spell:wall-of-fire');
  session.startTurn(caster);
  const casting = performPlayAction(context, id);
  await settle();
  const ticket = session.pending;
  expect(ticket.action.targeting.shape).toBe('wall');
  controller.root.querySelector('[data-target-variant="ring"]').click();
  expect(controller.active.profile).toMatchObject({
    shape: 'ring',
    sizeFeet: 10,
    heightFeet: 20,
    widthFeet: 1,
  });
  expect(ticket.action.targeting.shape).toBe('wall');
  expect(session.status(caster).actions).toBe(1);
  expect(library.get(caster.characterSheetId).slotsUsed.every((used) => used === 0)).toBe(true);
  controller.updatePoint({ x: 5.5, y: 0, z: 1.5 }, true);
  confirm();
  const cast = await casting;
  expect(cast.targetingVariant).toBe('ring');
  expect(cast.targetingSelection.variant).toBe('ring');
  expect(session.effects[0].area).toMatchObject({ shape: 'ring', size: 2, width: 0.2, height: 4 });
});

test('a location marker cannot be moved beyond the caster range, and cancellation spends nothing', async () => {
  const id = addSpell('spell:mage-hand');
  const casting = performPlayAction(context, id);
  await settle();
  controller.updatePoint({ x: 2.5, y: 0, z: 1.5 }, true);
  confirm();
  await casting;
  const before = JSON.stringify(session.effects);
  const moving = controller.moveEffect(session.effects[0].id);
  await settle();
  controller.updatePoint({ x: 8.5, y: 0, z: 1.5 }, true);
  expect(controller.root.querySelector('[data-target-action="confirm"]').disabled).toBe(true);
  expect(controller.root.textContent).toContain('within 30 feet of the caster');
  controller.cancel();
  await moving;
  expect(JSON.stringify(session.effects)).toBe(before);
  expect(session.pending).toBeNull();
  expect(library.get(caster.characterSheetId).slotsUsed.every((used) => used === 0)).toBe(true);
});

test('casting-level buttons update Magic Missile allocations and spend only the confirmed higher slot', async () => {
  const id = addSpell('spell:magic-missile');
  session.startTurn(caster);
  const use = performPlayAction(context, id);
  await settle();
  const level = controller.root.querySelector('[data-target-slot-level="2"]');
  expect(level).not.toBeNull();
  expect(
    controller.root.querySelector('[data-target-slot-level="1"]').getAttribute('aria-pressed')
  ).toBe('true');
  controller.toggle(target.id);
  controller.toggle(target.id);
  controller.toggle(target.id);
  controller.root.querySelector('[data-target-slot-level="2"]').click();
  expect(controller.active.profile.maxTargets).toBe(4);
  expect(controller.active.selection.targets).toEqual([{ tokenId: target.id, count: 3 }]);
  expect(controller.root.querySelector('[data-target-action="confirm"]').disabled).toBe(true);
  expect(session.status(caster).actions).toBe(1);
  expect(library.get(caster.characterSheetId).slotsUsed.every((used) => used === 0)).toBe(true);
  controller.toggle(target.id);
  confirm();
  const committed = await use;
  expect(committed).toMatchObject({
    slotLevel: 2,
    targetingSelection: { targets: [expect.objectContaining({ count: 4 })] },
  });
  expect(library.get(caster.characterSheetId).slotsUsed.slice(0, 2)).toEqual([0, 1]);
  expect(session.status(caster).actions).toBe(0);
  expect(session.history(caster)).toHaveLength(1);
});

test('Fly offers self and Touch targets, confirms willingness and grants all chosen upcast recipients', async () => {
  const id = addSpell('spell:fly');
  session.startTurn(caster);
  const use = performPlayAction(context, id);
  await settle();
  expect(controller.root.querySelector(`[data-target-token="${caster.id}"]`)).not.toBeNull();
  controller.toggle(caster.id);
  expect(controller.root.querySelector('[data-target-action="confirm"]').disabled).toBe(true);
  const willingness = controller.root.querySelector('[data-target-willing]');
  expect(willingness).not.toBeNull();
  willingness.checked = true;
  willingness.dispatchEvent(new Event('change', { bubbles: true }));
  expect(controller.root.querySelector('[data-target-action="confirm"]').disabled).toBe(false);
  controller.root.querySelector('[data-target-slot-level="4"]').click();
  controller.active.filter = 'any';
  controller.render();
  controller.toggle(target.id);
  expect(controller.active.selection.willingConfirmed).toBe(false);
  const confirmWillingness = controller.root.querySelector('[data-target-willing]');
  confirmWillingness.checked = true;
  confirmWillingness.dispatchEvent(new Event('change', { bubbles: true }));
  confirm();
  const committed = await use;
  expect(committed.slotLevel).toBe(4);
  expect(session.effects[0].targetTokenIds).toEqual([caster.id, target.id]);
  expect(library.get(caster.characterSheetId).slotsUsed.slice(2, 4)).toEqual([0, 1]);
  expect(controller.effectRoot.textContent).toContain('60 ft flying speed');
  expect(controller.overlay.group.getObjectsByProperty('isMesh', true)).toHaveLength(2);
  caster.world.y = 5;
  controller.frame();
  expect(controller.overlay.group.getObjectsByProperty('isMesh', true)[0].position.y).toBeCloseTo(
    0.015
  );
  expect(caster.world.y).toBe(5);
  library.endConcentration(caster.characterSheetId);
  session.syncEffects();
  expect(controller.overlay.group.children).toEqual([]);
  expect(controller.effectRoot.hidden).toBe(true);
});

test('upcasting Fog Cloud resizes the locked preview without moving its origin or spending a slot', async () => {
  const id = addSpell('spell:fog-cloud');
  const { result } = await choose(id);
  const origin = { x: 5, y: 0, z: 5 };
  controller.updatePoint(origin, true);
  const level = controller.root.querySelector('[data-target-slot-level="2"]');
  expect(level).not.toBeNull();
  level.click();
  expect(controller.active.profile.sizeFeet).toBe(40);
  expect(controller.active.selection.origin).toEqual(origin);
  const sphere = controller.overlay.group.children.find(
    (mesh) => mesh.geometry?.type === 'SphereGeometry'
  );
  expect(sphere.geometry.parameters.radius).toBe(8);
  controller.cancel();
  expect((await result).cancelled).toBe(true);
  expect(session.effects).toEqual([]);
  expect(library.get(caster.characterSheetId).slotsUsed.every((used) => used === 0)).toBe(true);
});

test('only usable slot levels appear and cantrips do not show slot-level buttons', async () => {
  library.setSlotUsed(caster.characterSheetId, 1, 4);
  const { result } = await choose(addSpell('spell:magic-missile'));
  expect(controller.root.querySelector('[data-target-slot-level="1"]')).toBeNull();
  expect(controller.root.querySelector('[data-target-slot-level="2"]')).not.toBeNull();
  controller.cancel();
  await result;
  const cantrip = await choose(addSpell('spell:fire-bolt'));
  expect(controller.root.querySelector('[data-target-slot-level]')).toBeNull();
  expect(controller.root.textContent).toContain('Cantrip (no spell slot)');
  controller.cancel();
  await cantrip.result;
});

test('lowering cast level keeps allocations visible and requires correcting excess projectiles before confirmation', async () => {
  const { result } = await choose(addSpell('spell:magic-missile'));
  const higher = controller.root.querySelector('[data-target-slot-level="2"]');
  expect(higher).not.toBeNull();
  higher.click();
  for (let n = 0; n < 4; n++) controller.toggle(target.id);
  controller.root.querySelector('[data-target-slot-level="1"]').click();
  expect(controller.active.selection.targets).toEqual([{ tokenId: target.id, count: 4 }]);
  expect(controller.root.querySelector('[data-target-action="confirm"]').disabled).toBe(true);
  controller.toggle(target.id, -1);
  expect(controller.root.querySelector('[data-target-action="confirm"]').disabled).toBe(false);
  controller.cancel();
  await result;
});

test('reaction spells choose their level in the same popup without consuming an Action', async () => {
  const id = addSpell('spell:shield');
  session.startTurn(caster);
  const use = performPlayAction(context, id);
  await settle();
  const level = controller.root.querySelector('[data-target-slot-level="2"]');
  expect(level).not.toBeNull();
  level.click();
  confirm();
  const committed = await use;
  expect(committed.slotLevel).toBe(2);
  expect(session.status(caster)).toMatchObject({ actions: 1, reactions: 0 });
  expect(library.get(caster.characterSheetId).slotsUsed.slice(0, 2)).toEqual([0, 1]);
});

test('board target selection intercepts the entire left gesture but preserves right camera gestures and UI clicks', async () => {
  const { result } = await choose('attack:unarmed');
  const normalInput = jest.fn();
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'])
    canvas.addEventListener(type, normalInput);
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'])
    canvas.dispatchEvent(new MouseEvent(type, { button: 0, bubbles: true, cancelable: true }));
  expect(normalInput).not.toHaveBeenCalled();
  expect(controller.active.selection.targets).toEqual([{ tokenId: target.id, count: 1 }]);
  canvas.dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true }));
  expect(normalInput).toHaveBeenCalledTimes(1);
  confirm();
  expect((await result).targets[0].tokenId).toBe(target.id);
});

test('the panel range label follows the selected weapon mode, not its other mode’s maximum', async () => {
  const owned = library.add(caster.characterSheetId, 'item:dagger');
  library.equip(caster.characterSheetId, owned, true);
  const { result } = await choose(`attack:${owned}`);
  const rangeText = () => controller.root.querySelector('header').nextElementSibling.textContent;
  expect(rangeText()).toContain('5 ft melee range');
  const mode = controller.root.querySelector('[data-target-mode]');
  mode.value = 'thrown';
  mode.dispatchEvent(new Event('change', { bubbles: true }));
  expect(rangeText()).toContain('20/60 ft thrown range');
  controller.cancel();
  await result;
});

test('caster-origin shapes begin along actual facing and remain locked after placement', async () => {
  const { result } = await choose(addSpell('spell:burning-hands'));
  const firstArea = controller.overlay.group.children.find(
    (mesh) => mesh.geometry?.type === 'ConeGeometry'
  );
  expect(firstArea.position.x).toBeCloseTo(caster.world.x);
  expect(firstArea.position.z).toBeLessThan(caster.world.z);
  controller.updatePoint({ x: 6, y: 0, z: 1.5 }, true);
  controller.updatePoint({ x: 1.5, y: 0, z: 6 }, false);
  expect(controller.active.selection.aim).toEqual({ x: 6, y: 0, z: 1.5 });
  confirm();
  await result;
});

test('point-origin cubes allow a separate aiming step and show affected target counts', async () => {
  library.actions.setTargetingProfile(caster.characterSheetId, 'attack:unarmed', {
    version: 1,
    kind: 'area',
    rangeFeet: 60,
    shape: 'cube',
    sizeFeet: 15,
  });
  const { result } = await choose('attack:unarmed');
  controller.updatePoint({ x: 1.5, y: 0, z: 1.5 }, true);
  controller.updatePoint({ x: 1.5, y: 0, z: 5 }, false);
  expect(controller.active.selection.origin).toEqual(caster.world);
  expect(controller.active.selection.aim).toEqual({ x: 1.5, y: 0, z: 5 });
  expect(controller.root.querySelector('[data-target-count]')).not.toBeNull();
  controller.cancel();
  expect((await result).cancelled).toBe(true);
});

test('multi-projectile attacks select allocations, roll each separately, and commit one spell slot', async () => {
  const action = addSpell('spell:scorching-ray');
  const use = performPlayAction(context, action);
  await settle();
  controller.toggle(target.id);
  controller.toggle(target.id);
  controller.toggle(target.id);
  confirm();
  const committed = await use;
  expect(rollDiceExpression).toHaveBeenCalledTimes(3);
  expect(committed.targetRolls).toHaveLength(3);
  expect(library.get(caster.characterSheetId).slotsUsed[1]).toBe(1);
  expect(session.history(caster)).toHaveLength(1);
  expect(controller.preview).toBeNull();
});

test('canceling after one completed projectile preserves that roll, spends nothing, and removes the frozen preview', async () => {
  rollDiceExpression
    .mockResolvedValueOnce({ cancelled: false, text: 'Ray: 18' })
    .mockResolvedValueOnce({ cancelled: true, text: 'Cancelled' });
  const use = performPlayAction(context, addSpell('spell:scorching-ray'));
  await settle();
  controller.toggle(target.id);
  controller.toggle(target.id);
  controller.toggle(target.id);
  confirm();
  expect(await use).toBeNull();
  expect(library.get(caster.characterSheetId).slotsUsed[1]).toBe(0);
  expect(session.history(caster)).toHaveLength(1);
  expect(session.history(caster)[0].rollText).toBe('Ray: 18');
  expect(controller.preview).toBeNull();
  expect(session.pending).toBeNull();
});

test('a history failure during cancellation is reported without recording already-recorded projectiles twice', async () => {
  rollDiceExpression
    .mockResolvedValueOnce({ cancelled: false, text: 'Ray: 11' })
    .mockResolvedValueOnce({ cancelled: false, text: 'Ray: 12' })
    .mockResolvedValueOnce({ cancelled: true, text: 'Cancelled' });
  const original = session.recordRoll.bind(session);
  jest
    .spyOn(session, 'recordRoll')
    .mockImplementationOnce(original)
    .mockImplementationOnce(() => {
      throw new Error('History unavailable');
    })
    .mockImplementation(original);
  const use = performPlayAction(context, addSpell('spell:scorching-ray'));
  await settle();
  controller.toggle(target.id);
  controller.toggle(target.id);
  controller.toggle(target.id);
  confirm();
  await use;
  expect(session.history(caster).filter((roll) => roll.rollText === 'Ray: 11')).toHaveLength(1);
  expect(context._failure).toHaveBeenCalled();
});

test('every completed projectile retains its own single-use roll history context on cancellation', async () => {
  rollDiceExpression
    .mockResolvedValueOnce({ cancelled: false, text: 'Ray: 11' })
    .mockResolvedValueOnce({ cancelled: false, text: 'Ray: 12' })
    .mockResolvedValueOnce({ cancelled: true, text: 'Cancelled' });
  const use = performPlayAction(context, addSpell('spell:scorching-ray'));
  await settle();
  controller.toggle(target.id);
  controller.toggle(target.id);
  controller.toggle(target.id);
  confirm();
  await use;
  expect(session.history(caster).map((roll) => roll.rollText)).toEqual(['Ray: 12', 'Ray: 11']);
  expect(context._failure).not.toHaveBeenCalled();
  expect(library.get(caster.characterSheetId).slotsUsed[1]).toBe(0);
});

test('selection cancellation via Escape resolves without costs or stuck dialog state', async () => {
  const use = performPlayAction(context, 'attack:unarmed');
  await settle();
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  );
  expect(await use).toBeNull();
  expect(session.pending).toBeNull();
  expect(controller.root.hidden).toBe(true);
  expect(controller.preview).toBeNull();
});

test('closing the actual sheet cancels its unconfirmed targeting without spending anything', async () => {
  const services = { ...context.services, catalog: new CompendiumCatalog({ ...data, version: 1 }) };
  gm.characterServices = services;
  caster.type = 'knight';
  gm.token3DAdapter = { setSelectedToken: jest.fn(), getSelectedToken: () => caster };
  const sheets = new CharacterSheetWindow({
    gameManager: gm,
    characterServices: services,
  }).attach();
  try {
    await sheets.open(caster);
    const use = performPlayAction(sheets.characterContent, 'attack:unarmed');
    await settle();
    sheets.hide();
    expect(controller.root.hidden).toBe(true);
    expect(await use).toBeNull();
    expect(session.pending).toBeNull();
    expect(session.history(caster)).toEqual([]);
  } finally {
    sheets.destroy();
  }
});

test('closing during lazy overlay loading cancels the reservation before the renderer arrives', async () => {
  let release;
  const loading = new Promise((resolve) => {
    release = resolve;
  });
  jest.spyOn(controller, 'ensureOverlay').mockReturnValue(loading);
  const ticket = session.prepareAction(caster, 'attack:unarmed');
  const selected = controller.choose(caster, ticket);
  try {
    controller.cancelFor(caster);
    expect(session.pending).toBeNull();
  } finally {
    release();
    await settle();
    controller.cancel();
    await selected;
  }
});

test.each(['expiry', 'manual ending'])(
  'the last lingering visual is actually removed on %s, not merely hidden in the ledger',
  async (ending) => {
    const id = addSpell('spell:grease');
    library.actions.setTargetingProfile(caster.characterSheetId, id, {
      version: 1,
      kind: 'area',
      rangeFeet: 60,
      shape: 'square',
      sizeFeet: 10,
      lingerTurns: 1,
    });
    const use = performPlayAction(context, id);
    await settle();
    controller.updatePoint({ x: 5.5, y: 0, z: 5.5 }, true);
    confirm();
    await use;
    expect(session.effects).toHaveLength(1);
    expect(controller.overlay.group.children).toHaveLength(1);
    if (ending === 'expiry') session.startTurn(caster);
    else session.endEffect(session.effects[0].id);
    expect(session.effects).toEqual([]);
    expect(controller.overlay.group.children).toEqual([]);
    expect(controller.effectRoot.hidden).toBe(true);
  }
);
