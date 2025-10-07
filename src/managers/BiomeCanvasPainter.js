// NFC NOTE (2025-09-19): This shim re-exports the refactored terrain/BiomeCanvasPainter.
// It appears as an 'orphan' in heuristic scans because downstream code increasingly imports
// from the terrain path directly. Retained intentionally for backward compatibility and
// potential external references. Do not remove during Phase 1 NFC cleanup.
// Deprecated shim: use src/terrain/BiomeCanvasPainter.js
// This file exists only to avoid broken imports during refactors.
// Re-export the terrain painter to keep backwards compatibility.
export { default } from '../terrain/BiomeCanvasPainter.js';
export * from '../terrain/BiomeCanvasPainter.js';
