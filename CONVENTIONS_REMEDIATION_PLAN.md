# Conventions Remediation Plan

**Created**: March 27, 2026  
**Baseline**: 72/73 test suites passing (3 pre-existing failures in Token3DAdapter.test.js)  
**Note**: 800-line limit is a soft guideline, not a hard requirement.

---

## Phase 1 — Cleanup: Empty Dirs, Dead Code, Duplicates
*Zero-risk changes. No logic changes, no import rewiring.*

| Step | Violation | Task | Status |
|------|-----------|------|--------|
| 1.1 | V-002 | Delete `src/scene/token-adapter/internals/` (empty) | ✅ Done |
| 1.2 | V-003 | Delete `src/ui/internals/` (empty) | ✅ Done |
| 1.3 | V-006 | Delete `tests/terrain/` (orphaned empty dir) | ✅ Done |
| 1.4 | V-045 | Remove unused `Container` import from `managers/GridRenderer.js` | ⏭ Skipped — false positive, import IS used |
| 1.5 | V-046 | Remove commented-out import from `managers/TerrainManager.js` | ✅ Done |
| 1.6 | V-054 | Delete duplicate `tests/unit/TerrainCoordinator3DPicking.test.js` | ✅ Done |
| 1.7 | V-055 | Delete duplicate `tests/unit/TerrainStateInternals.test.js` | ✅ Done |
| 1.8 | V-056 | Delete duplicate `tests/unit/viewMode.test.js` (keep `core/` copy) | ✅ Done |
| 1.9 | V-058 | Already covered by 1.3 (empty `tests/terrain/`) | ✅ Done |

**COMMIT**: `60f3d34` — Phase 1 complete

---

## Phase 2 — Import/Export Fixes
*Fix export patterns and import boundary violations. May require updating importers.*

| Step | Violation | Task | Status |
|------|-----------|------|--------|
| 2.1 | V-033 | Fix `GameManager.js` dual export → single `export default` | ✅ Done + 7 test importers updated |
| 2.2 | V-034 | Fix `BiomeCanvasPainter.js` → `export default class` | ✅ Done + 1 test importer updated |
| 2.3 | V-035 | Fix `NoisePrimitives.js` → inline `export function` at each def | ✅ Done |
| 2.4 | V-036 | Fix `RadialMenu.js` → `export default class` | ✅ Done + UIController importer updated |
| 2.5 | V-039 | Fix `Validation.js` importing from `entities/` — inline the normalizer or move validation block | ✅ Done — inlined alias map + normalizer into Validation.js |
| 2.6 | V-041 | Fix `placeables.js` import pattern (`import logger, {…}` → `import { logger, …}`) | ✅ Done |
| 2.7 | V-040 | Add blank line between import groups in `DragController.js` | ⏭ Skipped — imports already correct |

**COMMIT**: `02a0d25` — Phase 2 complete

---

## Phase 3 — Test Structure Cleanup
*Fix non-standard test naming.*

| Step | Violation | Task | Status |
|------|-----------|------|--------|
| 3.1 | V-057 | Rename `Placeables.trees.test.js` → `PlaceablesTrees.test.js` | ✅ Done |

**COMMIT**: `3c8134d` — Phase 3 complete

---

## Phase 4 — Section Comments
*Add `// ── Section Name ──` markers to 18 files. No logic changes.*

| Step | Violation | Task | Status |
|------|-----------|------|--------|
| 4.1 | V-015 | Add sections to `coordinators/TerrainCoordinator.js` | ⏭ Already has full sections |
| 4.2 | V-016 | Add sections to `coordinators/RenderCoordinator.js` | ✅ Added Constructor marker |
| 4.3 | V-017 | Add constructor section to `coordinators/StateCoordinator.js` | ✅ Added Constructor marker |
| 4.4 | V-018–020 | Add constructor sections to `ElevationScaleController`, `BiomeShadingController`, `TileLifecycleController` | ✅ Done (3 files) |
| 4.5 | V-021 | Add sections to `core/ModelPostProcessing.js` | ✅ Added Public API marker |
| 4.6 | V-022–024 | Add sections to `core/game-manager/internals/` (init, tokenDrag, elevation) | ✅ Done (3 files) |
| 4.7 | V-025 | Add sections to `coordinators/ProjectionUtils.js` | ⏭ Already has sections |
| 4.8 | V-026 | Add sections to `managers/interaction-manager/internals/target-resolution.js` | ✅ Added 3 section markers |
| 4.9 | V-027–030 | Add sections to dice files (DiceState, FaceCalibrationUI, dice.js, dice3d.js) | ⏭ Already have adequate sections |
| 4.10 | V-031 | Add sections to `terrain/painting/BiomeCanvasPainter.js` | ⏭ Already has full sections |
| 4.11 | V-032 | Add sections to `terrain/flora/floraHelpers.js` | ⏭ Already has sections |

