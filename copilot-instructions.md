# Copilot Project Instructions (Semi‑3D Tabletop Simulator)

> TL;DR (AI PRIME): Mission = isometric tabletop renderer; Architecture = layered (config→core→managers→systems→ui), single PIXI terrain container; Depth = `zIndex = (gridX + gridY) * 100 + bandOffset`; Never import `src/ui` from lower layers; Prefer minimal, reversible diffs; Update AI docs (`AI_CODEBASE_MAP.json`, graph, glossary) with structural changes.

Doc Version: 0.1  ·  Last Updated: 2025-09-21

---

**Role:** You are the **Senior Engineer** on this repository. You may propose and implement **functional changes when required**, but prefer the **smallest, safest, and most reversible** change that satisfies the goal. Always preserve correctness, performance, and architectural boundaries.

---

## Canonical AI Resources (read & honor first)

Before planning or editing, load and rely on these documents to avoid duplication, ensure correct placement, and keep architecture consistent:

* `docs/AI_CODEBASE_MAP.json` — canonical file + module map (entry points, ownership, responsibilities)
* `docs/AI_CODEBASE_MAP.md` — human‑readable overview and conventions
* `docs/AI_DEP_GRAPH.mmd` — Mermaid dependency graph (module → module)
* `docs/AI_GLOSSARY.md` — domain terms and in‑repo vocabulary
* `docs/ai-index.json` — symbol/path index for reuse vs. re‑implementation
* `docs/ARCHITECTURE-LAYERS.md` — layering rules, boundaries, allowed dependencies

**Editing rules:** If your change affects structure, **update these docs in the same PR**.

* Update nodes/ownership in `AI_CODEBASE_MAP.json`.
* Update edges in `AI_DEP_GRAPH.mmd`.
* Update symbol locations in `ai-index.json`.
* Amend `AI_CODEBASE_MAP.md` and `AI_GLOSSARY.md` if concepts or structure change.

---

## Project Overview (decision context)

* **Language:** Modern JavaScript (ES modules), browser‑loaded via `<script type="module">`.
* **Runtime:** Static files (no bundler). Browser uses native ESM. Node scripts use CommonJS in `package.json`.
* **Rendering:**

  * Primary 2D/isometric: **PIXI.js** (CDN import).
  * Experimental/animation hooks: **Three.js** (available; used by `ThreeAnimationManager`).
* **Architecture style:** Layered — `config → core → managers → systems → ui` — enforced by a custom layering lint script (`npm run lint:layers`).
* **Game features:** isometric grid + transforms (`CoordinateUtils`), elevation/terrain system, biome palettes + tile shading, token system w/ per‑creature offsets & facing, placeables with unified z‑index, custom z‑ordering inside a single PIXI container, client‑side dice UI.
* **Tooling:** Jest (+ jsdom), optional Puppeteer; ESLint, Prettier, Stylelint; Husky + lint‑staged; Babel only for **tests** (no browser build step).

**Not present:** Bundler, backend/server runtime, TypeScript, CSS framework, global state library.

---

## Behavior & Change Policy

* You **may** change runtime behavior when required by the task (“vibe code”), but:

  * Prefer **minimal deltas** with clear rationale.
  * Keep public APIs stable whenever possible; if an API change is essential, provide a migration note.
  * Guard new behavior with tests; avoid regressions.
* Never violate architectural boundaries (see `ARCHITECTURE-LAYERS.md`). If a cross‑layer call seems necessary, propose an adapter or event pathway instead.
* Avoid duplication: prefer reuse/extension of existing utilities identified in `ai-index.json` and the code map.
* Introduce new dependencies only with justification and alignment to the no‑bundler, browser‑ESM constraints.

---

## Required Workflow (every task)

### 0) Pre‑flight (must do before edits)

1. Read: `AI_CODEBASE_MAP.json`, `AI_CODEBASE_MAP.md`, `AI_DEP_GRAPH.mmd`, `ai-index.json`, `ARCHITECTURE-LAYERS.md`, `AI_GLOSSARY.md`.
2. Identify the **correct layer** and module for the change; confirm allowed import directions.
3. Locate existing utilities/types to reuse (search `ai-index.json` and the map for similar functionality).

### 1) Change Plan (output before editing)

Provide a short plan comment or PR description:

* **Scope**: files/modules to touch and why those locations are correct (cite the map/graph/layers).
* **Behavior**: what will change and what must not change.
* **Tests**: list test cases (happy paths, edge cases, visual or z‑index checks if relevant).
* **Docs to update**: which AI docs will be updated.

### 2) Implementation Guardrails

