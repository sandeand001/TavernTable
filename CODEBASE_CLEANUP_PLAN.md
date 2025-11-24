# TavernTable Full-Codebase Cleanup Plan (Phase 0)

_Last updated: 2025-11-24_

This document captures the Phase 0 survey of the TavernTable codebase, highlights duplication/logging hotspots, and proposes a multi-branch execution plan for the behavior-preserving refactor initiative. All downstream phases must keep external interfaces and behavior unchanged.

---

## Repository Map & Key Modules

| Module | Purpose | Notable Files |
| --- | --- | --- |
| `src/core/` | Runtime singletons and global services | `GameManager.js` (~53 KB), `ModelAssetCache.js` (~37 KB) |
| `src/coordinators/` | Glue between subsystems (input, rendering, state, terrain) | `TerrainCoordinator.js` (~38 KB) with `terrain-coordinator/` internals fan-out |
| `src/managers/` | Feature-specific managers for tokens, terrain, grids, and interactions | `terrain-manager/internals/*.js` (4×1k+ LOC utilities), `InteractionManager.js` (~38 KB) |
| `src/scene/` | Three.js orchestration and rendering helpers | `Token3DAdapter.js` (7,308 LOC / ~238 KB), `ThreeSceneManager.js` (~90 KB), `TerrainBrushOverlay3D.js` (~803 LOC) |
| `src/terrain/` | Terrain painting, brushes, data stores, shading | `BiomeCanvasPainter.js` (1,135 LOC / ~39 KB), `TerrainBrush*` trio |
| `src/systems/dice/` | Dice logic (both 2D + 3D) | `dice3d.js` (~55 KB) duplicates movement/physics helpers |
| `src/ui/` | Sidebar + controller wiring | `UIController.js` (~26 KB), `SidebarController.js` (~24 KB) |
| `src/utils/` | Shared helpers | `Logger.js` (~24 KB), `ErrorHandler.js`, `TerrainHeightUtils.js`, `CoordinateUtils.js` |
| `assets/` & `docs/` | Art + extensive design docs | Keep untouched except for reference |

### Observed "God" / Oversized Files

| File | Approx Size | Notes |
| --- | --- | --- |
| `src/scene/Token3DAdapter.js` | 237.7 KB (7,308 LOC) | Handles asset lookup, animation graphs, placement, highlighting, physics fallbacks, and logging in one unit.
| `src/scene/ThreeSceneManager.js` | 89.5 KB | Mixes renderer bootstrap, resize handling, animation loop, and event plumbing.
| `src/systems/dice/dice3d.js` | 55.5 KB | Contains math helpers, GLTF loading, animation states, and UI bridging; shares logic with `systems/dice/dice.js`.
| `src/managers/terrain-manager/internals/placeables.js` | 54.8 KB (1,511 LOC) | Duplicates placement math from `PlaceableMeshPool`, handles async model cache wiring, and logging.
| `src/core/GameManager.js` | 52.8 KB | Orchestrates state, event routing, subsystem instantiation; partially overlaps with `StateCoordinator`.
| `src/terrain/BiomeCanvasPainter.js` | 39 KB (1,135 LOC) | Contains rendering math, noise helpers, palette logic that overlaps with `terrain/biome-painter/*` + `scene/TerrainMaterialFactory.js`.
| `src/scene/TerrainBrushOverlay3D.js` | 24.4 KB (803 LOC) | Rendering + pooling logic duplicated from brush highlighter + `PlaceableMeshPool`.

These files are principal candidates for targeted splits rather than wholesale rewrites.

---

## Promising Deduplication Targets

1. **Terrain Brush Stack** (`terrain/TerrainBrushController.js`, `terrain/TerrainBrushHighlighter.js`, `scene/TerrainBrushOverlay3D.js`)
   - Repeated brush footprint math, highlight styling, and default color definitions.
   - Opportunity: single `terrain/brush` helper module exposing normalized brush state, footprint calculation, and shared palette so 2D highlighter + 3D overlay stay in sync.

