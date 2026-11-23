import PlayerCommandAdapter from '../../../src/ui/sessions/PlayerCommandAdapter.js';
import { validatePlayerCommandAcknowledgement } from '../../../src/campaigns/PlayerPublicProtocol.js';
import { publicPlayerState } from '../../helpers/publicPlayerState.js';

function fixture() {
  const sent = [];
  const { state } = publicPlayerState();
  state.revision = 8;
  state.sceneRevision = 12;
  state.observerTokenId = 'real-scout';
  Object.assign(state.publicScene.presentation, { mapId: 'ground', focusTokenId: 'real-scout' });
  Object.assign(state.publicScene.actors[0], { id: 'real-scout', mapId: 'ground' });
  state.publicScene.assets.maps[0].id = 'ground';
  Object.assign(state.gameplay.ownedTokens[0], {
    tokenId: 'real-scout',
    mapId: 'ground',
    movement: { spentFeet: 5, remainingFeet: 25, allowanceFeet: 30 },
  });
  state.gameplay.turn.tokenId = 'real-scout';
  const accepted = JSON.parse(JSON.stringify(state));
  accepted.sceneRevision = 13;
  accepted.publicScene.assets = null;
  Object.assign(accepted.publicScene.actors[0], {
    gridX: 2,
    gridY: 3,
    pose: { kind: 'ground', world: { x: 2.5, y: 0, z: 3.5 } },
  });
  const response = {
    version: 1,
    commandId: '00000000-0000-4000-8000-000000000001',
    outcome: 'applied',
    applied: { sceneRevision: 13, charactersRevision: 8 },
    receipt: {
      kind: 'move',
      tokenId: 'real-scout',
      costFeet: 5,
      budget: { movementSpentFeet: 10, movementRemainingFeet: 20, movementAllowanceFeet: 30 },
      route: [
        {
          mapId: 'ground',
          gridX: 2,
          gridY: 3,
          facingAngle: 0,
          pose: { kind: 'ground', world: { x: 2.5, y: 0, z: 3.5 } },
        },
      ],
    },
    state: accepted,
  };
  response.receipt.placement = response.receipt.route[0];
  response.receipt.motion = {
    kind: 'walk',
    completed: true,
    from: {
      mapId: 'ground',
      gridX: 1,
      gridY: 1,
      facingAngle: 0,
      pose: { kind: 'ground', world: { x: 1.5, y: 0, z: 1.5 } },
    },
    route: response.receipt.route,
  };
  const adapter = new PlayerCommandAdapter({
    connection: {
      call: async (...args) => {
        sent.push(args);
        return response;
      },
    },
    getState: () => state,
    createCommandId: () => response.commandId,
  });
  return { adapter, sent, state, response };
}

test('a move submits only the active owned token intent and acknowledged revisions, never a client pose or paid cost', async () => {
  const { adapter, sent, state, response } = fixture();
  await adapter.move('real-scout', { mapId: 'ground', gridX: 2, gridY: 3 });
  expect(sent).toEqual([
    [
      'playerCommand',
      [
        'campaign',
        {
          version: 1,
          commandId: response.commandId,
          sceneRevision: 12,
          charactersRevision: 8,
          observerTokenId: 'real-scout',
          tokenId: 'real-scout',
          kind: 'move',
          payload: { target: { mapId: 'ground', gridX: 2, gridY: 3 } },
          view: { mapId: 'ground', assetKey: 'assets' },
        },
      ],
    ],
  ]);
  expect(state.sceneRevision).toBe(12);
  expect(state.gameplay.ownedTokens[0].movement.remainingFeet).toBe(25);
});

test.each(['move', 'flight.drop'])(
  'a %s acknowledgement with a fall roll waits for the full authoritative receipt',
  (kind) => {
    const { adapter, response, state } = fixture();
    state.profile.id = 'player-session';
    const accept = jest.fn();
    adapter.pending = true;
    adapter.lastRequest = {
      campaignId: 'campaign',
      command: { commandId: response.commandId, tokenId: 'real-scout', kind },
      acceptLive: accept,
    };
    const acknowledgement = {
      version: 1,
      campaignId: 'campaign',
      actorId: state.profile.id,
      commandId: response.commandId,
      outcome: 'applied',
      applied: response.applied,
      receipt: {
        ...response.receipt,
        kind,
        roll: { expression: '1d6' },
      },
    };
    expect(() =>
      validatePlayerCommandAcknowledgement(acknowledgement, {
        cachedAssets: state.publicScene.assets,
      })
    ).not.toThrow();
    expect(adapter.acceptLive(acknowledgement)).toBe(false);
    expect(accept).not.toHaveBeenCalled();
  }
);

test('a fall into an uncached map waits for the scoped full receipt', () => {
  const { adapter, response, state } = fixture();
  state.profile.id = 'player-session';
  const accept = jest.fn();
  adapter.pending = true;
  adapter.lastRequest = {
    campaignId: 'campaign',
    command: { commandId: response.commandId, tokenId: 'real-scout', kind: 'flight.drop' },
    acceptLive: accept,
  };
  const route = [{ ...response.receipt.route[0], mapId: 'hidden-landing' }];
  const acknowledgement = {
    version: 1,
    campaignId: 'campaign',
    actorId: state.profile.id,
    commandId: response.commandId,
    outcome: 'applied',
    applied: response.applied,
    receipt: {
      ...response.receipt,
      kind: 'flight.drop',
      route,
      placement: route[0],
      motion: { ...response.receipt.motion, kind: 'fall', route },
      roll: { expression: '1d6' },
    },
  };
  expect(adapter.acceptLive(acknowledgement)).toBe(false);
  expect(adapter.lastRequest.awaitingFullReceipt).toBe(true);
  expect(accept).not.toHaveBeenCalled();
});

