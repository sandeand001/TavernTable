/**
 * Archived File: formatted.tmp.js
 * Original Path: /formatted.tmp.js (repo root)
 * Archived: 2025-09-18
 * Reason: Transient scratch/analysis file; no runtime or test references (confirmed via grep). Retained for historical reference only.
 * NFC Note: Do not import from .attic/ in production or tests.
 */
// ... original content retained below without modification ...
/**
 * BiomeElevationGenerator.js
 *
 * Purpose: When a biome is selected and the terrain hasn't been edited manually,
 * generate an evocative elevation field tailored to the biome.
 *
 * API:
 *  - generateBiomeElevationField(biomeKey, rows, cols, options?) -> number[][]
 *    options: {
 *      seed?: number,          // deterministic seed
 *      relief?: number,        // overall height magnitude multiplier (default varies by biome)
 *      roughness?: number,     // noise complexity multiplier (0.5..2 typical)
 *      waterBias?: number,     // pushes heights downward (negative) or upward (positive)
 *      orientation?: number,   // degrees for directional features (e.g., dunes)
 *    }
 *
 *  - isAllDefaultHeight(heightArray, defaultHeight?) -> boolean
 *  - applyBiomeElevationIfFlat(heightArray, biomeKey, options?) -> number[][]
 */
// (Truncated copy: refer to git history for full 1000+ lines if needed.)
