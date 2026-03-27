# TavernTable — Refactor Roadmap

> **Purpose**: Track progress on the codebase cleanup and refactor.
> Mark each task `[x]` when complete. Each phase ends with a **GATE** — a manual check before proceeding.

---

## Codebase Snapshot (Pre-Refactor)

| Metric                        | Value                                    |
|-------------------------------|------------------------------------------|
| Source files                  | 110+ in `src/`                           |
| Files over 900 lines          | 13                                       |
| Largest file                  | `Token3DAdapter.js` — 6,619 lines        |
| Pixi.js 2D code              | Intertwined across terrain, grid, sprites |
| Obsolete creature types       | 9 (everything except mannequin)          |
| Legacy 2D sprite assets       | 10 PNGs in `assets/sprites/`             |
| Legacy 2D plant PNGs          | 14 dirs in `assets/terrain/plants/trees/` |
| Functional 3D asset library   | `assets/terrain/3d Assets/` (glTF, FBX)  |

---

## Phase 1 — Dead Code & Config Cleanup · `LOW RISK`

**Goal**: Remove unused creature types, dead config, and orphaned code.

- [x] Delete `src/config/SpriteOffsets.js` (no imports found)
- [x] Strip 9 old creature types from `CREATURE_SCALES` in `GameConstants.js` (keep mannequin only)
- [x] Strip 9 old creature types from `CREATURE_BASELINE_OFFSETS` in `GameConstants.js`
- [x] Strip 9 old creature types from `CREATURE_COLORS` in `GameConstants.js`
- [x] Remove `CREATURE_SPRITE_FILE_OVERRIDES` entries for deleted creatures
- [x] Remove old factory functions (`createDragon`, `createBeholder`, etc.) from `entities/creatures/index.js`
- [x] Remove old creature imports/exports from `entities/creatures/index.js`

**GATE**: `npm test` passes · mannequin token works in browser

- [x] **GATE PASSED** — committed as: `4f4fd6e`

---

## Phase 2 — 2D Asset Cleanup · `LOW RISK`

**Goal**: Delete legacy 2D image assets and their config references.

- [x] Delete creature sprite PNGs from `assets/sprites/` (keep `X Bot.fbx`)
- [x] Delete legacy 2D plant/tree PNG directories from `assets/terrain/plants/trees/` (14 subdirectories)
- [x] Remove `path-dirt`, `path-stone`, `structure-crumbling-brick` entries from `TerrainPlaceables.js`
- [x] Remove `assets/terrain/paths/` directory (2D path tiles)
- [x] Remove `assets/terrain/structures/` directory (2D structure tiles)

**GATE**: `npm test` passes · biome generation works · 3D placeables render

- [x] **GATE PASSED** — committed as: `eec3eaa`

---

## Phase 3 — Pixi.js Divorce: Utilities · `MEDIUM RISK`

**Goal**: Remove pure-Pixi utility files and replace their usages.

- [x] Delete `src/utils/PixiShapeUtils.js`
- [x] Replace `traceDiamondPath()` calls in:
  - [x] `managers/GridRenderer.js`
  - [x] `managers/TerrainManager.js`
  - [x] `coordinators/terrain-coordinator/BiomeShadingController.js`
  - [x] `coordinators/terrain-coordinator/ElevationVisualsController.js`
  - [x] `coordinators/terrain-coordinator/internals/baseGridUpdates.js`
- [x] Delete `src/utils/TerrainPixiUtils.js`
- [x] Replace `safeRemoveFromContainer()` / `safeDestroyPixiObject()` / `resetContainer()` calls in:
  - [x] `managers/terrain-manager/internals/tiles.js`
  - [x] `managers/terrain-manager/internals/container.js`
  - [x] `coordinators/terrain-coordinator/internals/container.js`

**GATE**: `npm test` passes · grid rendering works · terrain tile lifecycle intact

- [x] **GATE PASSED** — committed as: `131abd9`

---

## Phase 4 — Pixi.js Divorce: Dead Sprite Systems · `HIGH RISK`

**Goal**: Remove dead PIXI sprite-loading systems; simplify creature token pipeline.

> **Scope adjusted**: Deep analysis revealed PIXI is still the active rendering engine
> for the 2D isometric grid, terrain tiles, containers, and overlays. Three.js renders
> 3D models (creatures, plants, terrain mesh) on top. Full PIXI removal requires
> replacing the entire grid/terrain rendering pipeline — deferred to a future phase.
> This phase removes confirmed-dead sprite managers and simplifies creature tokens.

