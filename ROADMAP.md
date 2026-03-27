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

## Phase 7 — Segment `dice3d.js` (1,770 lines → 2 files) · `MEDIUM RISK`

**Goal**: Modularize the d20 system.

> **Scope adjusted**: `dice3d.js` uses extensive shared mutable module state
> (`threeNamespace`, `blueprintPromise`, `activeDieState`, `faceCalibrationState`, etc.)
> which makes splitting model management, animation, and calibration into separate files
> risky. Only the pure physics/collision functions (zero state dependencies) were extracted.
> Further segmentation deferred to Phase 8 or later if state management is refactored.

- [x] Extract `systems/dice/DicePhysics.js` (449 lines) — collision, ricochet, vector math, path building
- [ ] ~~Extract `systems/dice/DiceModelManager.js`~~ — **deferred** (depends on 6 shared `let` vars)
- [ ] ~~Extract `systems/dice/DiceAnimationScheduler.js`~~ — **deferred** (tightly coupled to model + state)
- [ ] ~~Extract `systems/dice/FaceCalibrationUI.js`~~ — **deferred** (shares calibration state with animation)
- [x] Slim `dice3d.js` to 1,344 lines importing physics from `DicePhysics.js`

**GATE**: `npm test` passes · d20 roll works in browser

- [x] **GATE PASSED** — committed as: `867aa8b`

---

## Phase 8 — Secondary File Segmentation · `MEDIUM RISK`

**Goal**: Break down remaining 900+ line files into manageable modules.

- [x] `BiomeElevationGenerator.js` (1,048 → 969) → `terrain/NoisePrimitives.js` (85 lines)
- [x] `flora.js` (1,149 → 321) → `terrain-coordinator/internals/FloraProfiles.js` (842 lines)
- [ ] ~~`InteractionManager.js` (1,257)~~ — **deferred** (extracted methods reference too many parent constants)
- [ ] ~~`ModelAssetCache.js` (1,027)~~ — **deferred** (post-processing methods reference parent-scoped helpers)
- [ ] ~~`placeables.js` (1,554)~~ — **deferred** (shared mutable state across functions)
- [ ] ~~`BiomeCanvasPainter.js` (1,134)~~ — **deferred** (tightly coupled class internals)
- [ ] ~~`PlaceableMeshPool.js` (1,097)~~ — **deferred** (class with instance state coupling)

*Note: `GameManager.js` (1,583 lines) is low priority — already well-structured via coordinator pattern.*

**GATE**: Full `npm test` pass

- [x] **GATE PASSED** — committed as: _______________

---

## Phase 9 — Function Dedup & Organization · `LOW RISK`

**Goal**: Eliminate duplicated logic and fix misplaced code.

- [ ] Consolidate `validateContainerState()` (duplicated in `terrain-manager/internals/container.js` AND `terrain-coordinator/internals/container.js`)
- [ ] Evaluate merging `utils/ColorUtils.js` + `scene/ColorUtils3D.js`
- [ ] Move 3D rotation logic (`start3DRotation`, `update3DRotation`) from `InteractionManager` → `CameraSystem`
- [ ] Move `ID_TO_MODEL_KEY` mapping from `placeables.js` → `TerrainPlaceables.js` config

**GATE**: `npm test` passes

- [ ] **GATE PASSED** — committed as: _______________

---

## Phase 10 — Final Cleanup · `LOW RISK`

**Goal**: Polish — remove dead code, update docs.

- [ ] Run `node tools/find-unused-exports.js` and remove dead exports
- [ ] Clean up any remaining debug/diagnostic files
- [ ] Update `README.md` to reflect new file structure
- [ ] Verify `tools/` scripts are still relevant (remove obsolete ones)
- [ ] Final line-count audit — confirm no file exceeds ~600 lines

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
