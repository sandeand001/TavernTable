# CONVENTIONS.md Compliance Audit Report

**Date:** 2026-03-30  
**Scope:** All 168 source files under `src/` (42,457 LOC), 70 test files under `tests/`  
**Audited against:** CONVENTIONS.md §1–§7

---

## Executive Summary

| Metric | Value |
|--------|-------|
| Total files audited | 168 source + 70 test |
| Fully compliant files | **~145 / 168 (86%)** |
| Critical violations | **6** |
| Major violations | **9** |
| Minor violations | **5** |
| Files over 800 LOC | **3** (ThreeSceneManager 965, ClimbPhases 938, TerrainConstants 1093) |
| Files approaching 800 LOC | **5** (PlaceableMeshPool 772, AnimationController 750, Navigation 746, UIController 782, BiomePalettes 776) |

The codebase is in **good overall health**. The `internals/` pattern, mixin installers, test naming, import hygiene, utils domain isolation, and dead code policy are all well-followed. The primary issues are: (1) config files containing algorithmic logic, (2) two files exceeding 800 LOC that could be split, and (3) scattered section comment gaps in class files.

---

## CRITICAL Violations

### 1. `config/biome/BiomePalettes.js` — Logic in config (§4.2, §1.1)

**776 lines | Contains ~17 algorithmic functions in a config file**

The file itself acknowledges the violation on line 1:
> `// NOTE: §4 violation — algorithmic functions here are tightly coupled to palette data.`

Functions like `srgbToLinear01`, `oklabToRgb01`, `hexToOklch`, `lerpOklch`, `fbm2`, `generateHeightGradient`, `getBiomeColor`, `getBiomeColorHex`, and `getBiomeColorWithHydrology` are all algorithmic — they belong in `utils/color/` or a dedicated `terrain/painting/` helper, not in config.

**Impact:** Violates the core principle that `config/` = pure data, no logic.  
**Risk:** Medium — functions are tightly coupled to the data, so extraction requires careful refactoring.  
**Recommendation:** Extract color-space conversion functions to `utils/color/OklchUtils.js`. Extract biome color lookup functions to `terrain/painting/biome-color-lookup.js`. Keep only data tables (`BIOME_BASE_TRIADS`, stop definitions) in the config file.

---

### 2. `config/biome/BiomePalettes3D.js` — Logic in config (§4.2)

**184 lines | Contains `applyAtmosphere()`, `applyDepth()`, `buildPalette()`, `ensureBiomePalette()` + exports functions**

Line 1 acknowledges: `// NOTE: §4 violation`

Exports `registerCustom3DBiomePalette`, `getBiomeColor3DHex`, and a default function object — all logic, not data.

**Recommendation:** Move functions to a palette builder module. Keep only `BIOME_3D_BASE_TRIADS` in config.

---

### 3. `config/biome/BiomePalettes3DHarmonized.js` — Logic in config (§4.2)

**129 lines | Contains `applyAtmosphere()`, `applyDepth()`, `adjustSaturation()`, `buildHarmonizedPalette()`, `ensureHarmonyPalette()`**

Line 1 acknowledges: `// NOTE: §4 violation`

Same pattern as the other two palette files. Exports `getHarmonized3DColorHex`, `rebuildHarmonizedBiomeCache` — logic, not data.

**Recommendation:** Consolidate all three palette builder functions into one `terrain/painting/palette-builder.js` module.

---

### 4. `config/terrain/FloraProfiles.js` — Utility functions in config (§4.2)

**98 lines | Contains `pickIds()`, `makeWeights()`, `withSpectralVariants()`**

Line 3 acknowledges: `// NOTE: §4 violation`

These helper functions are called at import-time to construct the `BIOME_FLORA_PROFILES` data. While the result is data, the process of building it is logic.

**Recommendation:** Move `pickIds`, `makeWeights`, `withSpectralVariants` to `terrain/flora/floraHelpers.js` (which already exists), then import them in FloraProfiles.

