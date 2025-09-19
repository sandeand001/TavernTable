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
### (Uncommitted) Formatting, Inventory & Cycle Scan (NFC)
Scope: tests/unit/OrchardLayout.test.js (auto-format via lint:fix); CLEANUP_PLAN.md (utils export inventory + cycle scan status); docs/REFACTOR_NOTES.md; tools/cycle-scan.js (new)
Type: formatting | doc | tooling
Notes: Added non-enforcing cycle scan for visibility; no runtime import side-effects changed.
Behavioral Impact: None (script unused by runtime, only optional tool)

*(Will replace with commit hash after commit)*

### (Uncommitted) Dependency Audit Notes & cycle:scan script (NFC)
Scope: CLEANUP_PLAN.md (dependency audit section elaboration); package.json (add cycle:scan npm script)
Type: doc | tooling
Notes: Recorded absence of puppeteer & Levenshtein lib usage (deferred removal decisions); added convenience script to invoke existing cycle scan tool.
Behavioral Impact: None (new script only, no runtime imports)

*(Will replace with commit hash after commit)*
