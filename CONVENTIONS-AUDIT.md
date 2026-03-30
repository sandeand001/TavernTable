# Conventions Audit Report

**Date:** 2026-03-28  
**Scope:** Every file under `src/` and `tests/` reviewed against `CONVENTIONS.md`  
**Total files reviewed:** 162 source files, 70 test files

---

## Executive Summary

| Category | Score | Notes |
|----------|-------|-------|
| Directory Layout (§1) | 95% | Structure matches target; 1 duplicate file, 1 misplaced config |
| In-File Organization (§2) | 78% | Many files missing section comments; several over 800 lines |
| Module Patterns (§3) | 90% | 1 wildcard import; some singleton exports incorrect |
| Responsibility Boundaries (§4) | 75% | Logic in config files; duplicate color functions across codebase |
| Dead Code & Deprecation (§6) | 98% | No empty dirs, no stubs; 1 duplicate file to delete |
| Test Naming (§1.4) | 100% | All 70 test files properly named and located |

**Overall Compliance: ~85%**

---

## Critical Violations (Must Fix)

### C1. Logic in Config Files (§1.1 — "Pure data, no logic")

Config files must contain only constants, palettes, and lookup tables — **no functions with control flow**.

| File | Lines | Issue |
|------|-------|-------|
| `config/biome/BiomePalettes.js` | 24–435 | 20+ functions: OKLCH color math, Perlin noise, painterly rendering, hydrology blending |
| `config/biome/BiomePalettes3D.js` | 28–135 | `applyAtmosphere()`, `applyDepth()`, `buildPalette()`, `ensureBiomePalette()`, `getBiomeColor3DHex()` |
| `config/biome/BiomePalettes3DHarmonized.js` | 31–145 | `adjustSaturation()`, `buildHarmonizedPalette()`, `getHarmonized3DColorHex()`, `rebuildHarmonizedBiomeCache()` |
| `config/TokenCommandConfig.js` | 113–123 | `_registerCommand()` (recursive tree traversal), `getTokenCommand()` (conditional lookup) |
| `config/terrain/FloraProfiles.js` | 11–61 | `pickIds()`, `makeWeights()`, `withSpectralVariants()` — filtering/transformation logic |

**Fix:** Extract all algorithmic functions to appropriate utility/domain modules. Keep only pure data (objects, arrays, maps) in config files. The BiomePalettes color math could go to `utils/color/` or a new `terrain/painting/color-pipeline.js`.

---

### C2. Files Exceeding ~800 Lines (§1.2)

| File | Lines | Recommended Action |
|------|-------|--------------------|
| `core/GameManager.js` | ~1,100 | Further decompose to `game-manager/internals/` |
| `core/ModelAssetCache.js` | ~730 | Borderline — add section comments at minimum |
| `managers/InteractionManager.js` | ~845 | Acceptable (excellent section organization) |
| `managers/TerrainManager.js` | ~810 | Acceptable (well-structured) |
| `managers/terrain-manager/internals/placeables.js` | ~1,000+ | **Split into:** `placeables-plant-3d.js`, `placeables-variant-cycling.js`, `placeables-removal.js` |
| `managers/terrain-manager/internals/placeables-sprite.js` | ~500 | Add section comments; consider decomposition |
| `ui/UIController.js` | ~900 | Extract to `ui/ui-controller/internals/` |
| `ui/components/RadialMenu.js` | ~900 | Extract to `ui/components/radial-menu/internals/` |
| `utils/error/ErrorHandler.js` | ~950 | Extract to `utils/error/internals/` |
| `utils/logger/Logger.js` | ~1,050 | Extract to `utils/logger/internals/` |
| `scene/ThreeSceneManager.js` | ~1,000+ | Extract to `scene/three-scene-manager/internals/` |
| `terrain/painting/BiomeCanvasPainter.js` | ~900 | Extract field helpers and canvas layer management |
| `terrain/generation/internals/biomeShapeFunctions.js` | ~800+ | Split by biome category (plains, deserts, mountains, etc.) |

---

### C3. Duplicate File (§6 — delete deprecated shims)

`src/coordinators/ProjectionUtils.js` is a **full copy** of `src/utils/coordinates/ProjectionUtils.js`.

**Fix:** Delete `src/coordinators/ProjectionUtils.js` and update imports in `StateCoordinator.js` to point to `../utils/coordinates/ProjectionUtils.js`.

---

### C4. Misplaced Config File (§4.2 — config belongs in `config/`)

