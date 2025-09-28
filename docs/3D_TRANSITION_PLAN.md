# 3D Transition Plan (Living Document)

Status: IN PROGRESS (Phase 3 complete; Phase 4 core scaffolding active; PickingService integrated for ground hover; camera alignment + height resync iteration)  
Branch: `feature/3d-transition`  
Last Updated: 2025-09-26

---
## 0. Purpose
Move TavernTable from a 2.5D isometric sprite projection to a true 3D scene using Three.js while preserving gameplay logic and allowing incremental adoption. This document is a living plan: update sections as phases complete or decisions change.

---
## 1. Guiding Principles
- Incremental: Each phase is independently shippable and reversible.
- Stable APIs: Keep `GameManager`, coordinator interfaces, and token/terrain manager contracts intact until Phase 7.
- Test Continuity: Existing tests survive early phases; new tests assert world mapping without forcing brittle rewrites too soon.
- Dual Mode Bridge: Support `renderMode = '2d-iso' | '3d-hybrid'` until full migration.
- Determinism: Grid ↔ world transformations must be pure & tested.

---
## 2. Phases Overview
| Phase | Goal | Output | Ship Criteria |
|-------|------|--------|---------------|
| 0 | Spatial abstraction | `SpatialCoordinator` + tests | No visual regressions |
| 1 | Three.js bootstrap | `ThreeSceneManager` canvas | 3D plane below 2D sprites |
| 2 | Heightmapped terrain | Terrain mesh updates with elevation | Terrain reacts to editor |
| 3 | Token billboards | 3D token planes + dual render | Feature toggle works |
| 4 | Placeable instancing | Instanced meshes | Performance stable |
| 5 | Lighting & shadows | Directional + ambient + fog | Shadows render clean |
| 6 | 3D interaction | Ray picking & movement | All core actions in 3D |
| 7 | Projection retirement | Remove iso dependency | All consumers use world |
| 8 | Polish & advanced | Splat maps, TOF, AO | Feature backlog curated |

---
## 3. Key Decisions (Initial)
| Concern | Decision (Initial) | Rationale | Revisit Phase |
|---------|--------------------|-----------|---------------|
| World axes | X east, Z south, Y up | Aligns with Three.js conventions | Only if pathfinding needs change |
| Tile world size | 1.0 x (sqrt(0.5))? (TBD) | Start simple: 1 unit square; iso visuals later | Phase 2 before mesh |
| Elevation unit | 0.5 world units per level | Visual separation; tweakable factor | Phase 2 tuning |
| Camera initial | Orthographic iso-like | Preserve current spatial feel | Could add perspective Phase 5 |
| Token form (3D) | Billboard Sprite first | Lowest friction migration | Replace with meshes Phase 5/8 |
| Placeables | Instanced quads (InstancedMesh) | Perf; small memory footprint | Upgrade meshes Phase 8 |
| Camera iso tuning | Yaw + pitch adjustable (orthographic) | Manual alignment vs 2D iso (current matched preset 52° after non-adaptive frustum change) | Revisit for perspective Phase 5 |
| Vertical offsets | Global token vertical bias | Quick parity for sprite baseline | Per-creature offsets Phase 5 |
| Lighting model | StandardMaterial + dir + amb | Fast path | Enhance with env map Phase 5 |
| Fog | Disabled early | Avoid visual confusion | Enable Phase 5 |
| Physics | Deferred | Not blocking base visuals | Evaluate after Phase 6 |

Open placeholders: finalize tile size conversion + world scaling constant in Phase 0/1.

---
## 4. Module Additions
| File | Layer | Responsibility |
|------|-------|----------------|
| `src/scene/SpatialCoordinator.js` | app/domain bridge | Grid ↔ world math (canonical) |
| `src/scene/ThreeSceneManager.js` | core/app | Renderer, scene lifecycle |
| `src/scene/CameraRig.js` | core/app | Camera setup & mode toggles |
| `src/scene/TerrainMeshBuilder.js` | domain/app | Build/update height mesh |
| `src/scene/TerrainRebuilder.js` | app | Debounced terrain mesh refresh |
| `src/scene/Token3DAdapter.js` | app | Wrap token creation into 3D handles |
| `src/scene/PlaceableMeshPool.js` | app | Instanced placeable management |
| `src/scene/PickingService.js` | app | Raycast → grid/token/placeable |

