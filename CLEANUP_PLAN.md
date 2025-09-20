# CLEANUP_PLAN (Initial Skeleton) — No Functional Change

Branch: chore/nfc-cleanup
Date: 2025-09-18

## Guiding Principles
- Preserve runtime behavior: APIs, side-effects, config keys, file formats.
- Small, atomic commits with (NFC) tag.
- Each action mapped to a safety check (tests + grep + lint).

## Legend
| Status | Meaning |
|--------|---------|
| P | Planned |
| I | In progress |
| D | Done |
| Q | Question / needs confirmation |

## 1. Candidate Dead Code / Unused Modules
 (TBD after automated / grep analysis)
- [D] `formatted.tmp.js` identified as transient scratch file (0 refs). Archived to `.attic/root/formatted.tmp.js` (2025-09-18) per policy.
  - Safety Checks: grep references == 0 (confirmed); file not imported by runtime/tests; tests & lint rerun post-archival.
- [P] Identify any unused exports in `src/utils/` (e.g., logging helpers not referenced).
  - Safety: `grep -R "export function name"` & Jest run.
  
### 1.1 Preliminary Utils Export Inventory (Scan 2025-09-19) (NFC)
Status Legend: USED = referenced in src (import grep), DUP = duplicated concept across files, TBD = needs manual follow-up.

| File | Export(s) | Preliminary Status | Notes |
|------|-----------|--------------------|-------|
| env.js | isJest, getNodeEnv | USED | isJest used in UIController; getNodeEnv likely future-proof (keep) |
| TerrainPixiUtils.js | TerrainPixiUtils (class) | USED | Imported in terrain rendering contexts |
| Validation.js | TypeValidators, GameValidators, Sanitizers | PARTIAL USED | TypeValidators/GameValidators referenced; Sanitizers used in GameManager; all keep |
| TerrainValidation.js | TerrainValidation (class) | USED | Referenced by tests and validators |
| logger/enums.js | LOG_LEVEL, LOG_CATEGORY, LOG_OUTPUT | USED | Widely imported |
| TerrainHeightUtils.js | TerrainHeightUtils (class) | USED | Multiple terrain modules |
| SeededRNG.js | createSeededRNG, rngInt, rngPick, makeWeightedPicker, default aggregate | USED | Deterministic RNG in flora & tests |
| PixiShapeUtils.js | traceDiamondPath | USED | TerrainManager uses traceDiamondPath |
| Logger.js | many classes + logger (default), GameLogger, withPerformanceLogging, withLoggingContext | USED (broad) | High centrality; no action |
| ErrorHandler.js | classes, errorHandler (const), GameErrors, withErrorHandling, handleErrors, withPerformanceMonitoring, default export alias | USED | Core error infra |
| DepthUtils.js | DIAG_WEIGHT, X_TIE_WEIGHT, TYPE_BIAS, computeDepthKey, withOverlayRaise | USED | Depth ordering logic |
| error/enums.js | ERROR_SEVERITY, ERROR_CATEGORY, RECOVERY_STRATEGY | USED | Error system |
| error/notification.js | setErrorDomPorts, ErrorNotificationManager | TBD | UI usage not yet confirmed; keep (no removal) |
| error/telemetry.js | ErrorTelemetryManager | TBD | Telemetry wiring not fully searched beyond base grep; assume keep |
| CoordinateUtils.js | CoordinateUtils | USED | Interaction & coordinate transforms |
| CanvasShapeUtils.js | traceDiamondFacePath2D | USED | BiomeCanvasPainter, tests |
| ColorUtils.js | lightenColor, darkenColor, shadeMul | USED | Shading & tests |

Follow-up: error notification & telemetry classes marked TBD—retain until deeper analysis; no deletions proposed in Phase 1.

### 1.2 Timer / Open Handle Preliminary Scan (2025-09-18)
Scan: searched for `setTimeout|setInterval` across `src/`.
Findings (representative hotspots):
- `src/utils/Logger.js`: batching / sendTimeout logic.
- `src/ui/UIController.js`: debounce & retry hooks; one interval with stopper timeout.
- `src/utils/ErrorHandler.js` & `src/utils/error/*`: delayed error handling / notification dismissal.
- Managers (`InteractionManager`, `TerrainManager`, terrain updates internals) use timeouts for throttling.
- Dice system (`systems/dice/dice.js`): animation or deferred resolution.

