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

The curved-shape proof extends that same owner with clipped ellipsoid/cylinder
volumes and ordered convex solid/void queries. The renderer consumes those
boundaries; it does not own separate curved collision geometry. Physical campaign
queries transform the actual convex constraints instead of treating a curved
structure's bounding box as solid. Curved snapshots are geometry version 2, with
legacy box-only version 1 retained. The cave/dome/tube/battlement/tower recipes
are deterministic domain data shared by illustrated manual placement, safe
parameter resizing and seeded biome features. Editable groups use geometry
version 3, including arbitrary-angle prism walls. The UI previews only candidate
shapes, not a second world model; authoritative solids bake on commit. Generation
preserves manual groups and uses explicit intact/ruined town, city and fortress
profiles with organic village greens/lanes, dense city districts and markets, and
layered castles with grand keeps, bailey towers and arched gatehouses. Building
appearance is saved domain data; colour/material provenance survives clipping,
while procedural surface patterns and batched façade ornament remain render-only.
Linked floor rendering also batches its geometry without discarding per-map pick
identity; both batches retain cached geometry between unchanged frames.
Biome budgets replace the original universal eight-piece settlement limit.
Automatic opening density is an optional versioned building recipe, with
architecture-specific spacing and allowed local sides. Legacy saved profiles keep
their old pattern; manual features remain independent of automatic side masks.
Window-layout version 2 saves an architectural composition seed and varies
actual editable dimensions and per-floor arrangements, including tall apertures.
Version-1 and missing-layout recipes remain unchanged on load or resize.
Castle seeds vary actual coherent topology and dimensions through a separate
architecture stream, while rotated wall/stair footprints constrain placement.
Explicit cliff/mountain site recipes replace flat foundations with narrow rock
spurs, negative ravines, arched viaducts and stepped mountain baileys. Shared
convex rock/excavation supplies real support, ceilings, sight and falling;
connected halls keep their ordinary map ownership/alignment. A versioned terrace
exit on retaining stairs opens the opposite parapet so it joins the upper site.
The general natural-cave generator and non-to-scale designed interiors remain
separate later milestones.
Only untouched default canvases (or their unedited auto-sized successors) may grow
to the biome's recommended size; populated/custom maps retain their dimensions.
Natural landmarks include intact and broken buildings on dry, gentle sites.
Bounded cave networks share a floor and union their shells before subtracting
rooms and passage bores; member edits preserve interleaved CSG slots instead of
moving early cuts ahead of later shells. Structure/volume budgets and physical
layout caps apply even on large maps. Saved maps only adopt new generation
recipes on explicit Generate. Closed-outline connected-floor authoring remains later work.

Parametric buildings/turrets now derive linked floor maps and physical connections
from their versioned authoring definition. The exterior owns its shell; finite
interior maps own slabs and stairs. Pitched roofs add convex-polyhedron domain
data, not renderer-only collision shortcuts. Direct handles and wall-feature
gestures remain candidate previews until release/Apply.

An opaque geometry-edit participant, wired by the scene adapter, prepares the
campaign topology before the engine applies an edit. Apply/rollback coordinates
both owners atomically. History stores managed interior maps and their cameras,
not character resources or combat snapshots; fine resizing keeps the interior
grid lattice and physical actor positions. The engine does not import campaign
or renderer services. Topology changes wait for pending scene writes, and
actor-only checkpoints retain unchanged map geometry and idle render meshes.
Five-foot footprint indices restrict point and body queries to nearby ordered
operations/solid fragments, including foreign-map obstacles. Exact narrow-phase
geometry remains authoritative, and indices invalidate with terrain edits.
Range searches memoize support only within the search and reject visited states
before expensive clearance, not across changes to actors or turn budgets.
Unreachable distant stair anchors are excluded conservatively, and the same
footprint broad phase avoids global support searches when no foreign solid can
stand above the local surface. Exact physical checks still decide the result.
Generate failures are visible in its control area; rejected attempts preserve
the random seed as well as geometry and actor state.
Legacy shells require explicit upgrade rather than implicit load-time mutation.

Profile version 2 adds footprint-matched rectangular roof hulls and reusable
post-placement window/balcony manipulation without adding another geometry owner.
Legacy profile data remains loadable with its original roof recipe. A tall window
is one authoring cut with derived room-clipped connections, not duplicated window
definitions or removed floors. Physical floor slabs can own exterior grip contacts;
reframing tracks the contact's owner independently from the actor's map. Shape
limits live in the domain model and are shared by normalization and resize math.
Pointer previews remain small candidate meshes/handles, never world-CSG rebuilds.

Custom-level profile version 3 removes the fixed-height assumption from derived
maps and connections. Stable numeric IDs identify floors independently of their
elevations; the battlement deck reserves ID 100. Whole-floor removal, rectangular
cutouts, room heights and cellar excavation remain domain data under the same
atomic participant/history boundary. Larger stair gaps repeat supported flights
instead of scaling risers. Cellar access adds a validated real stair/ladder route,
not a teleport or a second actor. A pending cross-map fall landing cannot publish
an intermediate stable checkpoint in its source map.

Underground editor reveal is presentation state, not terrain visibility or a
second collision owner. Its adapter clones/restores materials and projects cellar
definitions/validated local floor geometry without modifying physical support or
sight. Structure identifiers and connection-target highlighting follow the same
read-only rule. Cellar candidate filtering shares a physical hatch/landing-fit
helper with topology validation, rather than a UI-only distance heuristic.

Authored wall stair layouts supply bounded physical navigation anchors for turns
and angled treads that grid centres cannot represent. They remain queries of
domain geometry and retain ordinary edge costs, step limits and swept-body
clearance. The renderer does not invent traversable stair surfaces.
Finite cellar walls and floor cutaways likewise keep their actual vertical
extent. Only the artificial bottom of unbounded earth is capped for rendering;
transient cell provenance distinguishes that bottom after convex clipping,
without changing physical support or the persisted geometry format.

Whole-structure translation carries owned floor content and camera frames, unlike
footprint resizing's physical-position-preserving lattice reframe. Authoring does
not transfer creatures: occupied structures reject edits until vacated. New wall
stair recipe version 2 uses solid, progressively wallward flights rather than
overlapping filled runs or unsupported thin exterior treads; earlier recipes stay
loadable until explicitly edited.

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