---
## 5. Refactor Touch Map
| Existing Area | Impact | Strategy |
|---------------|--------|----------|
| `CoordinateUtils.gridToIsometric` | Deprecated eventually | Wrap calls behind SpatialCoordinator early |
| `ProjectionUtils` | Removal target | Mark deprecated Phase 3; delete Phase 7 |
| `TokenManager` placement/positioning | Medium | Dual-write iso & world, then remove iso |
| `TerrainManager` placeables repositioning | High | Stop per-sprite Y adjustments once world set |
| `ElevationScaleController` | Medium | Switch to vertex height scaling |
| `DepthUtils` (zIndex) | Legacy overlay only | Replace with actual world depth ordering |

---
## 6. Testing Strategy Evolution
| Stage | Legacy Tests | New Tests |
|-------|--------------|-----------|
| 0 | All unchanged | `SpatialMapping.test` |
| 1 | All unchanged | Scene bootstrap smoke |
| 2 | Iso asserts tolerant (pixel ≈ projected world) | TerrainMesh vertex heights |
| 3 | Dual (iso + world) | Token3DAdapter sync |
| 4 | Placeable iso zIndex optional | Instancing lifecycle |
| 5 | Remove strict iso depth tests | Lighting config presence |
| 6 | Interaction: replace iso pick tests | PickingService ray grid mapping |
| 7 | Remove projection tests | World invariants only |
| 8 | Add shader/fog/time-of-day | Perf guards |

---
## 7. Risks & Mitigations
| Risk | Phase | Mitigation |
|------|-------|-----------|
| Grid/world drift | 0–2 | Centralized SpatialCoordinator + unit roundtrip tests |
| Performance regression (instancing) | 4 | Profiling & threshold gating |
| Shadow artifacts | 5 | Bias tuning & cascade option |
| Picking inaccuracies | 6 | Barycentric clamp + cell bounds check |
| Test brittleness | 2–3 | Tolerance-based comparisons, not exact px |
| Over-scope | All | Phase gates + feature flag per milestone |

---
## 8. Incremental Deliverables (Week-by-Week)
Week 1: Phase 0–1 (SpatialCoordinator + Three bootstrap + dev flag)  
Week 2: Phase 2 (height mesh) + partial Phase 3 (first billboard token)  
Week 3: Complete Phase 3; Phase 4 instancing; begin Phase 5 lighting  
Week 4: Phase 5–6 finalize; Phase 7 cleanup; backlog grooming for Phase 8  

---
## 9. Backlog (Polish & Advanced)
- Splat map biome blending
- Time-of-day light & sky gradient
- Ambient occlusion (baked or SSAO)
- Particle weather (rain, snow)
- Token mesh replacement (animated glTF)
- Fog-of-war shader (mask texture)
- Dice physics (Rapier integration)
- Selection outline postprocess

---
## 10. Immediate Action Items (Phase 0)
- [x] Decide tile world size constant & elevation world scalar (defaults accepted: 1.0 tile, 0.5 elev)
- [x] Implement `SpatialCoordinator` skeleton + tests (`SpatialMapping.test.js`)
- [x] Inject into `GameManager` (no visual change)
- [x] Refactor token placement to store `token.world` (grid-derived)
- [x] Add dev flag `gameManager.renderMode`

### 10A. Early Phase 1 Tasks (Bootstrap)
- [x] Stub `ThreeSceneManager` (scene, camera, renderer guarded) + unit test
- [x] Hook minimal grid plane (base world reference)
- [x] Add camera rig abstraction
- [x] Expose hybrid toggle dev hook (`gameManager.enableHybridRender()`) (UI pending)
- [x] Metrics: log degraded vs ready init state (`getRenderStats`, global snapshot)

### 10B. Phase 2 (Terrain Mesh) - Progress & Remaining
Completed:
- [x] Scaffold `TerrainMeshBuilder` (flat heightfield geometry)
- [x] Add `TerrainRebuilder` debounced wrapper
- [x] Integrate mesh build on hybrid enable (initial mesh)
- [x] Hook rebuild trigger after terrain edits (height change events)
- [x] Vertex height propagation test (multi-cell pattern -> geometry Y verification)
- [x] Rebuild on grid resize hook
- [x] Rebuild duration metrics (perf timing around builder) -> `window.__TT_METRICS__.terrain.lastRebuildMs`
- [x] Brush → coordinator change detection (applyAt returns modified flag)
- [x] Basic material/color pipeline placeholder (`TerrainMaterialFactory` returning MeshStandardMaterial)