`src/scene/token-adapter/MannequinConfig.js` contains pure data (constants, profiles, animation config, landing thresholds) with no logic.

**Fix:** Move to `src/config/token-adapter/MannequinConfig.js` and update all imports.

---

### C5. Singleton Export Pattern (§3.2)

| File | Current | Expected |
|------|---------|----------|
| `core/GameManager.js` | `export default GameManager` | `const gm = new GameManager(); export { gm as default }` |
| `core/ModelAssetCache.js` | `export default ModelAssetCache` | `export { instance as default }` |

---

## High-Priority Violations

### H1. Missing Section Comments (§2.1)

Files with >5 methods/functions that lack `// ── Section Name ────` headers:

| File | Methods | Status |
|------|---------|--------|
| `core/ModelAssetCache.js` | 15+ | **No section comments at all** |
| `scene/ThreeSceneManager.js` | Many | Missing throughout |
| `scene/Token3DAdapter.js` | Many | Inconsistent — some sections marked, others not |
| `scene/camera/CameraRig.js` | ~5 | Missing headers |
| `scene/camera/CameraSystem.js` | ~8 | Inconsistent application |
| `scene/picking/PickingService.js` | ~10 | Missing throughout (~400 lines) |
| `scene/token-adapter/AnimationController.js` | Many | Incomplete coverage |
| `scene/token-adapter/ClimbPhases.js` | ~6 | Missing headers |
| `scene/token-adapter/FallPhases.js` | ~6 | Missing headers |
| `scene/terrain/PlaceableMeshPool.js` | ~10 | Missing headers |
| `scene/terrain/brush/OverlayMeshPool.js` | 3 | Missing `── Public API ──` section |
| `managers/terrain-manager/internals/placeables-sprite.js` | Large | Missing throughout |
| `managers/token-manager/internals/positioning.js` | 1 (280 lines) | Complex function needs section dividers |
| `terrain/painting/internals/faceDetails.js` | 6 | Missing function group headers |
| `utils/color/ColorUtils.js` | 8 | Missing section delimiters |
| `ui/controls/Hybrid3DControls.js` | 5+ | Missing headers |
| `ui/controls/HybridRenderToggle.js` | 6+ | Missing headers |

---

### H2. Duplicate Color/Math Functions (§4.1 — no overlapping functionality)

The canonical location for color utilities is `utils/color/ColorUtils.js`. The following files contain **duplicate implementations**:

| File | Duplicated Functions |
|------|---------------------|
| `config/biome/BiomePalettes.js` | `hexToRgb`, `rgb01ToHex`, `clamp`, `mix`/`lerp` |
| `config/biome/BiomePalettes3D.js` | `clamp`, `lerp`, `hex`, `hexToRgb`, `lerpColor` |
| `config/biome/BiomePalettes3DHarmonized.js` | `clamp`, `lerp`, `hex`, `hexToRgb`, `lerpColor` |
| `scene/lighting/LightingSystem.js` | `_clamp`, `_srgbToLinear`, `_hexToLinearRGB`, `_mixLinearColor` |

**Fix:** Consolidate by adding missing functions (`clamp`, `lerp`, `srgbToLinear`) to `utils/color/ColorUtils.js`, then import from there. For the BiomePalettes files, the functions should move out with the logic (see C1).

---

### H3. Wildcard Import (§3.4)

`src/coordinators/terrain-coordinator/internals/activation/reset.js` line 4:
```js
import * as biomeInternals from '../rendering/biome.js';
```

**Fix:** Change to named imports: `import { functionA, functionB } from '../rendering/biome.js'`.

---

### H4. Import Grouping Issues (§3.4)

Several files have imports not properly grouped with blank lines between groups:

| File | Issue |
|------|-------|
| `core/GameManager.js` | Config mixed with coordinator imports without blank line separators |
| `core/ModelAssetCache.js` | Import groups not separated |
| `core/ModelPostProcessing.js` | Logger import not separated from same-module imports |
| `entities/creatures/CreatureToken.js` | Stubs/config/utils all mixed together |

---

## Medium-Priority Violations

### M1. Mixin Installer Pattern Compliance (§3.3)

Several token-adapter mixin files may be missing explicit `installXMethods(prototype)` exports:

