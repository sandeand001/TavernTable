import { PlayerCampaigns } from '../../../tools/player-campaigns.js';
import { gameplayRuntime } from '../../../src/campaigns/ServerGameplay.js';
import { CharacterLibrary } from '../../../src/entities/characters/CharacterLibrary.js';
import { sceneState } from '../../helpers/sceneState.js';

const profile = (id = 'session-a') => ({
  id,
  campaignId: 'campaign',
  characterIds: ['hero'],
});
const state = (sceneRevision, revision = 0) => ({
  campaign: { id: 'campaign' },
  sceneRevision,
  revision,
});
const receipts = () => new Map([['actor-a', [{ characterId: 'hero', sequence: 1 }]]]);

function remember(
  players,
  owner,
  previous,
  current,
  tokens = receipts(),
  tokenId = 'actor-a',
  reset = false
) {
  players.rememberUndo(owner, { previous, current, tokens, tokenId, reset });
}

test('server undo receipts are session-owned, assignment-filtered and pinned to both committed revisions', () => {
  const players = new PlayerCampaigns({ root: __dirname });
  const owner = profile();
  remember(players, owner, state(0), state(1, 1));
  expect(players.undoFor(owner, state(1, 1))).toEqual(receipts());
  expect(players.undoFor(profile('new-login'), state(1, 1)).size).toBe(0);
  expect(players.undoFor({ ...owner, characterIds: [] }, state(1, 1)).size).toBe(0);
  expect(players.undoFor(owner, state(2, 1)).size).toBe(0);
  expect(players.undoFor(owner, state(1, 2)).size).toBe(0);
});

test('another actor may commit without erasing undo, while a different session changing the same actor invalidates it', () => {
  const players = new PlayerCampaigns({ root: __dirname });
  const owner = profile();
  remember(players, owner, state(0), state(1));
  remember(players, profile('session-b'), state(1), state(2), new Map(), 'actor-b');
  expect(players.undoFor(owner, state(2))).toEqual(receipts());
  remember(players, profile('session-b'), state(2), state(3), new Map(), 'actor-a');
  expect(players.undoFor(owner, state(3)).size).toBe(0);
});

test('turn changes clear transient receipts and late publication cannot overwrite a newer committed cache', () => {
  const players = new PlayerCampaigns({ root: __dirname });
  const owner = profile();
  remember(players, owner, state(0), state(1));
  remember(players, owner, state(1), state(2));
  remember(players, owner, state(0), state(1), new Map());
  expect(players.undoFor(owner, state(2))).toEqual(receipts());
  remember(players, owner, state(2), state(3), receipts(), 'actor-a', true);
  expect(players.undoFor(owner, state(3)).size).toBe(0);
});

test('transient undo storage is bounded across authenticated sessions and actors', () => {
  const players = new PlayerCampaigns({ root: __dirname });
  for (let index = 0; index < 257; index++)
    remember(
      players,
      profile(`session-${index}`),
      state(index),
      state(index + 1),
      receipts(),
      `actor-${index}`
    );
  expect(players.undoSessions.size).toBeLessThanOrEqual(256);
  const tokens = new Map(
    Array.from({ length: 65 }, (_, index) => [
      `actor-${index}`,
      [{ characterId: 'hero', sequence: index + 1 }],
    ])
  );
  remember(players, profile('many-actors'), state(257), state(258), tokens);
  expect(players.undoFor(profile('many-actors'), state(258)).size).toBe(64);
});

test('a receipt evicted from bounded canonical history expires instead of preventing the player state from loading', () => {
  const library = new CharacterLibrary({ ruleset: '2014', catalog: [], storage: localStorage });
  const characterId = library.create('Hero');
  const scene = sceneState({ characterId, name: 'Hero' });
  const undo = new Map([[scene.creatures[0].id, [{ characterId, sequence: 99 }]]]);
  const runtime = gameplayRuntime(scene, library, undo);
  expect(runtime.combat.status(runtime.actors[0]).canUndo).toBe(false);
});
