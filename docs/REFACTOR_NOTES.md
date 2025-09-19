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
