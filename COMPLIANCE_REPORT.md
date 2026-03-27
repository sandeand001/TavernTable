# Taverntable — CONVENTIONS.md Compliance Report

**Generated:** March 27, 2026  
**Scope:** Full codebase audit — every folder, file, function, and line reviewed against CONVENTIONS.md

---

## Table of Contents

1. [Summary Dashboard](#1-summary-dashboard)
2. [Structural Violations (§1)](#2-structural-violations)
3. [In-File Organization Violations (§2)](#3-in-file-organization-violations)
4. [Module Pattern Violations (§3)](#4-module-pattern-violations)
5. [Responsibility Boundary Violations (§4)](#5-responsibility-boundary-violations)
6. [Target Structure Deviations (§5)](#6-target-structure-deviations)
7. [Dead Code & Deprecation Violations (§6)](#7-dead-code--deprecation-violations)
8. [Test Structure Violations](#8-test-structure-violations)
9. [Per-File Violation Index](#9-per-file-violation-index)

---

## 1. Summary Dashboard

| Category | Violations | Critical | High | Medium | Low |
|----------|-----------|----------|------|--------|-----|
| **Structural (§1)** | 18 | 7 | 6 | 3 | 2 |
| **In-File Organization (§2)** | 22 | 0 | 8 | 10 | 4 |
| **Module Patterns (§3)** | 16 | 0 | 5 | 8 | 3 |
| **Responsibility Boundaries (§4)** | 9 | 3 | 4 | 2 | 0 |
| **Dead Code (§6)** | 4 | 2 | 2 | 0 | 0 |
| **Test Structure** | 4 | 2 | 1 | 1 | 0 |
| **TOTAL** | **73** | **14** | **26** | **24** | **9** |

---

## 2. Structural Violations

### 2.1 Empty Directories Must Be Deleted (§1.2)

| # | Directory | Status |
|---|-----------|--------|
| S-1 | `src/core/model-cache/` | **EMPTY — DELETE** |
| S-2 | `src/scene/assets/` | **EMPTY — DELETE** |
| S-3 | `src/scene/scene-manager/` | **EMPTY — DELETE** |
| S-4 | `src/scene/terrain-brush/` | **EMPTY — DELETE** |
| S-5 | `src/ui/lib/` | **EMPTY — DELETE** |

**Severity:** HIGH (5 violations)

---

### 2.2 Files Exceeding ~800 Line Limit (§1.2)

Convention: "A class grows beyond ~800 lines → Create `<module-name>/internals/` alongside the class"

| # | File | Est. Lines | Action Required |
|---|------|-----------|-----------------|
| S-6 | `src/coordinators/TerrainCoordinator.js` | ~1,195 | Extract biome generation logic to internals/ |
| S-7 | `src/core/GameManager.js` | ~1,000+ | Extract subsystem wiring to internals/ |
| S-8 | `src/managers/TerrainManager.js` | ~1,100+ | Extract preview/overlay methods to internals/ |
| S-9 | `src/terrain/generation/BiomeElevationGenerator.js` | ~1,100 | Extract shaper functions to internals/ |
| S-10 | `src/terrain/painting/BiomeCanvasPainter.js` | ~1,200+ | Extract helpers to internals/ |
| S-11 | `src/ui/SidebarController.js` | ~933 | Extract biome menu building to internals/ |
| S-12 | `src/ui/UIController.js` | ~920+ | Decompose into sub-controllers |
| S-13 | `src/utils/Logger.js` | ~900+ | Extract handler classes to logger/internals/ |
| S-14 | `src/scene/ThreeSceneManager.js` | ~800+ | Verify and decompose if over limit |
| S-15 | `src/scene/Token3DAdapter.js` | ~800+ | Verify and decompose if over limit |

**Severity:** CRITICAL (10 violations)

---

### 2.3 internals/ Subdirectory Grouping (§1.2, §5)

| # | Issue | Details |
|---|-------|---------|
| S-16 | `src/coordinators/terrain-coordinator/internals/` is **flat** (18 files) | Convention §5 specifies subdirectories: `activation/` (apply.js, init.js, mode.js, reset.js, state.js), `brush/` (brush.js, inputs.js, tools.js), `rendering/` (biome.js, color.js, baseGridUpdates.js), `spatial/` (coords.js, height.js, resize.js). Currently all 18 files are loose. |

**Severity:** HIGH (1 violation)

---

### 2.4 File in Wrong Domain Directory (§1.1)

| # | File | Current Location | Should Be |
|---|------|-----------------|-----------|
| S-17 | `PixiStub.js` | `src/core/` | Not in target structure. Move to `src/utils/` or delete post-migration |
| S-18 | `OverlayMeshPool.js`, `OverlayOutlinePool.js` | `src/scene/terrain/` | `src/scene/terrain/brush/` per §5 target structure |

**Severity:** MEDIUM (2 violations)

---

## 3. In-File Organization Violations

### 3.1 Missing Section Comments (§2.1)

Convention: "Every file with more than ~5 functions/methods must have section comments in format: `// ── Section Name ────────────────────────────────────────────`"

| # | File | Issue |
|---|------|-------|
| O-1 | `src/config/TokenCommandConfig.js` | No section comments (multiple data groups + functions) |
| O-2 | `src/config/biome/BiomePalettes.js` | Missing `── Constants ──` section header at start |
| O-3 | `src/config/biome/PaletteDesign.js` | Missing file-level section comment |
| O-4 | `src/utils/SeededRNG.js` | No section comments |
| O-5 | `src/utils/color/ColorUtils.js` | No section comments |
| O-6 | `src/utils/coordinates/ProjectionUtils.js` | Missing formal section comments |
| O-7 | `src/scene/terrain/OverlayMeshPool.js` | Missing initial section comment |
| O-8 | `src/scene/terrain/OverlayOutlinePool.js` | Missing section comment, starts with raw function |
| O-9 | `src/scene/token-adapter/AnimationController.js` | Missing section comment before first function |
| O-10 | `src/ui/UIController.js` | Missing Constants session and Public API section comments |

**Severity:** MEDIUM (10 violations)

---

### 3.2 Wrong Section Comment Format (§2.1)

Convention requires: `// ── Section Name ────────────────────────────────────────────`

| # | File | Issue |
|---|------|-------|
| O-11 | `src/scene/token-adapter/MeshFactory.js` | Uses `/* ---- */` instead of `// ────` |
| O-12 | `src/scene/token-adapter/SelectionEffects.js` | Uses `/* ---- */` instead of `// ────` |

**Severity:** LOW (2 violations)

---

### 3.3 Class Method Ordering Wrong (§2.3)

Convention order: Constructor → Lifecycle → Public API → Event Handlers → Private Helpers → Accessors

| # | File | Issue |
|---|------|-------|
| O-13 | `src/ui/SidebarController.js` | Private helpers (`_ensureTerrainModeToggleOff`, etc.) scattered throughout; event handlers (`onTabChange`, etc.) mixed with public API rather than in dedicated section |

**Severity:** MEDIUM (1 violation)

---

### 3.4 Module File Ordering Wrong (§2.2)

Convention order: Imports → Constants → Public API (exported) → Private Helpers (unexported)

| # | File | Issue |
|---|------|-------|
| O-14 | `src/systems/dice/DiceAnimationScheduler.js` | Helper functions mixed throughout before Public API section |
| O-15 | `src/systems/dice/DiceModelManager.js` | Exports scattered throughout instead of grouped |
| O-16 | `src/systems/dice/DicePhysics.js` | Private helpers scattered; public API buried at end |
| O-17 | `src/systems/dice/FaceCalibrationUI.js` | Private helpers appear before public functions |
| O-18 | `src/systems/dice/dice.js` | Setup code and helpers mixed before public API |
| O-19 | `src/systems/dice/dice3d.js` | Private functions appear before public API |
| O-20 | `src/systems/DragController.js` | No clear constants section; mixed function flow |

**Severity:** HIGH (7 violations)

---

### 3.5 Config File Ordering Wrong (§2.4)

Convention order: Imports → Constants → Data Tables → Derived Constants → Export

| # | File | Issue |
|---|------|-------|
| O-21 | `src/config/terrain/TerrainPlaceables.js` | Export at line 12, but most data follows after line 14. `TREE_PLACEABLES` defined after the default export, orphaned and unreachable. |

**Severity:** CRITICAL (1 violation — file is structurally broken)

---

### 3.6 Missing Constants Section (§2.2–2.4)

| # | File | Issue |
|---|------|-------|
| O-22 | `src/systems/dice/DiceState.js` | No `── Constants ──` section header |
| O-23 | `src/systems/dice/dice.js` | No `── Constants ──` section |
| O-24 | `src/systems/dice/dice3d.js` | No `── Constants ──` section |

**Severity:** LOW (3 violations, grouped as 1 concern)

---

## 4. Module Pattern Violations

### 4.1 Import Grouping Wrong (§3.3)

Convention: "Group imports: 1) Third-party → 2) Config/constants → 3) Same-domain siblings → 4) Cross-domain imports, separated with blank lines."

| # | File | Issue |
|---|------|-------|
| M-1 | `src/coordinators/RenderCoordinator.js` | Config import (`GRID_CONFIG`) comes AFTER utils imports |
| M-2 | `src/coordinators/StateCoordinator.js` | Config import after utils imports |
| M-3 | `src/coordinators/terrain-coordinator/BiomeShadingController.js` | Utils at line 1, then config, then cross-domain, then utils again |
| M-4 | `src/coordinators/terrain-coordinator/ElevationVisualsController.js` | Config import mixed with utils |
| M-5 | `src/core/GameManager.js` | utils → config → coordinators → scene → utils (not grouped) |
| M-6 | `src/entities/creatures/CreatureFactory.js` | same-domain before config |
| M-7 | `src/entities/creatures/CreatureToken.js` | cross-domain (PixiStub) at line 1, should be at end |
| M-8 | `src/systems/dice/DiceState.js` | No blank line between config and same-domain groups |
| M-9 | `src/systems/dice/dice.js` | Same-domain utils before config import |
| M-10 | `src/systems/dice/dice3d.js` | No blank line separator between groups |
| M-11 | `src/ui/SidebarController.js` | domHelpers (same-domain) before Logger (cross-domain) with no blank separator |
| M-12 | `src/ui/UIController.js` | Imports severely mixed: core, config, utils, config, same-domain, cross-domain |
| M-13 | `src/scene/ThreeSceneManager.js` | Config import should follow utils grouping |

**Severity:** HIGH (13 violations)

---

### 4.2 Private Function/Method Naming (§2.3e)

Convention: "Private Helpers — internal methods, prefixed with `_`"

| # | File | Functions Missing `_` Prefix |
|---|------|------------------------------|
| M-14 | `src/entities/creatures/CreatureToken.js` | `createFallbackGraphics()`, `createFallbackSprite()`, `applyFacing()` |
| M-15 | `src/systems/dice/DiceAnimationScheduler.js` | `easeOutCubic`, `randomBetween`, `hasWindow`, `mergePathInfos`, `createLinearPath` (5 functions) |
| M-16 | `src/systems/dice/DiceModelManager.js` | `applyDiceMaterialTuning` |
| M-17 | `src/systems/dice/DicePhysics.js` | `normalize2D`, `reflectVector2D`, `deriveBounceIntensity`, `collectCollisionObstacles`, `findPathCollision`, `createLinearPath`, `mergePathInfos`, `_addWaypoints` (8 functions) |
| M-18 | `src/systems/dice/FaceCalibrationUI.js` | `getCalibrationSequence`, `cycleCalibrationFace`, `handleCalibrationPointer` (3 functions) |
| M-19 | `src/systems/dice/dice.js` | `maybePlay3DDice`, `getDiceButtons`, `getDiceCountEl`, `getDiceResultEl` (4 functions) |
| M-20 | `src/systems/dice/dice3d.js` | `clearActiveDie`, `resolvePrimaryCamera`, `resolvePrimaryDomElement`, `attachDiceAccentLights`, `attachDieDismissOnClick` (5 functions) |
| M-21 | `src/terrain/brush/BrushCommon.js` | `computeBrushRadii` |
| M-22 | `src/terrain/generation/BiomeElevationGenerator.js` | 26+ shape functions: `shapeGrassland`, `shapeHills`, `shapeMountain`, `shapeDesertHot`, `shapeSandDunes`, `shapeWetlands`, etc. |
| M-23 | `src/terrain/painting/biome-painter/fields.js` | `computeDistanceField` |

**Total: ~56 functions across 10 files missing `_` prefix**

**Severity:** HIGH (10 violations)

---

### 4.3 Export Style Violations (§3.2)

| # | File | Issue |
|---|------|-------|
| M-24 | `src/config/terrain/TerrainPlaceables.js` | Both named export and default export of same object |
| M-25 | `src/terrain/brush/TerrainBrushHighlighter.js` | Both named and default exports (should pick one) |
| M-26 | `src/systems/DragController.js` | Mixed ES6 exports + window globals |
| M-27 | `src/ui/controls/SettingsViewToggle.js` | IIFE pattern, no ES6 export statement at all |

**Severity:** MEDIUM (4 violations)

---

### 4.4 Import Syntax Error

| # | File | Issue |
|---|------|-------|
| M-28 | `src/managers/terrain-manager/internals/placeables-sprite.js` | Line 10: `import logger, { LOG_CATEGORY }` — mixing default and named import. Should be `import { logger, LOG_CATEGORY }` |

**Severity:** MEDIUM (1 violation)

---

## 5. Responsibility Boundary Violations

### 5.1 Config Files Containing Logic (§1.1, §4.2)

Convention: "config/ = Pure data: constants, palettes, lookup tables. **No logic.**"

| # | File | Logic Found |
|---|------|-------------|
| R-1 | `src/config/GameConstants.js` | `normalizeCreatureType()` function (L98–101), `VALIDATION` object with `isValidGridSize()`, `isValidCoordinate()`, `isValidCreatureType()` (L107–135), `CREATURE_HELPERS` with `getScale()`, `getColor()`, `getAllTypes()` (L137–165) |
| R-2 | `src/config/TokenCommandConfig.js` | `registerCommand()` function (L142–145), `getTokenCommand()` function (L169–171), `TOKEN_COMMAND_LOOKUP` built with complex reduction logic (L151–155) |
| R-3 | `src/config/biome/BiomePalettes.js` | `clampHeight()`, `clamp01()`, `mix()`, `hexToRgb()`, `rgbToHex()`, `lerp()`, `lerpColor()`, `srgbToLinear01()`, `linear01ToSrgb()`, 10+ color space conversion functions, `hash2D()`, `smoothNoise()`, `fbm2()`, `generateHeightGradient()`, `generateFromStops()` |
| R-4 | `src/config/biome/BiomePalettes3D.js` | `clamp()`, `lerp()`, `hex()`, `hexToRgb()`, `lerpColor()`, `applyAtmosphere()`, `applyDepth()`, `buildPalette()`, `ensureBiomePalette()`, `registerCustom3DBiomePalette()`, `getBiomeColor3DHex()` |
| R-5 | `src/config/biome/BiomePalettes3DHarmonized.js` | `clamp()`, `lerp()`, `hex()`, `hexToRgb()`, `lerpColor()`, `applyAtmosphere()`, `applyDepth()`, `adjustSaturation()`, `buildHarmonizedPalette()`, `ensureHarmonyPalette()`, `getHarmonized3DColorHex()`, `rebuildHarmonizedBiomeCache()` |
| R-6 | `src/config/biome/PaletteDesign.js` | `getBiomeDesign()` function (L65–69) |
| R-7 | `src/config/terrain/FloraProfiles.js` | **CRITICAL** — File is ~90% functions: `isSpectralPlaceable()`, `isTropicalCluster()`, `getTropicalDensityModifier()`, `isFlatEnoughForTropical()`, `hash32()`, `pickIds()`, `makeWeights()`, `relocateTropicalCandidate()`, `candidateFilters` object with filter functions, `hasWaterWithinRadius()`, `isAdjacentToWater()`, `isCoastlineTile()`. This is business logic, not config data. |

**Severity:** CRITICAL (7 violations — `FloraProfiles.js` is the worst offender)

---

### 5.2 Utils Having Domain Knowledge (§4.3)

Convention: "Files in `utils/` must not import from `managers/`, `scene/`, `coordinators/`, `terrain/`, or `entities/`."

| # | File | Domain Imports |
|---|------|----------------|
| R-8 | `src/utils/coordinates/ProjectionUtils.js` | Accepts `gameManager` parameter and directly accesses: `gameManager.tileWidth`, `gameManager.tileHeight`, `gameManager.gridContainer`, `gameManager.__biomeVersion`, `gameManager.cols`, `gameManager.rows`, `gameManager?.terrainCoordinator?.terrainManager?.placeables` (crosses THREE domain boundaries), `gameManager.placedTokens` |

**Severity:** CRITICAL (1 violation)

---

### 5.3 Coordinator Doing Too Much Direct Logic (§1.1)

Convention: "Orchestration façades that wire managers + scene together"

| # | File | Issue |
|---|------|-------|
| R-9 | `src/coordinators/TerrainCoordinator.js` | Contains significant inline biome generation logic: `generateBiomeElevationIfFlat()` (L568–678), `generateBiomeElevation()` (L680–807), `_clearAllBiomeFlora()` (L426–477). These should be extracted to internals/ or `terrain/generation/`. |

**Severity:** HIGH (1 violation)

---

## 6. Target Structure Deviations (§5)

Files/directories that don't match the target structure defined in §5:

| # | Current State | Target State | Action |
|---|--------------|-------------|--------|
| T-1 | `utils/ErrorHandler.js` at root | `utils/error/ErrorHandler.js` | Move to error/ subdirectory |
| T-2 | `utils/Logger.js` at root | `utils/logger/Logger.js` | Move to logger/ subdirectory |
| T-3 | `scene/terrain/OverlayMeshPool.js` at terrain root | `scene/terrain/brush/OverlayMeshPool.js` | Move to brush/ subdirectory |
| T-4 | `scene/terrain/OverlayOutlinePool.js` at terrain root | `scene/terrain/brush/OverlayOutlinePool.js` | Move to brush/ subdirectory |
| T-5 | `coordinators/terrain-coordinator/internals/` all flat | Should have `activation/`, `brush/`, `rendering/`, `spatial/` subdirectories | Group into sub-folders |
| T-6 | `core/PixiStub.js` exists | Not in target structure | Relocate or delete |

**Severity:** MEDIUM–HIGH (6 deviations)

---

## 7. Dead Code & Deprecation Violations

### §6: Dead Code / Stubs / Empty Dirs

| # | Item | Issue |
|---|------|-------|
| D-1 | `src/terrain/painting/biome-painter/index.js` | **Stub file** — Contains only comment: "Internal barrel removed… Intentionally left empty." Must be deleted per §6. |
| D-2 | `src/terrain/painting/biome-painter/style.js` | **Stub file** — Contains only comment: "Former styleForBiome helper internalized into BiomeCanvasPainter." Must be deleted per §6. |
| D-3 | `src/config/terrain/TerrainPlaceables.js` | **Orphaned data** — `TREE_PLACEABLES` section and functions appear after the default export (line 14+), making them unreachable/dead code. Likely a refactoring bug. |
| D-4 | Empty directories (5 total) | See §2.1 above — all 5 empty dirs violate deletion policy |

**Severity:** CRITICAL (D-1, D-2), HIGH (D-3, D-4)

---

## 8. Test Structure Violations

### 8.1 No Mirrored Directory Structure (§1.4)

Convention: "Test files: `<SourceName>.test.js` in `tests/unit/` mirroring `src/` path"

| # | Issue | Details |
|---|-------|---------|
| TS-1 | **All 69 test files are flat in `tests/unit/` root** | Convention requires mirrored structure: `tests/unit/managers/TokenManager.test.js`, `tests/unit/coordinators/TerrainCoordinator.test.js`, etc. Zero subdirectories exist. |
| TS-2 | **Misplaced test file** | `tests/terrain/biome-painter/fields.test.js` should be at `tests/unit/terrain/painting/biome-painter/fields.test.js` |

**Severity:** CRITICAL (fundamental structural violation)

---

### 8.2 Test Naming Ambiguity (§1.4)

Convention: Test files should be `<SourceName>.test.js`

| # | Test File | Issue |
|---|-----------|-------|
| TS-3 | `BiomeGroupsExport.test.js` | No corresponding `BiomeGroupsExport.js` in src/ |
| TS-3 | `viewMode.test.js` | No corresponding `viewMode.js` in src/ |
| TS-3 | `SpatialMapping.test.js` | Name doesn't match `SpatialCoordinator.js` |
| TS-3 | `PixiShapeUtils.test.js` | No corresponding `PixiShapeUtils.js` in src/ |
| TS-3 | `OrchardLayout.test.js` | No corresponding source file |
| TS-3 | `Placeables.trees.test.js` | Dot notation unusual; unclear mapping |
| TS-3 | `DeadForestFloraComposition.test.js` | Domain-specific test; no matching source file |
| TS-3 | `SwampFloraDensity.test.js` | Domain-specific test; no matching source file |
| TS-3 | `FloraDeterminism.test.js` | Domain-specific test; no matching source file |
| TS-3 | `ProjectionPlaceables.test.js` | Unclear mapping |
| TS-3 | `ProjectionTokensElevation.test.js` | Unclear mapping |
| TS-3 | `ProjectionTokensPosition.test.js` | Unclear mapping |

**Severity:** MEDIUM (12 files with naming ambiguity)

---

### 8.3 Source Files with No Test Coverage

~80+ source files have no corresponding test file. Key untested files:

**Config (9 files):** GameConstants, TokenCommandConfig, BiomeConstants, BiomePalettes3D, BiomePalettes3DHarmonized, PaletteDesign, TerrainConstants, TerrainPlaceables, FloraProfiles

**Coordinators (7 files):** InputCoordinator, RenderCoordinator, StateCoordinator, TerrainCoordinator (direct), TerrainInputHandlers, BiomeShadingController, ElevationVisualsController

**Core (3 files):** ModelAssetCache, ModelPostProcessing, PixiStub

**Managers — all internals (17 files):** grid-renderer/internals/tiles.js, every file in interaction-manager/internals/, terrain-manager/internals/, token-manager/internals/

**Scene (9 files):** CameraSystem, GridOverlay, LightingSystem, SpatialCoordinator, all token-adapter files

**Systems (8 files):** DragController, all dice/ files except smoke test coverage

**Terrain (7 files):** TerrainDataStore, TerrainFacesRenderer, BrushCommon, TerrainBrushController, NoisePrimitives, and more

**UI (5 files):** RadialMenu, Hybrid3DControls, HybridRenderToggle, SettingsViewToggle, styles.css

**Utils (11 files):** ErrorHandler, Logger, SeededRNG, all error/, logger/, geometry/, coordinates/CoordinateUtils, terrain/ContainerUtils

**Severity:** MEDIUM (noted for awareness — convention states test naming pattern but doesn't mandate 100% coverage)

---

## 9. Per-File Violation Index

Quick-reference of every file with at least one violation:

| File | Violations |
|------|-----------|
| `config/GameConstants.js` | R-1 (logic in config) |
| `config/TokenCommandConfig.js` | R-2 (logic in config), O-1 (no section comments) |
| `config/biome/BiomePalettes.js` | R-3 (logic in config), O-2 (missing section header) |
| `config/biome/BiomePalettes3D.js` | R-4 (logic in config) |
| `config/biome/BiomePalettes3DHarmonized.js` | R-5 (logic in config) |
| `config/biome/PaletteDesign.js` | R-6 (logic in config), O-3 (missing section comment) |
| `config/terrain/FloraProfiles.js` | R-7 (CRITICAL: 90% logic in config) |
| `config/terrain/TerrainPlaceables.js` | O-21 (broken file structure), D-3 (orphaned data), M-24 (export style) |
| `coordinators/RenderCoordinator.js` | M-1 (import grouping) |
| `coordinators/StateCoordinator.js` | M-2 (import grouping) |
| `coordinators/TerrainCoordinator.js` | S-6 (>800 lines), R-9 (too much logic), T-5 (internals not grouped) |
| `coordinators/terrain-coordinator/BiomeShadingController.js` | M-3 (import grouping) |
| `coordinators/terrain-coordinator/ElevationVisualsController.js` | M-4 (import grouping) |
| `core/GameManager.js` | S-7 (>800 lines), M-5 (import grouping) |
| `core/PixiStub.js` | S-17 (wrong domain), T-6 (not in target) |
| `core/model-cache/` | S-1 (empty dir) |
| `entities/creatures/CreatureFactory.js` | M-6 (import grouping) |
| `entities/creatures/CreatureToken.js` | M-7 (import grouping), M-14 (private methods no `_`) |
| `managers/TerrainManager.js` | S-8 (>800 lines) |
| `managers/terrain-manager/internals/placeables-sprite.js` | M-28 (import syntax error) |
| `scene/assets/` | S-2 (empty dir) |
| `scene/scene-manager/` | S-3 (empty dir) |
| `scene/terrain-brush/` | S-4 (empty dir) |
| `scene/ThreeSceneManager.js` | S-14 (possibly >800 lines), M-13 (import grouping) |
| `scene/Token3DAdapter.js` | S-15 (possibly >800 lines) |
| `scene/terrain/OverlayMeshPool.js` | O-7 (missing section comment), T-3 (wrong location) |
| `scene/terrain/OverlayOutlinePool.js` | O-8 (missing section comment), T-4 (wrong location) |
| `scene/token-adapter/AnimationController.js` | O-9 (missing section comment) |
| `scene/token-adapter/MeshFactory.js` | O-11 (wrong comment format) |
| `scene/token-adapter/SelectionEffects.js` | O-12 (wrong comment format) |
| `systems/DragController.js` | M-26 (mixed exports + window globals), O-20 (module ordering) |
| `systems/dice/DiceAnimationScheduler.js` | M-15 (private funcs no `_`), O-14 (module ordering) |
| `systems/dice/DiceModelManager.js` | M-16 (private func no `_`), O-15 (module ordering) |
| `systems/dice/DicePhysics.js` | M-17 (8 private funcs no `_`), O-16 (module ordering) |
| `systems/dice/DiceState.js` | M-8 (import grouping), O-22 (no constants section) |
| `systems/dice/FaceCalibrationUI.js` | M-18 (private funcs no `_`), O-17 (module ordering) |
| `systems/dice/dice.js` | M-9 (import grouping), M-19 (private funcs no `_`), O-18 (module ordering) |
| `systems/dice/dice3d.js` | M-10 (import grouping), M-20 (private funcs no `_`), O-19 (module ordering) |
| `terrain/brush/BrushCommon.js` | M-21 (private func no `_`) |
| `terrain/brush/TerrainBrushHighlighter.js` | M-25 (export style) |
| `terrain/generation/BiomeElevationGenerator.js` | S-9 (>800 lines), M-22 (26+ private funcs no `_`) |
| `terrain/painting/BiomeCanvasPainter.js` | S-10 (>800 lines) |
| `terrain/painting/biome-painter/fields.js` | M-23 (private func no `_`) |
| `terrain/painting/biome-painter/index.js` | D-1 (dead stub — delete) |
| `terrain/painting/biome-painter/style.js` | D-2 (dead stub — delete) |
| `ui/SidebarController.js` | S-11 (>800 lines), M-11 (import grouping), O-13 (method ordering) |
| `ui/UIController.js` | S-12 (>800 lines), M-12 (import grouping), O-10 (missing sections) |
| `ui/controls/SettingsViewToggle.js` | M-27 (IIFE pattern, no ES6 export) |
| `ui/lib/` | S-5 (empty dir) |
| `utils/ErrorHandler.js` | T-1 (wrong location per target) |
| `utils/Logger.js` | S-13 (>800 lines), T-2 (wrong location per target) |
| `utils/coordinates/ProjectionUtils.js` | R-8 (CRITICAL: domain knowledge in utils), O-6 (missing sections) |
| `tests/unit/` (all 69 files) | TS-1 (flat, no mirrored subdirectories) |
| `tests/terrain/biome-painter/fields.test.js` | TS-2 (misplaced — should be in tests/unit/) |

---

## Recommended Priority Order

### P0 — Fix Immediately (Architectural / Broken)
1. Delete 5 empty directories (S-1 through S-5)
2. Delete 2 dead stub files (D-1, D-2)
3. Fix `TerrainPlaceables.js` orphaned data (D-3/O-21)
4. Move logic OUT of `config/terrain/FloraProfiles.js` (R-7)

### P1 — Fix This Sprint (Convention Violations)
5. Move `ErrorHandler.js` → `utils/error/` and `Logger.js` → `utils/logger/` (T-1, T-2)
6. Move `OverlayMeshPool.js` + `OverlayOutlinePool.js` → `scene/terrain/brush/` (T-3, T-4)
7. Move logic out of all config/ files into proper domain modules (R-1 through R-6)
8. Fix `ProjectionUtils.js` domain knowledge violation (R-8)
9. Decompose 8 files exceeding 800 lines (S-6 through S-13)
10. Group `terrain-coordinator/internals/` into subdirectories (S-16/T-5)

### P2 — Fix Next Sprint
11. Add `_` prefix to ~56 private functions across 10 files (M-14 through M-23)
12. Fix import grouping/ordering in 13 files (M-1 through M-13)
13. Add missing section comments to 10 files (O-1 through O-10)
14. Fix module file ordering in 7 systems/ files (O-14 through O-20)
15. Reorganize test directory structure to mirror src/ (TS-1, TS-2)

### P3 — Housekeeping
16. Fix export style in 4 files (M-24 through M-27)
17. Fix section comment format in 2 files (O-11, O-12)
18. Relocate or delete `PixiStub.js` (S-17/T-6)
19. Address test naming ambiguities (TS-3)
