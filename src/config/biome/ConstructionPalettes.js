import { lerpColor } from '../../utils/color/ColorUtils.js';
import { getSettlementProfile } from './SettlementProfiles.js';

export const CONSTRUCTION_MATERIALS = Object.freeze({
  none: 0,
  plaster: 1,
  brick: 2,
  timber: 3,
  stone: 4,
  tiles: 5,
  slate: 6,
  paving: 7,
  grass: 8,
  rock: 9,
});

const PALETTES = [
  [/cliffsideCastle/i, { masonry: 0xb8b09a, roof: 0x526576, rock: 0x767e80 }],
  [/mountainCastle/i, { masonry: 0xa8acaa, roof: 0x4a5e6d, rock: 0x626e76 }],
  [
    /desert|sandDunes|oasis|savanna|saltFlats/i,
    { masonry: 0xc9ac7d, roof: 0xa87851, rock: 0xb99768 },
  ],
  [
    /forest|grove|orchard|bamboo|mangrove|swamp|wetland/i,
    { masonry: 0x87927c, roof: 0x685d4b, rock: 0x737e6e },
  ],
  [/tundra|glacier|frozen|packIce|alpine/i, { masonry: 0xc0ccd0, roof: 0xd9e4e6, rock: 0x899aa4 }],
  [/volcanic|obsidian|lava|ash/i, { masonry: 0x67636a, roof: 0x584b4d, rock: 0x4c494d }],
  [
    /ruinedTown|ruinedUrban|ruinedCastle|graveyard|wasteland/i,
    { masonry: 0x858a82, roof: 0x696b66, rock: 0x737a73 },
  ],
  [/crystal|fungal|eldritch|astral|arcane/i, { masonry: 0x9295af, roof: 0x696a91, rock: 0x72788f }],
  [/town|city|castle/i, { masonry: 0xb0a58f, roof: 0x985e4a, rock: 0x8e928b }],
];
const DEFAULT = Object.freeze({
  masonry: 0x99978c,
  roof: 0x835b4e,
  rock: 0x858e91,
  trim: 0x685044,
  accent: 0x365773,
  paving: 0x908b7e,
  timber: 0x806044,
  grass: 0x7e9865,
});
const CACHE = new Map();

export function getConstructionPalette(biomeKey) {
  if (!CACHE.has(biomeKey))
    CACHE.set(
      biomeKey,
      Object.freeze({
        ...DEFAULT,
        ...(PALETTES.find(([pattern]) => pattern.test(biomeKey || ''))?.[1] || DEFAULT),
      })
    );
  return CACHE.get(biomeKey);
}

function appearance(
  wallColor,
  roofColor,
  trimColor,
  wallMaterial,
  roofMaterial,
  detail,
  accentColor = 0xb28b42
) {
  const stoneFloor = wallMaterial === 'stone' || detail === 'fortress';
  return {
    wallColor,
    roofColor,
    trimColor,
    wallMaterial,
    roofMaterial,
    detail,
    accentColor,
    floorColor: stoneFloor ? 0xafa995 : 0x94724e,
    floorMaterial: stoneFloor ? 'stone' : 'timber',
  };
}

