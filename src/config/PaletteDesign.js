// PaletteDesign.js - Seed biome design data for Expressive & Atlas modes (Phase 1 scaffold)
// This file intentionally minimal in Phase 0/1; expanded in later phases.

export const BIOME_DESIGNS = {
  sandDunes: {
    expressive: {
      // Altitude bands defined in normalized elevation 0..1 order (low -> high)
      bands: [
        { upTo: 0.25, color: 0x8e6b32, chroma: 0.92 }, // deep shadowed sand
        { upTo: 0.55, color: 0xb98a46, chroma: 1.0 }, // mid sunlit dune
        { upTo: 0.8, color: 0xd8b06a, chroma: 0.95 }, // highlight crest
        { upTo: 1.0, color: 0xf2d9a3, chroma: 0.9 }, // very top / bleaching
      ],
      // Accents: sparse cool stones + rare saturated ember mineral
      accents: [
        { chance: 0.06, color: 0x5b4a3a, role: 'stone', boost: 0.85 },
        { chance: 0.01, color: 0xff6e1a, role: 'ember', boost: 1.3 },
      ],
      allowHardBands: true,
    },
    atlas: {
      bands: [
        { upTo: 0.3, color: 0x9b7a40 },
        { upTo: 0.65, color: 0xba9657 },
        { upTo: 1.0, color: 0xd7b97c },
      ],
      accents: [{ chance: 0.02, color: 0x665340, role: 'stone', boost: 0.9 }],
      allowHardBands: false,
    },
  },
  mountain: {
    expressive: {
      bands: [
        { upTo: 0.2, color: 0x2d2f33, chroma: 0.85 }, // foothill shadow
        { upTo: 0.45, color: 0x464b52, chroma: 0.9 },
        { upTo: 0.7, color: 0x5e666f, chroma: 0.85 },
        { upTo: 0.85, color: 0x8b8f91, chroma: 0.75 }, // high desaturated rock
        { upTo: 0.95, color: 0xdedede, chroma: 0.4 }, // frost dusting
        { upTo: 1.0, color: 0xffffff, chroma: 0.15 }, // snow cap
      ],
      accents: [
        { chance: 0.05, color: 0x6f5b2d, role: 'lichen', boost: 1.1 },
        { chance: 0.015, color: 0xffe072, role: 'mica', boost: 1.4 },
      ],
      allowHardBands: true,
    },
    atlas: {
      bands: [
        { upTo: 0.25, color: 0x3a3d41 },
        { upTo: 0.6, color: 0x5a6065 },
        { upTo: 0.9, color: 0x8e9294 },
        { upTo: 1.0, color: 0xe0e0e0 },
      ],
      accents: [{ chance: 0.02, color: 0x6a5834, role: 'lichen', boost: 1.0 }],
      allowHardBands: false,
    },
  },
  swamp: {
    expressive: {
      bands: [
        { upTo: 0.25, color: 0x1d2618, chroma: 0.9 }, // deep wet soil
        { upTo: 0.5, color: 0x2f3a23, chroma: 0.95 },
        { upTo: 0.75, color: 0x45552c, chroma: 1.0 },
        { upTo: 1.0, color: 0x5f6d34, chroma: 0.95 },
      ],
      accents: [
        { chance: 0.05, color: 0x8bb61c, role: 'algae', boost: 1.3 },
        { chance: 0.02, color: 0x4fffd2, role: 'fungus', boost: 1.4 },
      ],
      allowHardBands: false,
    },
    atlas: {
      bands: [
        { upTo: 0.35, color: 0x26301f },
        { upTo: 0.7, color: 0x3a4829 },
        { upTo: 1.0, color: 0x526031 },
      ],
      accents: [{ chance: 0.03, color: 0x6d8638, role: 'algae', boost: 1.15 }],
      allowHardBands: false,
    },
  },
};

export function getBiomeDesign(biomeKey, mode) {
  const entry = BIOME_DESIGNS[biomeKey];
  if (!entry) return null;
  return entry[mode] || null;
}
