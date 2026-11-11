import * as three from 'three';
import CampaignTraversalPopup from '../../../src/ui/campaigns/CampaignTraversalPopup.js';
import { TOKEN_3D_MODELS } from '../../../src/config/token-adapter/MannequinConfig.js';
import {
  addPointerView,
  clickFeature,
  createConnectedTravelBoard,
  disposeConnectedTravelBoard,
} from '../../helpers/connectedTravelBoard.js';
import { installHumanoidAssetFiles, stepHumanoid } from '../../helpers/humanoid-fixture.js';

let restoreFiles;
beforeAll(() => {
  restoreFiles = installHumanoidAssetFiles();
});
afterAll(() => restoreFiles());

async function fixture({
  mapId = 'map-main',
  position = { x: 5.5, y: 0, z: 10.5 },
  allowance = 30,
} = {}) {
  const gm = await createConnectedTravelBoard({ mapId, position });
  const actor = gm.placedTokens[0];
  const adapter = gm.token3DAdapter;
  adapter.releaseTokenVisual(actor);
  const config = TOKEN_3D_MODELS[actor.type];
  const mesh = await adapter._create3DToken(actor, gm.threeSceneManager.scene, {
    ...config,
    animations: { idle: config.animations.idle, walk: config.animations.walk },
  });
  expect(mesh).toBeTruthy();
  const canvas = addPointerView(
    gm,
    new three.Vector3(11.1, 1.2, 10.5),
    new three.Vector3(5, 4, 11.5)
  );
  const session = gm.characterServices.combat;
  session.startTurn(actor);
  session.adjustMovement(actor, allowance);
  const popup = new CampaignTraversalPopup({ gameManager: gm }).attach();
  return { gm, actor, adapter, mesh, canvas, session, popup };
}

function finishWalking(context) {
  const { gm, actor, adapter, mesh } = context;
  for (let frame = 0; frame < 6000 && adapter.isMovementInProgress(actor); frame++) {
    stepHumanoid({ adapter, token: actor, mesh }, 1 / 60);
    gm.advanceFrame();
  }
  gm.advanceFrame();
  expect(adapter.isMovementInProgress(actor)).toBe(false);
}

function dispose({ gm, popup, canvas }) {
  popup.dispose();
  canvas.remove();
  disposeConnectedTravelBoard(gm);
}

test('automatic approach stops at a physical barrier instead of walking through it', async () => {
  const context = await fixture({ allowance: 40 });
  const { gm, actor, canvas, session, popup } = context;
  try {
    gm.terrainEngine.addVolume({
      id: 'approach-barrier',
      bounds: { min: { x: 40, y: 0, z: 0 }, max: { x: 45, y: 4, z: 125 } },
    });
    clickFeature(canvas);
    finishWalking(context);
    await popup.ready;
    expect(actor.world).toEqual({ x: 7.5, y: 0, z: 10.5 });
    expect(actor.mapId).toBe('map-main');
    expect(session.status(actor).movement.remaining).toBe(30);
    expect(popup.root.hidden).toBe(true);
    expect(session.moves.size).toBe(0);
  } finally {
    dispose(context);
  }
}, 30000);

test('arrival still explains a blocked door instead of silently treating it as insufficient movement', async () => {
  const context = await fixture({ allowance: 40 });
  const { gm, actor, canvas, session, popup } = context;
  try {
    clickFeature(canvas);
    gm.terrainEngine.addVolume({
      id: 'closed-door',
      bounds: { min: { x: 55, y: 0, z: 50 }, max: { x: 56, y: 7, z: 55 } },
    });
    finishWalking(context);
    await popup.ready;
    expect(actor.mapId).toBe('map-main');
    expect(session.status(actor).movement.remaining).toBe(15);
    expect(popup.root.hidden).toBe(false);
    expect(popup.confirm.disabled).toBe(true);
    expect(popup.status.textContent).toMatch(/wall|closed opening/i);
  } finally {
    dispose(context);
  }
}, 30000);

test('selecting another creature prevents the previous walker from opening a traversal popup', async () => {
  const context = await fixture({ allowance: 40 });
  const { gm, actor, adapter, canvas, session, popup } = context;
  try {
    clickFeature(canvas);
    const pending = popup.ready;
    const selection = adapter.setSelectedToken(gm.placedTokens[1]);
    finishWalking(context);
    await selection;
    expect(await pending).toBe(false);
    expect(actor.world).toEqual({ x: 10.5, y: 0, z: 10.5 });
    expect(session.status(actor).movement.remaining).toBe(15);
    expect(popup.root.hidden).toBe(true);
    expect(adapter.getSelectedToken()).toBe(gm.placedTokens[1]);
  } finally {
    dispose(context);
  }
}, 30000);

test('choosing another movement destination cancels the queued traversal offer', async () => {
  const context = await fixture({ allowance: 40 });
  const { gm, actor, adapter, canvas, session, popup } = context;
  try {
    clickFeature(canvas);
    const pending = popup.ready;
    const point = new three.Vector3(9.5, 0, 10.5).project(gm.threeSceneManager.camera);
    clickFeature(canvas, { clientX: (point.x + 1) * 400, clientY: (1 - point.y) * 300 });
    expect(adapter.requestMoveToGrid(actor, 9, 10)).toMatchObject({ queued: true });
    finishWalking(context);
    expect(await pending).toBe(false);
    expect(actor.world).toEqual({ x: 9.5, y: 0, z: 10.5 });
    expect(session.status(actor).movement.remaining).toBe(20);
    expect(popup.root.hidden).toBe(true);
    expect(actor.mapId).toBe('map-main');
  } finally {
    dispose(context);
  }
}, 30000);

