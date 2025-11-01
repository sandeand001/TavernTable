# NFC Risk Register

Baseline Date: 2025-09-18
Branch: chore/nfc-cleanup

## 1. Summary
This document enumerates potential behavior change risks during No-Functional-Change (NFC) refactoring and the mitigations we will apply. Any action taken in the cleanup plan must cite at least one mitigation strategy here.

## 2. Baseline Metrics
- Test Suites: 39 passed / 0 failed
- Tests: 90 passed / 0 failed
- Coverage Thresholds (configured in `jest.config.js`): branches 60, functions 60, lines 60, statements 60 (exact current coverage % to be captured when running coverage mode if needed)
- Lint: 76 Prettier indentation errors in `tests/unit/OrchardLayout.test.js` currently (needs normalization) *[Update after formatting]*
- Architecture layering: `npm run lint:layers` passes

## 3. Risk Categories
| ID | Risk | Description | Likelihood | Impact | Mitigation |
|----|------|-------------|------------|--------|------------|
| R1 | Silent Behavior Drift | Moving/renaming modules causes path or relative import mistakes leading to altered code paths | Medium | High | Use incremental commits + run full test suite after each structural move; grep old path references; no logical edits in same commit as move |
| R2 | Dead Code False Positive | Removal of code thought unused but invoked via dynamic/reflective access | Low | High | Perform `grep` and search for string keys, check any registries; if uncertain, mark as deprecated instead of deleting |
| R3 | Test Flakiness Masking Regressions | Existing flakiness (worker force exit) hides new leaks | Medium | Medium | Use `jest --detectOpenHandles --runInBand` before and after large moves; document persistent leaks |
| R4 | Layer Boundary Violation | Refactors inadvertently introduce ui -> domain reverse dependency | Low | Medium | Run layering script (`lint:layers`); add a temporary script to detect new cycles if needed |
| R5 | Asset Path Breakage | Moving files affecting relative paths to assets (sprites, plants) breaks loading | Low | High | Do not move assets; if relocating code referencing assets, ensure relative paths unchanged; open browser smoke test (optional) |
| R6 | Config / Constants Mutation | Accidental rename of exported constant keys breaks consumers | Low | High | For config modules, allow only reordering + comment additions; no key renames, enforce diff review |
| R7 | Test Coverage Regression | Removing or merging tests lowers behavioral coverage | Medium | Medium | Only remove tests per policy; run coverage before/after suspicious deletions |
| R8 | Dependency Drift | Removing or updating dependencies changes transitive behavior | Low | High | Initial pass: only mark candidates; second pass requires explicit approval; lockfile diff inspection |
| R9 | Implicit Globals / Side Effects | Reordering imports changes initialization order and side effects | Medium | High | Maintain original top-level side-effect modules order; if moving, wrap pure exports; verify with snapshot of `Object.keys(require.cache)` (optional) |
| R10 | Build / Deploy Divergence | docs/ mirror falling out-of-sync after moves | Medium | Medium | Post-refactor run `npm run map:update`; diff docs/src vs src for critical entry points |
| R11 | Formatting-Only Commits Hiding Changes | Large formatting diffs obscure accidental logic edits | Medium | Medium | Keep formatting commits separate and labeled `chore(format): ... (NFC)` |
| R12 | Circular Dependency Introduction | Moving utilities into other folders creates cycles | Medium | High | Run a lightweight dependency cycle scan (TBD script) after directory reorganizations |

## 4. Mitigation Playbook
- Always: run `npm run test` and `npm run lint` after each multi-file move or deletion.
- For any deletion: capture evidence (grep, test pass) and record in `docs/DELETIONS.md`.
- For rename/move: commit includes only the move + import path adjustments; no logic edits.
- For formatting: isolate commit with Prettier normalization.
- For uncertain dynamic usage: search for bracket notation (e.g., `['moduleName']`, `window[...]`) referencing candidate names.

## 5. Out-of-Scope Changes
- No dependency upgrades (version bumps) unless required to eliminate unused deps (explicitly documented).
- No introduction of TypeScript or major tooling.
- No runtime feature toggles changed or removed unless permanently hard-coded ON and verified.

## 6. Documentation & Tracking
Artifacts to produce:
- `CLEANUP_PLAN.md`
- `docs/DELETIONS.md`
- `docs/REFACTOR_NOTES.md`
- Updated AI map files (`map:update` script)
- `NFC_VERIFICATION.md`

## 7. Approval Gates
Any action touching: config constants, public GameManager API, TerrainCoordinator public methods, or UIController requires explicit mention in commit message with (NFC) tag.

## 8. Open Questions / Assumptions
- Assumption: No dynamic `require`/`import()` using variable strings referencing internal modules (codebase appears ES module static imports). Will verify via grep for `import(`.
- Assumption: docs/src is currently a mirror; treat it as derived—will not manually refactor there until final sync.

## 9. Next Steps
1. Normalize formatting in failing test file(s) (create explicit formatting commit) — optionally after plan drafted.
2. Draft `CLEANUP_PLAN.md` enumerating candidate removals/moves.
3. Execute plan in phased, atomic commits.

-- End of Risk Register (initial)