- [x] Delete `core/SpriteManager.js` — zero callers; creature sprites bypassed by Token3DAdapter
- [x] Delete `core/AnimatedSpriteManager.js` — zero callers; dragon removed in Phase 1
- [x] Simplify `coordinators/StateCoordinator.js` — remove spriteManager init logic
- [x] Refactor `entities/creatures/CreatureToken.js` — remove PIXI.Sprite paths, use fallback graphics only
- [x] Remove SpriteManager `<script>` tag from `index.html`
- [ ] ~~Refactor `coordinators/RenderCoordinator.js`~~ — **deferred** (PIXI.Application still creates the 2D canvas)
- [ ] ~~Refactor `managers/GridRenderer.js`~~ — **deferred** (PIXI grid is the active 2D renderer)
- [ ] ~~Refactor `managers/TerrainManager.js`~~ — **deferred** (PIXI tiles still render terrain overlays)
- [ ] ~~Refactor `managers/terrain-manager/internals/placeables.js`~~ — **deferred** (legacy 2D fallback only)
- [ ] ~~Remove Pixi.js CDN from `index.html`~~ — **deferred** (still needed for grid/terrain/containers)

**GATE**: Full `npm test` · manual browser regression (grid, terrain, tokens, biomes)

- [x] **GATE PASSED** — committed as: `932b93c`

---

## Phase 5 — Segment `Token3DAdapter.js` (6,619 lines → 5 files) · `MEDIUM RISK`

**Goal**: Break the largest file into focused modules.

> **Pre-existing bug fixed**: `_createForwardMovementStep` used stale `gridX/gridY` to
> determine the token's current tile for fall detection. During free movement `gridX/gridY`
> is never updated, so tokens 2+ tiles from the cliff edge would check the wrong tile and
> skip the fall animation. Fixed by deriving the current tile from `tokenEntry.world` (which
> IS updated during free movement) and falling back to `gridX/gridY` when world is unavailable.
> Bug predated all refactor phases (reproduced on pre-refactor baseline `714643c`).

- [x] **Fix pre-existing fall detection bug** — derive current tile from world position in `_createForwardMovementStep`
- [x] Extract `scene/token-adapter/MannequinConfig.js` (298 lines) — model defs, animation library, constants
- [x] Extract `scene/token-adapter/AnimationController.js` (864 lines) — clip loading, retargeting, mixer control
- [x] Extract `scene/token-adapter/SelectionEffects.js` (349 lines) — hover/selection indicators, orientation, facing
- [x] Extract `scene/token-adapter/MeshFactory.js` (540 lines) — billboard/3D token creation, FBX loading, tinting
- [x] Slim `Token3DAdapter.js` to orchestrator (5,484 lines) importing above via mixin pattern
- [x] Verify all existing imports of `Token3DAdapter` still work (re-exports preserve API)

> Remaining movement polish items tracked in `TODO.md`.

**GATE**: `npm test` passes · token placement, animation, selection work in browser · **fall animations trigger reliably on all elevation drops**

- [x] **GATE PASSED** — committed as: `b764d55`

---

## Phase 6 — Segment `ThreeSceneManager.js` (2,612 lines → 4 files) · `MEDIUM RISK`

**Goal**: Separate camera, lighting, and grid overlay into own modules.

- [x] Extract `scene/scene-manager/CameraSystem.js` (627 lines) — iso mode, zoom, pitch, frustum, reframe, calibration
- [x] Extract `scene/scene-manager/LightingSystem.js` (731 lines) — sun cycle, color math, time-of-day profiles, terrain/placeable lighting
- [x] Extract `scene/scene-manager/GridOverlay.js` (354 lines) — grid overlay, brush preview, style stack, visibility toggles
- [x] Slim `ThreeSceneManager.js` to orchestrator (982 lines) importing above via mixin pattern

**GATE**: `npm test` passes · camera, lighting, grid overlay work in browser

- [x] **GATE PASSED** — committed as: `8194749`

---

## Phase 7 — Segment `dice3d.js` (1,770 lines → 6 files) · `MEDIUM RISK`

**Goal**: Modularize the d20 system.

> **Round 1** (commit `867aa8b`): Extracted pure physics/collision functions.
> **Round 2**: Introduced `DiceState.js` shared-state object to unlock the remaining
> extractions — model management, animation scheduling, and face calibration UI.

