# Archive Policy (.attic)

This document describes how and when to move files into `.attic/`, and how to manage them once archived. The goal is to keep the working tree lean and clear while preserving useful historical context.

## When to archive
- Files are no longer used in the runtime, tests, or build outputs.
- A refactor or redesign replaced a previous implementation, but the old version may be useful for reference.
- Documentation or playbooks that are outdated but still provide context.

Prefer Git history for raw diffs. Use `.attic/` when developers benefit from discoverable, curated context.

## How to archive
1. Confirm the file(s) are unused (search references; ensure tests/build don’t rely on them).
2. Move to `.attic/` maintaining a similar folder structure when helpful, e.g.:
   - `src/legacy/GameManager_Original.js` → `.attic/src/core/GameManager_Original.js`
3. Add a short header comment at the top indicating:
   - Original path
   - Date archived (YYYY-MM-DD)
   - Reason (e.g., superseded by `src/core/GameManager.js` in PR #123)
4. Update `.attic/INDEX.md` (see below) with a brief entry.

## Do not do
- Do not import anything from `.attic/` in production code or tests.
- Do not keep secrets or credentials in `.attic/`.
- Do not use `.attic/` as a dump; keep it tidy and intentional.

## Indexing archived items
Maintain an optional `INDEX.md` to aid discoverability.

Entry template:
```
- [path/inside/attic/FileName.ext](path/inside/attic/FileName.ext)
  - Original: src/.../FileName.ext
  - Archived: 2025-08-20
  - Reason: short explanation, link to replacement if any
```

## Periodic cleanup
- Review `.attic/` quarterly. If items are no longer helpful, remove them (Git keeps history).
- Keep the index current.

## Tooling hints
- Lint/Build/test should ignore `.attic/` by default. If not, add ignore rules (e.g., ESLint `.eslintignore`, Jest `testPathIgnorePatterns`, tooling config).