### 10C. Phase 3 (Token Billboards) - Progress (COMPLETED)
Completed:
- [x] Add `Token3DAdapter` scaffold (creates simple billboard plane per token, dynamic import)
- [x] Integrate adapter activation in `GameManager.enableHybridRender()` (sync existing tokens)
- [x] Hook into token placement pipeline to call `token3DAdapter.onTokenAdded` when new tokens placed
- [x] Add minimal test: creating a token in hybrid mode schedules/creates 3D mesh (mock / injected three stub)
- [x] Disposal path (removing token removes mesh + GPU resource disposal)
- [x] Sprite texture → plane material mapping (extract PIXI baseTexture -> Three.Texture with fallback)
- [x] Facing direction sync (flip billboard horizontally via mesh.scale.x for now)
- [x] Consolidated per-mesh + facing polling callbacks into a single unified frame callback (performance + simplicity)
- [x] Added regression test ensuring no vertical drift for token across repeated projection toggles
 - [x] Terrain rebuild performance guard test (threshold + metrics presence)

In Progress / Next (spun into Phase 5 polish backlog):
- [ ] Refine token facing implementation (UV flip/shader; event-driven)
- [ ] Remove DoubleSide materials once facing refined
- [ ] Expand mesh limitations & smoothing strategy documentation

Deferred:
- Animation frame extraction / animated textures (Phase 5+ when we revisit lighting & materials)
- Replace billboard with proper mesh per token model (Phase 5/8)
- [ ] (Optional) Vertex normal smoothing / interpolation prototype (depends on terrain chunking)

Deferred / Research:
- Token height influence on mesh tessellation
- LOD / chunk partition evaluation (quadtree / clipmap vs monolithic mesh)
- Splat map & biome-driven material layering (Phase 8 candidate)

Mesh Limitations (initial list):
- Single monolithic geometry; full rebuild on any edit (acceptable for small grids now)
- No normal smoothing across large elevation deltas (faceted look)
- Flat color material; no biome tint or texture blending yet
- No spatial partition for culling (scene size currently trivial)
- Rebuild debounce (120ms) may feel laggy for rapid strokes; tune later

Future Smoothing Strategy (Draft):
- Optional smoothing kernel (3x3) applied to a staging buffer when user enables "smooth" mode
- Preserve original unsmoothed heights for reversibility
- Manual normal recompute only for affected region (later chunking) to avoid full mesh normal cost

### 10D. Phase 4 (Placeable Instancing) - Progress
Completed:
- [x] `PlaceableMeshPool` scaffold (instanced quads grouped by variant key)
- [x] Metrics via `window.__TT_METRICS__.placeables` (groups, liveInstances)
- [x] Add/remove lifecycle with free index recycling
- [x] Unit test: pool add/remove + metrics
- [x] Feature flag integration (`gameManager.features.instancedPlaceables`) wiring into existing placeable placement/removal path
- [x] End-to-end integration test (flag-enabled) validating metrics increment/decrement
- [x] Terrain height sampling -> Y world placement (`worldY = height * elevationUnit`)
- [x] Height mapping test (`PlaceableMeshPoolHeight.test.js`)
- [x] Deterministic async handling: tracking pending instancing promises + `gameManager.flushInstancing()` utility for tests

In Progress / Next:
- [x] Capacity growth (auto-expand: double strategy) + metric (implemented in `_tryExpandGroup`)
- [ ] Explicit warning/log on capacity expansion & when max reached
- [ ] Per-variant / per-type material strategy (color tint, alpha from biome/type)
- [ ] Frustum/visibility hook (skip hidden groups when scene grows)
- [ ] Refine vertical sampling (corner averaging / interpolation vs center sample) if visual popping observed
- [ ] Documentation: migrate remaining references to legacy zIndex tuning once meshes fully replace sprites
- [ ] Per-instance metadata map (index -> {gx, gy}) to enable true height resync
- [ ] Implement `resyncHeights()` using stored metadata after terrain edits

Deferred:
- GPU texture atlas for placeable quads (Phase 5/6 candidate)
- Distance-based LOD swap (Phase 8 polish)
- Mesh (non-quad) upgrades for larger structures (Phase 8)

