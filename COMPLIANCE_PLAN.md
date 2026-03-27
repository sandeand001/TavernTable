# Taverntable — Convention Compliance Remediation Plan

**Ref:** [COMPLIANCE_REPORT.md](COMPLIANCE_REPORT.md)  
**Approach:** Small, safe batches grouped by risk level. Each phase ends with a
**GATE** — run the app in the browser and run `npm test` before proceeding.

> Mark each gate ✅ when you've verified everything works.

---

## Phase 1 — Zero-Risk Cleanup (no import changes, no logic moves)

These changes cannot break anything. They only delete unused things and add
comments to existing files.

### 1A. Delete empty directories

| Item | Action |
|------|--------|
| `src/core/model-cache/` | Delete directory |
| `src/scene/assets/` | Delete directory |
| `src/scene/scene-manager/` | Delete directory |
| `src/scene/terrain-brush/` | Delete directory |
| `src/ui/lib/` | Delete directory |

### 1B. Delete dead stub files

| Item | Action |
|------|--------|
| `src/terrain/painting/biome-painter/index.js` | Delete (empty barrel, zero importers) |
| `src/terrain/painting/biome-painter/style.js` | Delete (empty comment-only file, zero importers) |

### 1C. Fix broken config file

| Item | Action |
|------|--------|
| `src/config/terrain/TerrainPlaceables.js` | Move `TREE_PLACEABLES` and related data ABOVE the export. Merge into the `TERRAIN_PLACEABLES` object so nothing is orphaned. Fix the dual named+default export to use a single named export. |

### ──── GATE 1 ────
- [ ] `npm test` passes
- [ ] App loads in browser
- [ ] Terrain renders correctly (TerrainPlaceables fix)
- [ ] Placeables/trees appear on map

---

## Phase 2 — Section Comments & In-File Formatting (cosmetic, no logic changes)

Add missing section comments and fix comment format. Reorder methods within
files to match convention. These are formatting-only changes — no exports,
imports, or logic are altered.

### 2A. Add missing section comments (10 files)

| File | Add |
|------|-----|
| `src/config/TokenCommandConfig.js` | `── Constants ──`, `── Data Tables ──`, `── Derived Constants ──` |
| `src/config/biome/BiomePalettes.js` | `── Constants ──` at start |
| `src/config/biome/PaletteDesign.js` | `── Data Tables ──` at top |
| `src/utils/SeededRNG.js` | `── Public API ──` |
| `src/utils/color/ColorUtils.js` | `── Public API ──` |
| `src/utils/coordinates/ProjectionUtils.js` | `── Public API ──`, `── Private Helpers ──` |
| `src/scene/terrain/OverlayMeshPool.js` | `── Public API ──` at top |
| `src/scene/terrain/OverlayOutlinePool.js` | `── Public API ──` at top |
| `src/scene/token-adapter/AnimationController.js` | `── Animation Mixins ──` before first function |
| `src/ui/UIController.js` | `── Constants ──`, `── Public API ──` |

### 2B. Fix comment format (2 files)

| File | Fix |
|------|-----|
| `src/scene/token-adapter/MeshFactory.js` | Replace `/* ---- */` with `// ── Section ────` |
| `src/scene/token-adapter/SelectionEffects.js` | Replace `/* ---- */` with `// ── Section ────` |

### 2C. Add missing `── Constants ──` sections (3 files)

| File | Fix |
|------|-----|
| `src/systems/dice/DiceState.js` | Add `── Constants ──` header |
| `src/systems/dice/dice.js` | Add `── Constants ──` header |
| `src/systems/dice/dice3d.js` | Add `── Constants ──` header |

### 2D. Reorder class methods (1 file)

| File | Fix |
|------|-----|
| `src/ui/SidebarController.js` | Reorder methods: Constructor → Lifecycle → Public API → Event Handlers → Private Helpers → Accessors |

### 2E. Reorder module file sections (7 files)

Move private helpers below public API in each:

| File |
|------|
| `src/systems/dice/DiceAnimationScheduler.js` |
| `src/systems/dice/DiceModelManager.js` |
| `src/systems/dice/DicePhysics.js` |
| `src/systems/dice/FaceCalibrationUI.js` |
| `src/systems/dice/dice.js` |
| `src/systems/dice/dice3d.js` |
| `src/systems/DragController.js` |

