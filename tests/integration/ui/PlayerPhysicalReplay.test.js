import { readFileSync } from 'node:fs';
import path from 'node:path';
import { webcrypto } from 'node:crypto';
import { TextDecoder } from 'node:util';
import * as three from 'three';
import AuthoritativeDiceReplay from '../../../src/systems/dice/AuthoritativeDiceReplay.js';
import { resolveUpFacingFace } from '../../../src/systems/dice/DiceState.js';
import PublicPlayerLocation from '../../../src/ui/sessions/PublicPlayerLocation.js';
import { authorityRoot } from '../../helpers/playerAuthority.js';

const root = path.resolve(__dirname, '..', '..', '..');
const fixture = JSON.parse(
  readFileSync(
    path.join(authorityRoot, 'tests', 'fixtures', 'player-physical-roll-v1.json'),
    'utf8'
  )
);

function gameBoard() {
  const map = {
    id: fixture.board.mapId,
    name: 'Dice board',
    locationId: 'dice-site',
    originFeet: { x: 0, y: 0, z: 0 },
    quarterTurns: 0,
    base: 'ground',
    grid: fixture.board,
    terrain: {
      heights: Array.from({ length: fixture.board.rows }, () => Array(fixture.board.cols).fill(0)),
      worldElevationUnit: 0.3,
      placeables: [],
    },
  };
  const frames = new Set();
  return {
    campaignMapId: map.id,
    campaignWorld: new PublicPlayerLocation({
      location: { id: 'dice-site', name: 'Dice site' },
      maps: [map],
      connections: [],
    }),
    threeSceneManager: {
      three,
      scene: new three.Scene(),
      addAnimationCallback: (frame) => frames.add(frame),
      removeAnimationCallback: (frame) => frames.delete(frame),
    },
  };
}

test('the original gold GLB replays the genuine saved 120Hz host trajectory and settles on the SAME physical face', async () => {
  const decoder = globalThis.TextDecoder;
  globalThis.TextDecoder = TextDecoder;
  const createObjectURL = URL.createObjectURL;
  const revokeObjectURL = URL.revokeObjectURL;
  URL.createObjectURL = () => 'blob:physical-d20-texture';
  URL.revokeObjectURL = () => {};
  const textures = jest
    .spyOn(three.TextureLoader.prototype, 'load')
    .mockImplementation((_url, onLoad) => {
      const texture = new three.Texture();
      queueMicrotask(() => onLoad(texture));
      return texture;
    });
  const fetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const bytes = readFileSync(path.join(root, 'assets', 'Items', 'd20-gold.glb'));
    const buffer = new ArrayBuffer(bytes.length);
    new Uint8Array(buffer).set(bytes);
    return {
      ok: true,
      arrayBuffer: async () => buffer,
    };
  };
  const crypto = globalThis.crypto;
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  const gameManager = gameBoard();
  const replay = new AuthoritativeDiceReplay({ gameManager });
  try {
    const roll = fixture.roll;
    await replay.preload(roll.physics[0].geometryKey);
    const completed = replay.play(roll, { commandId: 'real-physical-fixture-1' });
    await Promise.resolve();
    await Promise.resolve();
    const mesh = gameManager.threeSceneManager.scene.children[0].children[0];
    let hasGeometry = false;
    mesh.traverse((node) => {
      if (node.isMesh && node.geometry.attributes.position.count > 0) hasGeometry = true;
    });
    expect(hasGeometry).toBe(true);
    const frames = roll.physics[0].frames;
    expect(frames).toHaveLength(501);
    expect(mesh.position.toArray()).toEqual(Object.values(frames[0].position));
    replay.advance(frames[150].timeSeconds);
    expect(mesh.position.toArray()).toEqual(Object.values(frames[150].position));
    expect(mesh.quaternion.toArray()).toEqual(Object.values(frames[150].quaternion));
    replay.advance(frames.at(-1).timeSeconds - frames[150].timeSeconds);
    expect(await completed).toMatchObject({ completed: true });
    expect(mesh.position.toArray()).toEqual(Object.values(frames.at(-1).position));
    expect(mesh.quaternion.toArray()).toEqual(Object.values(frames.at(-1).quaternion));
    expect(resolveUpFacingFace(mesh, three).value).toBe(3);
    expect(roll.total).toBe(8);
    expect(await replay.play(roll, { commandId: 'real-physical-fixture-1' })).toEqual({
      completed: false,
      reason: 'duplicate',
    });
    expect(gameManager.threeSceneManager.scene.children).toHaveLength(1);
  } finally {
    replay.destroy();
    textures.mockRestore();
    if (createObjectURL === undefined) delete URL.createObjectURL;
    else URL.createObjectURL = createObjectURL;
    if (revokeObjectURL === undefined) delete URL.revokeObjectURL;
    else URL.revokeObjectURL = revokeObjectURL;
    if (fetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = fetch;
    Object.defineProperty(globalThis, 'crypto', { value: crypto, configurable: true });
    if (decoder === undefined) delete globalThis.TextDecoder;
    else globalThis.TextDecoder = decoder;
  }
});
