# Conventions Remediation Plan

**Created**: March 27, 2026  
**Baseline**: 72/73 test suites passing (3 pre-existing failures in Token3DAdapter.test.js)  
**Note**: 800-line limit is a soft guideline, not a hard requirement.

---

## Phase 1 — Cleanup: Empty Dirs, Dead Code, Duplicates
*Zero-risk changes. No logic changes, no import rewiring.*

| Step | Violation | Task | Status |
|------|-----------|------|--------|
| 1.1 | V-002 | Delete `src/scene/token-adapter/internals/` (empty) | |
| 1.2 | V-003 | Delete `src/ui/internals/` (empty) | |
| 1.3 | V-006 | Delete `tests/terrain/` (orphaned empty dir) | |
| 1.4 | V-045 | Remove unused `Container` import from `managers/GridRenderer.js` | |
| 1.5 | V-046 | Remove commented-out import from `managers/TerrainManager.js` | |
| 1.6 | V-054 | Delete duplicate `tests/unit/TerrainCoordinator3DPicking.test.js` | |
| 1.7 | V-055 | Delete duplicate `tests/unit/TerrainStateInternals.test.js` | |
| 1.8 | V-056 | Delete duplicate `tests/unit/viewMode.test.js` (keep `core/` copy) | |
| 1.9 | V-058 | Already covered by 1.3 (empty `tests/terrain/`) | |

**COMMIT**: after 1.1–1.8 ·  

---

## Phase 2 — Import/Export Fixes
*Fix export patterns and import boundary violations. May require updating importers.*

| Step | Violation | Task | Status |
|------|-----------|------|--------|
| 2.1 | V-033 | Fix `GameManager.js` dual export → single `export default` | |
| 2.2 | V-034 | Fix `BiomeCanvasPainter.js` → `export default class` | |
| 2.3 | V-035 | Fix `NoisePrimitives.js` → inline `export function` at each def | |
| 2.4 | V-036 | Fix `RadialMenu.js` → `export default class` | |
| 2.5 | V-039 | Fix `Validation.js` importing from `entities/` — inline the normalizer or move validation block | |
| 2.6 | V-041 | Fix `placeables.js` import pattern (`import logger, {…}` → `import { logger, …}`) | |
| 2.7 | V-040 | Add blank line between import groups in `DragController.js` | |

**COMMIT**: after 2.1–2.7 ·  

---

## Phase 3 — Test Structure Cleanup
*Fix non-standard test naming.*

| Step | Violation | Task | Status |
|------|-----------|------|--------|
| 3.1 | V-057 | Rename `Placeables.trees.test.js` → `PlaceablesTrees.test.js` | |

**COMMIT**: after 3.1 ·  

---

## Phase 4 — Section Comments
*Add `// ── Section Name ──` markers to 18 files. No logic changes.*

| Step | Violation | Task | Status |
|------|-----------|------|--------|
| 4.1 | V-015 | Add sections to `coordinators/TerrainCoordinator.js` | |
| 4.2 | V-016 | Add sections to `coordinators/RenderCoordinator.js` | |
| 4.3 | V-017 | Add constructor section to `coordinators/StateCoordinator.js` | |
| 4.4 | V-018–020 | Add constructor sections to `ElevationScaleController`, `BiomeShadingController`, `TileLifecycleController` | |
| 4.5 | V-021 | Add sections to `core/ModelPostProcessing.js` | |
| 4.6 | V-022–024 | Add sections to `core/game-manager/internals/` (init, tokenDrag, elevation) | |
| 4.7 | V-025 | Add sections to `coordinators/ProjectionUtils.js` | |
| 4.8 | V-026 | Add sections to `managers/interaction-manager/internals/target-resolution.js` | |
| 4.9 | V-027–030 | Add sections to dice files (DiceState, FaceCalibrationUI, dice.js, dice3d.js) | |
| 4.10 | V-031 | Add sections to `terrain/painting/BiomeCanvasPainter.js` | |
| 4.11 | V-032 | Add sections to `terrain/flora/floraHelpers.js` | |

**COMMIT**: after 4.1–4.11 ·  

---

## Phase 5 — File Moves & Renames
*Structural moves that require updating all importers. Higher risk — test after each.*

| Step | Violation | Task | Status |
|------|-----------|------|--------|
| 5.1 | V-042 | Rename `ui/domHelpers.js` → `ui/dom-helpers.js` + update importers | |
| 5.2 | V-044 | Convert `CreatureFactory` class → plain function export + update importers | |
| 5.3 | V-001 | Reorganize `scene/token-adapter/` into subdirs (movement/, pathing/, spatial/) | |
| 5.4 | V-004 | Move `core/PixiStub.js` → `utils/stubs/PixiStub.js` + update importers | |
| 5.5 | V-005 | Move `coordinators/ProjectionUtils.js` → `utils/coordinates/ProjectionUtils.js` + update importers | |

**COMMIT**: after each step (5.1, 5.2, 5.3, 5.4, 5.5) individually ·  

---

## Phase 6 — Convention Doc Updates
*Update CONVENTIONS.md to reflect reality and new patterns.*

| Step | Violation | Task | Status |
|------|-----------|------|--------|
| 6.1 | V-007 | Remove `ui/lib/` from target structure (files don't exist) OR create them | |
| 6.2 | V-008 | Add `terrain/flora/` to target structure | |
| 6.3 | — | Document mixin installer pattern used in `scene/token-adapter/` | |
| 6.4 | — | Add `scene/token-adapter/` subdirectory layout to target structure | |

**COMMIT**: after 6.1–6.4 ·  

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
| | | | | |
