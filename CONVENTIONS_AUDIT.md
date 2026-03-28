# Conventions Audit Report

**Date**: March 27, 2026  
**Scope**: Every file under `src/` and `tests/` audited against `CONVENTIONS.md`

---

## Executive Summary

| Category | Violations | Severity |
|----------|-----------|----------|
| Directory Structure & Layout | 8 | 4 CRITICAL, 4 MODERATE |
| Config Files Containing Logic | 6 | 6 CRITICAL |
| Missing Section Comments | 18 | 18 MODERATE |
| Export Style | 6 | 6 MODERATE |
| Import Hygiene & Dependencies | 3 | 1 CRITICAL, 2 MODERATE |
| Naming Conventions | 3 | 3 MODERATE |
| Dead Code / Empty Dirs | 5 | 5 MODERATE |
| File Size | 4 | 4 MODERATE |
| Test Structure | 6 | 6 MODERATE |
| **TOTAL** | **59** | |

---

## 1. Directory Structure Violations (§1.1, §1.2, §5, §6)

### CRITICAL

#### V-001: `scene/token-adapter/` exceeds 6-file limit (15 files)
- **Convention §1.2**: "> 6 files → group by sub-concern into subdirectories"
- **Current**: 15 files (AnimationController, ClimbPhases, FallPhases, MannequinConfig, MeshFactory, MovementPhases, MovementStyle, Navigation, PathingLogger, ResumeProbe, RootMotion, SelectionEffects, SpatialUtils, StepFactory, WorldAuthority)
- **Target structure** only lists 4 files; 11 extra mixin installer files exist
- **Fix**: Create subdirs like `movement-phases/`, `pathing-navigation/`, `spatial-world/`

#### V-002: `scene/token-adapter/internals/` is EMPTY
- **Convention §6**: "Empty directories must be deleted."
- **Fix**: Delete the directory

#### V-003: `ui/internals/` is EMPTY
- **Convention §6**: "Empty directories must be deleted."
- **Fix**: Delete the directory

#### V-004: `core/PixiStub.js` not in target structure
- **Convention §5**: Target lists only GameManager.js, ModelAssetCache.js, ModelPostProcessing.js in `core/`
- **File self-describes** as "transitional shim" intended for deletion
- **Fix**: Move to `utils/stubs/` or delete after migrating consumers

### MODERATE

#### V-005: `coordinators/ProjectionUtils.js` misplaced
- **Convention §1.1**: Coordinators = "orchestration façades wiring managers + scene"
- **ProjectionUtils.js** contains pure coordinate transformation logic — belongs in `utils/coordinates/` or `utils/projection/`

#### V-006: `tests/terrain/` orphaned empty directory
- Contains only an empty `biome-painter/` subfolder
- **Fix**: Delete

#### V-007: Missing `ui/lib/` directory
- **Convention §5 target**: Shows `ui/lib/` with `elevationUtils.js`, `spriteKeys.js`
- **Current**: Directory does not exist
- **Fix**: Create if files are planned, or update target structure in CONVENTIONS.md

#### V-008: `terrain/flora/` not in target structure
- **Convention §5 target** does not show a `flora/` subdirectory under `terrain/`
- **Current**: `terrain/flora/floraHelpers.js` exists
- **Fix**: Update CONVENTIONS.md target structure to include it

---

## 2. Config Files Containing Logic (§1.1 — "Pure data, no logic")

### CRITICAL — 6 config files contain functions, loops, and computation

#### V-009: `config/biome/BiomePalettes.js` — ~90% algorithm
- Color space conversions (sRGB↔linear, Oklab, Oklch) — lines 11–84
- Noise generation (Perlin hash, smoothNoise, fbm2) — lines 113–148
- Palette generation (generateHeightGradient, generateFromStops) — lines 147–198
- Runtime initialization loop building palettes at import time — lines 276–289
- Exported computation functions: `getBiomeColorWithHydrology()`, `getBiomeColor()`, `getBiomeColorHex()`
- **Fix**: Extract computation to `utils/color/BiomePaletteComputer.js`; keep only data tables in config