### ──── GATE 2 ────
- [ ] `npm test` passes
- [ ] App loads in browser
- [ ] Dice rolling works
- [ ] Sidebar controls work

---

## Phase 3 — Import Hygiene (reorder import statements only)

Reorder import lines to match convention: third-party → config → same-domain →
cross-domain, with blank line separators. No paths change, just the line order.

### 3A. Fix import grouping (13 files)

| File | Change |
|------|--------|
| `src/coordinators/RenderCoordinator.js` | Move `GRID_CONFIG` import above utils imports |
| `src/coordinators/StateCoordinator.js` | Move `GRID_CONFIG` import above utils imports |
| `src/coordinators/terrain-coordinator/BiomeShadingController.js` | Group: config → cross-domain(terrain) → utils |
| `src/coordinators/terrain-coordinator/ElevationVisualsController.js` | Group: third-party(PixiStub) → config → utils |
| `src/core/GameManager.js` | Regroup all imports by domain with blank separators |
| `src/entities/creatures/CreatureFactory.js` | Move config before same-domain |
| `src/entities/creatures/CreatureToken.js` | Move PixiStub import to proper group |
| `src/systems/dice/DiceState.js` | Add blank line between groups |
| `src/systems/dice/dice.js` | Move config above utils |
| `src/systems/dice/dice3d.js` | Add blank line between groups |
| `src/ui/SidebarController.js` | Add blank separator between same-domain and cross-domain |
| `src/ui/UIController.js` | Full regroup: config → same-domain → cross-domain |
| `src/scene/ThreeSceneManager.js` | Move config to correct group position |

### 3B. Fix import syntax error (1 file)

| File | Change |
|------|--------|
| `src/managers/terrain-manager/internals/placeables-sprite.js` | Change `import logger, { LOG_CATEGORY }` → `import { logger, LOG_CATEGORY }` |

### ──── GATE 3 ────
- [ ] `npm test` passes
- [ ] App loads in browser
- [ ] Token placement works
- [ ] Terrain painting works

---

## Phase 4 — Private Function Naming (rename only, no logic changes)

Add `_` prefix to private/unexported functions. Each file must also update all
internal call sites within the same file.

### 4A. Entities (1 file, 3 renames)

| File | Renames |
|------|---------|
| `src/entities/creatures/CreatureToken.js` | `createFallbackGraphics` → `_createFallbackGraphics`, `createFallbackSprite` → `_createFallbackSprite`, `applyFacing` → `_applyFacing` |

### 4B. Dice subsystem (6 files, ~26 renames)

| File | Renames |
|------|---------|
| `src/systems/dice/DiceAnimationScheduler.js` | `easeOutCubic` → `_easeOutCubic`, `randomBetween` → `_randomBetween`, `hasWindow` → `_hasWindow`, `mergePathInfos` → `_mergePathInfos`, `createLinearPath` → `_createLinearPath` |
| `src/systems/dice/DiceModelManager.js` | `applyDiceMaterialTuning` → `_applyDiceMaterialTuning` |
| `src/systems/dice/DicePhysics.js` | `normalize2D` → `_normalize2D`, `reflectVector2D` → `_reflectVector2D`, `deriveBounceIntensity` → `_deriveBounceIntensity`, `collectCollisionObstacles` → `_collectCollisionObstacles`, `findPathCollision` → `_findPathCollision`, `createLinearPath` → `_createLinearPath`, `mergePathInfos` → `_mergePathInfos` |
| `src/systems/dice/FaceCalibrationUI.js` | `getCalibrationSequence` → `_getCalibrationSequence`, `cycleCalibrationFace` → `_cycleCalibrationFace`, `handleCalibrationPointer` → `_handleCalibrationPointer` |
| `src/systems/dice/dice.js` | `maybePlay3DDice` → `_maybePlay3DDice`, `getDiceButtons` → `_getDiceButtons`, `getDiceCountEl` → `_getDiceCountEl`, `getDiceResultEl` → `_getDiceResultEl` |
| `src/systems/dice/dice3d.js` | `clearActiveDie` → `_clearActiveDie`, `resolvePrimaryCamera` → `_resolvePrimaryCamera`, `resolvePrimaryDomElement` → `_resolvePrimaryDomElement`, `attachDiceAccentLights` → `_attachDiceAccentLights`, `attachDieDismissOnClick` → `_attachDieDismissOnClick` |