Risk: Some timers may persist after tests complete, triggering Jest force-exit warning. No teardown hooks currently standardizing cancellation.

Deferred Action (Phase 2 candidate): Introduce a lightweight TestTimerRegistry to wrap and auto-clear timers in test environment (NFC) or add afterEach cleanup in specific suites. Requires careful audit to avoid masking genuine async issues.

### 1.3 Unused Export & Orphan Module Scan (2025-09-19)
Tooling: `tools/find-unused-exports.js` (heuristic; regex-based, no AST).

Run Output Snapshot (abridged):
```
UNUSED_EXPORTS (examples):
  src/config/BiomeConstants.js: findBiome, BIOME_GROUPS
  src/config/BiomePalettes.js: getBiomeHeightColor, getBiomeColorLegacy, blendWithBiome, BIOME_HEIGHT_PALETTES
  src/config/GameConstants.js: APP_CONFIG, INPUT_CONFIG, CREATURE_FOOTPRINTS, CREATURE_BASELINE_OFFSETS, CREATURE_COLORS
  src/utils/Logger.js: LoggerConfig, ConsoleOutputHandler, MemoryOutputHandler, RemoteOutputHandler, GameLogger, withPerformanceLogging, withLoggingContext, LOG_OUTPUT
  ... (see full: tools/unused-scan-output.txt)

ORPHAN_MODULES (examples):
  src/core/AnimatedSpriteManager.js
  src/core/SpriteManager.js
  src/managers/BiomeCanvasPainter.js
  src/ui/SidebarController.js
  src/ui/UIController.js
```

Interpretation / Triage:
| Category | Rationale | Planned Action |
|----------|-----------|----------------|
| Config constants (e.g., APP_CONFIG) | May be referenced indirectly in future features; risk of premature removal | Defer (Phase 3 reevaluation) |
| Legacy / transitional API (getBiomeColorLegacy, getBiomeHeightColor) | Potential backward-compatible helpers | Mark as legacy in comments later (NFC) |
| Logger & Error extended exports | Intentional breadth for composition; not all variants imported yet | Keep; maybe add doc comment grouping |
| Orphan managers (BiomeCanvasPainter, SpriteManager) | Possibly dynamically required or future integration | Verify dynamic usage before any change |
| UIController / SidebarController orphans | Likely entry points referenced only by manual initialization | Keep until bootstrap pattern formalized |

Non-asserting Test Scan:
  - Enumerated all `test(` / `it(` declarations under `tests/unit`. Manual sampling shows assertions present (expect/usage) or implicit by not throwing. No empty tests detected.

Safety Posture:
  - No deletions in Phase 1; findings are informational.
  - Will consider adding inline `// UNUSED?` comments only after second confirmation pass (deferred) to avoid churn.

Next (related):
  - Optional AST-based refinement (if heuristic noise proves high) — defer unless needed.
  - Dynamic import / side-effect module identification pass (to reduce false positives) — later phase.

## 2. Redundant / Overlapping Utilities
- [P] Check for multiple color manipulation utilities vs `colord` usage.
  - Safety: diff behavior by unit tests or add a quick surrogate test if missing.

## 3. Directory & Layer Conformance
- [P] Audit imports for violations: ui importing domain; domain importing ui.
  - Safety: layering script + custom grep for `from '../ui'` patterns.
- [P] Move any `internals` folder contents that leak into public API unexpectedly into clearer private path names (without changing exports).
  - Safety: create re-export shim if consumers rely on path (avoid break by leaving stub file exporting relocated module).

## 4. Naming Consistency
- [P] Ensure consistent biome naming across config (`BiomePalettes`, `TerrainPlaceables`, etc.).
  - Safety: only comment/doc renames; no key renames.