#### V-010: `config/biome/BiomePalettes3D.js` — heavy computation
- Utility math functions (clamp, lerp, hex conversion) — lines 17–39
- Effect functions (applyAtmosphere, applyDepth) — lines 41–80
- Palette construction with caching (buildPalette, ensureBiomePalette) — lines 79–119
- Module-level initialization side-effect — lines 155–159
- **Fix**: Move to `utils/color/BiomePalette3DManager.js`

#### V-011: `config/biome/BiomePalettes3DHarmonized.js` — utility module
- Math helpers, atmosphere/depth/saturation effects — lines 14–89
- Palette generation with caching — lines 92–135
- Public computation API — lines 137–182
- **Fix**: Move to `utils/color/BiomePalette3DHarmonizer.js`

#### V-012: `config/biome/PaletteDesign.js` — exported function
- `getBiomeDesign()` function with conditional logic — line 76
- **Fix**: Move lookup function to a utility or inline at call sites

#### V-013: `config/TokenCommandConfig.js` — recursive logic
- `_registerCommand()` recursive traversal — lines 84–96
- `reduce()` loop building lookup map — lines 98–101
- `getTokenCommand()` lookup function — lines 103–107
- **Fix**: Move functions to `utils/TokenCommandResolver.js`

#### V-014: `config/terrain/FloraProfiles.js` — weight computation
- `pickIds()`, `makeWeights()`, `withSpectralVariants()` — lines 8–50
- Complex weight computation called during data structure definition
- **Fix**: Move helper functions to `terrain/flora/floraHelpers.js`

---

## 3. Missing Section Comments (§2.1, §2.3)

Convention: "Every file with more than ~5 functions or methods **must** have section comments" using format `// ── Section Name ──`

### Class files missing `// ── Constructor ──` and other standard sections:

| # | File | Missing Sections |
|---|------|-----------------|
| V-015 | `coordinators/TerrainCoordinator.js` | All standard class sections (Constructor, Lifecycle, Public API, Event Handlers, Private Helpers) |
| V-016 | `coordinators/RenderCoordinator.js` | Constructor, Application Setup, Grid Centering, Viewport sections |
| V-017 | `coordinators/StateCoordinator.js` | Constructor section marker |
| V-018 | `coordinators/terrain-coordinator/ElevationScaleController.js` | Constructor section |
| V-019 | `coordinators/terrain-coordinator/BiomeShadingController.js` | Constructor section |
| V-020 | `coordinators/terrain-coordinator/TileLifecycleController.js` | Constructor section |
| V-021 | `core/ModelPostProcessing.js` | Constants, Public API, Private Helpers sections |
| V-022 | `core/game-manager/internals/init.js` | Public API section |
| V-023 | `core/game-manager/internals/tokenDrag.js` | Section headers |
| V-024 | `core/game-manager/internals/elevation.js` | Section headers |

### Function-export files missing section comments:

| # | File | Missing Sections |
|---|------|-----------------|
| V-025 | `coordinators/ProjectionUtils.js` | All sections (8+ functions, 300+ lines) |
| V-026 | `managers/interaction-manager/internals/target-resolution.js` | ~375 lines, 8 exported functions, no section markers |
| V-027 | `systems/dice/DiceState.js` | ~15 exported items, zero section markers |
| V-028 | `systems/dice/FaceCalibrationUI.js` | 4+ functions, no markers |
| V-029 | `systems/dice/dice.js` | Multiple sections unmarked |
| V-030 | `systems/dice/dice3d.js` | Helper functions unmarked |
| V-031 | `terrain/painting/BiomeCanvasPainter.js` | Missing sub-sections within class |
| V-032 | `terrain/flora/floraHelpers.js` | Missing explicit Public API / Private Helpers separation |

---

## 4. Export Style Violations (§3.2)

