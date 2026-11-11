import { readFileSync } from 'node:fs';
import path from 'node:path';
import PlayerCommandAdapter from '../../../src/ui/sessions/PlayerCommandAdapter.js';
import SessionConnection from '../../../src/campaigns/SessionConnection.js';
import { validatePlayerCommand } from '../../../src/campaigns/PlayerCommandProtocol.js';
import {
  validatePlayerState,
  validatePlayerCommandResult,
} from '../../../src/campaigns/PlayerPublicProtocol.js';

const root = process.env.TAVERNTABLE_AUTHORITY_TREE || path.resolve(__dirname, '..', '..', '..');
const wire = JSON.parse(
  readFileSync(path.join(root, 'tests', 'fixtures', 'player-wire-v1.json'), 'utf8')
);

test('the published native-token command and result pass unchanged through the actual client adapter', async () => {
  const state = JSON.parse(JSON.stringify(wire.observerState));
  const result = JSON.parse(JSON.stringify(wire.completedMoveResult));
  expect(validatePlayerState(state)).toBe(state);
  expect(validatePlayerState(wire.actorlessGrantState)).toBe(wire.actorlessGrantState);
  expect(validatePlayerCommand(wire.completedMoveCommand)).toBe(wire.completedMoveCommand);
  expect(validatePlayerCommandResult(result, { cachedAssets: state.publicScene.assets })).toBe(
    result
  );
  let submitted;
  const received = [];
  const adapter = new PlayerCommandAdapter({
    getState: () => state,
    createCommandId: () => wire.completedMoveCommand.commandId,
    connection: {
      call: async (_operation, [, command]) => {
        submitted = command;
        validatePlayerCommand(command);
        return result;
      },
    },
    onReceipt: (receipt, context) => received.push({ receipt, context }),
  });
  await adapter.move(state.observerTokenId, wire.completedMoveCommand.payload.target);
  expect(submitted).toEqual(wire.completedMoveCommand);
  expect(received[0].receipt).toBe(result);
  expect(received[0].context.animate).toBe(true);
  expect(submitted).not.toHaveProperty('actorTokenId');
});

test.each(Object.entries(wire.denials))(
  'published %s denial is preserved without private state or invented aliases',
  async (_name, { status, body }) => {
    const connection = new SessionConnection({
      identity: { role: 'player', csrf: 'synthetic-test-token' },
      fetch: async () => ({ ok: false, status, json: async () => body }),
    });
    try {
      await connection.call('playerState', [{ presentationVersion: 1 }]);
      throw new Error('Expected the published HTTP denial');
    } catch (error) {
      expect(error.status).toBe(status);
      expect(error.message).toBe(body.error);
      expect(error.code).toBe(body.code);
      expect(error.current).toEqual(body.current);
      expect(error).not.toHaveProperty('state');
      expect(error).not.toHaveProperty('scene');
    } finally {
      connection.close();
    }
  }
);
