# ADR-0001: TerrainEngine — Event-Based Seam, No Renderer Dependencies

**Status:** Accepted  
**Date:** 2026-05-03

---

## Context

The terrain system was fragmented across four layers with no clear owner:

- `coordinators/TerrainCoordinator.js` — 78-method pass-through facade
- `managers/TerrainManager.js` — 55-method rendering owner with bidirectional coupling back to TerrainCoordinator
- `terrain/` — data, brush, generation, painting scattered as separate public modules
- `scene/terrain/` — 3D mesh system with no clean connection to the above

`TerrainManager` held PIXI.js (2D) rendering as its core responsibility, but 2D rendering was already intended for full removal. `TerrainCoordinator` delegated to 40+ internal imports with an interface nearly as complex as its implementation.

The result: no single testable seam for terrain. Tests had to mock entire coordinator chains. Callers were coupled to multiple layers simultaneously.

---

## Decision

Consolidate the terrain domain into a single **`TerrainEngine`** module with the following properties:

1. **Owns all terrain state.** Grid data, elevation map, active tool, brush configuration, biome seed — all private. `TerrainDataStore`, brush internals, generation, and painting become private implementation details, not public modules.

2. **Event-based outbound communication.** TerrainEngine fires events (`onTileChanged`, `onHeightChanged`, `onBrushMoved`). It has no knowledge of PIXI, Three.js, or any rendering system. Both 2D and 3D renderers are adapters that subscribe to these events externally.

3. **No PIXI dependency.** 2D rendering is being removed from the codebase. TerrainEngine will never take a PIXI container as a dependency. Remaining PIXI usage in terrain will be removed as 3D equivalents are completed.

4. **`TerrainCoordinator` survives as a pure wiring layer only.** Its only job is to subscribe TerrainEngine events to the 3D scene adapters. It holds no terrain logic, no pass-through methods, and no state. If it grows beyond wiring, that is a violation of this decision.

5. **Simple Three.js materials are acceptable for biome rendering.** Procedural biome painting (`BiomeCanvasPainter`) will not be ported to shaders in the initial migration. Solid/blended per-biome materials are sufficient. Procedural shader painting is a future enhancement.

---

## Alternatives Considered

**TerrainEngine calls the 3D scene directly.**  
Rejected. Creates a hard dependency on Three.js inside the terrain domain, making TerrainEngine untestable without a GPU context.

**TerrainEngine owns 2D rendering (PIXI).**  
Rejected. 2D rendering is slated for full removal. Embedding PIXI into TerrainEngine would contradict that goal.

**GameManager wires events directly.**  
Rejected. GameManager is already large. Wiring is a distinct concern and belongs in a coordinator whose only job is connecting seams.

**Keep TerrainCoordinator as an orchestrator with many methods.**  
Rejected. Its 78-method interface is nearly as complex as its implementation. Fails the deletion test — callers were effectively importing through a pass-through.

---

## Consequences

- `TerrainManager` is absorbed into `TerrainEngine` and ceases to exist as a public module.
- `TerrainDataStore`, `TerrainBrushController`, `terrain/generation/`, `terrain/painting/` become private internals.
- `TerrainCoordinator` is rewritten from scratch as a wiring-only layer (~20-30 lines).
- PIXI removal from terrain proceeds incrementally as 3D equivalents are completed (side faces, elevation shadows, placeable sprites).
- `BiomeCanvasPainter` procedural painting is deferred — tracked as a future enhancement.
- TerrainEngine becomes the single testable seam for all terrain behavior.