| # | File | Issue | Fix |
|---|------|-------|-----|
| V-033 | `core/GameManager.js` | Dual export: both `export { GameManager }` and `export default GameManager` | Keep only `export default GameManager` |
| V-034 | `terrain/painting/BiomeCanvasPainter.js` | `export class` instead of `export default class` | Change to `export default class` |
| V-035 | `terrain/generation/NoisePrimitives.js` | Bulk `export { fn1, fn2 }` at bottom instead of `export function` at each definition | Move `export` to each function definition |
| V-036 | `ui/components/RadialMenu.js` | `export class RadialMenu` (named) for single class | Should be `export default class` |
| V-037 | `ui/controls/Hybrid3DControls.js` | Named export for single function | Could use default export |
| V-038 | `ui/controls/HybridRenderToggle.js` | Named export for single function | Could use default export |

---

## 5. Import Hygiene & Responsibility Boundary Violations (§3.3, §4.3)

### CRITICAL

#### V-039: `utils/Validation.js` imports from `entities/`
- **Line 10**: `import { normalizeCreatureType } from '../entities/creatures/creatureHelpers.js'`
- **Convention §4.3**: "utils/ must not import from managers/, scene/, coordinators/, terrain/, or entities/"
- **Fix**: Move creature validation logic to `entities/` or create game-agnostic mapping in utils

### MODERATE

#### V-040: `systems/DragController.js` — import groups not separated by blank lines
- All utils imports on consecutive lines without blank-line group separation

#### V-041: `managers/terrain-manager/internals/placeables.js` — incorrect import pattern
- `import logger, { LOG_CATEGORY }` should be `import { logger, LOG_CATEGORY }` (assumes default + named exports mixed)

---

## 6. Naming Convention Violations (§1.4)

| # | File | Issue | Fix |
|---|------|-------|-----|
| V-042 | `ui/domHelpers.js` | camelCase for multi-word file; convention suggests kebab-case | Rename to `dom-helpers.js` |
| V-043 | `coordinators/terrain-coordinator/ActivationHelpers.js` | PascalCase suggests class but contains a class named `ActivationHelpers` — "Helpers" suffix ambiguous | Consider singular `ActivationHelper.js` |
| V-044 | `entities/creatures/CreatureFactory.js` | Class with only a static method; convention §3.1 says "use plain functions for stateless" | Convert to `export function createCreature(...)` |

---

## 7. Dead Code & Empty Artifacts (§6)

| # | File | Issue |
|---|------|-------|
| V-045 | `managers/GridRenderer.js` ~L18 | Unused import: `Container` from `core/PixiStub.js` |
| V-046 | `managers/TerrainManager.js` ~L9 | Commented-out import: `// import { GRID_CONFIG }` |
| V-047 | `ui/UIController.js` ~L558 | Empty stub function `wireTerrainStyleControls()` |
| V-048 | `ui/UIController.js` ~L442 | Multiple "deprecated" comments about Placeable Tiles UI — consider full removal |
| V-049 | `config/biome/BiomePalettes3D.js` ~L155 | `try { ... } catch (_) { /* ignore */ }` initialization side-effect silencing errors |

---

## 8. File Size Violations (§1.2 — decompose at ~800 lines)

| # | File | Est. Lines | Status |
|---|------|-----------|--------|
| V-050 | `managers/terrain-manager/internals/placeables.js` | ~2000 | **CRITICAL** — needs decomposition into placeables-model-cache.js, placeables-tree-helpers.js, placeables-removal.js |
| V-051 | `scene/ThreeSceneManager.js` | ~1100 | Over threshold — monitor or decompose |
| V-052 | `ui/UIController.js` | ~900 | Over threshold — consider extracting initialization vs event handlers |
| V-053 | `ui/components/RadialMenu.js` | ~850 | At threshold — consider extracting SVG geometry constants |

---

## 9. Test Structure Violations (§1.4 — test naming and mirroring)

| # | Issue | Details |
|---|-------|---------|
| V-054 | Duplicate test at root of `tests/unit/` | `TerrainCoordinator3DPicking.test.js` exists both at root AND in `coordinators/terrain-coordinator/` — delete root copy |
| V-055 | Duplicate test at root | `TerrainStateInternals.test.js` — same issue, delete root copy |
| V-056 | Duplicate test | `viewMode.test.js` exists both at `tests/unit/` root AND in `tests/unit/core/` — consolidate |
| V-057 | Non-standard naming | `Placeables.trees.test.js` — `.trees.` suffix is non-standard |
| V-058 | Orphaned directory | `tests/terrain/biome-painter/` is empty — delete |
| V-059 | Major test coverage gaps | 50%+ of source files have no corresponding test (see coverage table below) |

