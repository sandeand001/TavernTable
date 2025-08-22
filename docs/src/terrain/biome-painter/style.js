// src/terrain/biome-painter/style.js
// Pure helper to classify a biome key into a painter style.

/**
 * Map a biome string to a painterly style bucket.
 * Keep this in sync with prior logic from BiomeCanvasPainter._styleForBiome.
 * @param {string} biome
 * @returns {"plains"|"arid"|"forest"|"wetland"|"alpine"|"water"|"volcanic"|"arcane"|"generic"}
 */
export function styleForBiome(biome) {
    const b = String(biome || '');
    if (/(grassland|steppe|prairie|hill)/i.test(b)) return 'plains';
    if (/desert|dune|savanna|thorn|salt/i.test(b)) return 'arid';
    if (/forest|grove|bamboo|orchard|cedar|fey|shadowfell/i.test(b)) return 'forest';
    if (/swamp|marsh|wetland|mangrove|flood/i.test(b)) return 'wetland';
    if (/glacier|tundra|frozen|pack|alpine|mountain|scree/i.test(b)) return 'alpine';
    if (/ocean|coast|river|lake|reef|oasis|geyser|beach|shore/i.test(b)) return 'water';
    if (/volcan|lava|obsidian|ash/i.test(b)) return 'volcanic';
    if (/waste|ruin|urban|grave|cavern|crystal|eldritch|astral|arcane/i.test(b)) return 'arcane';
    return 'generic';
}

export default styleForBiome;
