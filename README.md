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
- Internet access for the pinned Three.js modules and the large d20's cannon-es
  physics module loaded from jsDelivr.

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

After changing code, hard-refresh the browser (`Ctrl+Shift+R`) and regenerate the
map. There is no hot reload, and an open tab can retain old JavaScript modules
and cached models.

## Current state

- Rendering uses Three.js. The former PIXI renderer has been removed, but some
  compatibility helpers and old renderer-oriented test fixtures remain.
- The orbiting 3D view uses natural perspective. Tactical top-down stays
  orthographic, with parallel edges and no distance-based foreshortening.
- OBJ/FBX model loading and instanced placeables are wired into the 3D scene.
- Automatic biome flora uses concrete model-backed plants, not virtual family
  menu entries. Instance-group creation is shared per model and invalidated
  when a map is cleared or regenerated.
- Token navigation is animation-based. Click and keyboard cliff traversal now
  share approach geometry, aligned climbing/recovery, and contact-timed landings.
  Rolls require enough flat landing space. Remaining movement follow-ups are in
  [TODO.md](./TODO.md).
- The single large d20 uses rigid-body physics and reads its actual resting face.
  Other dice types and multiple-die rolls retain their existing behavior.
- The terrain-engine migration is **partially implemented**.
  [TerrainEngine](./src/terrain/TerrainEngine.js) exists, but the live
  [TerrainCoordinator](./src/coordinators/TerrainCoordinator.js) still owns a
  separate height store. Do not treat the accepted
  [terrain design](./docs/adr/ADR-0001-terrain-engine-event-seam.md) as completed.
- There is no complete scene save/load interface, shared-session multiplayer,
  or packaged desktop release. The engine's terrain snapshot methods are not a
  complete application persistence feature.

## Camera views

In **Settings**, enable **Top-Down View** for an orthographic tactical map.
Disable it to return to natural 3D perspective: nearby edges appear larger than
distant edges rather than looking like an ambiguous parallel projection.

Switching views preserves the current focus and zoom, and returning to 3D
restores the previous orbit angle. Top-down pitch stays locked while rotating.
Mouse-wheel zoom remains anchored to the ground beneath the cursor. Camera
changes do not rescale terrain heights or token movement.

## Large d20 rolls

With **Count: 1**, press **d20** to throw the gold die onto the board. Bounces,
tumbling, friction, and quiet-body settling come from a fixed-step physics
simulation rather than a scripted tour and a final face snap.
The low forward launch scales with the board's usable span, sending the die
across the board with end-over-end tumble and a modest rebound from its boundary
walls. Surface resistance keeps the finish from dragging on.

The displayed result comes from the resting numbered face. If the die is caught
between faces, the result says **D20 is cocked. Roll again.** The model stays
visible for inspection, no number is logged, and you can press d20 again.
Clicking the die dismisses it; dismissing during a throw cancels that roll.
On very small boards, its size is reduced enough to leave rolling room.

Only an unavailable 3D renderer uses the existing 2D d20 fallback. A failed or
unreadable physical roll never silently becomes a random result.

## Exotic biome appearances

All biomes marked `exotic` use biome-specific appearances, including those listed
outside the Exotic menu group. Choose a biome and press **Generate** to apply
its population and appearance.

| Biome             | Generated asset appearance                                                | Opacity range |
| ----------------- | ------------------------------------------------------------------------- | ------------- |
| Blood Marsh       | Crimson, burgundy, and muted red tones; suitable shallow-marsh vegetation | 65-85%        |
| Mystic Grove      | Teal, mint, lavender, and pale gold                                       | 60-80%        |
| Feywild Bloom     | Pink, aqua, lilac, and lime                                               | 50-75%        |
| Shadowfell Forest | Muted blue-violet and ghostly gray dead trees                             | 30-60%        |
| Crystal Spires    | Blue-purple rocks and pebbles                                             | 45-80%        |
| Eldritch Rift     | Violet and eerie teal dead trees, fungi, and rocks                        | 30-65%        |
| Lava Fields       | Dark ember-tinted rocks and pebbles only; no plants or foliage            | 80-95%        |
| Astral Plateau    | Original natural texture colors, with transparency only                   | 35-65%        |
| Arcane Ley Nexus  | Unnatural magenta, cyan, violet, and blue tones                           | 35-70%        |

Lower opacity means more see-through. Variation is stable for the same biome,
seed, model, and position, so locking the seed also preserves the appearance
pattern. The palettes and opacity levels are defined in
[ExoticBiomeAppearance.js](./src/config/biome/ExoticBiomeAppearance.js).

Fantasy tinting retains the original texture detail and cutouts rather than
substituting the generic multicolored atlas. Astral retains the original texture
colors as well. Material copies are isolated from cached assets, so generating
an exotic biome does not tint or fade a later ordinary biome.

The **Asset Density** control scales generated trees, plants, and rocks. Changing
the biome palette alone recolors the ground; regenerate to replace the assets.

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

### Verification snapshot: October 24, 2026

- Jest: **77 suites, 341 tests passing**.
- JavaScript lint: **0 errors, 40 existing unused-variable warnings**.
- Stylesheet lint and architecture-layer check: **passing**.
- The repository-wide formatting check flags the unchanged
  [lint configuration](./tools/.eslintrc.json). Changed JavaScript and tests pass
  a focused formatting check.

Cliff-motion regression coverage includes real Three.js hierarchy transforms,
animation/root blending, terrain-edge detection, exact arrival budgets, input
release, and landing clearance. Fresh-load browser replays with the actual FBX
clips also cover walk/run/sprint, both inputs, adjacent height changes, elevation
scales, and 30/60/120 FPS. See [HANDOFF.md](./HANDOFF.md) for motion invariants and
remaining limits; a green suite alone does not close every older movement report.
Large-d20 tests additionally use the real GLB geometry to cover all 20 numbered
faces, physical ground contact, bounds/terrain, frame-rate independence, short
throws, cancellation, cocked rolls, and result/log consistency.
Camera tests use real Three.js projections to cover near/far edge widths,
landscape/portrait framing, non-unit tiles, stored view modes, cursor zoom,
ground-plane pan math, and picking after projection switches.

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
