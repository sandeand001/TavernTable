import * as three from 'three';
import CampaignTraversalPopup from '../../../src/ui/campaigns/CampaignTraversalPopup.js';
import {
  addPointerView,
  clickFeature,
  createConnectedTravelBoard,
  disposeConnectedTravelBoard,
} from '../../helpers/connectedTravelBoard.js';
import { createOpeningsTravelScene } from '../../../src/campaigns/examples/ConnectedOpeningsExample.js';

test('a successful entry prompt asks only for confirmation and shows its cost on the action', async () => {
  const gm = await createConnectedTravelBoard();
  const popup = new CampaignTraversalPopup({ gameManager: gm }).attach();
  try {
    popup.open('building-door');
    expect(popup.title.textContent).toBe('Enter Inn doorway?');
    expect(popup.confirm.textContent).toBe('Enter (5 ft)');
    expect(popup.status.textContent).toBe('');
    expect(popup.status.hidden).toBe(true);
    expect(popup.root.textContent).not.toContain('current turn');
    expect(popup.root.textContent).not.toContain('Pathfinder to');
  } finally {
    popup.dispose();
    disposeConnectedTravelBoard(gm);
  }
});

test('a five-foot window entry gives only a short insufficient-movement message below the threshold', async () => {
  const gm = await createConnectedTravelBoard({ sceneFactory: createOpeningsTravelScene });
  const actor = gm.placedTokens[0],
    session = gm.characterServices.combat;
  const popup = new CampaignTraversalPopup({ gameManager: gm }).attach();
  try {
    actor.world = { x: 10.8, y: 3.4, z: 6.5 };
    actor.gridX = 10;
    actor.gridY = 6;
    actor.openingHold = { openingId: 'high-window' };
    session.startTurn(actor);
    session.adjustMovement(actor, 4);
    popup.open('high-window');
    expect(popup.title.textContent).toBe('Enter window?');
    expect(popup.confirm.textContent).toBe('Enter (5 ft)');
    expect(popup.confirm.disabled).toBe(true);
    expect(popup.status.textContent).toBe('Not enough movement.');
    expect(session.status(actor).movement.remaining).toBe(4);
    session.adjustMovement(actor, 5);
    popup.open('high-window');
    expect(popup.confirm.disabled).toBe(false);
    expect(popup.status.hidden).toBe(true);
    expect(popup.status.textContent).toBe('');
  } finally {
    popup.dispose();
    disposeConnectedTravelBoard(gm);
  }
});

test('climb and drop prompts stay brief while retaining the confirmed gap action', async () => {
  const gm = await createConnectedTravelBoard({ sceneFactory: createOpeningsTravelScene });
  const actor = gm.placedTokens[0];
  const popup = new CampaignTraversalPopup({ gameManager: gm }).attach();
  try {
    actor.world = { x: 10.8, y: 3.4, z: 6.5 };
    actor.gridX = 10;
    actor.gridY = 6;
    actor.surfaceHold = gm.campaignWorld.openingSurfaceGrip(
      'map-main',
      actor.world,
      'high-window',
      {
        mapId: 'map-main',
        geometry: gm.terrainEngine.geometry,
      }
    );
    popup.openSurface(
      { point: { x: 10.8, y: 0, z: 6.5 }, normal: { x: 0, y: 1, z: 0 } },
      { clientX: 200, clientY: 200 },
      actor
    );
    expect(popup.title.textContent).toBe('Climb and re-grab?');
    expect(popup.confirm.textContent).toBe('Climb and re-grab (20 ft)');
    expect(popup.status.textContent).toBe('');
    expect(popup.status.hidden).toBe(true);
    expect(popup.root.querySelector('[data-travel-action="drop"]').textContent).toBe('Drop (0 ft)');
  } finally {
    popup.dispose();
    disposeConnectedTravelBoard(gm);
  }
});