test('Escape dismisses the pending traversal offer without refunding the walk', async () => {
  const context = await fixture({ allowance: 40 });
  const { actor, canvas, session, popup } = context;
  try {
    clickFeature(canvas);
    const pending = popup.ready;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    finishWalking(context);
    expect(await pending).toBe(false);
    expect(actor.world).toEqual({ x: 10.5, y: 0, z: 10.5 });
    expect(session.status(actor).movement.remaining).toBe(15);
    expect(popup.root.hidden).toBe(true);
    expect(actor.mapId).toBe('map-main');
  } finally {
    dispose(context);
  }
}, 30000);

test('free play retains its normal per-move refresh before offering stair traversal', async () => {
  const context = await fixture({
    mapId: 'ground-floor',
    position: { x: 3.5, y: 0, z: 6.5 },
  });
  const { gm, actor, canvas, session, popup } = context;
  session.endCombat();
  const camera = gm.threeSceneManager.camera;
  camera.position.set(4, 6, 9.5);
  camera.lookAt(6.5, 1.25, 5.75);
  camera.updateMatrixWorld(true);
  try {
    clickFeature(canvas);
    finishWalking(context);
    await popup.ready;
    expect(actor.world).toEqual({ x: 6.5, y: 0, z: 8.5 });
    expect(session.active).toBe(false);
    expect(session.freeMovementAllowance(actor)).toBe(30);
    expect(popup.root.hidden).toBe(false);
    expect(popup.confirm.textContent).toBe('Use stairs (20 ft)');
    popup.confirm.click();
    await popup.ready;
    expect(actor.mapId).toBe('upper-floor');
    expect(session.freeMovementAllowance(actor)).toBe(30);
  } finally {
    dispose(context);
  }
}, 30000);

test('a distant staircase click walks to its landing and preserves the remaining stair cost', async () => {
  const context = await fixture({
    mapId: 'ground-floor',
    position: { x: 0.5, y: 0, z: 6.5 },
    allowance: 50,
  });
  const { gm, actor, canvas, session, popup } = context;
  const camera = gm.threeSceneManager.camera;
  camera.position.set(4, 6, 9.5);
  camera.lookAt(6.5, 1.25, 5.75);
  camera.updateMatrixWorld(true);
  const turn = session.turn;
  try {
    clickFeature(canvas);
    finishWalking(context);
    await popup.ready;
    expect(actor.world).toEqual({ x: 6.5, y: 0, z: 8.5 });
    expect(session.status(actor).movement.remaining).toBe(20);
    expect(popup.confirm.textContent).toBe('Use stairs (20 ft)');
    expect(popup.root.hidden).toBe(false);
    popup.confirm.click();
    await popup.ready;
    expect(actor.mapId).toBe('upper-floor');
    expect(session.status(actor).movement.remaining).toBe(0);
    expect(session.turn).toBe(turn);
  } finally {
    dispose(context);
  }
}, 30000);

test('reaching an entrance without enough movement to use it stops without a traversal popup', async () => {
  const context = await fixture({ allowance: 25 });
  const { actor, canvas, session, popup } = context;
  try {
    clickFeature(canvas);
    finishWalking(context);
    await popup.ready;
    expect(actor.world).toEqual({ x: 10.5, y: 0, z: 10.5 });
    expect(actor.mapId).toBe('map-main');
    expect(session.status(actor).movement.remaining).toBe(0);
    expect(popup.root.hidden).toBe(true);
    expect(session.moves.size).toBe(0);
  } finally {
    dispose(context);
  }
}, 30000);

test('a distant entrance click spends only the available walking movement and stops short', async () => {
  const context = await fixture({ allowance: 10 });
  const { actor, adapter, canvas, session, popup } = context;
  const turn = session.turn;
  try {
    clickFeature(canvas);
    expect(adapter.isMovementInProgress(actor)).toBe(true);
    finishWalking(context);
    await popup.ready;
    expect(actor.world).toEqual({ x: 7.5, y: 0, z: 10.5 });
    expect(actor.mapId).toBe('map-main');
    expect(session.status(actor).movement.remaining).toBe(0);
    expect(session.moves.size).toBe(0);
    expect(session.turn).toBe(turn);
    expect(popup.root.hidden).toBe(true);
  } finally {
    dispose(context);
  }
}, 30000);

test('a distant doorway click walks the real character to the entrance before offering paid Enter', async () => {
  const context = await fixture();
  const { gm, actor, adapter, canvas, session, popup } = context;
  const turn = session.turn;
  try {
    clickFeature(canvas);
    expect(adapter.isMovementInProgress(actor)).toBe(true);
    expect(popup.root.hidden).toBe(true);
    expect(actor.mapId).toBe('map-main');
    finishWalking(context);
    await popup.ready;
    expect(actor.world).toEqual({ x: 10.5, y: 0, z: 10.5 });
    expect(session.status(actor).movement.remaining).toBe(5);
    expect(session.turn).toBe(turn);
    expect(popup.root.hidden).toBe(false);
    expect(popup.confirm.textContent).toBe('Enter (5 ft)');
    expect(popup.confirm.disabled).toBe(false);
    popup.confirm.click();
    await popup.ready;
    expect(actor.mapId).toBe('ground-floor');
    expect(session.status(actor).movement.remaining).toBe(0);
    expect(session.turn).toBe(turn);
    expect(gm.placedTokens[0]).toBe(actor);
  } finally {
    dispose(context);
  }
}, 30000);
