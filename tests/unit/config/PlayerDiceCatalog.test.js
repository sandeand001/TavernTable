import fs from 'node:fs';
import path from 'node:path';
import {
  PLAYER_DICE_COLORS,
  PLAYER_DICE_DEFAULT_COLOR,
  PLAYER_DICE_MODEL_PATH,
  PLAYER_DICE_STORAGE_KEY,
  getPlayerDiceColor,
  persistPlayerDiceColor,
  readPlayerDiceColor,
} from '../../../src/config/PlayerDiceCatalog.js';

test('the dice source manifest identifies the active runtime model', () => {
  const manifest = JSON.parse(
    fs.readFileSync(
      path.resolve('assets', 'Items', 'source-packs', 'SOURCE-PACK-MANIFEST.json'),
      'utf8'
    )
  );
  const pack = manifest.packs.find(({ id }) => id === 'player-dice-set-ghosted');
  expect(manifest.runtimeIntegrated).toBe(true);
  expect(pack.status).toBe('runtime-integrated');
  expect(pack.runtime.model).toBe(PLAYER_DICE_MODEL_PATH);
  expect(fs.existsSync(path.resolve(pack.runtime.model))).toBe(true);
});

describe('player dice colors', () => {
  afterEach(() => localStorage.clear());

  test('offers all seven authored color variants', () => {
    expect(PLAYER_DICE_COLORS.map(({ id }) => id)).toEqual([
      'ocean',
      'amber',
      'emerald',
      'crimson',
      'amethyst',
      'obsidian',
      'cobalt',
    ]);
  });

  test('persists a supported presentation-only selection', () => {
    expect(persistPlayerDiceColor('crimson')).toBe('crimson');
    expect(localStorage.getItem(PLAYER_DICE_STORAGE_KEY)).toBe('crimson');
    expect(readPlayerDiceColor()).toBe('crimson');
  });

  test('falls back safely for stale values', () => {
    localStorage.setItem(PLAYER_DICE_STORAGE_KEY, 'removed-color');

    expect(readPlayerDiceColor()).toBe(PLAYER_DICE_DEFAULT_COLOR);
    expect(getPlayerDiceColor('removed-color')).toBeNull();
  });
});