### 4C. Terrain files (3 files, ~28 renames)

| File | Renames |
|------|---------|
| `src/terrain/brush/BrushCommon.js` | `computeBrushRadii` → `_computeBrushRadii` |
| `src/terrain/generation/BiomeElevationGenerator.js` | All 26+ `shape*` functions → `_shape*` |
| `src/terrain/painting/biome-painter/fields.js` | `computeDistanceField` → `_computeDistanceField` |

### ──── GATE 4 ────
- [ ] `npm test` passes
- [ ] App loads in browser
- [ ] Dice rolling works (dice subsystem touched heavily)
- [ ] Terrain generation works (biome shapers renamed)
- [ ] Token creatures render correctly

---

## Phase 5 — Export Style Fixes (4 files)

### 5A. Fix export patterns

| File | Change |
|------|--------|
| `src/terrain/brush/TerrainBrushHighlighter.js` | Remove `export default { buildBrushHighlightDescriptor }` — keep only the named export |
| `src/systems/DragController.js` | Remove `window.` global assignments; keep only ES6 exports |
| `src/ui/controls/SettingsViewToggle.js` | Convert IIFE to normal function + add `export { initViewToggle }` |

### ──── GATE 5 ────
- [ ] `npm test` passes
- [ ] App loads in browser
- [ ] Drag-and-drop tokens works
- [ ] Terrain brush highlighting works
- [ ] Settings view toggle (2D/3D) works

---

## Phase 6 — File Moves (import paths change across codebase)

Each move requires updating every importer. Do one move at a time, test, then
continue.

### 6A. Move overlay files to brush/ subdirectory

| From | To |
|------|----|
| `src/scene/terrain/OverlayMeshPool.js` | `src/scene/terrain/brush/OverlayMeshPool.js` |
| `src/scene/terrain/OverlayOutlinePool.js` | `src/scene/terrain/brush/OverlayOutlinePool.js` |

Update all importers.

### ──── GATE 6A ────
- [ ] `npm test` passes
- [ ] Terrain brush overlay renders in 3D mode

### 6B. Move ErrorHandler.js and Logger.js to subdirectories

| From | To |
|------|----|
| `src/utils/ErrorHandler.js` | `src/utils/error/ErrorHandler.js` |
| `src/utils/Logger.js` | `src/utils/logger/Logger.js` |

Update **every importer across the entire codebase** (these are imported
everywhere).

### ──── GATE 6B ────
- [ ] `npm test` passes
- [ ] App loads in browser
- [ ] No console errors (logging/error handling wiring intact)

### 6C. Group terrain-coordinator internals into subdirectories

| Files | Move to |
|-------|---------|
| `apply.js`, `init.js`, `mode.js`, `reset.js`, `state.js` | `internals/activation/` |
| `brush.js`, `inputs.js`, `tools.js` | `internals/brush/` |
| `biome.js`, `color.js`, `baseGridUpdates.js` | `internals/rendering/` |
| `coords.js`, `height.js`, `resize.js` | `internals/spatial/` |
| `container.js`, `deps.js`, `flora.js`, `validation.js` | Stay in `internals/` (loose) |

Update all imports in TerrainCoordinator.js and its controllers.

### ──── GATE 6C ────
- [ ] `npm test` passes
- [ ] App loads in browser
- [ ] Terrain mode activation works
- [ ] Brush painting works
- [ ] Grid resize works

---

## Phase 7 — Logic Extraction from Config (responsibility boundary fixes)

These are the most delicate changes — logic is being moved from `config/` into
domain modules. Each sub-phase moves one file's logic at a time.

### 7A. Extract logic from GameConstants.js

1. Move `normalizeCreatureType()` → `src/utils/Validation.js` (or a new `src/entities/creatures/creatureHelpers.js`)
2. Move `VALIDATION` object methods → `src/utils/Validation.js`
3. Move `CREATURE_HELPERS` methods → `src/entities/creatures/creatureHelpers.js`
4. Keep only pure constants, enums, and data tables in `GameConstants.js`
5. Update all importers

### ──── GATE 7A ────
- [ ] `npm test` passes
- [ ] Creature token placement works
- [ ] Grid size validation works

### 7B. Extract logic from TokenCommandConfig.js

