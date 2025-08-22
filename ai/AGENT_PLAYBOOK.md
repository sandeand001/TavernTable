Agent Playbook — TavernTable

Scope

- Read-only default. Do not change runtime behavior outside docs/ and ai/.
- Keep docs/src mirrored with src/ only when deploying; prefer editing src/ as source of truth.

Startup checklist

- Load docs/AI_CODEBASE_MAP.json for structure and constraints.
- Respect .gitignore; skip node_modules, dist/build, coverage, .git, lockfiles, large binaries.
- Use npm scripts: test, lint; do not add dependencies without a lockfile.

Layering rules

- ui -> app only (coordinators, core)
- app -> domain (entities, terrain, utils) and infra (config)
- domain -> stdlib/utils only; no ui imports
- infra (config) -> no inbound imports from ui/app/domain required

Operational guidelines

- Prefer small, targeted changes; add tests for public behavior changes.
- Keep SpriteManager asset paths relative for GitHub Pages.
- Preserve Logger contexts/stages; use structured logs.
- Avoid introducing cycles; keep managers/coordinators small and split internals.

When adding features

- Update docs/AI_CODEBASE_MAP.md and docs/AI_CODEBASE_MAP.json via ai/update_codebase_map.js
- Add or update tests in tests/
- Run npm run test and npm run lint locally

Deployment

- GitHub Pages deploys from docs/; ensure docs/index.html includes full UI panels and mirrors src/.
- To retrigger deploy, push to main (docs/ changes) or use an empty commit on main.