## 5. Test Suite Hygiene
- [P] Detect non-asserting tests (grep for `test(` without expect) — validate manually.
- [P] Flakiness: worker force-exit; investigate timers (search `setTimeout`, `setInterval`) and consider explicit teardown in NFC manner (adding `unref` or clearing timers in afterEach). If changes are logical risk, postpone.

## 6. Formatting & Style
- [P] Normalize indentation issues in `tests/unit/OrchardLayout.test.js` (already failing lint).
  - Safety: formatting-only commit.
- [P] Run `npm run format:check` and resolve any drift.

## 7. Dependency Audit
- [D] Grep shows no runtime/test imports of `puppeteer` (only appears in package & plan doc). Treat as FUTURE (planned E2E) dependency; do NOT remove in Phase 1. Mark for reevaluation in Phase 3 (stabilization) if still unused.
  - Safety: keep for now to avoid breaking unpublished workflows; add note to refactor log.
- [Q] Evaluate if both `fast-levenshtein` and `fastest-levenshtein` are needed.
  - Observation: Neither library name appears in `src/**/*.js` (grep zero hits). Both appear only in package manifests. Candidate duplication — prefer one (likely `fastest-levenshtein`).
  - Action (Deferred): Add micro benchmark test before removal; remove the slower one in a dedicated NFC commit with perf note. Not in current phase.

## 8. Build / Deploy Artifacts
- [P] Confirm `docs/src` parity: generate map and compare changed module counts.
  - Safety: treat docs/src as derived — refresh after refactors.

## 9. Circular Dependency Scan
- [D] Added lightweight script `tools/cycle-scan.js` to detect straightforward relative import cycles (NFC visibility only). Does not fail CI; informational output.
  - Latest run (2025-09-19): "No simple relative import cycles detected. (NFC)"

## 10. Logging and Diagnostics
- [P] Add clarifying comments for logger context constants; no renames.

## 11. Documentation Updates
- [P] Update AI map after refactors: `npm run map:update`.
- [P] Create `docs/DELETIONS.md` & `docs/REFACTOR_NOTES.md` skeletons early.

## 12. Safety Checklist Template (Per Commit)
```
Commit: <summary> (NFC)
Scope: files moved/removed
Checks:
  - grep old path: 0 refs
  - tests: PASS
  - lint: PASS
  - layering: PASS
Notes: <short justification>
```

## 13. Open Questions
- Are there any runtime dynamic asset registrations outside static imports? (Need confirmation before pruning any asset reference helpers.)
- Should puppeteer-based smoke tests be added (out of NFC scope) or left for later feature work?

## 14. Next Immediate Actions
1. (Baseline) Capture formatting diffs for orchard test (already failing) — integrate into first NFC commit.
2. Perform unused export scan (dry run; no deletions yet) and append results here.
3. Add skeleton docs for deletions/refactor notes.

---
(Plan will be iteratively expanded; see commit history for evolution.)

## Phase 1 Closure (2025-09-19)
Status: Completed core inventory & hygiene objectives.

Deliverables Achieved:
- Utils export inventory (1.1) and timer scan (1.2).
- Unused export & orphan module heuristic scan (1.3) with triage; no deletions.
- Annotations added to orphan modules (SpriteManager, AnimatedSpriteManager, TerrainManager, UIController, SidebarController, BiomeCanvasPainter shim) explaining retention.
- Legacy/future exports tagged with inline comments (BiomePalettes, BiomeConstants, GameConstants).

Deferred to Phase 2:
- Timer/open-handle mitigation scaffolding (TestTimerRegistry or afterEach clears).
- Potential removal or consolidation of clearly unused constants after second confirmation pass.

Exit Criteria Met:
- All additions NFC (tests & lint pass per verification commits).
- Documentation & rationale captured before making any pruning decisions.

Next Phase (Phase 2) Focus:
1. Introduce standardized timer registration & teardown (minimize Jest open-handle warning) without behavior change.
2. Evaluate feasibility of consolidating duplicate dependencies (Levenshtein libs) with micro benchmark.
3. Prepare dynamic usage capture (optional lightweight logging) to confirm orphan status before any removal.

