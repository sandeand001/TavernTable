/**
 * BiomeConstants.js - Defines biome taxonomy and metadata for terrain system.
 *
 * Grouping hierarchy: GROUP -> list of biome definitions.
 * Each biome has: key (stable id), label (UI), emoji (optional), category (broad type), rarity.
 */

// CLEANUP (2025-09-19): Initially internalized BIOME_GROUPS, but SidebarController dynamically
// imports this module and destructures { BIOME_GROUPS } to build the biome selection menu.
// Without a named export the palette disappears. Re-exporting to restore UI functionality.
export const BIOME_GROUPS = {
  // ── Common Biomes ─────────────────────────────────────────────
  Common: [
    { key: 'grassland', label: 'Grassland', emoji: '🌾', rarity: 'common' },
    { key: 'hills', label: 'Hills', emoji: '⛰️', rarity: 'common' },
    { key: 'forestTemperate', label: 'Temperate Forest', emoji: '🌳', rarity: 'common' },
    { key: 'forestConifer', label: 'Conifer Forest', emoji: '🌲', rarity: 'common' },
    { key: 'savanna', label: 'Savanna', emoji: '🦒', rarity: 'common' },
    { key: 'steppe', label: 'Steppe / Prairie', emoji: '🌾', rarity: 'common' },
  ],
  // ── Desert Biomes ─────────────────────────────────────────────
  Desert: [
    { key: 'desertHot', label: 'Hot Desert', emoji: '🏜️', rarity: 'uncommon' },
    { key: 'desertCold', label: 'Cold Desert', emoji: '🥶', rarity: 'uncommon' },
    { key: 'sandDunes', label: 'Sand Dunes', emoji: '🌬️', rarity: 'uncommon' },
    { key: 'oasis', label: 'Oasis', emoji: '💧', rarity: 'uncommon' },
    { key: 'saltFlats', label: 'Salt Flats', emoji: '🧂', rarity: 'rare' },
    { key: 'thornscrub', label: 'Thornscrub / Chaparral', emoji: '🌵', rarity: 'uncommon' },
  ],
  // ── Arctic Biomes ─────────────────────────────────────────────
  Arctic: [
    { key: 'tundra', label: 'Tundra', emoji: '❄️', rarity: 'uncommon' },
    { key: 'glacier', label: 'Glacier / Ice Sheet', emoji: '🧊', rarity: 'rare' },
    { key: 'frozenLake', label: 'Frozen Lake', emoji: '🧊', rarity: 'rare' },
    { key: 'packIce', label: 'Pack Ice', emoji: '🧊', rarity: 'rare' },
  ],
  // ── Mountain Biomes ───────────────────────────────────────────
  Mountain: [
    { key: 'mountain', label: 'Mountain', emoji: '🏔️', rarity: 'common' },
    { key: 'alpine', label: 'Alpine', emoji: '⛰️', rarity: 'uncommon' },
    { key: 'screeSlope', label: 'Scree Slope', emoji: '🪨', rarity: 'uncommon' },
    { key: 'cedarHighlands', label: 'Cedar Highlands', emoji: '🌲', rarity: 'uncommon' },
    { key: 'geyserBasin', label: 'Geyser Basin', emoji: '♨️', rarity: 'rare' },
  ],
  // ── Wetland Biomes ────────────────────────────────────────────
  Wetlands: [
    { key: 'swamp', label: 'Swamp / Marsh', emoji: '🪵', rarity: 'uncommon' },
    { key: 'wetlands', label: 'Wetlands (Bog/Fen)', emoji: '🦆', rarity: 'uncommon' },
    { key: 'floodplain', label: 'Floodplain', emoji: '🌧️', rarity: 'common' },
    { key: 'bloodMarsh', label: 'Blood Marsh', emoji: '🩸', rarity: 'exotic' },
    { key: 'mangrove', label: 'Mangrove', emoji: '🛶', rarity: 'rare' },
  ],
  // ── Aquatic Biomes ────────────────────────────────────────────
  Aquatic: [
    { key: 'coast', label: 'Coast / Beach', emoji: '🏖️', rarity: 'common' },
    { key: 'riverLake', label: 'River / Lake', emoji: '🏞️', rarity: 'common' },
    { key: 'ocean', label: 'Ocean (Deep)', emoji: '🌊', rarity: 'uncommon' },
    { key: 'coralReef', label: 'Coral Reef', emoji: '🐠', rarity: 'rare' },
  ],
  // ── Forest Variant Biomes ─────────────────────────────────────
  ForestVariants: [
    { key: 'deadForest', label: 'Dead / Burnt Forest', emoji: '🔥', rarity: 'uncommon' },
    { key: 'petrifiedForest', label: 'Petrified Forest', emoji: '🪨', rarity: 'rare' },
    { key: 'bambooThicket', label: 'Bamboo Thicket', emoji: '🎍', rarity: 'uncommon' },
    { key: 'orchard', label: 'Orchard', emoji: '🍎', rarity: 'common' },
    { key: 'mysticGrove', label: 'Mystic Grove', emoji: '✨', rarity: 'exotic' },
    { key: 'feywildBloom', label: 'Feywild Bloom', emoji: '🧚', rarity: 'exotic' },
    { key: 'shadowfellForest', label: 'Shadowfell Forest', emoji: '🌑', rarity: 'exotic' },
  ],
  // ── Underground Biomes ────────────────────────────────────────
  Underground: [
    { key: 'cavern', label: 'Cavern', emoji: '🕳️', rarity: 'uncommon' },
    { key: 'fungalGrove', label: 'Fungal Grove', emoji: '🍄', rarity: 'rare' },
    { key: 'crystalFields', label: 'Crystal Fields', emoji: '💎', rarity: 'rare' },
    { key: 'crystalSpires', label: 'Crystal Spires', emoji: '💠', rarity: 'exotic' },
    { key: 'eldritchRift', label: 'Eldritch Rift', emoji: '🌀', rarity: 'exotic' },
  ],
  // ── Volcanic Biomes ──────────────────────────────────────────
  Volcanic: [
    { key: 'volcanic', label: 'Volcanic', emoji: '🌋', rarity: 'rare' },
    { key: 'obsidianPlain', label: 'Obsidian Plain', emoji: '🪨', rarity: 'rare' },
    { key: 'ashWastes', label: 'Ash Wastes', emoji: '⚫', rarity: 'rare' },
    { key: 'lavaFields', label: 'Lava Fields', emoji: '🔥', rarity: 'exotic' },
  ],
  // ── Wasteland Biomes ─────────────────────────────────────────
  Wasteland: [
    { key: 'wasteland', label: 'Blighted Wasteland', emoji: '☢️', rarity: 'rare' },
    { key: 'ruinedUrban', label: 'Ruined Urban', emoji: '🏚️', rarity: 'rare' },
    { key: 'graveyard', label: 'Graveyard / Necropolis', emoji: '🪦', rarity: 'uncommon' },
  ],
  // ── Exotic Biomes ─────────────────────────────────────────────
  Exotic: [
    { key: 'astralPlateau', label: 'Astral Plateau', emoji: '🌌', rarity: 'exotic' },
    { key: 'arcaneLeyNexus', label: 'Arcane Ley Nexus', emoji: '🧿', rarity: 'exotic' },
  ],
};

// ── Derived Lookups ───────────────────────────────────────────
export const ALL_BIOMES = Object.values(BIOME_GROUPS).flat();

// CLEANUP NOTE (2025-09-19): Removed unused helper findBiome (no in-repo callers).
