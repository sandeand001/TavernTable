export const PLAYER_DICE_MODEL_PATH = 'assets/Items/player-dice-set/player-dice-set.glb';
export const PLAYER_DICE_TEXTURE_BASE = 'assets/Items/player-dice-set/textures';
export const PLAYER_DICE_STORAGE_KEY = 'taverntable:player-dice-color';
export const PLAYER_DICE_DEFAULT_COLOR = 'ocean';
export const PLAYER_DICE_SIDES = Object.freeze([4, 6, 8, 10, 12, 20]);

export const PLAYER_DICE_COLORS = Object.freeze([
  { id: 'ocean', label: 'Ocean', variant: 1, swatch: '#138a9e' },
  { id: 'amber', label: 'Amber', variant: 2, swatch: '#f08a18' },
  { id: 'emerald', label: 'Emerald', variant: 3, swatch: '#15936c' },
  { id: 'crimson', label: 'Crimson', variant: 4, swatch: '#a8203a' },
  { id: 'amethyst', label: 'Amethyst', variant: 5, swatch: '#8c62b8' },
  { id: 'obsidian', label: 'Obsidian', variant: 6, swatch: '#393842' },
  { id: 'cobalt', label: 'Cobalt', variant: 7, swatch: '#29438f' },
]);

export const PLAYER_DICE_DEFINITIONS = Object.freeze({
  4: {
    sides: 4,
    meshName: 'd4',
    faceValues: Object.freeze([2, 4, 3, 1]),
    resultFaceDirection: 'down',
  },
  6: {
    sides: 6,
    meshName: 'd6',
    faceValues: Object.freeze([4, 1, 3, 6, 5, 2]),
    resultFaceDirection: 'up',
  },
  8: {
    sides: 8,
    meshName: 'd8',
    faceValues: Object.freeze([7, 1, 4, 6, 5, 3, 2, 8]),
    resultFaceDirection: 'up',
  },
  10: {
    sides: 10,
    meshName: 'd10',
    faceValues: Object.freeze([9, 5, 3, 7, 1, 8, 2, 6, 4, 10]),
    resultFaceDirection: 'up',
  },
  12: {
    sides: 12,
    meshName: 'd12',
    faceValues: Object.freeze([8, 2, 1, 4, 10, 3, 12, 6, 7, 9, 11, 5]),
    resultFaceDirection: 'up',
  },
  20: {
    sides: 20,
    meshName: 'd20',
    faceValues: Object.freeze([
      14, 11, 16, 19, 2, 5, 10, 7, 4, 8, 3, 17, 6, 9, 12, 15, 20, 18, 13, 1,
    ]),
    resultFaceDirection: 'up',
  },
});

export function getPlayerDiceDefinition(sides) {
  const definition = PLAYER_DICE_DEFINITIONS[Number(sides)];
  if (!definition) throw new Error(`Unsupported player dice type: d${sides}`);
  return definition;
}

export function getPlayerDiceColor(id) {
  return PLAYER_DICE_COLORS.find((entry) => entry.id === id) || null;
}

export function readPlayerDiceColor() {
  if (typeof window === 'undefined') return PLAYER_DICE_DEFAULT_COLOR;
  try {
    const value = window.localStorage.getItem(PLAYER_DICE_STORAGE_KEY);
    return getPlayerDiceColor(value)?.id || PLAYER_DICE_DEFAULT_COLOR;
  } catch (_) {
    return PLAYER_DICE_DEFAULT_COLOR;
  }
}

export function persistPlayerDiceColor(id) {
  if (!getPlayerDiceColor(id)) throw new Error('Choose a supported dice color');
  if (typeof window === 'undefined') return id;
  try {
    window.localStorage.setItem(PLAYER_DICE_STORAGE_KEY, id);
  } catch (_) {
    // Browser privacy settings may make presentation-only persistence unavailable.
  }
  return id;
}