- [x] Extract `systems/dice/DicePhysics.js` (449 lines) — collision, ricochet, vector math, path building
- [x] Extract `systems/dice/DiceState.js` (246 lines) — shared mutable state, constants, board/geometry utilities
- [x] Extract `systems/dice/DiceModelManager.js` (173 lines) — model loading, material tuning, blueprint cache
- [x] Extract `systems/dice/DiceAnimationScheduler.js` (364 lines) — roll animation, snap-to-board, ground sampling
- [x] Extract `systems/dice/FaceCalibrationUI.js` (331 lines) — calibration UI, pointer handling, window globals
- [x] Slim `dice3d.js` to 238 lines (orchestration core: playD20RollOnGrid, clearActiveDie, accent lights)

**GATE**: `npm test` passes · d20 roll works in browser

- [x] **GATE PASSED** — round 1 committed as: `867aa8b`

---

## Phase 8 — Secondary File Segmentation · `MEDIUM RISK`

**Goal**: Break down remaining 900+ line files into manageable modules.

- [x] `BiomeElevationGenerator.js` (1,048 → 969) → `terrain/NoisePrimitives.js` (85 lines)
- [x] `flora.js` (1,149 → 321) → `terrain-coordinator/internals/FloraProfiles.js` (842 lines)
- [x] `InteractionManager.js` (1,257 → 1,042) → `interaction-manager/internals/keyboard.js` (128 lines)
- [x] `ModelAssetCache.js` (1,027 → 704) → `core/ModelPostProcessing.js` (321 lines)
- [x] `placeables.js` (1,507 → 991) → `placeables-positioning.js` (152 lines) + `placeables-sprite.js` (387 lines)
- [x] `PlaceableMeshPool.js` (1,072 → 765) → `scene/PlaceablePoolLifecycle.js` (319 lines)
- [ ] ~~`BiomeCanvasPainter.js` (1,083)~~ — **deferred** (tightly coupled class internals; already delegates to biome-painter/motifs.js)

*Note: `GameManager.js` (1,583 lines) is low priority — already well-structured via coordinator pattern.*

**GATE**: Full `npm test` pass

- [x] **GATE PASSED** — committed as: `c1beed7`

---

## Phase 9 — Code Organization & Conventions · `MEDIUM RISK`

**Goal**: Establish consistent structure across the entire codebase per `CONVENTIONS.md`.

> See `CONVENTIONS.md` for the full specification: directory layout, in-file
> ordering, section comments, responsibility boundaries.

### 9A — Dead code & cleanup (done)
- [x] Delete `scene/ColorUtils3D.js` (zero importers — dead code)
- [x] Delete redundant `ID_TO_MODEL_KEY` from `placeables.js`
- [x] Extract 3D rotation → `interaction-manager/internals/rotation.js`
- [x] ~~Consolidate `validateContainerState()`~~ — not duplicated (skip)
- [x] Delete deprecated shim `managers/BiomeCanvasPainter.js` (9-line re-export)
- [x] Delete dead stub `terrain/ShadingHelpers.js` (3 lines, empty)
- [x] Delete empty directories: `core/model-cache/`, `scene/assets/`

### 9B — Directory restructuring (done)
Restructure flat directories per `CONVENTIONS.md` §5 target layout:

- [x] `config/` → split into `config/biome/`, `config/terrain/`
- [x] `scene/` → split into `scene/camera/`, `scene/lighting/`, `scene/grid/`, `scene/terrain/`, `scene/picking/`
- [x] `terrain/` → split into `terrain/generation/`, `terrain/painting/`, `terrain/brush/`
- [x] `ui/` → create `ui/controls/` for toggle/control files
- [x] `utils/` → split into `utils/canvas/`, `utils/color/`, `utils/coordinates/`, `utils/geometry/`, `utils/terrain/`
- [x] Move `FloraProfiles.js` from `terrain-coordinator/internals/` → `config/terrain/`
- [x] ~~Group `terrain-coordinator/internals/` (19 files)~~ — kept flat (files are small enough)
- [x] Update all import paths across the codebase

### 9C — In-file method grouping (done)
Apply `// ── Section ──` comments and reorder methods in **all files** per `CONVENTIONS.md` §2:

**Convention**: constructor → lifecycle → public API → event handlers → private helpers → accessors