Transition Trigger: Begin Phase 2 when timer scaffold branch point created (chore/nfc-phase2) or continue on current branch if low-risk.

## Phase 2 (In Progress) — Timer / Open Handle Mitigation (NFC)
Objective: Eliminate Jest worker force-exit warning by ensuring no lingering timeouts/intervals after tests, without altering production logic.

Approach (Step 1 implemented):
1. Add `tests/timerRegistry.js` wrapping `setTimeout` / `setInterval`, tracking IDs and auto-clearing after each test. Uses unref() when available to reduce impact on Node event loop.
2. Integrate via `tests/setup.js` (try/catch guarded, comment-labeled NFC) — avoids touching runtime source.
3. (Diagnostics Enhancement) Added setImmediate tracking + optional stack capture (env `TEST_TIMER_CAPTURE_STACKS=1`) + afterAll summary to surface remaining handles.

Current Status:
- Tests still emit Jest force-exit warning; registry shows no remaining tracked timers implying another handle class (e.g., process event listener, unresolved promise with active I/O, or requestAnimationFrame polyfill) is responsible.
-Update (RAF + Process Diagnostics):
-- Added requestAnimationFrame tracking & auto-cancel to `tests/timerRegistry.js` (NFC) — covers animation frame handles.
-- Added optional process listener diagnostics module (`tests/processListenerDiagnostics.js`) gated by `TEST_PROCESS_LISTENER_DIAGNOSTICS=1` to surface added/removed listeners between start and end of test run.
-- No regressions in test outcomes; parallel run still intermittently shows force-exit warning, in-band detectOpenHandles does not, suggesting race/timing rather than persistent handle retention.

Next Investigative Steps:
- Run Jest with `--detectOpenHandles --runInBand` to capture additional hints.
- Instrument potential `requestAnimationFrame` or add wrapper if present in code under test.
- Audit for added process listeners (`process.on`) not removed in teardown.
- If still undetected, enable stack capture and log creation sites for intervals/timeouts to confirm zero residual handles.

## Phase 2 – Export Pruning (Batch 1 Recap & Batch 2 Added)
### Batch 1 (Recap)
Removed unused exports: biome legacy color helpers (getBiomeColorLegacy, blendWithBiome, getBiomeHeightColor now internal), GameConstants large unused sets (APP_CONFIG, INPUT_CONFIG, CREATURE_FOOTPRINTS, CREATURE_BASELINE_OFFSETS, CREATURE_COLORS), findBiome, rngPick, depth weighting constants internalized.
### Batch 2 (2025-09-19)
Actions (all NFC – verified via tests & lint):
- Removed obsolete shading helper functions; `src/terrain/ShadingHelpers.js` reduced to explicit empty module stub (was fully unused, previously partially deleted creating lint noise).
- Pruned logger `LOG_OUTPUT` re-export (no downstream imports) keeping `LOG_LEVEL` and `LOG_CATEGORY` public.
- Temporarily internalized `BIOME_GROUPS` but UI biome menu (SidebarController dynamic import) depended on named export; restored export and added regression test `BiomeGroupsExport.test.js`.
- Internalized `TREE_PLACEABLES` (no direct imports); now merged into `TERRAIN_PLACEABLES` internally without separate export to shrink surface.
- Updated `AI_CODEBASE_MAP.json` to reflect removed exports (`LOG_OUTPUT`, `TREE_PLACEABLES`, shading helpers) and restored `BIOME_GROUPS`.

Safety Checks:
- Grep confirmed absence of external references before each removal (`LOG_OUTPUT`, `TREE_PLACEABLES`, shading helpers functions).
- Full Jest run green after each step (added regression test increased total test count).
- Lint clean post adjustments.

Rationale Notes:
- `TREE_PLACEABLES` added redundancy: consuming code always accesses consolidated `TERRAIN_PLACEABLES`; export removed to discourage future direct coupling to tree variants map.
- Shading helpers presented maintenance burden with zero callers; replacement stub preserves potential future module path expectations while keeping bundle lean.
- Logger surface minimized incrementally; retaining only enums actually used by callers prevents unnecessary API stabilization of unused output enum.
- Regression test ensures accidental removal of `BIOME_GROUPS` will surface immediately (prevents silent UI palette disappearance).