**COMMIT**: `f2c0f59` — Phase 4 complete

---

## Phase 5 — File Moves & Renames
*Structural moves that require updating all importers. Higher risk — test after each.*

| Step | Violation | Task | Status |
|------|-----------|------|--------|
| 5.1 | V-042 | Rename `ui/domHelpers.js` → `ui/dom-helpers.js` + update importers | ✅ Done |
| 5.2 | V-044 | Convert `CreatureFactory` class → plain function export + update importers | ✅ Done |
| 5.3 | V-001 | Reorganize `scene/token-adapter/` into subdirs (movement/, pathing/, spatial/) | ✅ Done (15→4 root + 3 subdirs) |
| 5.4 | V-004 | Move `core/PixiStub.js` → `utils/stubs/PixiStub.js` + update importers | ✅ Done (15 files + index.html) |
| 5.5 | V-005 | Move `coordinators/ProjectionUtils.js` → `utils/coordinates/ProjectionUtils.js` + update importers | ✅ Done |

**COMMITS**: `cec870a` (5.1), `7bc54a3` (5.2), `9c6e79e` (5.3), `32bca46` (5.4), `7ca65bb` (5.5)

---

## Phase 6 — Convention Doc Updates
*Update CONVENTIONS.md to reflect reality and new patterns.*

| Step | Violation | Task | Status |
|------|-----------|------|--------|
| 6.1 | V-007 | Remove `ui/lib/` from target structure (files don't exist) OR create them | ✅ Removed from target |
| 6.2 | V-008 | Add `terrain/flora/` to target structure | ✅ Done |
| 6.3 | — | Document mixin installer pattern used in `scene/token-adapter/` | ✅ Added §3.3 |
| 6.4 | — | Add `scene/token-adapter/` subdirectory layout to target structure | ✅ Done |

**COMMIT**: `7b6d21d` — Phase 6 complete

---

## Deferred / Out of Scope

| Item | Reason |
|------|--------|
| V-009–014: Extract logic from config files | Large refactor — schedule separately |
| V-047–048: Dead UI stubs | Low risk, fix opportunistically |
| V-050–053: File size (soft guideline) | Monitor, not blocking |
| V-059: Test coverage gaps | Separate effort, not a conventions fix |
| V-037–038: Controls export style | Very minor, fix opportunistically |

---

## Commit Log

| # | Phase | Scope | Hash | Notes |
|---|-------|-------|------|-------|
| 1 | Phase 1 | Cleanup empty dirs, dead code, duplicate tests | `60f3d34` | V-002,003,006,046,054,055,056,058 resolved. V-045 false positive (Container used). Tests: 70 suites, 3 pre-existing failures unchanged. |
| 2 | Phase 2 | Fix import/export violations | `02a0d25` | V-033,034,035,036,039,041 resolved. V-040 already correct (skipped). 16 files changed. Tests: 70/70 pass. |
| 3 | Phase 3 | Rename non-standard test file | `3c8134d` | V-057 resolved. Tests: 70/70 pass. |
| 4 | Phase 4 | Add missing section comments | `f2c0f59` | 10 files updated, 7 files already adequate. V-015 thru V-032 resolved. Tests: 70/70 pass. |
| 5a | Phase 5.1 | Rename domHelpers.js | `cec870a` | V-042. 3 importers + test updated. Tests: 70/70 pass. |
| 5b | Phase 5.2 | CreatureFactory → function | `7bc54a3` | V-044. Tests: 70/70 pass. |
| 5c | Phase 5.3 | Reorganize token-adapter/ | `9c6e79e` | V-001. 11 files into 3 subdirs, 9 internal refs fixed. Tests: 70/70 pass. |
| 5d | Phase 5.4 | Move PixiStub to utils/stubs/ | `32bca46` | V-004. 15 source files + index.html updated. Tests: 70/70 pass. |
| 5e | Phase 5.5 | Move ProjectionUtils to utils/ | `7ca65bb` | V-005. 6 importers updated. Tests: 70/70 pass. |
| 6 | Phase 6 | Update CONVENTIONS.md target structure | `7b6d21d` | V-007,008 resolved. Mixin pattern documented (§3.3). token-adapter subdirs in target. |