2. **Terrain Rendering & Shading** (`terrain/BiomeCanvasPainter.js`, `terrain/biome-painter/*.js`, `scene/TerrainMaterialFactory.js`, `terrain/ShadingHelpers.js`)
   - Multiple bespoke noise/gradient functions (`_valueNoise2D`, `_noise01`, slope/aspect computations) that are near-identical.
   - Opportunity: extract deterministic noise + slope/aspect helpers into `terrain/shading-utils.js`, referenced by both painter + material factory to cut duplicate math.

3. **Placeable/Token Asset Instantiation** (`managers/terrain-manager/internals/placeables.js`, `scene/PlaceableMeshPool.js`, `scene/Token3DAdapter.js`, `core/ModelAssetCache.js`)
   - Async asset acquisition, baseline offset detection, and material cloning reimplemented in each file.
   - Opportunity: shared `scene/asset-loading/` helpers to funnel through `ModelAssetCache` and unify baseline caching + material cloning.

4. **Dice Systems** (`systems/dice/dice.js` vs `systems/dice/dice3d.js`)
   - Movement easing, randomization seeds, and logging duplicates; 3D version inlines 2D math.
   - Opportunity: shared dice math/util module with deterministic seeds + logging stub to keep both variants aligned.

5. **Config Data Explosion** (`config/TerrainPlaceables.js`, `terrain/biome-painter/style.js`, `terrain/TerrainBrushHighlighter.js`)
   - Color constants & mappings repeated. Introduce `config/VisualThemes.js` or extend `BiomePalettes` to store canonical colors.

---

## Logging Hotspots

`Select-String` scan surfaced 63 direct `console.*` calls in `src/`. Concentrated files:

| File | Count | Notes |
| --- | --- | --- |
| `src/core/ModelAssetCache.js` | 11 | Mixes INFO + ERROR logs for cache misses; some redundant due to upstream logger usage.
| `src/utils/Logger.js` | 10 | Console bridging inside logger itself; expected but ensure only error-path logging stays.
| `src/managers/terrain-manager/internals/placeables.js` | 10 | Detailed trace logs for placement; many are dev-only and duplicate logger output.
| `src/systems/dice/dice3d.js` | 10 | Verbose physics tracing + animation state logs.
| `src/scene/PlaceableMeshPool.js` | 7 | Warmup + disposal logs; duplicates `placeables.js` info.
| `src/scene/Token3DAdapter.js` | 4 | Token spawn/debug traces sprinkled through 7k LOC file.
| `src/scene/ThreeSceneManager.js` | 4 | Resize + capability detection logs.
| `src/terrain/TerrainBrushController.js` | via `logger.log` | Aggregated brush stroke debug logs toggled by `window.DEBUG_TERRAIN_TRACE`.

Goal: retain error/warning logs tied to user-facing issues or external contracts; demote dev traces to optional hooks (e.g., `logger.isDebugEnabled()` guard) or remove.

---

## Phase & Branch Plan

### Phase 1 – Shared Utilities & Logging Hygiene

1. **Branch `phase1-terrain-brush-foundation`**
   - **Scope:** `terrain/TerrainBrushController.js`, `terrain/TerrainBrushHighlighter.js`, `scene/TerrainBrushOverlay3D.js`, `terrain/brush/` (new helper directory).
   - **Goals:**
     - Introduce shared brush state helper (color constants, footprint math, bounds guards).
     - Split `TerrainBrushOverlay3D` into renderer vs. pooling modules (~400 LOC each) for readability.
     - Ensure both 2D highlighter + 3D overlay consume same helper to remove duplicated constants.
   - **Can run parallel with:** logging cleanup branch.
   - **Risks/tests:** manual terrain editing at multiple brush sizes, regression on hover previews, verify render order vs. tokens.