---

### 5. `scene/ThreeSceneManager.js` — Exceeds 800 LOC (§1.2)

**965 lines | Class with 5 section comments**

This is the largest class file in the codebase. It has proper section comments (`Constructor`, `Lifecycle`, `Public API`, `Private Helpers`, `Cleanup`) and already delegates via mixin installers (lighting, grid overlay, camera). However, it exceeds the 800-line guideline by 165 lines.

**Can it be split safely?** Yes. The `Lifecycle` section (line 109–439) contains initialization logic spanning 330 lines — scene setup, renderer creation, shadow configuration, terrain mesh init, instanced mesh creation. This could be extracted to `scene/three-scene-manager/internals/init.js`. The `Cleanup` section (line 917–965) could also be extracted.

**Recommendation:** Create `scene/three-scene-manager/internals/` with `init.js` (~300 lines) and optionally `cleanup.js` (~50 lines). This would bring the parent class to ~615 lines.

---

### 6. `scene/token-adapter/movement/ClimbPhases.js` — Exceeds 800 LOC (§1.2)

**938 lines | Mixin installer with 9 section comments**

The file is well-organized with clear sections: State Reset Helpers, Climb Resolution Helpers, Climb Landing, Standard Climb Phase, Wall Climb Sequence, Climb Phase Advancement, Climb Recover Phase, Climb Advance Phase, Module Installation. The climb animation system is inherently complex and the sections are logically cohesive.

**Can it be split safely?** Partially. The Wall Climb Sequence (line 346–652, ~306 lines) is the largest section and could be extracted to a separate file. However, each climb phase shares local helper functions and state management. Splitting may require passing additional context or duplicating helper references.

**Recommendation:** Consider extracting `climb-wall.js` with the Wall Climb Sequence (~306 lines), which would bring ClimbPhases.js to ~632 lines. The helper functions they share could be placed in a `climb-helpers.js`. However, if this creates excessive parameter-passing overhead or coupling, keeping the file unified at 938 lines is defensible given its singular, cohesive concern.

---

## MAJOR Violations

### 7. `config/TokenCommandConfig.js` — Function exports from config (§4.2)

**150 lines | Has `_registerCommand()` and `export function getTokenCommand()`**

Line 140 notes: `// NOTE: §4 violation — _registerCommand builds the tree lazily at import time`

The file exports `getTokenCommand()`, a lookup function. While this is a thin data-access wrapper, it technically violates the "config = pure data" rule.

**Recommendation:** Either move `getTokenCommand()` to a separate `config/token-adapter/token-command-lookup.js` utility, or document an explicit exception since it's a simple lookup into exported data.

---

### 8. `config/biome/PaletteDesign.js` — Function export from config (§3.2)

**90 lines | Exports `getBiomeDesign()` function at line 88**

This is a simple object lookup function, not algorithmic logic. Low severity.

**Recommendation:** Accept as minor exception or inline the lookup into consumers.

---

### 9. `ui/UIController.js` — Approaching 800 LOC + ordering violation (§1.2, §2.2)

**782 lines | Module file with reversed section order**

The file places `// ── Private Helpers ──` (line 49) before `// ── Public API ──` (line 179). Per §2.2, module files should order: Imports → Constants → **Public API** → **Private Helpers**. This file has them reversed.

Additionally at 782 lines, any new feature will push it over the 800-line threshold.

**Recommendation:** 
1. Reorder sections to match §2.2: move Public API above Private Helpers.
2. Plan extraction into `ui/ui-controller/internals/` with modules for terrain controls, creature panel, grid sizing, etc.

---

### 10. `core/ModelAssetCache.js` — Missing class section comments (§2.1, §2.3)

**713 lines | Has partial section comments but lacks full class sectioning**

Has `// ── Imports & Logging Helpers ──` and `// ── Constants & Tropical Entry Builder ──` at module level, but the class body lacks the required `// ── Constructor ──`, `// ── Lifecycle ──`, `// ── Public API ──`, `// ── Private Helpers ──` section markers.