1. Move `registerCommand()` and `getTokenCommand()` → `src/ui/tokenCommands.js` (or similar domain file)
2. Move `TOKEN_COMMAND_LOOKUP` computation → same target file
3. Keep only the static `TOKEN_COMMANDS` array in config
4. Update all importers

### ──── GATE 7B ────
- [ ] `npm test` passes
- [ ] Radial menu / token commands work

### 7C. Extract logic from BiomePalettes.js, BiomePalettes3D.js, BiomePalettes3DHarmonized.js

1. Move shared color math (`clamp`, `lerp`, `hexToRgb`, `rgbToHex`, `lerpColor`, etc.) → `src/utils/color/ColorUtils.js` (consolidate with existing)
2. Move noise functions (`hash2D`, `smoothNoise`, `fbm2`) → `src/terrain/generation/NoisePrimitives.js` (already exists)
3. Move palette generation functions → `src/terrain/painting/paletteGenerator.js` (new file)
4. Move 3D atmosphere/depth functions → `src/scene/terrain/terrainColorUtils.js` (new file)
5. Keep only final data tables and palette definitions in config
6. Update all importers

### ──── GATE 7C ────
- [ ] `npm test` passes
- [ ] App loads in browser
- [ ] Biome colors render correctly (2D and 3D)
- [ ] Height-based coloring correct

### 7D. Extract logic from PaletteDesign.js

1. Move `getBiomeDesign()` → `src/terrain/painting/paletteGenerator.js` (created in 7C)
2. Keep only the static design data table in config
3. Update importers

### ──── GATE 7D ────
- [ ] `npm test` passes
- [ ] Biome palette design lookup works

### 7E. Extract logic from FloraProfiles.js (largest change)

1. Create `src/terrain/flora/` directory
2. Move all filter/helper functions → `src/terrain/flora/floraFilters.js`
3. Move `hash32`, `pickIds`, `makeWeights` → `src/terrain/flora/floraSelection.js`
4. Move `relocateTropicalCandidate`, `candidateFilters` → `src/terrain/flora/candidateFilters.js`
5. Keep only `BIOME_FLORA_PROFILES` data, `SPECTRAL_VARIANTS` data in config
6. Update all importers

### ──── GATE 7E ────
- [ ] `npm test` passes
- [ ] App loads in browser
- [ ] Flora/trees generate correctly across ALL biome types
- [ ] Tropical biome flora correct
- [ ] Spectral variant placeables correct

---

## Phase 8 — ProjectionUtils Domain Knowledge Fix

### 8A. Refactor ProjectionUtils.js

1. Move `ProjectionUtils.js` from `src/utils/coordinates/` → `src/coordinators/projectionHelpers.js` (or `src/managers/projectionHelpers.js`), since it inherently needs gameManager context
2. Alternatively, refactor functions to accept primitive parameters instead of `gameManager` (e.g., `applyIsometricPosition(tileWidth, tileHeight, ...)` instead of `applyIsometricPosition(gameManager, ...)`)
3. Update all importers

### ──── GATE 8 ────
- [ ] `npm test` passes
- [ ] App loads in browser
- [ ] Token positions correct in both 2D and 3D
- [ ] Placeables positioned correctly
- [ ] Reprojection on view mode toggle works

---

## Phase 9 — Large File Decomposition

Each file is split into a facade + internals/. Do one file at a time.

### 9A. TerrainCoordinator.js (~1195 → ≤800 lines)

Extract: `generateBiomeElevationIfFlat()`, `generateBiomeElevation()`,
`_clearAllBiomeFlora()` → `terrain-coordinator/internals/activation/generation.js`

### ──── GATE 9A ────
- [ ] `npm test` passes
- [ ] Biome auto-generation works

### 9B. GameManager.js (~1000 → ≤800 lines)

Extract initialization/wiring methods → `core/game-manager/internals/init.js`

### ──── GATE 9B ────
- [ ] `npm test` passes
- [ ] Full app boot-up works

### 9C. TerrainManager.js (~1100 → ≤800 lines)

Extract `reapplyElevationScaleToOverlay()`, `renderBrushPreview()`,
`clearBrushPreview()` → `managers/terrain-manager/internals/preview.js`

### ──── GATE 9C ────
- [ ] `npm test` passes
- [ ] Brush preview renders
- [ ] Elevation overlay renders

