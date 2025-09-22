 AI Codebase Map — TavernTable

Overview

TavernTable is a browser-based, isometric tabletop interface built with vanilla JavaScript modules, rendered via HTML Canvas/Web APIs (with optional Pixi.js helpers in utilities), tested by Jest, and hosted as a static site (GitHub Pages) from the docs/ folder. The codebase is organized into cohesive folders by responsibility: ui, coordinators, core, managers, systems, entities, terrain, utils, and config.

Inventory and Structure

- Languages: JavaScript (ES modules), HTML, CSS
- Package manager: npm (Jest, ESLint, Stylelint configured)
- Entry points:
  - index.html (local dev)
  - docs/index.html (GitHub Pages)
  - Primary runtime bootstrap: src/core/GameManager.js via ui/UIController.js and coordinators/StateCoordinator.js
- Tests: Jest test suite in tests/ (unit + terrain painter)
- Lint: ESLint for JS, Stylelint for CSS (configs in tools/)

Folder purposes and typical layer mapping

- src/ui — UI wiring and DOM controls (layer: ui)
- src/coordinators — Application orchestration/state (layer: app)
- src/core — Core game bootstrap and sprite/animation managers (layer: app)
- src/managers — Rendering, interaction, tokens, terrain managers (layer: app)
- src/systems — Input/drag and system-level concerns (layer: app)
- src/entities — Domain entities (creatures, tokens) (layer: domain)
- src/terrain — Domain logic for terrain/biomes/brush (layer: domain)
- src/config — Constants, palettes, offsets (layer: infra)
- src/utils — Utilities, logging, validation, pixi helpers (layer: domain/lib)
- docs/src — Deployed mirror of src used by GitHub Pages; source of truth is src/

Key runtime flow (high level)

UIController -> GameManager.initialize -> StateCoordinator.initializeApplication ->
- TerrainCoordinator.initialize (TerrainManager, GridRenderer)
- InputCoordinator/RenderCoordinator setup
- SpriteManager.loadSprites -> assets/sprites/*.png

Contracts and invariants (do not break)

- Logging: structured via src/utils/Logger.js; keep contexts and stages stable for diagnostics.
- Public UI selectors and Sidebar tabs in index.html/docs/index.html must match SidebarController.js expectations.
- Asset paths: SpriteManager uses assets/sprites/*.png; paths must remain relative for GitHub Pages.
- Config constants (GameConstants, TerrainConstants, Biome*): stable keys used across modules and tests.
  (2025-09-19 cleanup: pruned unused APP_CONFIG, INPUT_CONFIG, creature footprint/baseline/color sets, legacy biome color helpers, findBiome.)
- Token/Creature APIs: CreatureFactory/CreatureToken consumed by TokenManager and tests; keep constructor/shape stable.
- Terrain painter invariants: brush size, elevation scales, biome palettes; validated by tests in tests/terrain and tests/unit.

Cleanliness guardrails

- Directory boundaries: ui -> coordinators/app only; coordinators/app -> domain (entities/terrain/utils) and infra (config); domain must not import ui.
- Avoid long, god-like modules (>500 LOC) in coordinators/managers; split internals as already done under internals/.
- Keep utils pure and free of DOM side effects; logging isolated via Logger.
- Avoid cycles between managers and coordinators; use events/callbacks where needed.
- Prefer src/ as the source of truth; docs/src is a deploy mirror and should not diverge.

Known hotspots and duplication

- docs/src mirrors src/*: risk of drift; keep synchronized or generate during deploy.
- Many internals/* modules split by concern; ensure imports stay one-way toward leaves.

How to regenerate this map

- Run: node ai/update_codebase_map.js
- Outputs:
  - docs/AI_CODEBASE_MAP.json (machine-readable)
  - docs/AI_DEP_GRAPH.mmd (Mermaid dependency graph)
  - docs/AI_CODEBASE_MAP.md (this guide; overview will be refreshed)

Testing and linting

- Tests: npm run test (Jest)
- Lint: npm run lint (ESLint + Stylelint)

Architecture rules (enforced by convention)

- ui -> app (coordinators, core)
- app -> domain (entities, terrain, utils) and infra (config)
- domain -> stdlib/utils only (no importing ui)
- infra (config) -> no imports from ui/app/domain

Glossary

See docs/AI_GLOSSARY.md for domain terms (Grid, Token, Creature, Biome, Elevation, Brush, Palette, Sprite, Manager, Coordinator).

Maintenance

- Consider adding ai/precommit.hook.sample as a pre-commit hook to auto-refresh the map.
- Keep assets under assets/ consistent and valid for browser decoding.
