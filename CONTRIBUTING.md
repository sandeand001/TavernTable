# Contributing Guide

This project uses a lightweight, explicit architecture and AI-aware documentation. Please follow these steps for any change (code or docs).

## 1. Read Before You Change
- `copilot-instructions.md` (TL;DR + rules)
- `docs/AI_CODEBASE_MAP.json` (module inventory / ownership)
- `docs/AI_DEP_GRAPH.mmd` (dependency edges)
- `docs/ARCHITECTURE-LAYERS.md` (allowed import directions)

## 2. Pick the Right Layer
Layer order (top → bottom at runtime):
`ui` (may depend on below) → `systems` → `managers` → `core` → `config` + `utils` (lowest, pure).
Lower layers MUST NOT import from `src/ui` (enforced by `npm run lint:layers`).

## 3. Plan the Change
Open a PR or issue with:
- Intent / problem
- Files you expect to touch
- Behavior changes & what must not regress
- Tests you will add/update
- Docs to update (code map, dep graph, glossary)

## 4. Implement
- Reuse existing utilities where possible (search `ai-index.json`).
- Keep diffs small & cohesive.
- Follow depth ordering rule: `zIndex = (gridX + gridY) * 100 + bandOffset` inside the terrain container.
- Do not introduce new deps unless justified (no bundler present—browser ESM only).

## 5. Update AI Docs (When Structural Changes Happen)
If you add/move/rename modules or alter dependencies:
- Run `npm run map:update` (or `node ai/update_codebase_map.js`).
- Edit `docs/AI_DEP_GRAPH.mmd` and `docs/AI_CODEBASE_MAP.md` as needed.
- Reflect new concepts in `docs/AI_GLOSSARY.md`.

## 6. Quality Gates
Run locally before pushing:
```bash
npm run lint:all
npm test
npm run map:update
```
Add or update tests for new logic. Keep passes green.

## 7. Commit & PR
Use clear imperative commit messages (optionally conventional):
`feat(terrain): add biome shading intensity slider`

PR Checklist (copy into description):
- [ ] Layer boundaries respected
- [ ] Depth ordering unchanged or intentionally updated
- [ ] Tests added/updated and passing
- [ ] AI docs updated (map / graph / glossary) if structure changed
- [ ] Lint & format clean

## 8. Out of Scope / Anti-Patterns
- Random or per-frame zIndex hacks
- Importing `src/ui` from non-UI code
- Large refactors without a prior proposal
- Introducing heavy frameworks (React, Redux, etc.)

## 9. Getting Help
Open an issue with a minimal reproduction (screenshots or steps). For rendering order issues, list grid (x,y), elevation, and expected occlusion.

Thanks for contributing!
