# ADR-0001: TerrainEngine — Event-Based Seam, No Renderer Dependencies

**Status:** Accepted  
**Date:** 2026-05-03

**Implementation status:** Completed for the existing heightfield editor.
Live editing, game height queries, resizing, reset, biome generation and campaign
capture/restore use TerrainEngine. TerrainCoordinator only wires its input and
3D scene adapters. The engine also owns non-mutating gesture previews and bounded,
session-local height Undo/Redo. Public-interface tests cover editing, persistence,
biome/flora behavior and real terrain geometry without legacy 2D fixtures.
The bounded solid/void and multi-surface proof is retained but paused. The user
has replaced shared-board layering with separate connected building/floor/area
grids, independent participant views, and cross-grid physical rules. The planned
builder uses a closed outline and height instead of the numeric box editor;
carving is deferred. This changes map topology, not the ownership decision below:
each grid still needs one authoritative terrain owner and renderer adapters.
The connected-map foundation now stores physical map anchors and independent
map checkpoints in version-3 scenes. Targeting reads unsaved active-map geometry
from TerrainEngine and inactive-map geometry from validated checkpoints; they
are not competing live terrain stores. Interior floors use finite slabs rather
than extending solid earth through lower maps. Live map-view controls switch the
active terrain checkpoint and renderer presentation without replacing canonical
creatures or restoring combat. Per-map cameras persist, and sight-gated creature
projections share the original identity. Failed view changes roll back rather
than saving incomplete terrain. Connected locomotion, the outline builder and
networked participant ownership remain separate implementation chunks.
Sight-gated supporting terrain for projections queries read-only foreign-map
checkpoint geometry. Its cached scene meshes never become a second terrain owner,
editable cells or navigation supports in the active grid.
Interior wall cutaways follow the same rule: render-only, floor-scoped queries
reveal the original wall openings while suppressing ceiling coverage. The
authoritative structure, exterior roof and physical sight geometry are not
removed or copied into another terrain owner.

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
