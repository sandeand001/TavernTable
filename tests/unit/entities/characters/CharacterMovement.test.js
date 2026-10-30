import { CharacterLibrary } from '../../../../src/entities/characters/CharacterLibrary.js';
import {
  buildMovementRange,
  getTokenMovementSettings,
  linkTokenCharacter,
  setTokenMovementSettings,
} from '../../../../src/entities/creatures/TokenMovement.js';

beforeEach(() => localStorage.clear());

test('a linked character is the single speed source for tokens, edits and grid reachability', () => {
  const library = new CharacterLibrary({
    ruleset: '2014',
    storage: globalThis.localStorage,
    catalog: [],
  });
  const id = library.create('Mira');
  const first = { movementSettings: { speed: 50, mode: 'run', type: 'drunk' } };
  const second = {};
  linkTokenCharacter(first, library, id);
  linkTokenCharacter(second, library, id);
  expect(getTokenMovementSettings(first)).toEqual({ speed: 30, mode: 'run', type: 'drunk' });
  expect(first.movementSettings).not.toHaveProperty('speed');

  library.edit(id, { speed: 20 });
  const range = buildMovementRange({
    cols: 20,
    rows: 20,
    startGridX: 8,
    startGridY: 8,
    speed: getTokenMovementSettings(first).speed,
    tileWorldSize: 1,
    elevationUnit: 1,
    getHeight: () => 0,
  });
  expect(range.tiles.has('12,8')).toBe(true);
  expect(range.tiles.has('13,8')).toBe(false);
  setTokenMovementSettings(second, { speed: 40 });
  expect(library.get(id).speed).toBe(40);
  expect(getTokenMovementSettings(first).speed).toBe(40);
  expect(getTokenMovementSettings(second).speed).toBe(40);
});
