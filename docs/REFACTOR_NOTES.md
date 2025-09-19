# REFACTOR_NOTES — NFC Tracking

Chronological log of refactor actions (No Functional Change). Each section references commits.

## Template Entry
```
## <Commit Hash> <Summary>
Scope: <files / directories>
Type: move | rename | delete | comment | formatting | doc
Notes: <short justification>
Behavioral Impact: None (validated via tests & lint)
```

## Log
### a99d566 Formatting, Inventory & Cycle Scan (NFC)
Scope: tests/unit/OrchardLayout.test.js (auto-format via lint:fix); CLEANUP_PLAN.md (utils export inventory + cycle scan status); docs/REFACTOR_NOTES.md; tools/cycle-scan.js (new)
Type: formatting | doc | tooling
Notes: Added non-enforcing cycle scan for visibility; no runtime import side-effects changed.
Behavioral Impact: None (validated via full test run & lint)

### 00f2ca8 Dependency Audit Notes & cycle:scan script (NFC)
Scope: CLEANUP_PLAN.md (dependency audit section elaboration); package.json (add cycle:scan npm script)
Type: doc | tooling
Notes: Recorded absence of puppeteer & Levenshtein lib usage (deferred removal decisions); added convenience script to invoke existing cycle scan tool.
Behavioral Impact: None (validated via tests & lint)

### 6974e4f Archive formatted.tmp.js & Timer Scan (NFC)
Scope: .attic/root/formatted.tmp.js (new archived copy); CLEANUP_PLAN.md (mark archived + timer scan section)
Type: archive | doc
Notes: Unreferenced scratch file archived following policy; added preliminary timer usage inventory to plan to support future open-handle mitigation.
Behavioral Impact: None (tests & lint passed post-archival)

### (Post-6974e4f) Verification Run (NFC)
Scope: No file changes (test + lint verification only)
Type: verification
Notes: Re-ran full Jest suite (39/39 passing, 90 tests) and lint after archival commit to confirm NFC integrity. Observed existing Jest worker force-exit warning (open handle) persists; aligns with previously identified timers — no regression.
Behavioral Impact: None (baseline reaffirmed)

### (Uncommitted) Unused Export & Orphan Scan Tooling (NFC)
Scope: tools/find-unused-exports.js (new), tools/unused-scan-output.txt (artifact), CLEANUP_PLAN.md (Section 1.3)
Type: tooling | doc | analysis
Notes: Added heuristic script enumerating unused exports and orphan modules; captured snapshot output and summarized triage (no deletions). Non-asserting test pass found no empty tests.
Behavioral Impact: None (script not imported by runtime; docs only)

### (Uncommitted) Orphan Retention & Legacy Tagging Annotations (NFC)
Scope: src/core/*Manager.js, src/managers/BiomeCanvasPainter.js (shim), src/ui/UIController.js, src/ui/SidebarController.js, config (BiomePalettes, BiomeConstants, GameConstants), CLEANUP_PLAN.md (Phase 1 closure)
Type: doc | comments
Notes: Added NFC rationale comments for heuristic orphans & legacy/future exports to prevent premature deletion; recorded Phase 1 closure & Phase 2 plan seed.
Behavioral Impact: None (comment-only changes)

### (Uncommitted) Timer Registry Installation (NFC)
Scope: tests/timerRegistry.js (new), tests/setup.js (import + afterEach), CLEANUP_PLAN.md (Phase 2 section)
Type: tooling | test infra | doc
Notes: Added non-intrusive test-only wrapper for setTimeout/setInterval to auto-clear timers per test and reduce Jest open-handle warnings. No production code modified.
Behavioral Impact: None (test environment only)