test('confirmation rechecks an opening that became blocked and spends no movement', async () => {
  const gm = await createConnectedTravelBoard();
  const actor = gm.placedTokens[0];
  const session = gm.characterServices.combat;
  session.startTurn(actor);
  session.adjustMovement(actor, 30);
  const popup = new CampaignTraversalPopup({ gameManager: gm }).attach();
  try {
    popup.open('building-door');
    expect(popup.confirm.disabled).toBe(false);
    gm.terrainEngine.addVolume({
      id: 'closed-door',
      bounds: { min: { x: 55, y: 0, z: 50 }, max: { x: 56, y: 7, z: 55 } },
    });
    popup.confirm.click();
    await popup.ready;
    expect(popup.root.hidden).toBe(false);
    expect(popup.status.textContent).toMatch(/wall|closed opening/i);
    expect(popup.confirm.disabled).toBe(true);
    expect(actor.mapId).toBe('map-main');
    expect(session.status(actor).movement.remaining).toBe(30);
    expect(session.moves.size).toBe(0);
  } finally {
    popup.dispose();
    disposeConnectedTravelBoard(gm);
  }
});

test('imported character, connection and destination names are displayed only as text', async () => {
  const gm = await createConnectedTravelBoard();
  const popup = new CampaignTraversalPopup({ gameManager: gm }).attach();
  try {
    const saved = gm.campaignWorld.save();
    saved.connections[0].name = '<img src=x onerror=alert(1)>';
    saved.maps[1].name = '<svg onload=alert(1)>';
    gm.campaignWorld.acceptCheckpoint(saved);
    gm.placedTokens[0].name = '<b>Pathfinder</b>';
    popup.open('building-door');
    expect(popup.title.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(popup.root.textContent).not.toContain('<b>Pathfinder</b>');
    expect(popup.root.textContent).not.toContain('<svg onload=alert(1)>');
    expect(popup.root.querySelector('img, svg, b')).toBeNull();
  } finally {
    popup.dispose();
    disposeConnectedTravelBoard(gm);
  }
});

test('the upper stairwell shows real lower treads and clicking them offers the return route', async () => {
  const gm = await createConnectedTravelBoard({
    mapId: 'upper-floor',
    position: { x: 6.5, y: 0, z: 4.5 },
  });
  const canvas = addPointerView(gm, new three.Vector3(6.5, -1, 6.35), new three.Vector3(4, 5, 4));
  const popup = new CampaignTraversalPopup({ gameManager: gm }).attach();
  try {
    const ray = new three.Raycaster(new three.Vector3(6.5, 1, 6.35), new three.Vector3(0, -1, 0));
    const walls = gm.threeSceneManager.scene.getObjectByName('MapInteriorWalls');
    const hit = ray.intersectObject(walls, true)[0];
    expect(hit).toBeDefined();
    expect(hit.point.y).toBeCloseTo(-1);
    clickFeature(canvas);
    expect(popup.root.hidden).toBe(false);
    expect(popup.title.textContent).toBe('Use stairs?');
    expect(popup.confirm.textContent).toBe('Use stairs (20 ft)');
    popup.confirm.click();
    await popup.ready;
    expect(gm.placedTokens[0].mapId).toBe('ground-floor');
  } finally {
    popup.dispose();
    canvas.remove();
    disposeConnectedTravelBoard(gm);
  }
});

test('a traversal popup confirms Enter with its cost and transfers the selected creature', async () => {
  const gm = await createConnectedTravelBoard();
  const actor = gm.placedTokens[0];
  const popup = new CampaignTraversalPopup({ gameManager: gm }).attach();
  try {
    popup.open('building-door', { clientX: 200, clientY: 200 });
    expect(popup.root.hidden).toBe(false);
    expect(popup.root.getAttribute('aria-label')).toBe('Traversal options');
    expect(popup.title.textContent).toBe('Enter Inn doorway?');
    expect(popup.root.textContent).toContain('5 ft');
    expect(actor.mapId).toBe('map-main');
    const confirm = popup.root.querySelector('[data-travel-confirm]');
    expect(confirm.disabled).toBe(false);
    expect(confirm.textContent).toContain('Enter');
    confirm.click();
    await popup.ready;
    expect(actor.mapId).toBe('ground-floor');
    expect(gm.token3DAdapter.getSelectedToken()).toBe(actor);
    expect(popup.root.hidden).toBe(true);
  } finally {
    popup.dispose();
    disposeConnectedTravelBoard(gm);
  }
});

test('clicking the actual doorway opens a cancellable popup instead of moving automatically', async () => {
  const gm = await createConnectedTravelBoard();
  const canvas = addPointerView(
    gm,
    new three.Vector3(11.1, 1.2, 10.5),
    new three.Vector3(5, 4, 11.5)
  );
  const popup = new CampaignTraversalPopup({ gameManager: gm }).attach();
  let ordinaryPointerReceived = false;
  canvas.addEventListener('pointerdown', () => {
    ordinaryPointerReceived = true;
  });
  try {
    const event = clickFeature(canvas);
    expect(popup.root.hidden).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(ordinaryPointerReceived).toBe(false);
    expect(popup.root.textContent).toContain('Inn doorway');
    expect(popup.root.textContent).toContain('5 ft');
    expect(gm.placedTokens[0].mapId).toBe('map-main');
    popup.root.querySelector('[data-travel-cancel]').click();
    expect(popup.root.hidden).toBe(true);
    expect(gm.placedTokens[0].mapId).toBe('map-main');
    expect(gm.characterServices.combat.moves.size).toBe(0);
  } finally {
    popup.dispose();
    canvas.remove();
    disposeConnectedTravelBoard(gm);
  }
});

test('a distant doorway with no movement stays closed without moving the creature', async () => {
  const gm = await createConnectedTravelBoard({
    position: { x: 5.5, y: 0, z: 10.5 },
  });
  const session = gm.characterServices.combat;
  session.startTurn(gm.placedTokens[0]);
  session.adjustMovement(gm.placedTokens[0], 0);
  const canvas = addPointerView(
    gm,
    new three.Vector3(11.1, 1.2, 10.5),
    new three.Vector3(5, 4, 11.5)
  );
  const popup = new CampaignTraversalPopup({ gameManager: gm }).attach();
  try {
    clickFeature(canvas);
    expect(popup.root.hidden).toBe(true);
    expect(gm.placedTokens[0].world).toEqual({ x: 5.5, y: 0, z: 10.5 });
    expect(gm.characterServices.combat.moves.size).toBe(0);
  } finally {
    popup.dispose();
    canvas.remove();
    disposeConnectedTravelBoard(gm);
  }
});

test('clicking the physical staircase offers a paid transfer while preserving the active turn', async () => {
  const gm = await createConnectedTravelBoard({
    mapId: 'ground-floor',
    position: { x: 6.5, y: 0, z: 8.5 },
  });
  const actor = gm.placedTokens[0];
  const session = gm.characterServices.combat;
  session.startTurn(actor);
  session.adjustMovement(actor, 30);
  const turn = session.turn;
  const canvas = addPointerView(
    gm,
    new three.Vector3(6.5, 1.25, 5.75),
    new three.Vector3(4, 6, 9.5)
  );
  const popup = new CampaignTraversalPopup({ gameManager: gm }).attach();
  try {
    clickFeature(canvas);
    expect(popup.root.hidden).toBe(false);
    expect(popup.title.textContent).toBe('Use stairs?');
    expect(popup.confirm.textContent).toBe('Use stairs (20 ft)');
    expect(session.status(actor).movement.remaining).toBe(30);
    popup.confirm.click();
    await popup.ready;
    expect(actor.mapId).toBe('upper-floor');
    expect(session.turn).toBe(turn);
    expect(session.activeToken).toBe(actor);
    expect(session.status(actor).movement.remaining).toBe(10);
    popup.open('main-stairs');
    expect(popup.confirm.disabled).toBe(true);
    expect(popup.status.textContent).toBe('Not enough movement.');
    expect(popup.confirm.textContent).toBe('Use stairs (20 ft)');
  } finally {
    popup.dispose();
    canvas.remove();
    disposeConnectedTravelBoard(gm);
  }
});
