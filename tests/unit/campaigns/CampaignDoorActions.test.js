import { prepareSharedDoorScene } from '../../../src/campaigns/CampaignDoorActions.js';
import {
  createConnectedTravelBoard,
  disposeConnectedTravelBoard,
} from '../../helpers/connectedTravelBoard.js';

test('a shared door update preserves the local camera, creature positions and combat ledger', async () => {
  const gm = await createConnectedTravelBoard();
  try {
    const before = gm.campaignWorld.save();
    const incoming = JSON.parse(JSON.stringify(before));
    incoming.connections[0].open = false;
    incoming.connections[0].locked = true;
    incoming.view.camera.target.x += 10;
    const merged = prepareSharedDoorScene(gm, incoming);
    expect(merged.view).toEqual(before.view);
    expect(merged.creatures).toEqual(before.creatures);
    expect(merged.combat).toEqual(before.combat);
    expect(merged.maps).toEqual(before.maps);
    expect(merged.connections[0]).toMatchObject({ open: false, locked: true });
    expect(gm.campaignWorld.save()).toEqual(before);
  } finally {
    disposeConnectedTravelBoard(gm);
  }
});

test('a shared update that also moves a creature is rejected instead of overwriting local gameplay', async () => {
  const gm = await createConnectedTravelBoard();
  try {
    const before = gm.campaignWorld.save();
    const incoming = JSON.parse(JSON.stringify(before));
    incoming.creatures[0].pose.world.x += 1;
    expect(() => prepareSharedDoorScene(gm, incoming)).toThrow(/board changed/i);
    expect(gm.campaignWorld.save()).toEqual(before);
  } finally {
    disposeConnectedTravelBoard(gm);
  }
});
