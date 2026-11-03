import CampaignWorld from '../../../src/campaigns/CampaignWorld.js';
import { CharacterLibrary } from '../../../src/entities/characters/CharacterLibrary.js';
import { createTwoFloorTravelScene } from '../../../src/campaigns/examples/ConnectedTravelExample.js';
import { targetingBoard } from '../../../src/coordinators/TargetingBoard.js';
import { restoreCampaignScene } from '../../../src/campaigns/SceneWorld.js';
import { createCampaignBoard } from '../../helpers/campaignBoard.js';

function fixture() {
  localStorage.clear();
  const library = new CharacterLibrary({ ruleset: '2014', catalog: [], storage: localStorage });
  const characters = ['Pathfinder', 'Lower Window Lookout', 'Upper Window Lookout'].map((name) =>
    library.get(library.create(name))
  );
  return CampaignWorld.fromScene(createTwoFloorTravelScene({ ruleset: '2014', characters }), {
    ruleset: '2014',
    library,
  });
}

test('support below an upper-floor opening comes from the actual lower floor, not an imaginary upper ground plane', () => {
  const world = fixture();
  const support = world.findSupportBelow({ x: 87.5, y: 12, z: 62.5 }, { mapId: 'upper-floor' });
  expect(support.mapId).toBe('ground-floor');
  expect(support.positionFeet).toEqual({ x: 87.5, y: 0, z: 62.5 });
  expect(support.world).toEqual({ x: 6.5, y: 0, z: 8.5 });
});

test('the two-floor proof provides supported reversible door and stair routes with real movement costs', () => {
  const world = fixture();
  const door = world.planConnection('building-door', 'map-main', { x: 10.5, y: 0, z: 10.5 });
  expect(door.targetMapId).toBe('ground-floor');
  expect(door.costFeet).toBe(5);
  const stairs = world.planConnection('main-stairs', 'ground-floor', {
    x: 6.5,
    y: 0,
    z: 8.5,
  });
  expect(stairs.costFeet).toBe(20);
  expect(stairs.targetMapId).toBe('upper-floor');
  expect(stairs.targetWorld).toEqual({ x: 6.5, y: 0, z: 4.5 });
  const down = world.planConnection('main-stairs', 'upper-floor', stairs.targetWorld);
  expect(down.costFeet).toBe(20);
  expect(down.targetMapId).toBe('ground-floor');
  expect(down.targetWorld).toEqual({ x: 6.5, y: 0, z: 8.5 });
});

test('upper-window sight works both ways while floors and the physical roof still obstruct it', () => {
  const world = fixture();
  const outside = { x: 22.5, y: 0, z: 32.5 };
  const upper = { x: 62.5, y: 10, z: 32.5 };
  expect(world.hasLineOfSight(outside, upper)).toBe(true);
  expect(world.hasLineOfSight(upper, outside)).toBe(true);
  expect(world.hasLineOfSight({ ...upper, y: 0 }, upper)).toBe(false);
  expect(world.hasLineOfSight(upper, { ...upper, y: 22 })).toBe(false);
  expect(world.hasLineOfSight({ x: 87.5, y: 0, z: 62.5 }, { x: 87.5, y: 10, z: 42.5 })).toBe(true);
});

test('targeting and projected visibility agree on an upstairs creature visible through its window', async () => {
  const world = fixture();
  const library = new CharacterLibrary({ ruleset: '2014', catalog: [], storage: localStorage });
  const gm = createCampaignBoard(library);
  try {
    await restoreCampaignScene(gm, world.save(), library, gm.characterServices.combat);
    const outside = gm.placedTokens[0];
    outside.world = { x: 4.5, y: 0, z: 6.5 };
    outside.gridX = 4;
    outside.gridY = 6;
    const board = targetingBoard(gm);
    expect(board.clearPath(board.tokens[0], board.tokens[2])).toBe(true);
    expect(board.clearPath(board.tokens[1], board.tokens[2])).toBe(false);
  } finally {
    for (const token of [...gm.placedTokens]) gm.tokenManager.removeToken(token);
    gm.token3DAdapter.disposeMovementRange();
  }
});
