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
- Token navigation is animation-based and currently click-only. Cliff traversal
  retains aligned climbing/recovery and contact-timed landings. Rolls require
  enough flat landing space and room within the approved route. Remaining movement follow-ups are in
  [TODO.md](./TODO.md).
- The creature palette includes Mannequin, Knight and Mutant, using one shared
  humanoid animation and movement pipeline.
- Creature right-click menus retain emotes, add eight visual-only **Actions**,
  and open an in-app tabbed character sheet. Other planned commands share a
  disabled placeholder.
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

Hold the **right mouse button and drag** over the map to rotate and tilt it.
Controls remain attached when the 3D renderer recovers from a fallback surface.

Switching views preserves the current focus and zoom, and returning to 3D
restores the previous orbit angle. Top-down pitch stays locked while rotating.
Mouse-wheel zoom remains anchored to the ground beneath the cursor. Camera
changes do not rescale terrain heights or token movement.

## Creature menus and character sheets

Right-click a creature and choose **Character Sheet** to open its sheet
inside the app, not a separate browser window. **Emotes** retain their existing
animations. **Actions** offers Wave, Sit, Take Cover, Jump, Punch, Hit Reaction,
Dodge and Cast Spell. Other unfinished commands are represented by one disabled
**Not yet available** option.

The Knight (Mixamo's **Knight D Pelegrini**) and Mutant use the same one-square
footprint, movement settings, wall climbing, ledge hangs and falling rules as
Mannequin. They are appearances, not separate movement implementations.

The new actions are animation previews, not combat or movement rules:

- Wave and Sit loop. Take Cover requires an adjacent wall high enough for the
  crouched creature; it turns and makes a short within-cell adjustment to put
  the creature's back against the wall. It then holds the crouch. Moving,
  changing facing, or removing the wall releases cover. No armor/cover bonus
  is applied.
- Jump, Punch, Hit Reaction, Dodge and Cast Spell return to idle when their
  animation finishes. Jump is a complete jump in place, not the existing
  Rumba Dance animation.
- Dodge now visibly sidesteps and then takes an authored recovery step back,
  rather than playing in place or rewinding. Its gameplay position and
  allowance stay unchanged; the short out-and-back performance completes
  before another movement or facing request can begin.
- Other preview actions keep the token's gameplay position and allowance unchanged,
  except Take Cover's permitted alignment within its existing cell.
  They do not deal damage, grant cover, evade attacks, create spell effects,
  or add new traversal abilities.
- Manual actions require a stationary creature on the ground. They cannot
  interrupt a route, a climb, a held wall pose or a fall.
- New clips load on first use. A failed or interrupted load is reported instead
  of being marked as successfully played.

Adding another compatible character or action requires an asset and one catalog
entry, not another creature class or command switch. See the
[import and authoring workflow](./HANDOFF.md#shared-humanoid-imports-and-action-authoring).

Character sheets share one non-modal window:

- Drag the title bar to move it, and the bottom-right handle to resize it.
  The map remains interactive around the window.
- **− (Minimize)** collapses it to a movable title bar. **□ (Restore)** brings back
  its tabs and previous full size.
- Selecting creatures while minimized updates the selected sheet but leaves the
  window collapsed. Choosing **Character Sheet** from a creature menu restores it.
- Each creature gets its own tab. Selecting a creature on the map creates or
  selects its tab **while the sheet window is open**. Selecting a sheet tab
  also selects its creature on the map, including when navigating tabs with
  the keyboard.
- Selecting a tab centers the camera on that creature's current position,
  including its terrain height, without changing zoom or viewing angle.
  This is a one-time recenter, not automatic following. Map-to-tab synchronization
  does not pan the camera; click the active tab to recenter again.
- **× (Close)** hides the window without losing its tabs, size, or position.
  Selecting creatures does not reopen a closed window; use Character Sheet again.
- The `x` on a tab closes just that sheet. Deleting a creature also removes its tab.
- Each tab includes editable Movement settings; other sheet sections are still
  placeholders. Tabs and settings do not persist across page reloads.

The first creature of a type is initially unnumbered. Placing a second gives
them names such as **Mannequin 1** and **Mannequin 2**, including in existing sheet
tabs and the creature menu. Further copies increment the number independently
for each creature type; deleted numbers are not reused during the app session.

### Movement

Each creature has its own settings:

- **Speed (feet)** is the distance allowance, defaulting to **50 feet**.
- **Mode:** Walk or Run. Run changes ground pace, not the allowance; its downward
  wall movement is a free fall rather than a controlled descent.
- **Type:** Default or Drunk. Drunk uses the existing drunk animations without
  random movement or changes to the requested route.

Select a creature to outline the perimeter of its reachable area, without filling
the tiles. Excluded holes receive their own boundary, and the outline follows
terrain height and reachable sections of sheer walls. Each straight or diagonal
step costs **5 feet**, so 50 feet permits ten flat-ground steps. Routes account
for intervening terrain, other creatures, and existing blocking-placeable data;
cliff corners require a face-on approach rather than diagonal corner cutting.

**Facing:** left-click and drag directly on an idle creature to turn it to one of
eight grid-relative directions. The heading follows the drag in both perspective
and tactical views, even after camera rotation. Ordinary clicks retain selection
and movement behavior, and right-drag still orbits the camera. Turning does not
move the creature or cost movement. Escape or focus loss cancels a facing drag;
facing is protected during movement, wall attachment and committed actions.

**Height transitions** use actual vertical feet, not the number of terrain levels:

- Steps up to **1.5 feet** blend their height continuously instead of snapping.
- Waist-high ledges, up to **2.5 feet**, use a short authored mantle upward,
  controlled lowering in Walk, and an authored hop down in Run.
- Higher transitions use the appropriate full mantle, wall climb or
  gravity-driven fall. Controlled climbing still costs double vertical distance.
- Landing variants also use physical height: soft landings, braced landings
  above 7.5 feet, and rolls above 12 feet only when landing clearance permits.

**Vaults:** Run routes can vault over a waist-high terrain obstacle no more than
one square thick when a clear, supported landing at the starting height exists.
Vaults approach a wall face rather than cutting diagonally across its corner.
They cost the normal two horizontal steps (**10 feet**) plus double the vertical
rise. The complete vault must fit the allowance; there are no mid-vault stops.
An already aligned Run approach flows straight into the vault without an
in-place turning pause. Clicking the obstacle's top still stops on top. Walk uses
controlled climbing: crouch/stand recovery keeps its authored foot contacts, and
ordinary walking steps cover the remaining distance to the cell center.
Switching to Walk before a queued vault converts it to up/down traversal, while
an already committed vault finishes safely.

Climbing uses **2 feet of allowance per vertical foot**, both upward and during a
Walk descent. A creature already hanging on a wall with a 50-foot allowance can
climb at most **25 vertical feet** in that action. Ground approach steps still
count: 10 feet of ground movement plus 20 feet climbing costs 50 feet, and one
grid step onto a 10-foot-higher ledge costs **25 feet**. Small non-climbing steps
retain their normal grid cost. Vertical feet use the same world scale as the
5-foot-wide squares, not raw terrain-height levels.

Click inside the outlined area to move. Out-of-range clicks do nothing and keep the
creature selected. Empty background outside the rendered board is also ignored,
rather than redirecting the creature to an edge tile. Visible creature parts near
the board edge remain selectable. Each accepted click gets a fresh allowance; new movement
clicks for that creature are ignored until its current move finishes. The outline
hides while it moves and returns at its new position afterward.

Click a reachable wall point to stop partway up or down. Destinations prefer
nearby **5-foot height intervals**, but the creature moves continuously to that
point rather than snapping there. Exact allowance boundaries and terrain ends
may lie between those intervals. The creature holds its climbing pose until
another move, which receives a fresh allowance. Wall movement is vertical-only;
changing columns requires returning to ground or the ledge first.
A hanging creature's selection ring lies flat against its wall face, centered
behind its rendered body rather than its logical grid anchor. Getting off the
wall restores the normal horizontal ground ring.

The upper wall remains selectable when the allowance can reach a stable
**ledge hang**. Click the wall near the lip to hang with both hands on the edge;
click the top ground surface to finish climbing onto the platform. These are
separate movement destinations and costs. Entry/exit animations never freeze
mid-crouch. If the remaining allowance cannot reach a safe wall pose, the
creature stays standing at the edge instead of stopping halfway through entry.

In **Run**, click reachable lower ground to drop without vertical movement cost.
There is no mid-air catching; use **Walk** to descend to another wall point.
Changing the mode while already hanging does not release the creature by itself.
Controlled mannequin descents use a dedicated **Climbing Down Wall** animation
instead of playing the upward wall loop backward. Mid-wall holds and resumes
retain the downward cycle's pose and timing.

Falls accelerate under gravity at the grid's physical scale rather than drifting
at a constant speed. A 20-foot fall takes about **1.1 seconds airborne**; a
36-foot fall takes about **1.5 seconds**. Landing contact follows that trajectory,
while the recovery animation retains its normal pace.

Changing **Mode** or **Type** updates the current gait and travel pace immediately,
without resetting the original allowance. Switching an active controlled descent
to Run starts a drop to ground. Switching Run to Walk before a drop starts can
make the destination too expensive: the creature stops at its remaining allowance,
including mid-wall when needed. A drop/release already in progress finishes
safely, then adopts the new gait. Changes to **Speed (feet)** apply to the next move.

Keyboard creature movement and turning are disabled for now. Mouse map rotation
and keyboard navigation within sheets still work. Token-placement/drag editing
remains separate from distance-limited click navigation; there is no turn system.

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

## Biome plant placement

Oasis uses individual palm, banana, Monstera, and fern models, not the complete
tropical asset pack. Instancing preserves their calibrated size, authored
transforms, materials, and ground-level root anchor. Monstera leaves use the
cutouts already present in the supplied color textures.

Generated trees keep their normal size wherever the trunk base fits supported
ground. Near a terrain drop or map edge, generation uniformly shrinks a tree
only as much as needed, down to **65% of its normal size**. If that is still too
large, the site is skipped. Canopies may naturally overhang; they do not determine
the required ground footprint.

Manual placement is not automatically resized. The fit is calculated during
generation; later terrain carving does not automatically refit existing trees.
Hard-refresh and regenerate to apply these changes to a new map.

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

### Verification snapshot: October 28, 2026

- Jest: **100 suites, 751 tests passing**.
- JavaScript lint: **0 errors, 40 existing unused-variable warnings**.
- Stylesheet lint and architecture-layer check: **passing**.
- The repository-wide formatting check flags the unchanged
  [lint configuration](./tools/.eslintrc.json). Changed JavaScript and tests pass
  a focused formatting check.

The humanoid contracts replay actual FBXs on all three registered characters:
grounding, shared locomotion, live gait changes, movement budgets, double-cost
climbs, frozen wall poses, two-hand ledge grips, gravity-driven falls, every
manual action, asynchronous failures and removal/loading races. Browser checks
also decoded the imported 2048-pixel textures and exercised body picking and the
eight-action menu. The earlier `webgl_unavailable` result was caused by an
overly strict application startup check, not missing browser support. The
check now accepts working software-backed WebGL, matching the renderer's
default policy. Live grid and character rendering in VS Code is verified.

Cliff-motion regression coverage includes real Three.js hierarchy transforms,
animation/root blending, terrain-edge detection, exact arrival budgets, input
release, and landing clearance. Fresh-load browser replays with the actual FBX
clips also cover walk/run/sprint, both inputs, adjacent height changes, elevation
scales, and 30/60/120 FPS. See [HANDOFF.md](./HANDOFF.md) for motion invariants and
remaining limits; a green suite alone does not close every older movement report.
Wall-cycle tests use the actual skinned skeleton at 30/60/120 FPS and uneven
frame intervals, checking joint continuity, action weight, and animation/controller
clock alignment rather than only the final token position.
Partial-climb coverage also checks frozen hand poses, smooth up/down resumption,
reversed mantles, live-mode allowance caps, canonical tile ownership, and real
heightfield-face picking.
Fall regressions measure acceleration and airtime independently of recovery,
including different tile/elevation scales, uneven frames, short drops, and actual
FBX foot-contact timing.
Large-d20 tests additionally use the real GLB geometry to cover all 20 numbered
faces, physical ground contact, bounds/terrain, frame-rate independence, short
throws, cancellation, cocked rolls, and result/log consistency.
Camera tests use real Three.js projections to cover near/far edge widths,
landscape/portrait framing, non-unit tiles, stored view modes, cursor zoom,
ground-plane pan math, and picking after projection switches.
Biome placement regressions parse the actual tropical FBX and terrain OBJ assets.
They cover individual species selection, calibrated geometry, root anchors,
compound meshes, reflected transforms, and supported trunk vertices across
generated Oasis, temperate-forest, and exotic scenes.
Character-sheet tests cover duplicate naming, per-token tabs, selection and
removal events, hide/reopen behavior, drag/resize bounds, menu routing, and
preserved emotes. Browser checks also cover actual placement, token selection,
window gestures, and map input after a radial menu closes.
Movement-allowance tests additionally cover perimeter geometry and holes, live
gait changes and continuation, exact ten-square boundaries, diagonal
and climbing costs, reachable detours, all four gait combinations, ignored
out-of-range/busy clicks, disabled keyboard input, live range updates, and
overlay cleanup. Actual-FBX replays verify constrained climbs/falls and the
return to idle after arrival.

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

- [CONTEXT.md](./CONTEXT.md): shared domain vocabulary.
- [TODO.md](./TODO.md): current engineering follow-ups and feature backlog.
- [CONVENTIONS.md](./CONVENTIONS.md): code organization and conventions.
- [HANDOFF.md](./HANDOFF.md): concise maintenance handoff and cleanup context.
- [March 2026 conventions audit](./docs/archive/CONVENTIONS-AUDIT-2026-03-30.md):
  historical findings that must be rechecked before acting on them.
