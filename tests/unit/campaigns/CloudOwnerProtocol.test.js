/** @jest-environment node */
import {
  cloudOwnerDelta,
  applyCloudOwnerDelta,
} from '../../../src/campaigns/CloudOwnerProtocol.js';
import { sceneActorPlacement } from '../../../src/scene/token-adapter/SavedPlacements.js';
import { sceneState } from '../../helpers/sceneState.js';

const campaignId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const commandId = '33333333-3333-4333-8333-333333333333';
const characterId = '44444444-4444-4444-8444-444444444444';
const access = {
  version: 1,
  uid: 'owner-a',
  campaignId,
  role: 'owner',
  seatId: null,
  accessGeneration: 0,
};

function fixture() {
  const scene = sceneState({ characterId, name: 'Owner actor' });
  const image = 'data:image/png;base64,' + 'A'.repeat(1024 * 1024);
  const campaign = {
    version: 1,
    id: campaignId,
    name: 'Private owner world',
    ruleset: '2014',
    coreVersion: '5.1',
    sourcePacks: [],
    createdAt: '2026-11-14T00:00:00.000Z',
    charactersRevision: 1,
    sceneRevision: 1,
    sceneSavedAt: '2026-11-14T00:00:01.000Z',
  };
  const previous = {
    version: 1,
    access,
    sessionId,
    generation: 1,
    origin: null,
    state: {
      campaign,
      revision: 1,
      records: [
        {
          key: `taverntable.character.v1.${characterId}`,
          value: JSON.stringify({ id: characterId, name: 'Owner actor', portraitImage: image }),
        },
      ],
      scene: JSON.stringify(scene),
      sceneRevision: 1,
      sceneSavedAt: campaign.sceneSavedAt,
    },
  };
  const next = structuredClone(previous);
  next.generation = 2;
  next.origin = { uid: 'member-a', commandId, kind: 'world.command', generation: 2 };
  next.state.sceneRevision = 2;
  next.state.campaign.sceneRevision = 2;
  next.state.sceneSavedAt = '2026-11-14T00:00:02.000Z';
  next.state.campaign.sceneSavedAt = next.state.sceneSavedAt;
  const moved = structuredClone(scene);
  moved.creatures[0].gridX = 2;
  moved.creatures[0].pose.world.x = 2.5;
  next.state.scene = JSON.stringify(moved);
  const character = JSON.parse(next.state.records[0].value);
  character.notes = 'Changed without retransmitting the portrait';
  next.state.records[0].value = JSON.stringify(character);
  const presentation = {
    commandId,
    tokenId: 'token-1',
    kind: 'move',
    sceneRevision: 2,
    charactersRevision: 1,
    costFeet: 5,
    motion: {
      kind: 'walk',
      completed: true,
      from: sceneActorPlacement(scene, scene.creatures[0]),
      route: [sceneActorPlacement(moved, moved.creatures[0])],
    },
  };
  return { previous, next, presentation };
}

test('one owner actor and note change transfer under 2 KiB rather than retransmitting a valid unchanged MiB portrait or terrain', () => {
  const { previous, next, presentation } = fixture();
  const delta = cloudOwnerDelta(previous, next, [presentation]);
  const text = JSON.stringify(delta);
  expect(Buffer.byteLength(JSON.stringify(next))).toBeGreaterThan(1024 * 1024);
  expect(Buffer.byteLength(text)).toBeLessThan(2048);
  expect(text).not.toContain('portraitImage');
  expect(text).not.toContain('heights');
  expect(applyCloudOwnerDelta(previous, delta)).toEqual(next);
});

test.each([
  [
    'campaign-access-changed',
    (delta) => {
      delta.access.uid = 'other-owner';
    },
  ],
  [
    'live-session-changed',
    (delta) => {
      delta.sessionId = commandId;
    },
  ],
  [
    'owner-delta-gap',
    (delta) => {
      delta.baseGeneration = 0;
    },
  ],
])('an owner patch rejects %s without altering its previous world', (code, mutate) => {
  const { previous, next } = fixture();
  const original = structuredClone(previous);
  const delta = cloudOwnerDelta(previous, next);
  mutate(delta);
  expect(() => applyCloudOwnerDelta(previous, delta)).toThrow(expect.objectContaining({ code }));
  expect(previous).toEqual(original);
});

test('owner motion cannot carry a negative cost even though the authorized owner can see every actor budget', () => {
  const { previous, next, presentation } = fixture();
  expect(() => cloudOwnerDelta(previous, next, [{ ...presentation, costFeet: -1 }])).toThrow(
    expect.objectContaining({ code: 'invalid-cloud-owner-state' })
  );
});