**Large files (reorder + section comments):**
- [x] `InteractionManager.js` — constructor, event setup, mouse handlers, delegating methods, cleanup
- [x] `Token3DAdapter.js` — 22 domain sections (constructor/init, movement phases, animation, cleanup)
- [x] `ThreeSceneManager.js` — constructor/init, public API, delegating methods, cleanup
- [x] `placeables.js` — config/constants, tree helpers, model cache, placeItem, variant cycling, removal
- [x] `GameManager.js` — constructor, coordinator init, public API, event handlers, cleanup
- [x] `TerrainCoordinator.js` — constructor, lifecycle, public API, event handlers, private helpers
- [x] `TerrainManager.js` — constructor, lifecycle, public API, private helpers
- [x] `BiomeCanvasPainter.js` — constructor, lifecycle, public API, private helpers
- [x] `BiomeElevationGenerator.js` — constructor, generation API, noise helpers, private helpers
- [x] `SidebarController.js` — constructor, public API, event handlers, DOM helpers
- [x] `UIController.js` — constructor, public API, event handlers, DOM helpers

**Medium files (section comments only, no reorder needed):**
- [x] All `scene/` class files (CameraSystem, LightingSystem, GridOverlay, PickingService, etc.)
- [x] All `coordinators/terrain-coordinator/` controller files
- [x] All `managers/*/internals/` files
- [x] All `utils/` files with > 5 functions
- [x] All `systems/dice/` files
- [x] All `terrain/` files
- [x] All `config/` data files (TerrainPlaceables, FloraProfiles, BiomePalettes, etc.)
- [x] All `ui/` and `entities/` files
- [x] All `core/` files (ModelAssetCache, ModelPostProcessing)

**GATE**: `npm test` passes, `npm run lint` clean

- [x] **GATE PASSED** — committed as: `1eafbff` (9C), `52d00dd` (9A+9B)

---

## Phase 10 — Final Cleanup · `LOW RISK`

**Goal**: Polish — remove dead code, update docs, validate structure.

- [ ] Run `node tools/find-unused-exports.js` and remove dead exports
- [ ] Clean up any remaining debug/diagnostic files
- [ ] Update `README.md` to reflect new directory structure
- [ ] Verify `tools/` scripts are still relevant (remove obsolete ones)
- [ ] Final line-count audit — confirm no file exceeds ~800 lines (façades) or ~400 lines (internals)

**GATE**: Full `npm test` + manual browser smoke test

- [ ] **GATE PASSED** — committed as: _______________

---

## Phase 11 — Full PIXI Removal / Renderer Unification · `HIGH RISK`

**Goal**: Migrate all remaining PIXI.js rendering to Three.js, making Three.js the sole renderer.

> Deferred from Phase 4 — PIXI is still the active 2D rendering engine for the
> isometric grid, terrain tiles, containers, and overlays. This phase replaces
> the entire 2D pipeline with Three.js equivalents.

- [ ] Refactor `coordinators/RenderCoordinator.js` — remove `PIXI.Application`, Three.js-only canvas init
- [ ] Refactor `managers/GridRenderer.js` — replace PIXI.Graphics diamond tiles with Three.js plane geometry
- [ ] Refactor `managers/TerrainManager.js` — remove PIXI-specific tile/container creation
- [ ] Refactor `managers/terrain-manager/internals/tiles.js` — replace PIXI.Graphics tile factory with Three.js
- [ ] Refactor `terrain/BiomeCanvasPainter.js` — remove PIXI.Texture/Sprite canvas conversion
- [ ] Refactor `coordinators/terrain-coordinator/ElevationVisualsController.js` — replace PIXI.Graphics shadows
- [ ] Refactor `coordinators/terrain-coordinator/BiomeShadingController.js` — replace PIXI fill/draw calls
- [ ] Refactor `utils/ProjectionUtils.js` — replace PIXI.Graphics overlay
- [ ] Refactor `managers/terrain-manager/internals/placeables.js` — remove PIXI.Sprite legacy 2D fallback
- [ ] Refactor `entities/creatures/CreatureToken.js` — replace PIXI.Graphics handle with Three.js Object3D
- [ ] Refactor `utils/Validation.js` — remove `pixiApp()` validator
- [ ] Update `managers/InteractionManager.js` — replace any PIXI stage event delegation
- [ ] Remove PIXI.js CDN `<script>` from `index.html`
- [ ] Remove PIXI mock stubs from `tests/setup.js` and test files
- [ ] Full regression: grid, terrain, tokens, biomes, dice, camera, drag — all via Three.js only

**GATE**: Full `npm test` + complete manual browser regression

- [ ] **GATE PASSED** — committed as: _______________

---

## Completion

- [ ] **All 11 phases complete**
- Date completed: _______________
- Final test suite: ___ suites, ___ tests passing
