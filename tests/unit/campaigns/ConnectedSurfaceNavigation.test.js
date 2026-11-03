import { createOpeningsTravelScene } from '../../../src/campaigns/examples/ConnectedOpeningsExample.js';
import {
  createConnectedTravelBoard,
  disposeConnectedTravelBoard,
} from '../../helpers/connectedTravelBoard.js';

test('a balcony step cannot fall through the physical upper floor simply because another map owns it', async () => {
  const gm = await createConnectedTravelBoard({
    sceneFactory: createOpeningsTravelScene,
    position: { x: 10.5, y: 2, z: 10.5 },
  });
  try {
    const range = gm.token3DAdapter.getTokenMovementRange(gm.placedTokens[0]);
    expect(
      [...range.tiles.values()].some(
        (cell) => cell.gridX === 11 && cell.gridY === 10 && cell.heightFeet === 0 && cell.cost === 5
      )
    ).toBe(false);
  } finally {
    disposeConnectedTravelBoard(gm);
  }
});
