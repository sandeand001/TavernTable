---
name: taverntable
version: 1.0.0 (5a2447a-dirty)
languages: ["JavaScript"]
primary_frameworks: ["Pixi.js"]
package_managers: ["npm"]
entry_points: ["index.html", "src/ui/UIController.js"]
---

# Overview
Taverntable is an isometric grid-based tabletop game interface, designed for browser-based play and extensible terrain/creature management. It features a modular terrain system, biome painter, and token management for digital tabletop experiences.

# Quickstart
## Windows PowerShell
```powershell
npm install
npm run serve
# Open http://localhost:3000
```
## Bash
```bash
npm install
npm run serve
# Open http://localhost:3000
```

# Project Structure
```
Taverntable/
├── index.html                # Main entry point
├── package.json              # Project manifest
├── src/
│   ├── config/               # Game, terrain, biome constants
│   ├── core/                 # Game/animation managers
│   ├── entities/             # Creature tokens
│   ├── managers/             # Token, terrain, interaction managers
│   ├── systems/              # Drag, dice, terrain controllers
│   ├── terrain/              # Biome painter, style helpers
│   ├── ui/                   # UI controllers, sidebar, styles
│   └── utils/                # Validation, error, logger, env helpers
├── tests/                    # Unit and terrain tests
├── coverage/                 # Test coverage output
├── tools/                    # Lint configs, secondary package.json
└── .attic/                   # Archived docs/policies
```

# Tech Stack & Services
| Language    | JavaScript |
| Framework   | Pixi.js    |
| UI          | HTML/CSS   |
| Server      | Python (http.server for local dev) |
| Test        | Jest       |
| Lint        | ESLint, Stylelint |
| Package     | npm        |

# Build / Run / Test / Lint
| Action   | PowerShell Command                        | Bash Command                  |
|----------|-------------------------------------------|-------------------------------|
| Install  | npm install                               | npm install                   |
| Serve    | npm run serve                             | npm run serve                 |
| Lint     | npm run lint                              | npm run lint                  |
| Test     | npm test                                  | npm test                      |
| Lint Fix | npm run lint:fix                          | npm run lint:fix              |
 

# Configuration & Environment Variables
<!-- @updatable:env_vars -->
| NAME        | Required | Default      | Description                | Source           |
|-------------|----------|--------------|----------------------------|------------------|
| NODE_ENV    | No       | development  | Node environment           | src/utils/env.js |
| JEST_WORKER_ID | No    | (none)       | Jest test worker id        | src/utils/env.js |

.env.example
```
# Example environment variables
NODE_ENV=development
```
<!-- /@updatable:env_vars -->

# APIs & Endpoints / CLI
<!-- @updatable:endpoints -->
No OpenAPI/GraphQL schemas detected. All interaction is via browser UI at http://localhost:3000.
<!-- /@updatable:endpoints -->

# Data & Migrations
No database or migration system detected. All data is in-memory or browser-local.

# Observability
- Logging: Structured logger via `src/utils/Logger.js`
- Health: No explicit health endpoint; check browser console for errors.
- Metrics/Traces: Not present.

# Security Notes
- No secrets or sensitive config detected in codebase.
- Auth: Not implemented.
- SBOM/dep scan: Lint and test gates only.

# CI/CD
No CI/CD config detected (no .github/workflows, Jenkinsfile, etc). Lint and test must be run locally before commit.

# Operational Runbook
- Start: `npm run serve` (PowerShell/Bash)
- Stop: Ctrl+C in terminal
- Logs: Browser console
- Incidents: UI not loading → check server, browser console, lint/test output

# Architecture Notes & ADRs
No ADRs found. See `src/config/` for game/terrain/biome architecture.

# Contributing & Coding Standards
- Format: ESLint, Stylelint, lint-staged
- Commit: No conventional commit hooks detected
- PR: Run lint and test before submitting

# Troubleshooting
| Issue                | Cause                | Resolution                  |
|----------------------|---------------------|-----------------------------|
| UI not loading       | Server not running  | Run `npm run serve`         |
| Lint errors          | Code style issues   | Run `npm run lint:fix`      |
| Test failures        | Code/test bug       | Check test output, fix code |
| Port 3000 busy       | Another process     | Kill process or change port |
| Browser errors       | JS runtime error    | Check console, fix code     |

# Roadmap / Known Limitations
<!-- @updatable:release_notes -->
Recent changes (from git log):
- Step 8-10: painter smoke extended, dice smoke stabilized; add .attic archive policy; fix UIController lint; remove attic readme/index
- Step 7: convenience run scripts, add DOM helpers selectors test, and fix terrain tool button wiring to update active state
- Step 6: remove global UI/dice exposures; migrate to module-only event wiring; clean dev helpers; fix linting; update HTML wiring and tests; add env helpers and tests
- test(validation): add TerrainValidation boundary tests and TerrainCoordinator validation wrapper tests; suites green
- test(terrain/ui): add smoke tests for TerrainCoordinator public surface and elevation slider UI; all tests passing
 

<!-- Forest billboard generation feature removed: scripts and assets no longer present. -->
<!-- /@updatable:release_notes -->

# License
MIT

# Changelog (high-level)
- Modular terrain/biome system
- Token manager for creatures
- UI controllers for elevation, grid, sidebar
- Full test and lint coverage
