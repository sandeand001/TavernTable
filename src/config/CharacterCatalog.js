export const DEFAULT_CHARACTER_ID = 'mannequin';

export const CHARACTER_DEFINITIONS = [
  {
    id: 'mannequin',
    label: 'Mannequin',
    icon: '\uD83E\uDDDD\u200D\u2640\uFE0F',
    color: 0xcb99ff,
    scale: 0.06,
    aliases: ['defeated-doll', 'female-humanoid'],
    model: {
      path: 'assets/animated-sprites/Standing Idle.fbx',
      normalization: 'footprint',
      retargetAnimations: false,
    },
  },
  {
    id: 'knight',
    label: 'Knight',
    icon: '\uD83D\uDEE1\uFE0F',
    color: 0xb7b2c8,
    scale: 0.06,
    aliases: [],
    mixamoName: 'Knight D Pelegrini',
    model: {
      path: 'assets/animated-sprites/Knight T-Pose.fbx',
      normalization: 'height',
      retargetAnimations: true,
    },
  },
  {
    id: 'mutant',
    label: 'Mutant',
    icon: '\uD83D\uDC79',
    color: 0x708d4b,
    scale: 0.06,
    aliases: [],
    mixamoName: 'Mutant',
    model: {
      path: 'assets/animated-sprites/Mutant T-Pose.fbx',
      normalization: 'height',
      retargetAnimations: true,
    },
  },
  {
    id: 'female-archer',
    label: 'Female Archer',
    icon: '\uD83C\uDFF9',
    color: 0x8eb66a,
    scale: 0.06,
    aliases: [],
    mixamoName: 'Erika Archer',
    model: {
      path: 'assets/animated-sprites/Erika Archer.fbx',
      normalization: 'height',
      retargetAnimations: true,
    },
  },
  {
    id: 'armored-knight',
    label: 'Armored Knight',
    icon: '\uD83D\uDEE1\uFE0F',
    color: 0x8797b4,
    scale: 0.06,
    aliases: [],
    mixamoName: 'Paladin J Nordstrom',
    model: {
      path: 'assets/animated-sprites/Paladin J Nordstrom.fbx',
      normalization: 'height',
      retargetAnimations: true,
    },
  },
  {
    id: 'monk',
    label: 'Monk',
    icon: '\uD83E\uDD4B',
    color: 0xb88b67,
    scale: 0.06,
    aliases: [],
    mixamoName: 'Yaku J Ignite',
    model: {
      path: 'assets/animated-sprites/Yaku J Ignite.fbx',
      normalization: 'height',
      retargetAnimations: true,
    },
  },
];

const characters = new Map(CHARACTER_DEFINITIONS.map((entry) => [entry.id, entry]));
const aliases = new Map(
  CHARACTER_DEFINITIONS.flatMap((entry) => entry.aliases.map((alias) => [alias, entry.id]))
);

export function normalizeCreatureType(type) {
  if (typeof type !== 'string') return '';
  const normalized = type.trim().toLowerCase();
  return aliases.get(normalized) || normalized;
}

export function getCharacterDefinition(type) {
  return characters.get(normalizeCreatureType(type)) || null;
}
