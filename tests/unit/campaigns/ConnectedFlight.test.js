import {
  createConnectedTravelBoard,
  disposeConnectedTravelBoard,
} from '../../helpers/connectedTravelBoard.js';

test('a flying doorway interaction approaches an elevation that fits the real opening', async () => {
  const gm = await createConnectedTravelBoard();
  const actor = gm.placedTokens[0];
  try {
    await gm.characterServices.library.edit(actor.characterSheetId, {
      fallTraits: { flySpeed: 60 },
    });
    actor.flightActive = true;
    actor.world.y = 1;
    const option = getConnectionTravelOption(gm, actor, 'building-door');
    expect(option.actionLabel).toBe('Fly through');
    expect(option.approach.point).toMatchObject({ x: 10.5, z: 10.5 });
    expect(option.approach.point.y).toBeCloseTo(0.4);
    expect(option.allowed).toBe(false);
  } finally {
    disposeConnectedTravelBoard(gm);
  }
});

test('a live flying transfer preserves flight and spends flying rather than walking allowance', async () => {
  const gm = await createConnectedTravelBoard();
  const actor = gm.placedTokens[0];
  const session = gm.characterServices.combat;
  try {
    await changeCampaignView(gm, { mapId: 'map-main' });
    await gm.characterServices.library.edit(actor.characterSheetId, {
      speed: 0,
      fallTraits: { flySpeed: 60 },
    });
    actor.flightActive = true;
    actor.world.y = 0.4;
    session.startTurn(actor);
    const turn = session.turn;
    await travelCampaignConnection(gm, actor, 'building-door');
    expect(actor.mapId).toBe('ground-floor');
    expect(actor.world).toEqual({ x: 0.5, y: 0.4, z: 6.5 });
    expect(actor.flightActive).toBe(true);
    expect(session.status(actor).movement.remaining).toBe(55);
    expect(session.turn).toBe(turn);
    expect(session.activeToken).toBe(actor);
    expect(gm.campaignMapId).toBe('map-main');
    const saved = await captureCampaignScene(gm, gm.characterServices.library);
    expect(saved.creatures[0].pose.kind).toBe('flight');
  } finally {
    disposeConnectedTravelBoard(gm);
  }
});

test('airborne checkpoints above an upper-floor opening remain valid when browsing another map', async () => {
  const gm = await createConnectedTravelBoard({
    mapId: 'upper-floor',
    position: { x: 6.5, y: 0, z: 4.5 },
  });
  const actor = gm.placedTokens[0];
  try {
    await gm.characterServices.library.edit(actor.characterSheetId, {
      fallTraits: { flySpeed: 60 },
    });
    actor.flightActive = true;
    actor.gridY = 8;
    actor.world = { x: 6.5, y: 0.4, z: 8.5 };
    const saved = await captureCampaignScene(gm, gm.characterServices.library);
    expect(saved.creatures[0].pose).toEqual({ kind: 'flight', world: actor.world });
    await changeCampaignView(gm, { focusTokenId: gm.placedTokens[1].id });
    const remote = await captureCampaignScene(gm, gm.characterServices.library);
    expect(remote.creatures[0].pose).toEqual(saved.creatures[0].pose);
    expect(gm.token3DAdapter.getFlightStatus(actor).heightFeet).toBe(12);
    expect(gm.token3DAdapter.getTokenGroundPosition(actor)).toEqual({ x: 6.5, y: 0, z: 8.5 });
    expect(actor.mapId).toBe('upper-floor');
    expect(actor.flightActive).toBe(true);
  } finally {
    disposeConnectedTravelBoard(gm);
  }
});

test('interior flight respects shared exterior walls while preserving the upper window aperture', async () => {
  const gm = await createConnectedTravelBoard({
    mapId: 'upper-floor',
    position: { x: 6.5, y: 0, z: 4.5 },
  });
  const actor = gm.placedTokens[0];
  try {
    gm.tokenManager.removeToken(gm.placedTokens[2]);
    await gm.characterServices.library.edit(actor.characterSheetId, {
      fallTraits: { flySpeed: 60 },
    });
    actor.flightActive = true;
    actor.world.y = 0.4;
    const range = gm.token3DAdapter.getTokenMovementRange(actor);
    expect(range.tiles.has('0,6')).toBe(false);
    expect(range.tiles.has('0,2')).toBe(true);
  } finally {
    disposeConnectedTravelBoard(gm);
  }
});

test('flight above a finite upper-floor opening uses actual lower support without blocking the air', async () => {
  const gm = await createConnectedTravelBoard({
    mapId: 'upper-floor',
    position: { x: 6.5, y: 0, z: 4.5 },
  });
  const actor = gm.placedTokens[0];
  try {
    await gm.characterServices.library.edit(actor.characterSheetId, {
      fallTraits: { flySpeed: 60 },
    });
    actor.flightActive = true;
    actor.world.y = 0.4;
    const range = gm.token3DAdapter.getTokenMovementRange(actor);
    expect(range.travelMode).toBe('fly');
    expect(range.tiles.get('6,8').cost).toBe(20);
    expect(actor.mapId).toBe('upper-floor');
    expect(actor.world.y).toBe(0.4);
  } finally {
    disposeConnectedTravelBoard(gm);
  }
});
import {
  captureCampaignScene,
  changeCampaignView,
  travelCampaignConnection,
} from '../../../src/campaigns/SceneWorld.js';
import { getConnectionTravelOption } from '../../../src/campaigns/CampaignTravel.js';