### Batch 2 (2025-09-19)
Scope: Further shrink unused surface (logging + terrain constants) with NFC guarantee.

Changes:
- Logger: De-exported LoggerConfig, ConsoleOutputHandler, MemoryOutputHandler, RemoteOutputHandler, GameLogger, withPerformanceLogging, withLoggingContext (no external imports; internal logic retained). Enums (LOG_LEVEL, LOG_CATEGORY) and default logger remain.
- TerrainConstants: Removed TERRAIN_TOOLS, TERRAIN_SHORTCUTS, TERRAIN_VALIDATION (0 imports). Added inline cleanup note.

Safety Checks:
- Grep before removal: confirmed zero external imports for removed symbols.
- Lint: passes post-removal (no unused vars).
- Tests: pending re-run verification step (expect PASS; functionality unaffected).

Next Candidate Batch (Planned):
- ShadingHelpers unused pattern functions (confirm no dynamic lookup).
- Orphan managers/controllers if still unreferenced after shading pass.
- DOM helper getters (defer until sure no manual test harness usage).

Safety Considerations:
- All instrumentation confined to test layer; no production mutation.
- Stack capture gated by environment variable to avoid noise during routine runs.

Additional Optional Steps:
- If warning persists, capture run with both `TEST_TIMER_CAPTURE_STACKS=1` and `TEST_PROCESS_LISTENER_DIAGNOSTICS=1` to archive diagnostic output.
- Consider wrapping `setTimeout` long delays with a cap during tests (e.g., clamp >2s delays) purely for faster teardown diagnostics (would remain NFC logically but deferred unless needed).

### Phase 2 Export Pruning (2025-09-19)
Removed truly unused exports after multi-file grep confirmation:
- BiomePalettes: getBiomeColorLegacy, blendWithBiome (internalized BIOME_HEIGHT_PALETTES & getBiomeHeightColor)
- BiomeConstants: findBiome
- GameConstants: APP_CONFIG, INPUT_CONFIG, CREATURE_FOOTPRINTS, CREATURE_BASELINE_OFFSETS, CREATURE_COLORS (helpers now return neutral defaults)
- SeededRNG: rngPick (unused)
- DepthUtils: internalized DIAG_WEIGHT and X_TIE_WEIGHT (no external imports)

Safety Checklist per removal batch:
- grep old symbol name: 0 external refs (confirmed)
- tests: 39/39 passing post-change
- lint: PASS
- layering script: no new violations

Rationale: User directive removed future-retention constraint; objective shifted to minimal surface area. All deletions NFC (no executing call sites).

Post-Removal Adjustment (2025-09-19): Initial Batch 2 logger pruning also dropped internal LogEntry helper methods (generateId, sanitizeData, collectMetadata) implicitly relied upon during log creation, causing test failures (TypeError: this.generateId is not a function). Restored lean implementations ONLY (no re‑expansion of removed public helpers) plus explicit re-export of required enums (LOG_LEVEL, LOG_CATEGORY, LOG_OUTPUT). Tests re-run: 39/39 PASS. Terrain constant removals confirmed unrelated. This constitutes a corrective NFC patch, maintaining reduced public surface while fixing inadvertent internal dependency removal.

Current Logger Public Surface (post-correction):
- logger (default instance)
- Logger (class) — still exported for potential structured use
- LOG_LEVEL, LOG_CATEGORY, LOG_OUTPUT (enums)

Internal-Only (formerly exported, now intentionally private): LoggerConfig, ConsoleOutputHandler, MemoryOutputHandler, RemoteOutputHandler, GameLogger, withPerformanceLogging, withLoggingContext.

Safety Recap After Correction:
- grep removed symbols: 0 external refs
- tests: PASS (39/39)
- lint: PASS
- layering script: PASS
- docs: pending sync (next action)

Next: Document in REFACTOR_NOTES and update AI map (deferred until batch commit).