test('scene mutations share the pending checkpoint lock and cannot bypass an uncertain gameplay command', async () => {
  const { adapter, sent } = fixture();
  let finish;
  const operation = jest.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const pending = adapter.mutateScene(operation);
  expect(adapter.pending).toBe(true);
  await expect(
    adapter.move('real-scout', {
      mapId: 'ground',
      gridX: 2,
      gridY: 3,
    })
  ).rejects.toThrow('current host command');
  finish('committed');
  expect(await pending).toBe('committed');
  await adapter.idle;
  expect(adapter.pending).toBe(false);
  adapter.lastRequest = { command: {} };
  adapter.failure = new TypeError('Lost acknowledgement');
  await expect(adapter.mutateScene(operation)).rejects.toThrow(/uncertain/i);
  expect(operation).toHaveBeenCalledTimes(1);
  expect(sent).toEqual([]);
});

test('rapid native intents queue behind the current authority acknowledgement without being rejected', async () => {
  const { adapter, state, response } = fixture();
  const sent = [];
  let release;
  adapter.connection.call = async (operation, args) => {
    sent.push(JSON.parse(JSON.stringify([operation, args])));
    if (sent.length === 1)
      await new Promise((resolve) => {
        release = resolve;
      });
    return JSON.parse(JSON.stringify(response));
  };
  const first = adapter.move('real-scout', { mapId: 'ground', gridX: 2, gridY: 3 });
  const target = { mapId: 'ground', gridX: 3, gridY: 3 };
  const second = adapter.move('real-scout', target);
  expect(sent).toHaveLength(1);
  target.gridX = 9;
  release();
  await first;
  await second;
  expect(sent).toHaveLength(2);
  expect(sent[1][1][1].payload.target.gridX).toBe(3);
  expect(state.sceneRevision).toBe(12);
});

test.each(['unowned', 'other-observer', 'unsupported', 'unavailable'])(
  '%s controls cannot submit gameplay or silently change the observer',
  async (reason) => {
    const { adapter, sent, state } = fixture();
    let tokenId = 'real-scout';
    if (reason === 'unowned') tokenId = 'foreign-guard';
    if (reason === 'other-observer') state.observerTokenId = 'other-owned-token';
    if (reason === 'unsupported') state.gameplay.commands = [];
    if (reason === 'unavailable')
      state.gameplay.ownedTokens[0].availability.move = { allowed: false, code: 'not-your-turn' };
    await expect(adapter.move(tokenId, { mapId: 'ground', gridX: 2, gridY: 3 })).rejects.toThrow();
    expect(sent).toEqual([]);
    expect(state.observerTokenId).toBe(
      reason === 'other-observer' ? 'other-owned-token' : 'real-scout'
    );
  }
);

test('a lost response retries the exact intent ID and never animates a durable duplicate again', async () => {
  const { state, response } = fixture();
  const sent = [];
  const received = [];
  let calls = 0;
  const adapter = new PlayerCommandAdapter({
    connection: {
      call: async (...args) => {
        sent.push(JSON.parse(JSON.stringify(args)));
        if (++calls === 1) throw new TypeError('Network connection lost after submission');
        return { ...response, outcome: 'duplicate' };
      },
    },
    getState: () => state,
    createCommandId: () => response.commandId,
    onReceipt: (receipt, options) => received.push({ receipt, options }),
  });
  const target = { mapId: 'ground', gridX: 2, gridY: 3 };
  await expect(adapter.move('real-scout', target)).rejects.toThrow('Network connection lost');
  target.gridX = 99;
  expect(adapter.pending).toBe(false);
  expect(adapter.canRetry).toBe(true);
  await adapter.retry();
  expect(sent[1]).toEqual(sent[0]);
  expect(received).toHaveLength(1);
  expect(received[0].options.animate).toBe(false);
  expect(adapter.canRetry).toBe(false);
  expect(state.gameplay.ownedTokens[0].movement.remainingFeet).toBe(25);
});

test('an uncertain submitted command cannot be replaced with a fresh intent before same-ID retry or reconnect', async () => {
  const { state } = fixture();
  const sent = [];
  const adapter = new PlayerCommandAdapter({
    connection: {
      call: async (...args) => {
        sent.push(args);
        throw new TypeError('Response lost after submission');
      },
    },
    getState: () => state,
  });
  await expect(adapter.move('real-scout', { mapId: 'ground', gridX: 2, gridY: 3 })).rejects.toThrow(
    'lost'
  );
  const commandId = sent[0][1][1].commandId;
  await expect(adapter.move('real-scout', { mapId: 'ground', gridX: 3, gridY: 3 })).rejects.toThrow(
    /uncertain|retry|reconnect/i
  );
  expect(sent).toHaveLength(1);
  expect(adapter.lastRequest.command.commandId).toBe(commandId);
  expect(adapter.canRetry).toBe(true);
  expect(adapter.availability('move', 'real-scout').allowed).toBe(false);
});
