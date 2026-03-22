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

- [ ] **GATE PASSED** — committed as: _______________

---

## Phase 5 — Segment `Token3DAdapter.js` (6,619 lines → ~5 files) · `MEDIUM RISK`

**Goal**: Break the largest file into focused modules.

- [ ] Extract `scene/token-adapter/MannequinConfig.js` (~800 lines) — model constants + animation library
- [ ] Extract `scene/token-adapter/AnimationManager.js` (~900 lines) — mixer management, play/stop/transition, goal state
- [ ] Extract `scene/token-adapter/SelectionEffects.js` (~600 lines) — hover/selection indicators, visual effects
- [ ] Extract `scene/token-adapter/MeshFactory.js` (~900 lines) — billboard plane, 3D model, skeletal mesh creation
- [ ] Slim `Token3DAdapter.js` to orchestrator (~400 lines) importing above modules
- [ ] Verify all existing imports of `Token3DAdapter` still work

**GATE**: `npm test` passes · token placement, animation, selection work in browser

- [ ] **GATE PASSED** — committed as: _______________

---

## Phase 6 — Segment `ThreeSceneManager.js` (2,493 lines → ~4 files) · `MEDIUM RISK`

**Goal**: Separate camera, lighting, and grid overlay into own modules.

- [ ] Extract `scene/CameraSystem.js` (~700 lines) — iso mode, zoom, pitch, frustum
- [ ] Extract `scene/LightingSystem.js` (~600 lines) — sun cycle, ambient, hemisphere, shadows
- [ ] Extract `scene/GridOverlay.js` (~400 lines) — bootstrap grid, visibility, style stack
- [ ] Slim `ThreeSceneManager.js` to orchestrator (~600 lines)

**GATE**: `npm test` passes · camera, lighting, grid overlay work in browser

- [ ] **GATE PASSED** — committed as: _______________

---

## Phase 7 — Segment `dice3d.js` (1,640 lines → ~5 files) · `MEDIUM RISK`

**Goal**: Modularize the d20 system.

- [ ] Extract `systems/dice/DiceModelManager.js` (~350 lines) — blueprint caching, cloning, materials, tinting
- [ ] Extract `systems/dice/DicePhysics.js` (~450 lines) — collision detection, ricochet, vector math
- [ ] Extract `systems/dice/DiceAnimationScheduler.js` (~350 lines) — roll animation, path building, face snap
- [ ] Extract `systems/dice/FaceCalibrationUI.js` (~250 lines) — calibration start/stop, pointer events
- [ ] Slim `dice3d.js` to entry point (~200 lines)

**GATE**: `npm test` passes · d20 roll works in browser

- [ ] **GATE PASSED** — committed as: _______________

---

## Phase 8 — Secondary File Segmentation · `MEDIUM RISK`

**Goal**: Break down remaining 900+ line files into manageable modules.

- [ ] `placeables.js` (1,507) → `ModelRegistry` + `SpriteFactory` + `ItemPlacement`
- [ ] `InteractionManager.js` (1,145) → `MouseHandler` + `GridPanning` + `KeyboardHandler` + `PickingSystem`
- [ ] `flora.js` (1,118) → `FilterPredicates` + `WeightMgmt` + `BiomeProfiles` + `PlacementEngine`
- [ ] `BiomeCanvasPainter.js` (1,083) → `NoiseGenerator` + `CanvasManager` + `DrawingPrimitives`
- [ ] `PlaceableMeshPool.js` (1,065) → `GroupManager` + `MaterialSystem` + `HeightSync` + `Preview`
- [ ] `ModelAssetCache.js` (1,004) → `Registry` + `OBJLoader` + `FBXLoader` + `PostProcessing`
- [ ] `BiomeElevationGenerator.js` (950) → `NoisePrimitives` + `BiomeShapes` + `FieldProcessing`

*Note: `GameManager.js` (1,459 lines) is low priority — already well-structured via coordinator pattern.*

**GATE**: Full `npm test` pass

- [ ] **GATE PASSED** — committed as: _______________

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

## Completion

- [ ] **All 10 phases complete**
- Date completed: _______________
- Final test suite: ___ suites, ___ tests passing
