/** @jest-environment node */
import { randomUUID } from 'node:crypto';
import { CLOUD_FREE_ROAM_MOVE_LIMIT } from '../../../src/campaigns/CloudProtocol.js';
import {
  appendFreeRoamMove,
  freeRoamMovesSince,
  materializeFreeRoamScene,
} from '../../../tools/cloud/free-roam-moves.js';

const position = (gridX) => ({
  mapId: 'main',
  gridX,
  gridY: 0,
  facingAngle: 0,
  pose: { kind: 'ground', world: { x: gridX + 0.5, y: 0, z: 0.5 } },
});

test('folding a long series of moves into a checkpoint preserves both durable poses and recent playback', () => {
  const sessionId = randomUUID();
  const scene = {
    version: 3,
    creatures: [
      { id: 'mover', ...position(0) },
      { id: 'bystander', ...position(3) },
    ],
    combat: { active: false, states: [], effects: [] },
  };
  let base = JSON.stringify(scene);
  let head = {
    version: 1,
    generation: 1,
    campaign: { sceneRevision: 1, charactersRevision: 0 },
    sceneRef: {},
  };
  let checkpointReplaced = false;
  for (let count = 0; count <= CLOUD_FREE_ROAM_MOVE_LIMIT; count++) {
    const saved = materializeFreeRoamScene(head, base);
    const before = JSON.parse(saved);
    const from = position(count % 2);
    const destination = position((count + 1) % 2);
    Object.assign(before.creatures[0], destination);
    const sceneRevision = head.campaign.sceneRevision + 1;
    const next = { scene: JSON.stringify(before), sceneRevision, revision: 0 };
    const commandId = randomUUID();
    const prepared = appendFreeRoamMove(
      head,
      { scene: saved, sceneRevision: sceneRevision - 1, revision: 0 },
      next,
      { kind: 'move', payload: { target: { gridX: destination.gridX, gridY: 0, mapId: 'main' } } },
      {
        generation: head.generation + 1,
        sessionId,
        sceneRevision,
        charactersRevision: 0,
        entries: [
          {
            tokenId: 'mover',
            commandId,
            kind: 'move',
            motion: { kind: 'walk', completed: true, from, route: [destination] },
          },
        ],
      }
    );
    if (prepared.checkpointScene !== null) {
      base = prepared.checkpointScene;
      checkpointReplaced = true;
    }
    head = {
      ...head,
      version: 2,
      generation: head.generation + 1,
      campaign: { ...head.campaign, sceneRevision },
      freeRoamMoves: prepared.moves,
      sceneCheckpointRevision: prepared.checkpointRevision,
    };
    expect(JSON.parse(materializeFreeRoamScene(head, base))).toEqual(before);
  }
  expect(checkpointReplaced).toBe(true);
  const pendingViewer = {
    generation: head.generation - 3,
    state: { sceneRevision: head.campaign.sceneRevision - 3, revision: 0 },
  };
  expect(
    freeRoamMovesSince(head, pendingViewer, sessionId).map(({ entry }) => [
      entry.motion.from.gridX,
      entry.motion.route.at(-1).gridX,
    ])
  ).toEqual([
    [0, 1],
    [1, 0],
    [0, 1],
  ]);
  expect(freeRoamMovesSince(head, pendingViewer, randomUUID())).toEqual([]);
});