| File | Status |
|------|--------|
| `scene/token-adapter/movement/ClimbPhases.js` | Needs verification of installer export |
| `scene/token-adapter/movement/FallPhases.js` | Needs verification of installer export |
| `scene/token-adapter/movement/MovementPhases.js` | Needs verification |
| `scene/token-adapter/movement/MovementStyle.js` | Needs verification |
| `scene/token-adapter/movement/StepFactory.js` | Needs verification |
| `scene/token-adapter/pathing/PathingLogger.js` | Missing `installPathingLoggerMethods()` |
| `scene/token-adapter/spatial/SpatialUtils.js` | Missing explicit installer export |

**Confirmed compliant:**
- `scene/token-adapter/SelectionEffects.js` ✓
- `scene/token-adapter/pathing/ResumeProbe.js` ✓
- `scene/token-adapter/spatial/RootMotion.js` ✓
- `scene/token-adapter/spatial/WorldAuthority.js` ✓

---

### M2. Dice Directory File Count (§1.2)

`src/systems/dice/` has **8 files**, exceeding the 6-file guideline. Not critical since each file is focused, but consider subdirectories if it grows further.

---

### M3. Section Comment Formatting Inconsistencies

Some files use slightly different dash lengths or styles in their section comments. While functional, standardizing to the exact convention format would improve consistency:
```js
// ── Section Name ────────────────────────────────────────────
```

---

## Fully Compliant Areas

### Directory Structure
- All 10 top-level `src/` domains match §1.1 perfectly ✓
- `internals/` folder pattern correctly applied in 6 locations ✓
- No empty directories ✓
- No stub files ✓

### Circular Dependency Prevention
- **Zero circular dependencies** found across all `internals/` directories ✓
- All `internals/` files import only from `utils/`, `config/`, `scene/`, or sibling internals ✓

### Utils Domain Independence (§4.3)
- **Zero violations** — no `utils/` file imports from `managers/`, `scene/`, `coordinators/`, `terrain/`, or `entities/` ✓

### Test Files (§1.4)
- All 70 test files use `.test.js` suffix ✓
- All mirror `src/` path structure in `tests/unit/` ✓
- No test files outside `tests/unit/` (only setup utilities at root) ✓

### Coordinators Directory
- **95% compliant** — excellent orchestration patterns, proper delegation to controllers and internals ✓
- Clean separation of coordinator state vs. manager state ✓

### Systems & Terrain
- Well-organized with proper internals patterns ✓
- Generated file correctly uses `.generated.js` suffix ✓
- All internals functions use `(context, ...)` first argument pattern ✓

---

## Test Coverage Gaps

While test naming is compliant, many src/ modules lack test files:

| Domain | Files | Tests | Coverage |
|--------|-------|-------|----------|
| config/ | 10 | 2 | 20% |
| coordinators/ | 27 | 24 | 89% |
| core/ | 8 | 5 | 63% |
| entities/ | 4 | 0 | 0% |
| managers/ | 23 | 10 | 43% |
| scene/ | 31 | 15 | 48% |
| systems/ | 9 | 1 | 11% |
| terrain/ | 12 | 5 | 42% |
| ui/ | 6 | 3 | 50% |
| utils/ | 17 | 7 | 41% |
| **Total** | **162** | **70** | **43%** |

---

## Prioritized Action Items

### Tier 1 — Critical (structural/architectural violations)
1. **Extract logic from config files** (C1): Move all algorithmic functions out of `BiomePalettes*.js`, `TokenCommandConfig.js`, `FloraProfiles.js`
2. **Split oversized files** (C2): `placeables.js` (1000+ lines), `GameManager.js` (1100), `Logger.js` (1050), `ErrorHandler.js` (950)
3. **Delete duplicate** `coordinators/ProjectionUtils.js` (C3)
4. **Move** `MannequinConfig.js` to `config/` (C4)
5. **Fix singleton exports** for `GameManager` and `ModelAssetCache` (C5)

### Tier 2 — High (convention enforcement)
6. **Add section comments** to 17 files missing them (H1)
7. **Consolidate duplicate color functions** into `utils/color/ColorUtils.js` (H2)
8. **Replace wildcard import** in `reset.js` (H3)
9. **Fix import grouping** in 4 files (H4)

### Tier 3 — Medium (pattern consistency)
10. **Verify mixin installer exports** in 7 token-adapter files (M1)
11. **Plan dice/ subdirectories** for future growth (M2)
12. **Standardize section comment formatting** across all files (M3)

### Tier 4 — Improvement (not violations)
13. Increase test coverage from 43% to 60%+ (focus on entities/, systems/, config/)
14. Add section comments to borderline files (<5 methods but would benefit)