Risks / Notes:
- Current pool still fixed at 256 until growth implemented (silent -1 allocation returns null; will add explicit warning)
- Height currently sampled at tile center only (may cause sharp steps on steep transitions)
- Materials still using flat `MeshBasicMaterial` placeholder (no lighting yet)


---
## 11. Open Questions
| Question | Notes | Owner |
|----------|-------|-------|
| Should elevation allow fractional levels? | Needed for smooth ramps? | TBD |
| Keep support for top-down 2D mode post-migration? | Could project from 3D camera | TBD |
| Asset pipeline for 3D models | FBX→glTF conversion script | TBD |

---
## 12. Change Log
| Date | Change | Author |
|------|--------|--------|
| INITIAL | Document created on branch `feature/3d-transition` | system |
| 2025-09-25 | Phase 2: terrain mesh integration (rebuild hooks, metrics, vertex test, resize trigger) | system |
| 2025-09-25 | Added TerrainMaterialFactory placeholder & updated plan with limitations | system |
| 2025-09-25 | Phase 3 additions: performance guard test & PlaceableMeshPool scaffold (instancing groundwork) | system |
| 2025-09-25 | Phase 4 integration: feature flag wiring, instanced placement/removal, height-based Y placement, async flush util & tests | system |
| 2025-09-26 | Phase 3 partial: Token3DAdapter, texture mapping, facing sync, callback consolidation, drift regression test | system |
| 2025-09-26 | Added minimal grid plane & dev hybrid toggle hook | system |
| 2025-09-26 | Camera iso yaw/pitch setters + reframe heuristic; token vertical bias & resync integration | system |
| 2025-09-26 | Capacity growth logic for instanced placeables; plan updated with next metadata & resync tasks | system |
| 2025-09-26 | Integrated PickingService into GameManager (ground plane hover replaces ad-hoc ray logic) + added PickingService unit test | system |

---
## 14. Immediate Next Step (Execution Focus)
Objective: Enable accurate placeable height resynchronization after terrain edits.

Tasks:
1. Extend `PlaceableMeshPool` to store per-instance metadata (index -> { gx, gy }) when adding a placeable.
2. Update `removePlaceable` to clear metadata entry for freed index.
3. Implement real `resyncHeights()`:
	- Iterate active indices (exclude freeIndices) and recompute Y using `getTerrainHeight(gx, gy) * elevationUnit`.
	- Reuse a single `Object3D` dummy for matrix update to avoid allocations.
4. Hook `placeableMeshPool.resyncHeights()` into `GameManager.notifyTerrainHeightsChanged()` after token resync (guard if pool exists).
5. Add metrics counter: `__TT_METRICS__.placeables.lastResyncCount` and optional `lastResyncMs` timing.
6. Add unit test: create N placeables, mutate terrain heights, invoke notify, assert updated matrix Y values differ accordingly.

Acceptance Criteria:
- Metadata map persists across capacity expansions (migrate old entries on grow).
- Height Y of at least two modified placeables changes after terrain edit & notify.
- No regression in existing instancing metrics (groups, liveInstances, capacityExpansions).

Stretch (optional if time permits):
- Warn (console.debug) when a resync processed > 500 instances (future perf flag threshold).

---
## 15. Upcoming Capability Transfer (2D -> 3D Parity Roadmap)
The following sub-phases describe migrating remaining 2D-only interactions and features into the hybrid 3D environment.

### A. Core Parity (Already Active / Just Landed)
- [x] Token billboard creation on placement (`Token3DAdapter.onTokenAdded`).
- [x] Terrain mesh rebuild + token/instanced placeable height resync on edits (`notifyTerrainHeightsChanged`).
- [x] Biome generation now triggers 3D rebuild + resync (added hook).

### B. Interaction Layer (Phase 6 Expansion)
1. 3D Picking & Grid Raycast
	- Introduce `PickingService` (listed in Module Additions) with methods:
	  - `raycastGrid(screenX, screenY)` -> { gridX, gridY, hitPoint }
	  - `raycastTokens(screenX, screenY)` -> token reference list (nearest first)
	- Basis: unproject NDC -> ray; intersect with XZ plane (y=0) or terrain mesh bounding plane first; clamp to board extents.