### Test Coverage Gaps (source files without tests)

| Directory | Files Without Tests | Priority |
|-----------|-------------------|----------|
| `config/` | 9 of 10 files | Low (pure data) |
| `coordinators/` (root) | InputCoordinator, RenderCoordinator, StateCoordinator, ProjectionUtils | Medium |
| `core/` | ModelAssetCache, ModelPostProcessing, PixiStub | Medium |
| `managers/` | GridRenderer, TerrainManager + all internals subdirs | High |
| `scene/token-adapter/` | All 15 files | High |
| `scene/lighting/` | LightingSystem | Low |
| `scene/grid/` | GridOverlay | Low |
| `systems/` | DragController + 7 of 8 dice files | High |
| `terrain/` | TerrainDataStore, TerrainFacesRenderer, brush/* 2 files, flora/* | Medium |
| `ui/` | UIController (~900 lines), SidebarController | High |
| `utils/` | SeededRNG, Logger, ErrorHandler, CoordinateUtils, GeometryUtils, DepthUtils, all error/* and logger/* | Medium |

---

## 10. Additional Observations

### Items compliant with conventions (positive findings)

- **All `internals/` files** correctly export plain functions (not classes)
- **All `internals/` files** use `(context, ...)` first-argument pattern
- **No circular imports** detected in `internals/` → parent relationships
- **`managers/`** class files all have proper section ordering
- **`scene/`** subdirectories (camera, grid, lighting, picking, terrain) are well-organized
- **`utils/`** domain isolation is clean (except Validation.js)
- **Import hygiene** generally strong — no wildcard imports found anywhere
- **Naming conventions** broadly followed (PascalCase classes, camelCase/kebab-case functions)
- **`d20FaceCenters.generated.js`** correctly uses `.generated.js` suffix
- **`entities/creatures/index.js`** barrel export correct

### Mixin pattern in `scene/token-adapter/`

11 files in `token-adapter/` use the mixin installer pattern (`export function installXMethods(prototype)`). While functional, this is not documented in CONVENTIONS.md. Consider:
- Documenting the mixin pattern as an accepted convention
- OR refactoring into the `internals/` pattern with `(context, ...)` first arg

### `DiceState.js` singleton pattern

`export const diceState = { ... }` exports a mutable object directly. Convention §3.2 says singletons should use `export { instance as default }`. Consider wrapping in a controlled accessor.

---

## Priority Action Items

### P0 — Fix Immediately
1. Delete empty dirs: `scene/token-adapter/internals/`, `ui/internals/`, `tests/terrain/`
2. Fix `utils/Validation.js` importing from `entities/` (§4.3 violation)
3. Decompose `managers/terrain-manager/internals/placeables.js` (~2000 lines)

### P1 — Fix Soon
4. Extract logic from config files (BiomePalettes*.js, TokenCommandConfig.js, FloraProfiles.js) into utils/
5. Reorganize `scene/token-adapter/` into subdirectories (15 files → 6 max per dir)
6. Fix `GameManager.js` dual export
7. Delete duplicate test files at `tests/unit/` root
8. Remove dead imports (GridRenderer.js Container, TerrainManager.js commented import)

### P2 — Fix When Touching These Files
9. Add missing section comments to 18 files
10. Fix export styles (5 files)
11. Rename `domHelpers.js` → `dom-helpers.js`
12. Convert `CreatureFactory` class to plain function export
13. Move/delete `PixiStub.js` from `core/`
14. Move `ProjectionUtils.js` from `coordinators/` to `utils/`

### P3 — Track
15. Improve test coverage (50%+ of source files have no tests)
16. Monitor file sizes approaching 800-line threshold
17. Consider documenting the mixin installer pattern in CONVENTIONS.md
18. Update CONVENTIONS.md target structure to reflect actual `terrain/flora/`
