import { readFileSync } from 'node:fs';
import path from 'node:path';
import { webcrypto } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify, TextDecoder } from 'node:util';
import * as three from 'three';
import AuthoritativeDiceReplay from '../../../src/systems/dice/AuthoritativeDiceReplay.js';
import { resolvePlayerDiceFace } from '../../../src/systems/dice/DiceState.js';
import { getPlayerDiceDefinition } from '../../../src/config/PlayerDiceCatalog.js';
import PublicPlayerLocation from '../../../src/ui/sessions/PublicPlayerLocation.js';

const root = path.resolve(__dirname, '..', '..', '..');

function gameBoard() {
  const map = {
    id: 'map-main',
    name: 'Dice board',
    locationId: 'dice-site',
    originFeet: { x: 0, y: 0, z: 0 },
    quarterTurns: 0,
    base: 'ground',
    grid: { cols: 25, rows: 25, tileSize: 1, tileWorldSize: 1 },
    terrain: {
      heights: Array.from({ length: 25 }, () => Array(25).fill(0)),
      worldElevationUnit: 1,
      placeables: [],
    },
  };
  const callbacks = new Set();
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
      addAnimationCallback: (callback) => callbacks.add(callback),
      removeAnimationCallback: (callback) => callbacks.delete(callback),
    },
  };
}

test('the player-selected physical die replays its host trajectory in the selected color', async () => {
  const previousFetch = globalThis.fetch;
  const previousCrypto = globalThis.crypto;
  const previousDecoder = globalThis.TextDecoder;
  globalThis.TextDecoder = TextDecoder;
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  const bytes = readFileSync(
    path.join(root, 'assets', 'Items', 'player-dice-set', 'player-dice-set.glb')
  );
  globalThis.fetch = async () => ({
    ok: true,
    arrayBuffer: async () => new Uint8Array(bytes).buffer,
  });
  const textures = jest
    .spyOn(three.TextureLoader.prototype, 'load')
    .mockImplementation((_url, onLoad) => {
      const texture = new three.Texture();
      queueMicrotask(() => onLoad(texture));
      return texture;
    });
  const program = `
    const {PhysicalDice}=require(process.argv[1]);
    let seed=71;
    const dice=new PhysicalDice({root:process.argv[2],random:()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}});
    dice.roll(
      {expression:'1d8',label:'Player: 1d8',mode:'normal',diceColor:'crimson'},
      {metrics:{cols:25,rows:25,tileSize:1},groundHeights:Array.from({length:25},()=>Array(25).fill(0))}
    ).then(result=>process.stdout.write(JSON.stringify(result))).catch(error=>{console.error(error);process.exitCode=1;});
  `;
  const { stdout } = await promisify(execFile)(
    process.execPath,
    ['-e', program, path.join(root, 'tools', 'physical-dice.js'), root],
    { cwd: root, timeout: 20000, maxBuffer: 2000000 }
  );
  const roll = JSON.parse(stdout);
  roll.mapId = 'map-main';
  const gameManager = gameBoard();
  const replay = new AuthoritativeDiceReplay({ gameManager });
  try {
    const descriptor = roll.physics[0];
    await replay.preload(descriptor.geometryKey, 'physical-die');
    const completed = replay.play(roll, { commandId: 'player-colored-die' });
    for (let index = 0; index < 20 && !gameManager.threeSceneManager.scene.children[0]; index += 1)
      await Promise.resolve();
    const mesh = gameManager.threeSceneManager.scene.children[0]?.children[0];
    expect(mesh).toBeTruthy();
    expect(mesh.userData.diceColor).toBe('crimson');
    replay.advance(descriptor.frames.at(-1).timeSeconds);
    expect(await completed).toMatchObject({ completed: true });
    expect(resolvePlayerDiceFace(mesh, getPlayerDiceDefinition(8), three)?.value).toBe(
      descriptor.value
    );
  } finally {
    replay.destroy();
    textures.mockRestore();
    globalThis.fetch = previousFetch;
    globalThis.TextDecoder = previousDecoder;
    Object.defineProperty(globalThis, 'crypto', {
      value: previousCrypto,
      configurable: true,
    });
  }
});