2. Direct Token Placement in 3D
	- New helper `placeTokenAtPointer(screenX, screenY, creatureType)` bridging to existing token manager.
	- Preserves 2D pipeline logic (still uses `addTokenToCollection`) ensuring single source of truth.
3. Token Selection & Hover Highlight
	- Material tint or additive outline (initial implementation: clone material color multiply; later postprocess outline).
	- Maintain `gameManager.selectedToken` in sync with 2D selection state.
4. Drag / Reposition in 3D
	- On mousedown over token: capture; while moving: continuously raycast ground, update token grid (snap) & mesh position.
	- Debounce world ↔ grid snapping to avoid jitter (snap only when crossing half-tile threshold).
5. Camera Interaction Refinements (optional early)
	- Middle-mouse pan & scroll zoom integrated with existing 2D constraints.

### C. Elevation & Terrain Enhancement
1. Elevation Exaggeration Slider in 3D
	- Scales vertex Y after mesh rebuild; token & placeable Y derived from scaled heights (consistent view).
2. Smooth Height Preview
	- Optional sampling of 3x3 neighborhood for preview cursor (does not alter stored heights).

### D. Placeable & Instancing Parity
1. 3D Placement Mirroring 2D Panel
	- When a placeable is selected in UI, 3D hover ghost mesh / marker at raycast cell.
2. Removal Mode in 3D
	- Raycast cell -> remove matching instance(s) (metadata lookup by {gx, gy}).
3. Metadata Completion
	- Ensure every instanced index stores { gx, gy, variant } for fast height resync & selection.

### E. Visual Feedback & Polish
1. Selection Outline (postprocess or simple mesh clone scale *1.05 with emissive color).
2. Token Elevation Ghost
	- When dragging across height steps show a subtle vertical line or shadow projection for spatial clarity.
3. Terrain Cursor in 3D
	- Single transparent ring or tile wireframe sized to current brush (for future terrain edit-in-3D mode).

### F. Performance & Stability Milestones
1. Raycast Budget Guard
	- Track per-frame raycast count; warn if > N (configurable, default N=8).
2. Token & Placeable Bounds Culling (frustum test once per few frames; hide off-screen groups).
3. Async Terrain Chunking (future: partition mesh into quads; rebuild only dirty patch on edits).

---
## 16. Near-Term Implementation Queue (Actionable Tickets)
Priority order (top = next to implement):
1. Token placement via 3D pointer (`placeTokenAtPointer`) using PickingService.
2. Token hover/selection tint (material color multiply; revert on deselect).
3. Drag-to-move tokens (snap logic + world/grid sync) — IMPLEMENTED (pending dedicated tests).
4. Instanced placeable metadata map + resyncHeights real implementation (ties into existing Immediate Next Step #14 tasks 1–3).
5. Height exaggeration slider wiring (updates TerrainMeshBuilder scale factor + rebuild).
6. Brush / hover ghost for placeable placement (enhance current preview with validity coloring).
7. Basic performance telemetry: raycasts/frame + selection updates/frame -> `__TT_METRICS__.interaction`.
8. Register additional pick layers (tokens, placeables) via `pickingService.registerLayer`.

Acceptance metrics to add:
- `__TT_METRICS__.interaction.raycastsPerFrame (EMA)`
- `__TT_METRICS__.interaction.lastPickMs`
- `__TT_METRICS__.interaction.lastTokenDragGrid` {from,to}

---
## 17. Definition of Done for 3D Parity (Pre-Polish)
A session can be run entirely in 3D mode with:
1. Creating, selecting, dragging, and deleting tokens without switching back to 2D.
2. Generating a biome-based map that immediately updates 3D terrain & token elevations.
3. Placing / removing placeables in 3D with correct height and resync after terrain edits.
4. Camera pitch/yaw adjustable + isometric preset stable (52°) matching 2D grid perception baseline.
5. All grid/world conversions validated by tests (roundtrip within <= 0.01 world units tolerance).
6. No critical performance regressions: (a) terrain rebuild under threshold, (b) raycasts/frame under budget.

Post-DoD shifts project from “Transition” to “Enhancement / Polish” (Phase 8).

After completion, update this plan (Section 10D progress + Change Log) and then proceed to precise frustum fit (project 4 grid corners) as the following step.

---
## 13. Maintenance Notes
- Update phase tables as each completes; do not delete previous rows—append status.
- Keep decisions immutable unless new row added with supersede note.
- Add test references when a phase lands (file paths).