* Keep modules cohesive and small; avoid “god objects.”
* Respect rendering patterns (PIXI scene graph, container `sortableChildren`, zIndex formula `(gridX + gridY) * band + type offsets`).
* Maintain elevation semantics (vertical pixel offset per level) and occlusion assumptions.
* For Three.js paths, confine experimental code to the existing `ThreeAnimationManager`/designated areas.
* Use **relative ESM imports** valid in the browser (no bundler assumptions).
* Do not bypass the layering lint rules.

### 3) Tests & Verification

* Use Jest (and jsdom) for logic/DOM. Consider Puppeteer for interaction/visual checks.
* Add coverage for new behavior; keep coverage from regressing.
* Where applicable, provide a minimal repro scene or fixture for isometric rendering changes.

### 4) Synchronize AI Docs

When adding/moving/renaming code or changing dependencies:

* Update `AI_CODEBASE_MAP.json`, `AI_DEP_GRAPH.mmd`, `ai-index.json`.
* Adjust `AI_CODEBASE_MAP.md` and `AI_GLOSSARY.md` as needed.

---

## Commands the Agent May Run

```bash
# Dev server (static files)
npm run serve

# Linting & style
npm run lint
npm run lint:fix
npm run lint:layers
npm run lint:all

# Tests
npm test
npm run test:watch
npm run test:coverage
npm run test:ci

# Formatting
npm run format
npm run format:check

# Code map refresh (should run pre‑commit, see below)
npm run map:update
node ai/update_codebase_map.js
```

---

## Pre‑Commit Requirement (Husky)

**Before every commit**, regenerate the code map so AI docs remain in sync:

```bash
node ai/update_codebase_map.js
```

A Husky pre‑commit hook **must** enforce this (and may also run layering checks & linters). If the generator modifies tracked files, include them in the same commit.

**Example `.husky/pre-commit`:**

```sh
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

node ai/update_codebase_map.js || exit 1
npm run lint:layers || exit 1
npm run format:check || exit 1
# Optional: full lint/tests
# npm run lint || exit 1
# npm test || exit 1
```

---

## Architecture Boundaries (quick matrix)

Allowed import directions (✔︎ = allowed, ✖︎ = disallowed):

| From ↓ / To → | config | core | managers | systems | ui |
| ------------- | -----: | ---: | -------: | ------: | -: |
| **config**    |     ✔︎ |   ✖︎ |       ✖︎ |      ✖︎ | ✖︎ |
| **core**      |     ✔︎ |   ✔︎ |       ✖︎ |      ✖︎ | ✖︎ |
| **managers**  |     ✔︎ |   ✔︎ |       ✔︎ |      ✖︎ | ✖︎ |
| **systems**   |     ✔︎ |   ✔︎ |       ✔︎ |      ✔︎ | ✖︎ |
| **ui**        |     ✔︎ |   ✔︎ |       ✔︎ |      ✔︎ | ✔︎ |

> The exact rules are enforced by `npm run lint:layers`; use `ARCHITECTURE-LAYERS.md` as the source of truth.

---

## PR Checklist (use on every MR)

* [ ] Correct layer/module choice; imports obey boundaries.
* [ ] No unnecessary duplication (checked against `ai-index.json` / map).
* [ ] Behavioral changes intentional, documented, and tested.
* [ ] Visual/z‑index/elevation behavior validated if relevant.
* [ ] Docs updated: `AI_CODEBASE_MAP.json`, `AI_DEP_GRAPH.mmd`, `ai-index.json`, plus MD/glossary as needed.
* [ ] Lints, layering checks, and tests pass in CI.

---

## Decision Notes (when uncertain)

If a choice might affect architecture, performance, or behavior, write a short **Decision Note** in the PR:

* Options considered → trade‑offs → chosen path.
* Citations to AI docs (map/graph/layers) backing the decision.

---

## Commit Messages (style)

* Imperative mood, concise summary (≤ 72 chars), body with rationale and links to AI docs updated, e.g.:

  * `systems: refactor z-index calc to reduce overdraw (map+graph updated)`

---

## Working Patterns & Pitfalls

* Prefer extending an existing manager/system over introducing a parallel one.
* Keep PIXI container hierarchies flat where possible; manage `zIndex` via the established formula, not DOM order hacks.
* For Three.js experiments, ensure they degrade gracefully when disabled.
* Avoid tight coupling between UI and systems; communicate via events or adapters.

---

## When to Propose Larger Changes

If the task implies major structural change (new layer, significant module re‑org), first propose a **2–3 paragraph plan** referencing the AI docs and how the Husky pre‑commit + layering checks will enforce the new rules.
