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
- [P] Verify if `formatted.tmp.js` is transient (likely scratch) — move to `.attic/` or delete.
  - Safety: grep references == 0; tests still green.
- [P] Identify any unused exports in `src/utils/` (e.g., logging helpers not referenced).
  - Safety: `grep -R "export function name"` & Jest run.

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
- [P] List devDependencies never imported in code (e.g., puppeteer?). Puppeteer presence suggests future e2e not currently used.
  - Safety: postpone removal until confirmed unused via grep for `puppeteer`.
- [Q] Evaluate if both `fast-levenshtein` and `fastest-levenshtein` are needed.

## 8. Build / Deploy Artifacts
- [P] Confirm `docs/src` parity: generate map and compare changed module counts.
  - Safety: treat docs/src as derived — refresh after refactors.

## 9. Circular Dependency Scan
- [P] Add a lightweight script (if quick) to detect obvious require/import cycles (NFC measure only).

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
