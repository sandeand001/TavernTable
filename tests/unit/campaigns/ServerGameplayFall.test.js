import { executePlayerCommand } from '../../../src/campaigns/ServerGameplay.js';
import { CharacterLibrary } from '../../../src/entities/characters/CharacterLibrary.js';
import CombatSession from '../../../src/entities/characters/CombatSession.js';
import { linkTokenCharacter } from '../../../src/entities/creatures/TokenMovement.js';
import CampaignWorld from '../../../src/campaigns/CampaignWorld.js';
import { sceneState } from '../../helpers/sceneState.js';
import revised from '../../../assets/data/resources/srd-2024-5.2.1-seed.1.json';

test('a cocked falling-damage die leaves the creature and Slow Fall reaction unchanged', async () => {
  localStorage.clear();
  const library = new CharacterLibrary({
    ruleset: '2024',
    catalog: revised.entries,
    classes: revised.classes,
    storage: localStorage,
  });

  const characterId = await library.create('Falling monk');
  await library.edit(characterId, {
    classId: 'monk',
    level: 4,
    hp: { max: 40, current: 40 },
    fallTraits: { flySpeed: 60, hover: true },
  });
  const scene = sceneState({ ruleset: '2024', characterId, name: 'Falling monk' });
  scene.terrain.heights = Array.from({ length: 5 }, () => Array(5).fill(0));
  scene.creatures[0].pose = { kind: 'flight', world: { x: 1.5, y: 4, z: 1.5 } };
  const actor = {
    id: 'token-1',
    world: { ...scene.creatures[0].pose.world },
    movementSettings: { mode: 'walk', type: 'default' },
    flightActive: true,
  };
  linkTokenCharacter(actor, library, characterId);
  const combat = new CombatSession({ library, hasToken: (token) => token === actor });
  await combat.startTurn(actor);
  scene.combat = combat.snapshot();
  const originalScene = JSON.parse(JSON.stringify(scene));
  const originalCharacter = JSON.parse(JSON.stringify(library.get(characterId)));
  const dice = {
    roll: jest.fn().mockResolvedValue({
      rerollRequired: true,
      cancelled: true,
      physics: [{ cocked: true }],
    }),
  };
  const result = await executePlayerCommand(
    scene,
    library,
    {
      kind: 'flight.drop',
      tokenId: actor.id,
      commandId: 'fall-command',
      payload: { useSlowFall: true, diceColor: 'amber' },
    },
    { dice }
  );
  expect(result.scene).toEqual(originalScene);
  expect(library.get(characterId)).toEqual(originalCharacter);
  expect(result.receipt).toMatchObject({
    type: 'flight.drop',
    tokenId: actor.id,
    rerollRequired: true,
    roll: { cancelled: true, mapId: 'map-main' },
  });
  expect(dice.roll).toHaveBeenCalledWith(
    expect.objectContaining({ expression: '2d6', diceColor: 'amber' }),
    expect.objectContaining({
      metrics: { cols: 5, rows: 5, tileSize: 1 },
      groundHeights: scene.terrain.heights,
    })
  );
});

test('a cocked fall does not expose a foreign landing map before the creature arrives', async () => {
  localStorage.clear();
  const library = new CharacterLibrary({
    ruleset: '2024',
    catalog: revised.entries,
    classes: revised.classes,
    storage: localStorage,
  });
  const characterId = await library.create('Falling scout');
  await library.edit(characterId, { fallTraits: { flySpeed: 60, hover: true } });
  const initial = sceneState({ ruleset: '2024', characterId, name: 'Falling scout' });
  initial.terrain.heights = Array.from({ length: 5 }, () => Array(5).fill(0));
  initial.creatures[0].pose = { kind: 'flight', world: { x: 1.5, y: 4, z: 1.5 } };
  const world = CampaignWorld.fromScene(initial, { ruleset: '2024', library });
  world.addMap({
    id: 'hidden-landing',
    name: 'Foreign floor',
    originFeet: { x: 0, y: 10, z: 0 },
    quarterTurns: 0,
    base: 'floor',
    grid: initial.grid,
    terrain: { ...initial.terrain, geometry: { version: 1, volumes: [] } },
  });
  const scene = world.save();
  const result = await executePlayerCommand(
    scene,
    library,
    {
      kind: 'flight.drop',
      tokenId: 'token-1',
      commandId: 'fall-command',
      payload: { useSlowFall: false },
    },
    {
      dice: {
        roll: jest.fn().mockResolvedValue({
          rerollRequired: true,
          cancelled: true,
          physics: [{ cocked: true }],
        }),
      },
    }
  );
  expect(result.scene).toEqual(scene);
  expect(result.receipt).toMatchObject({ type: 'flight.drop', rerollRequired: true });
  expect(result.receipt.roll).toBeUndefined();
  expect(JSON.stringify(result.receipt)).not.toContain('hidden-landing');
});