2. **Branch `phase1-logging-trim-core`**
   - **Scope:** `core/ModelAssetCache.js`, `managers/terrain-manager/internals/placeables.js`, `systems/dice/dice3d.js`, `scene/PlaceableMeshPool.js`, `utils/Logger.js` (console bridging only).
   - **Goals:**
     - Remove raw `console.*` statements that duplicate structured logger output.
     - Gate remaining logs behind logger level checks or feature flags.
     - Ensure `Logger` only emits required console output (errors) and document how to enable verbose tracing via config/env instead.
   - **Dependencies:** None, but coordinate with Phase 2 asset refactors to avoid conflicts.
   - **Risks/tests:** dice roll flows, placeable placement/removal, asset cache warmup. Ensure no behavior change when logging disabled.

### Phase 2 – Terrain & Placeable Consolidation

3. **Branch `phase2-terrain-shading-utils`**
   - **Scope:** `terrain/BiomeCanvasPainter.js`, `terrain/biome-painter/*.js`, `terrain/ShadingHelpers.js`, `scene/TerrainMaterialFactory.js`.
   - **Goals:**
     - Extract shared noise/slope/aspect helpers into `terrain/shading-utils.js`.
     - Trim duplicated palette/style lookup logic by centralizing in `config/BiomePalettes.js` (add narrow helper functions only).
     - Reduce `BiomeCanvasPainter` by 20–25% LOC through helper extraction without touching rendering semantics.
   - **Order:** start after Phase 1 brush helper lands (to avoid parallel large file edits with overlay work).
   - **Risks/tests:** rerun painter integration tests (if available), manual biome painting with varied seeds, inspect coverage reports for `BiomeCanvasPainter`.

4. **Branch `phase2-placeable-asset-pipeline`**
   - **Scope:** `managers/terrain-manager/internals/placeables.js`, `scene/PlaceableMeshPool.js`, `core/ModelAssetCache.js`, `scene/Token3DAdapter.js` (asset-loading segments only).
   - **Goals:**
     - Create shared asset loading + baseline offset helper (likely `scene/assets/AssetLoader.js`).
     - Deduplicate material cloning + tree variant selection logic.
     - Ensure `ModelAssetCache` exposes a minimal interface used by both placeables + tokens.
   - **Dependencies:** Should follow `phase1-logging-trim-core` (since same files touched) and coordinate with Token refactor branch.
   - **Risks/tests:** spawn/remove diverse placeables, reload scenes with cached assets, regression on tree baseline alignment.

### Phase 3 – Token/Scene Modularization & Dice Utilities

5. **Branch `phase3-token-adapter-split`**
   - **Scope:** `scene/Token3DAdapter.js`, `scene/ThreeSceneManager.js`, `managers/token-manager/`, `core/AnimatedSpriteManager.js` (integration points).
   - **Goals:**
     - Break `Token3DAdapter` into focused modules (asset config, animation graph, scene syncing, highlighting) while keeping API stable.
     - Extract animation profile constants to `config/token-animations.js` for reuse/testing.
   - **Dependencies:** After placeable pipeline branch (shared asset helpers needed).
   - **Risks/tests:** token spawn/despawn, animation transitions, rotation/facing parity with 2D tokens, performance (FPS) checks.

6. **Branch `phase3-dice-shared-math`**
   - **Scope:** `systems/dice/dice.js`, `systems/dice/dice3d.js`, `utils/Random.js` (new), `systems/dice/d20FaceCenters.generated.js` (read-only reference).
   - **Goals:**
     - Factor shared math/randomization/logging into a new helper module consumed by both dice systems.
     - Remove duplicate physics easing code while preserving RNG seeds for deterministic tests.
   - **Dependencies:** Logging cleanup (Phase 1) should be merged first to avoid conflicts.
   - **Risks/tests:** run dice unit tests, confirm deterministic face results, manual UI dice roll.

---

## Additional Notes & Recommendations

- **Testing cadence:** After each branch merge, run `npm run test` plus targeted manual flows (terrain edit, dice roll, token drag) to guarantee parity.
- **Doc sync:** Update this plan after each phase to record completed work and adjust future scopes.
- **Speculative refactors:** If deeper architectural changes emerge (e.g., replacing Three.js scene manager), capture them as TODOs rather than coding during this cleanup effort.

Phase 0 deliverable complete. Await confirmation before beginning Phase 1 code changes.