const ARCHITECTURE = {
  town: [
    appearance(0xe1cfac, 0xa9563c, 0x513b2d, 'plaster', 'tiles', 'timber'),
    appearance(0xc3cbb5, 0x596875, 0x493c31, 'plaster', 'slate', 'timber'),
    appearance(0xcfae91, 0x76513c, 0x4f3628, 'plaster', 'timber', 'timber'),
    appearance(0xaec5bf, 0x9d563b, 0x574232, 'plaster', 'tiles', 'timber'),
    appearance(0xb6986f, 0x697359, 0x503b2c, 'timber', 'timber', 'timber'),
    appearance(0xc8c2a7, 0x644e43, 0x77715d, 'stone', 'slate', 'masonry'),
    appearance(0xe0d8bf, 0xbe7b48, 0x5b4030, 'plaster', 'tiles', 'timber'),
    appearance(0xbfa67e, 0x53686c, 0x624637, 'plaster', 'slate', 'timber'),
  ],
  city: [
    appearance(0xaa735b, 0x515c67, 0xd2bda0, 'brick', 'slate', 'masonry'),
    appearance(0xd9cdb3, 0x985239, 0x665247, 'plaster', 'tiles', 'masonry'),
    appearance(0xbab9a7, 0x536a70, 0xdfd4b7, 'stone', 'slate', 'masonry'),
    appearance(0xb98462, 0x6a4d3e, 0xd6c19a, 'brick', 'tiles', 'masonry'),
    appearance(0xb4c5be, 0x656073, 0x686050, 'plaster', 'slate', 'masonry'),
    appearance(0xd1b989, 0x8a503c, 0x5a4132, 'plaster', 'tiles', 'timber'),
    appearance(0xa89e88, 0x4a555f, 0xc5b899, 'stone', 'slate', 'masonry'),
    appearance(0xdcc8aa, 0x5b7374, 0x735847, 'plaster', 'slate', 'masonry'),
  ],
  castle: [
    appearance(0xbdb8a2, 0x42566b, 0xdbd0b2, 'stone', 'slate', 'fortress', 0x842f40),
    appearance(0xaaa994, 0x4b5e68, 0xc7c1a4, 'stone', 'slate', 'fortress', 0x294e82),
    appearance(0xd2c8ac, 0x4d6970, 0xe3d6b7, 'stone', 'slate', 'fortress', 0x315b49),
    appearance(0xa8ad9f, 0x574c60, 0xc9c6ae, 'stone', 'slate', 'fortress', 0x663a6d),
  ],
};

export function getConstructionAppearance(biomeKey, variant = 0, heraldry = 0) {
  if (!Number.isInteger(variant) || variant < 0 || !Number.isInteger(heraldry) || heraldry < 0)
    throw new TypeError('Building palette variation requires non-negative integer choices');
  const profile = getSettlementProfile(biomeKey);
  let result;
  if (profile) {
    const choices = ARCHITECTURE[profile.kind];
    result = { ...choices[variant % choices.length] };
    if (profile.kind === 'castle')
      result.accentColor = choices[heraldry % choices.length].accentColor;
  } else {
    const palette = getConstructionPalette(biomeKey);
    const wall = lerpColor(
      palette.masonry,
      variant % 2 ? 0x5e5142 : 0xede1c3,
      0.08 + (variant % 4) * 0.035
    );
    result = appearance(
      wall,
      palette.roof,
      palette.trim,
      'stone',
      'tiles',
      'masonry',
      palette.accent
    );
  }
  if (/^ruined/.test(biomeKey || '')) {
    result.wallColor = lerpColor(result.wallColor, 0x7f8472, 0.28);
    result.roofColor = lerpColor(result.roofColor, 0x625e50, 0.3);
  }
  return result;
}

export function normalizeConstructionAppearance(value) {
  const colors = ['wallColor', 'roofColor', 'trimColor', 'accentColor', 'floorColor'];
  const materials = ['wallMaterial', 'roofMaterial', 'floorMaterial'];
  const keys = [...colors, ...materials, 'detail'];
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key)) ||
    colors.some(
      (key) => !Number.isInteger(value[key]) || value[key] < 0 || value[key] > 0xffffff
    ) ||
    materials.some(
      (key) => !Object.hasOwn(CONSTRUCTION_MATERIALS, value[key]) || value[key] === 'none'
    ) ||
    !['timber', 'masonry', 'fortress'].includes(value.detail)
  )
    throw new Error(
      'A building appearance requires valid colours, materials and architectural detail'
    );
  return Object.fromEntries(keys.map((key) => [key, value[key]]));
}