### 9D. BiomeElevationGenerator.js (~1100 → ≤800 lines)

Extract 26+ `_shape*` functions → `terrain/generation/biome-elevation-generator/internals/shapers.js`

### ──── GATE 9D ────
- [ ] `npm test` passes
- [ ] All biome shapes generate correctly

### 9E. BiomeCanvasPainter.js (~1200 → ≤800 lines)

Extract rendering helpers → `terrain/painting/biome-canvas-painter/internals/`

### ──── GATE 9E ────
- [ ] `npm test` passes
- [ ] Canvas biome painting renders correctly

### 9F. SidebarController.js (~933 → ≤800 lines)

Extract biome menu building → `ui/sidebar-controller/internals/biomeMenu.js`

### ──── GATE 9F ────
- [ ] `npm test` passes
- [ ] Sidebar biome menu works

### 9G. UIController.js (~920 → ≤800 lines)

Extract terrain tool controls → `ui/ui-controller/internals/terrainTools.js`

### ──── GATE 9G ────
- [ ] `npm test` passes
- [ ] All UI controls work

### 9H. Logger.js (~900 → ≤800 lines)

Extract handler classes → `utils/logger/internals/handlers.js`

### ──── GATE 9H ────
- [ ] `npm test` passes
- [ ] Console logging works
- [ ] No error handler regressions

### 9I. ThreeSceneManager.js & Token3DAdapter.js

Verify line counts. If over 800, extract methods to
`scene/scene-internals/` and `scene/token-adapter/internals/` respectively.

### ──── GATE 9I ────
- [ ] `npm test` passes
- [ ] 3D scene renders
- [ ] 3D tokens render and animate

---

## Phase 10 — Test Structure Reorganization

### 10A. Create mirrored directory structure in tests/unit/

Create subdirectories:
```
tests/unit/config/
tests/unit/config/biome/
tests/unit/coordinators/
tests/unit/coordinators/terrain-coordinator/
tests/unit/core/
tests/unit/entities/creatures/
tests/unit/managers/
tests/unit/managers/token-manager/
tests/unit/scene/
tests/unit/scene/camera/
tests/unit/scene/picking/
tests/unit/scene/terrain/
tests/unit/systems/
tests/unit/systems/dice/
tests/unit/terrain/
tests/unit/terrain/generation/
tests/unit/terrain/painting/
tests/unit/terrain/painting/biome-painter/
tests/unit/ui/
tests/unit/utils/
tests/unit/utils/color/
tests/unit/utils/canvas/
tests/unit/utils/coordinates/
tests/unit/utils/terrain/
```

### 10B. Move all 69 test files to mirrored paths

Move each test to the subdirectory matching its source file's location in `src/`.

### 10C. Move misplaced test

`tests/terrain/biome-painter/fields.test.js` → `tests/unit/terrain/painting/biome-painter/fields.test.js`

### 10D. Update jest.config.js if needed

Ensure `testMatch` or `roots` still finds tests in the new structure.

### ──── GATE 10 ────
- [ ] `npm test` passes (all 69 tests found and run)
- [ ] No test regressions

---

## Phase 11 — Remaining Housekeeping

### 11A. Resolve PixiStub.js placement
- Move to `src/utils/compat/PixiStub.js` or leave in `core/` with a comment explaining why
- Update importers if moved

### ──── GATE 11 ────
- [ ] `npm test` passes
- [ ] App loads in browser
- [ ] Full smoke test: tokens, terrain, dice, sidebar, 3D toggle all work

---

## Summary

| Phase | Risk | Files Touched | Focus |
|-------|------|--------------|-------|
| **1** | None | 8 | Delete dead code & empty dirs |
| **2** | None | ~23 | Section comments & method ordering |
| **3** | Low | 14 | Import line reordering |
| **4** | Low | 10 | Rename private functions |
| **5** | Low | 3 | Fix export patterns |
| **6** | Medium | ~40+ | File moves + import path updates |
| **7** | High | ~30+ | Logic extraction from config/ |
| **8** | High | ~10+ | ProjectionUtils domain fix |
| **9** | Medium | 10 | Large file decomposition |
| **10** | Low | 69 | Test directory restructure |
| **11** | Low | 2 | Final housekeeping |

**Total gates: 20** — each one is a checkpoint to verify in browser + tests.