**Recommendation:** Add standard class section comments per §2.3.

---

### 11. `managers/GridRenderer.js` — Missing section comments (§2.1)

**214 lines | No horizontal-rule section markers inside class**

Class is small but lacks any `// ── Section ──` markers.

**Recommendation:** Add `// ── Constructor ──`, `// ── Public API ──`, `// ── Private Helpers ──` markers.

---

### 12. `managers/TokenManager.js` — Incomplete section comments (§2.1)

**202 lines | Has partial sections, missing Constants + full class structure**

Has `// ── Constructor & State Accessors ───` but lacks `// ── Constants ──` before the class for module-level constants (`DEFAULT_TOKEN_TYPE`, `LEGACY_TOKEN_ALIASES`, `normalizeTokenType`), and lacks `// ── Lifecycle ──`, `// ── Public API ──`, `// ── Private Helpers ──` inside the class.

**Recommendation:** Add missing section headers.

---

### 13. `managers/InteractionManager.js` — Incomplete section comments (§2.3)

**726 lines | Has Constructor and Lifecycle sections but missing Event Handlers and Private Helpers sections**

Has `// ── Constructor ──` (line 50), `// ── Lifecycle ──` (line 90), `// ── Event Setup ──` (line 101), but lacks `// ── Public API ──`, `// ── Event Handlers ──`, and `// ── Private Helpers ──` section markers.

**Recommendation:** Add missing section headers for Public API, Event Handlers, and Private Helpers.

---

### 14. `managers/TerrainManager.js` — Incomplete section comments (§2.3)

**708 lines | Has Constructor and Public API but missing Private Helpers section**

Has `// ── Constructor ──` (line 57), `// ── Public API ──` (line 87), `// ── Lifecycle ──` (line 121), but lacks `// ── Event Handlers ──`, `// ── Private Helpers ──`, `// ── Accessors ──` sections.

**Recommendation:** Add missing section headers.

---

### 15. `coordinators/TerrainCoordinator.js` — Import grouping (§3.4)

**686 lines | Imports not grouped per convention**

Lines 5–76: imports from utils, config, terrain, coordinators, and internals are intermixed. Per §3.4 they should be grouped: (1) third-party → (2) config → (3) same-domain siblings → (4) cross-domain, with blank lines between groups.

**Recommendation:** Reorganize imports into proper groups with blank-line separators.

---

## MINOR Violations

### 16. `coordinators/InputCoordinator.js` — Import grouping (§3.4)

**172 lines | Mixed utils imports without blank-line separation**

Logger, GameErrors, GameValidators, CoordinateUtils imports could be grouped more clearly.

---

### 17. `coordinators/RenderCoordinator.js` — Import grouping (§3.4)

**306 lines | PixiStub, config, and utils imports not clearly separated**

Missing blank lines between import groups.

---

### 18. `entities/creatures/CreatureToken.js` — Missing class section headers (§2.3)

**286 lines | Has Constructor section but lacks subsequent sections**

Has `// ── Constructor & Validation ───` but no `// ── Public API ──`, `// ── Private Helpers ──` sections after.

---

### 19. `entities/creatures/creatureHelpers.js` — Missing section header (§2.4)

**29 lines | Private data lacks section comment**

`CREATURE_COLORS` and `CREATURE_TYPE_ALIASES` defined before the main export without a `// ── Private Data ──` section header.

---

### 20. `core/ModelPostProcessing.js` — Missing Private Helpers section (§2.2)

**325 lines | Has Public API section but lacks Private Helpers demarcation**

Functions after the main export lack a `// ── Private Helpers ──` marker.

---

## Files Over 800 LOC Analysis

