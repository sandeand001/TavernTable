# TavernTable

A local, browser-based tabletop scene editor built with JavaScript and Three.js.
The current app includes terrain and biome tools, 3D placeables, mannequin tokens,
animated navigation, and dice rolling.

## Getting started

Open this project directory in VS Code: the directory containing this file and
[package.json](./package.json), not the surrounding workspace directory.

Requirements:

- Node.js with npm.
- Python 3 available as `python`.
- A modern browser with WebGL 2.
- Internet access for the pinned Three.js modules loaded from jsDelivr.

Verified development environment: Windows, Node.js 24.4.1, npm 11.4.2, and
Python 3.13.14.

Run these commands from the project directory:

```powershell
npm ci
npm start
```

Open <http://localhost:3000>. Stop the server with `Ctrl+C`.
If port 3000 is occupied, use `npm run serve:alt1` and open
<http://localhost:3001>.

There is no application build step. Python serves the HTML, JavaScript, and
assets; open the app through HTTP rather than opening the HTML file directly.
The server is a development file server, not a multiplayer session server.

## Current state

- Rendering uses Three.js. The former PIXI renderer has been removed, but some
  compatibility helpers and old renderer-oriented test fixtures remain.
- OBJ/FBX model loading and instanced placeables are wired into the 3D scene.
- Token navigation is animation-based. The movement polish items in
  [TODO.md](./TODO.md) still need browser-level investigation.
- The terrain-engine migration is **partially implemented**.
  [TerrainEngine](./src/terrain/TerrainEngine.js) exists, but the live
  [TerrainCoordinator](./src/coordinators/TerrainCoordinator.js) still owns a
  separate height store. Do not treat the accepted
  [terrain design](./docs/adr/ADR-0001-terrain-engine-event-seam.md) as completed.
- There is no complete scene save/load interface, shared-session multiplayer,
  or packaged desktop release. The engine's terrain snapshot methods are not a
  complete application persistence feature.

## Development commands

| Command                                | Purpose                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------- |
| `npm run test:stable -- --watch=false` | Run the full Jest suite serially with open-handle detection                     |
| `npm run test:watch`                   | Run tests in watch mode                                                         |
| `npm run test:coverage`                | Generate a new coverage report                                                  |
| `npm run lint:all`                     | Run JavaScript, stylesheet, and architecture-layer checks                       |
| `npm run format:check`                 | Check formatting of configured source, test, tool, and documentation data files |
| `npm run format`                       | Format those files                                                              |

Run commands from the project root. The root package manifest is the only
package manifest for this app; lint configuration remains under
[tools](./tools/).

### Verification snapshot: October 23, 2026

- Jest: **63 suites, 190 tests passing**.
- JavaScript lint: **0 errors, 40 existing unused-variable warnings**.
- Stylesheet lint and architecture-layer check: **passing**.

The previous three movement-test failures were stale assertions/fixtures:
landing sanitization removes vertical root offsets, `W` selects the drunk gait,
and the real fall finalizer sets the idle phase. Tests now cover those contracts
without changing movement production code. A green unit suite does not resolve
the manually reported movement issues in the backlog.

## Project layout

- [src](./src/): application and rendering code.
- [tests](./tests/): Jest tests and test setup.
- [assets](./assets/): models, textures, animation files, and their licenses.
  Keep these resources and license files intact.
- [tools](./tools/) and [scripts](./scripts/): development and asset-inspection utilities.
- [docs/adr](./docs/adr/): accepted architecture decisions.
- [docs/archive](./docs/archive/): historical reports, not the current task list.

Dependencies and generated coverage output are ignored by Git. Do not use an old
coverage report as evidence of current test health.

## Documentation

- [TODO.md](./TODO.md): current engineering follow-ups and feature backlog.
- [CONVENTIONS.md](./CONVENTIONS.md): code organization and conventions.
- [HANDOFF.md](./HANDOFF.md): concise maintenance handoff and cleanup context.
- [March 2026 conventions audit](./docs/archive/CONVENTIONS-AUDIT-2026-03-30.md):
  historical findings that must be rechecked before acting on them.