| File | Lines | Pure Data? | Can Split? | Recommendation |
|------|------:|:----------:|:----------:|----------------|
| `config/terrain/TerrainConstants.js` | 1,093 | **Yes** | No — it's all config objects | **Acceptable.** Pure data file, no logic. Splitting would fragment related constants. |
| `scene/ThreeSceneManager.js` | 965 | No | **Yes** | Extract init logic to `internals/init.js` (~300 lines) |
| `scene/token-adapter/movement/ClimbPhases.js` | 938 | No | **Partially** | Extract Wall Climb Sequence (~306 lines) if safe; otherwise accept with documentation |

---

## Files Approaching 800 LOC (Watch List)

| File | Lines | Trend | Action |
|------|------:|-------|--------|
| `ui/UIController.js` | 782 | Growing | **Refactor soon** — already has ordering violation |
| `config/biome/BiomePalettes.js` | 776 | Stable | Will shrink when logic extracted per Critical #1 |
| `scene/terrain/PlaceableMeshPool.js` | 772 | Stable | Already has lifecycle extracted; monitor |
| `scene/token-adapter/AnimationController.js` | 750 | Growing | Plan `internals/` extraction before 800 |
| `scene/token-adapter/pathing/Navigation.js` | 746 | Growing | Plan `internals/` extraction before 800 |

---

## Areas of Strong Compliance

These aspects of the codebase are **exemplary**:

1. **`internals/` pattern** — All 60+ internals files across 8 parent modules correctly export plain functions with `(context, ...)` as first parameter. Zero circular dependency violations.

2. **Mixin installer pattern** — All mixin files (ClimbPhases, FallPhases, CameraSystem, LightingSystem, GridOverlay, AnimationController, etc.) correctly export a single `installXMethods(prototype)` function.

3. **`utils/` domain isolation** (§4.3) — All 20 utility files have zero imports from domain modules (managers, scene, coordinators, terrain, entities). Perfect compliance.

4. **Dead code policy** (§6) — No commented-out code found. No empty directories. No stub files (<5 lines). PixiStub is actively used and documented.

5. **Test naming** (§1.4) — All 70 test files follow `<SourceName>.test.js` naming and mirror the `src/` directory structure.

6. **Export patterns** (§3.2) — Classes use `export default class`, function modules use named exports, singletons use the correct pattern. No `export default { fn1, fn2 }` anti-patterns found.

7. **Naming conventions** (§1.4) — PascalCase for class/config files, camelCase/kebab-case for function files, `.generated.js` suffix for generated files. Full compliance.

8. **No wildcard imports** (§3.4) — Zero `import *` statements found across the entire codebase.

---

## Priority Action Plan

### Immediate (High Impact, Low Risk)
1. Add missing section comments to `ModelAssetCache.js`, `GridRenderer.js`, `TokenManager.js`, `InteractionManager.js`, `TerrainManager.js`, `CreatureToken.js` — pure formatting, zero behavioral change.
2. Fix import grouping in `TerrainCoordinator.js`, `InputCoordinator.js`, `RenderCoordinator.js` — reorder with blank lines.
3. Fix `UIController.js` section ordering — move Public API above Private Helpers per §2.2.

### Short-term (Moderate Impact, Low-Medium Risk)
4. Extract `ThreeSceneManager.js` init logic to `internals/init.js` (~300 lines).
5. Extract helper functions from `FloraProfiles.js` to `terrain/flora/floraHelpers.js`.
6. Plan `UIController.js` decomposition into `ui/ui-controller/internals/`.

### Medium-term (High Impact, Medium Risk)
7. Extract algorithmic functions from `BiomePalettes.js`, `BiomePalettes3D.js`, `BiomePalettes3DHarmonized.js` to utility/domain modules, keeping only data tables in config.
8. Evaluate `ClimbPhases.js` for safe decomposition of Wall Climb Sequence.

### Deferred (Low Priority)
9. Monitor `AnimationController.js` (750), `Navigation.js` (746), `PlaceableMeshPool.js` (772) for growth.
10. Consider moving `getTokenCommand()` out of `TokenCommandConfig.js`.
11. Consider moving `getBiomeDesign()` out of `PaletteDesign.js`.

---

*End of audit report.*
